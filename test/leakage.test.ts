// White-label isolation (NFR-3): the skill core must not contain anything from a company pack.
// Covers the skill core and the built documents; M5 adds the zip checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { listFiles } from "../tools/lib/zip.ts";
import { openDocx } from "./docx.ts";
import { buildFixture, DEMO_PACKS, identifyingStrings, readJson, ROOT, SKILL_DIR } from "./helpers.ts";

/** The skill core: the TypeScript source and the shipped skill folder, minus the swappable pack. */
function coreFiles(): string[] {
  const neutralPack = join(SKILL_DIR, "company");
  return [...listFiles(join(ROOT, "src/skill")), ...listFiles(SKILL_DIR)].filter((f) => !f.startsWith(neutralPack));
}

describe("the skill core contains no company", () => {
  for (const [name, dir] of Object.entries(DEMO_PACKS)) {
    it(`no string from the ${name} pack`, () => {
      const needles = identifyingStrings(dir).map((s) => s.toLowerCase());
      const hits: string[] = [];
      for (const file of coreFiles()) {
        const text = readFileSync(file, "utf8").toLowerCase();
        for (const needle of needles) if (text.includes(needle)) hits.push(`${relative(ROOT, file)}: "${needle}"`);
      }
      assert.deepEqual(hits, []);
    });
  }

  it("the neutral pack holds no demo company either", () => {
    const needles = Object.values(DEMO_PACKS).flatMap(identifyingStrings).map((s) => s.toLowerCase());
    for (const file of listFiles(join(SKILL_DIR, "company"))) {
      const text = readFileSync(file, "utf8").toLowerCase();
      assert.deepEqual(needles.filter((n) => text.includes(n)), [], relative(ROOT, file));
    }
  });
});

describe("each document carries only its own pack", () => {
  const lower = (s: string): string => s.toLowerCase();
  const docs = {
    lumen: openDocx(buildFixture("acme-lumen", DEMO_PACKS.lumen).out).allXml().toLowerCase(),
    ironbark: openDocx(buildFixture("acme-ironbark", DEMO_PACKS.ironbark).out).allXml().toLowerCase(),
  };
  const strings = { lumen: identifyingStrings(DEMO_PACKS.lumen).map(lower), ironbark: identifyingStrings(DEMO_PACKS.ironbark).map(lower) };
  const brand = (dir: string) => readJson<{ company: { displayName: string }; colors: { primary: string } }>(join(dir, "brand.json"));

  for (const [own, other] of [["lumen", "ironbark"], ["ironbark", "lumen"]] as const) {
    it(`the ${own} document has its own brand and nothing from ${other}`, () => {
      const b = brand(DEMO_PACKS[own]);
      assert.ok(docs[own].includes(b.company.displayName.toLowerCase()), "own company name");
      assert.ok(docs[own].includes(b.colors.primary.replace("#", "").toLowerCase()), "own primary color");
      assert.deepEqual(strings[other].filter((s) => docs[own].includes(s)), []);
    });
  }
});
