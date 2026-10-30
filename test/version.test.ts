// The version in the shipped scripts must match package.json, which packaging stamps into SKILL.md.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { releaseNotes } from "../tools/version.ts";
import { readJson, ROOT, SCRIPTS } from "./helpers.ts";

it("SKILL_VERSION in the compiled scripts equals package.json's version", () => {
  const { SKILL_VERSION } = createRequire(import.meta.url)(join(SCRIPTS, "lib/version.cjs")) as { SKILL_VERSION: string };
  assert.equal(SKILL_VERSION, readJson<{ version: string }>(join(ROOT, "package.json")).version);
});

it("SKILL.md ends with the same version", () => {
  const skillMd = readFileSync(join(ROOT, "skill/sales-proposal-builder/SKILL.md"), "utf8");
  assert.match(skillMd, new RegExp(`Skill version ${readJson<{ version: string }>(join(ROOT, "package.json")).version.replaceAll(".", "\\.")}\\.\\s*$`));
});

it("release notes are the version's CHANGELOG section, without its heading", () => {
  const changelog = "# Changelog\n\n## [1.1.0] - 2026-11-01\n\n### Added\n- New.\n\n## [1.0.0] - 2026-10-01\n\n### Added\n- Old.\n";
  assert.equal(releaseNotes("1.1.0", changelog), "### Added\n- New.");
  assert.equal(releaseNotes("1.0.0", changelog), "### Added\n- Old.");
  assert.throws(() => releaseNotes("2.0.0", changelog), /no "## \[2\.0\.0\]" section/);
  const current = readJson<{ version: string }>(join(ROOT, "package.json")).version;
  assert.ok(releaseNotes(current).length > 0, "the current version has release notes");
});
