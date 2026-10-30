// White-label isolation (NFR-3): the skill core must not contain anything from a company pack.
// M1 covers the core; M3 adds the cross-pack document checks and M5 the zip checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { listFiles } from "../tools/lib/zip.ts";
import { DEMO_PACKS, readJson, ROOT, SKILL_DIR } from "./helpers.ts";

interface DemoBrand {
  packId: string;
  company: Record<string, string>;
  colors: Record<string, string>;
}

/** Every string that identifies a demo pack: names, contact details, colors, SKUs, approver. */
export function identifyingStrings(packDir: string): string[] {
  const brand = readJson<DemoBrand>(join(packDir, "brand.json"));
  const catalog = readJson<{ items: { sku: string; name: string }[] }>(join(packDir, "catalog.json"));
  const pricing = readJson<{ approval: { approver: string } | null }>(join(packDir, "pricing.json"));
  const strings = [
    brand.packId,
    ...Object.values(brand.company),
    // Colors appear with or without "#", in either case.
    ...Object.values(brand.colors).map((hex) => hex.replace("#", "")),
    ...catalog.items.map((i) => i.sku),
  ];
  // Only approver roles specific enough to identify the pack; "Sales Director" is a generic title.
  if (pricing.approval && pricing.approval.approver !== "Sales Director") strings.push(pricing.approval.approver);
  return strings;
}

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
