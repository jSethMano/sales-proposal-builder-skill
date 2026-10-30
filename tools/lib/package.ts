// Packages the skill for one company (design §11): the company-neutral core plus one pack in
// company/, zipped with the skill folder at the root, after checking every rule the platforms
// enforce. Used by tools/package.ts and by the eval harness.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { listFiles, zipFolder } from "./zip.ts";

export const ROOT = resolve(import.meta.dirname, "../..");
export const SKILL_NAME = "sales-proposal-builder";
export const CORE_DIR = join(ROOT, "skill", SKILL_NAME);

// Limits from Anthropic's skill docs (checked 2026-10-30; see HANDOVER.md §3).
const MAX_NAME = 64;
// The platform allows 1,024 characters, but claude.ai's upload limit is 200, so 200 works everywhere.
const MAX_DESCRIPTION = 200;
const MAX_SKILL_MD_LINES = 500;
// A reference longer than this starts with a table of contents, so a partial read still finds things.
const TOC_THRESHOLD_LINES = 100;
// /v1/skills accepts uploads under 30 MB uncompressed.
const MAX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
const SHIPPED_ONLY = /\.(?:ts|cts|mts|map)$/;

export interface PackageOptions {
  /** Pack folder; the core's own neutral pack when omitted. */
  packDir?: string;
  /** Name of the dist folder, e.g. "lumen-ridge-it" or "neutral". */
  name?: string;
  coreDir?: string;
  outDir?: string;
}

export interface PackageResult {
  name: string;
  packId: string;
  version: string;
  path: string;
  sha256: string;
  bytes: number;
  files: string[];
}

export class PackageError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Packaging failed:\n- ${problems.join("\n- ")}`);
    this.problems = problems;
  }
}

export function packageSkill(options: PackageOptions = {}): PackageResult {
  const coreDir = options.coreDir ?? CORE_DIR;
  const packDir = resolve(options.packDir ?? join(coreDir, "company"));
  const name = options.name ?? (options.packDir ? basename(packDir) : "neutral");
  const outDir = options.outDir ?? join(ROOT, "dist", name);
  const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;

  // The shipped checker validates the pack, so packaging and runtime agree on what a valid pack is.
  const check = checkPack(coreDir, packDir);
  if (options.packDir && check.configured !== true) {
    throw new PackageError([`${packDir} is not configured; only the core's neutral pack may have configured: false.`]);
  }

  const stage = join(outDir, "stage", SKILL_NAME);
  rmSync(join(outDir, "stage"), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(join(coreDir, "SKILL.md"), join(stage, "SKILL.md"));
  cpSync(join(coreDir, "references"), join(stage, "references"), { recursive: true });
  cpSync(join(coreDir, "scripts"), join(stage, "scripts"), { recursive: true });
  cpSync(packDir, join(stage, "company"), { recursive: true });

  const problems = checkStage(stage, version);
  if (problems.length > 0) throw new PackageError(problems);

  const zipPath = join(outDir, `${SKILL_NAME}.zip`);
  const files = zipFolder(stage, SKILL_NAME, zipPath);
  const zip = readFileSync(zipPath);
  rmSync(join(outDir, "stage"), { recursive: true, force: true });
  return {
    name,
    packId: String(check.packId),
    version,
    path: zipPath,
    sha256: createHash("sha256").update(zip).digest("hex"),
    bytes: zip.length,
    files,
  };
}

function checkPack(coreDir: string, packDir: string): Record<string, unknown> {
  try {
    const out = execFileSync(process.execPath, [join(coreDir, "scripts/check-pack.cjs"), packDir], { encoding: "utf8" });
    return JSON.parse(out) as Record<string, unknown>;
  } catch (e) {
    const stdout = (e as { stdout?: string }).stdout ?? "";
    let messages: string[] = [String(e)];
    try {
      const json = JSON.parse(stdout) as { errors?: { path: string; message: string }[] };
      messages = (json.errors ?? []).map((p) => `${p.path}: ${p.message}`);
    } catch {
      // keep the raw error
    }
    throw new PackageError([`The pack at ${packDir} is invalid:`, ...messages]);
  }
}

/** Every rule a skill folder must meet. Returns the problems found; empty means it's good. */
export function checkStage(stage: string, version: string): string[] {
  const problems: string[] = [];
  const skillMd = readFileSync(join(stage, "SKILL.md"), "utf8");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(skillMd);
  if (!front) {
    problems.push("SKILL.md must start with YAML frontmatter between --- lines.");
  } else {
    const field = (key: string): string | undefined => new RegExp(`^${key}: (.+)$`, "m").exec(front[1] ?? "")?.[1]?.trim();
    const name = field("name");
    const description = field("description");
    if (!name) problems.push("Frontmatter needs a name.");
    else {
      if (name !== SKILL_NAME) problems.push(`Frontmatter name '${name}' must equal the folder name '${SKILL_NAME}'.`);
      if (name.length > MAX_NAME || !/^[a-z0-9-]+$/.test(name)) problems.push(`name must be at most ${MAX_NAME} lowercase letters, numbers and hyphens.`);
      if (/anthropic|claude/.test(name)) problems.push("name can't contain 'anthropic' or 'claude'.");
    }
    if (!description) problems.push("Frontmatter needs a description.");
    else {
      if (description.length > MAX_DESCRIPTION) problems.push(`description is ${description.length} characters; the limit is ${MAX_DESCRIPTION}.`);
      if (/[<>]/.test(description)) problems.push("description can't contain XML tags.");
    }
  }
  const lines = skillMd.split("\n").length;
  if (lines >= MAX_SKILL_MD_LINES) problems.push(`SKILL.md has ${lines} lines; keep it under ${MAX_SKILL_MD_LINES}.`);
  if (!skillMd.includes(`Skill version ${version}.`)) problems.push(`SKILL.md must end with "Skill version ${version}." (package.json's version).`);

  // References: one level deep, each linked straight from SKILL.md, long ones with contents.
  const refDir = join(stage, "references");
  const linked = new Set([...skillMd.matchAll(/\]\((references\/[^)#]+)\)/g)].map((m) => m[1]));
  for (const entry of readdirSync(refDir)) {
    const full = join(refDir, entry);
    if (statSync(full).isDirectory()) {
      problems.push(`references/${entry} is a folder; references must be one level deep.`);
      continue;
    }
    if (!linked.has(`references/${entry}`)) problems.push(`references/${entry} isn't linked from SKILL.md.`);
    const text = readFileSync(full, "utf8");
    const refLines = text.split("\n");
    if (refLines.length > TOC_THRESHOLD_LINES && !refLines.slice(0, 15).some((l) => /^## Contents/.test(l))) {
      problems.push(`references/${entry} has ${refLines.length} lines; start it with a "## Contents" list.`);
    }
  }
  for (const link of linked) {
    try {
      statSync(join(stage, link as string));
    } catch {
      problems.push(`SKILL.md links to ${link}, which doesn't exist.`);
    }
  }

  let total = 0;
  for (const file of listFiles(stage)) {
    total += statSync(file).size;
    if (SHIPPED_ONLY.test(file)) problems.push(`${relative(stage, file)} is source or a map file; only compiled scripts ship.`);
  }
  if (total > MAX_UNCOMPRESSED_BYTES) problems.push(`The skill is ${total} bytes uncompressed; the limit is ${MAX_UNCOMPRESSED_BYTES}.`);
  return problems;
}
