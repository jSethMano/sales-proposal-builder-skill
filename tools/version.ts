// Version tooling for releases (docs/change-management.md):
//   npm run version:bump -- 0.2.0     sets the version everywhere it lives and opens a CHANGELOG section
//   node tools/version.ts notes 0.2.0 prints that version's CHANGELOG section (used for release notes)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/package.ts";

const SEMVER = /^\d+\.\d+\.\d+$/;
const CHANGELOG = join(ROOT, "CHANGELOG.md");

/** The body of a version's section in CHANGELOG.md, without its heading. */
export function releaseNotes(version: string, changelog = readFileSync(CHANGELOG, "utf8")): string {
  const heading = new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\][^\\n]*\\n`, "m");
  const match = heading.exec(changelog);
  if (!match) throw new Error(`CHANGELOG.md has no "## [${version}]" section.`);
  const rest = changelog.slice(match.index + match[0].length);
  const next = rest.search(/^## \[/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function bump(version: string): void {
  if (!SEMVER.test(version)) throw new Error(`'${version}' isn't a version like 1.2.3.`);
  // npm updates package.json and package-lock.json together.
  execFileSync("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"], { cwd: ROOT, stdio: "ignore" });

  const replaceIn = (file: string, pattern: RegExp, replacement: string): void => {
    const path = join(ROOT, file);
    const text = readFileSync(path, "utf8");
    if (!pattern.test(text)) throw new Error(`${file}: no match for ${pattern}.`);
    writeFileSync(path, text.replace(pattern, replacement));
  };
  replaceIn("src/skill/lib/version.cts", /SKILL_VERSION = "[^"]+"/, `SKILL_VERSION = "${version}"`);
  replaceIn("skill/sales-proposal-builder/SKILL.md", /^Skill version [^\n]+\.$/m, `Skill version ${version}.`);

  const changelog = readFileSync(CHANGELOG, "utf8");
  if (!changelog.includes(`## [${version}]`)) {
    const today = new Date().toISOString().slice(0, 10);
    const firstSection = changelog.search(/^## \[/m);
    const entry = `## [${version}] - ${today}\n\n### Changed\n- Describe the change, and who approved it if it touches pricing or terms.\n\n`;
    writeFileSync(CHANGELOG, changelog.slice(0, firstSection) + entry + changelog.slice(firstSection));
  }

  // The example proposals point at their pricing by hash, and the version is part of the pricing.
  execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(ROOT, "tsconfig.skill.json")], { stdio: "inherit" });
  for (const [fixture, pack] of [["acme-lumen", "packs/lumen-ridge-it"], ["acme-ironbark", "packs/ironbark-msp"]] as const) {
    const dir = join(ROOT, "test/fixtures/proposals", fixture);
    const out = execFileSync(process.execPath, [join(ROOT, "skill/sales-proposal-builder/scripts/price.cjs"), join(dir, "quote.json"), "--pack", join(ROOT, pack)], { encoding: "utf8" });
    const ref = `sha256:${(JSON.parse(out) as { sha256: string }).sha256}`;
    replaceIn(`test/fixtures/proposals/${fixture}/proposal.json`, /"pricingRef": "sha256:[0-9a-f]{64}"/, `"pricingRef": "${ref}"`);
  }
  console.log(`Version ${version}: package.json, package-lock.json, version.cts, SKILL.md, CHANGELOG.md and example pricing refs updated.`);
  console.log("Next: describe the change in CHANGELOG.md, run npm test, open a PR. After merge, tag v" + version + " to release.");
}

const [command, version] = process.argv.slice(2);
if (import.meta.main) {
  if (command === "bump" && version) bump(version);
  else if (command === "notes" && version) console.log(releaseNotes(version));
  else {
    console.error("Usage: node tools/version.ts bump <x.y.z> | notes <x.y.z>");
    process.exitCode = 2;
  }
}
