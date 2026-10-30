// The version in the shipped scripts must match package.json, which packaging stamps into SKILL.md.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { it } from "node:test";
import { readJson, ROOT, SCRIPTS } from "./helpers.ts";

it("SKILL_VERSION in the compiled scripts equals package.json's version", () => {
  const { SKILL_VERSION } = createRequire(import.meta.url)(join(SCRIPTS, "lib/version.cjs")) as { SKILL_VERSION: string };
  assert.equal(SKILL_VERSION, readJson<{ version: string }>(join(ROOT, "package.json")).version);
});
