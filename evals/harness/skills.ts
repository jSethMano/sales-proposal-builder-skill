// Uploads each packaged zip once and remembers it. evals/.skills.json (git-ignored) maps each zip's
// sha256 to the skill version it was uploaded as, so an unchanged zip is never uploaded twice.
// Requests always pin that exact version, never "latest", so a run tests the zip it says it tests.
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { type PackageResult, ROOT } from "../../tools/lib/package.ts";

const MANIFEST = join(ROOT, "evals/.skills.json");

interface Manifest {
  /** One custom skill per pack; later zips of the same pack become new versions of it. */
  skills: Record<string, string>;
  versions: Record<string, { pack: string; skillId: string; versionId: string; uploadedAt: string }>;
}

export interface PinnedSkill {
  skillId: string;
  versionId: string;
}

function readManifest(): Manifest {
  return existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest) : { skills: {}, versions: {} };
}

export async function ensureSkill(client: Anthropic, zip: PackageResult): Promise<PinnedSkill> {
  const manifest = readManifest();
  const known = manifest.versions[zip.sha256];
  if (known) return { skillId: known.skillId, versionId: known.versionId };

  const file = await toFile(createReadStream(zip.path), "sales-proposal-builder.zip");
  let pinned: PinnedSkill;
  const existing = manifest.skills[zip.name];
  if (existing) {
    const version = await client.skills.versions.create(existing, { files: [file] });
    pinned = { skillId: existing, versionId: version.id };
  } else {
    const skill = await client.skills.create({ files: [file], display_name: `sales-proposal-builder eval (${zip.name})` });
    pinned = { skillId: skill.id, versionId: skill.latest_version_id };
    manifest.skills[zip.name] = skill.id;
  }
  manifest.versions[zip.sha256] = { pack: zip.name, ...pinned, uploadedAt: new Date().toISOString() };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return pinned;
}
