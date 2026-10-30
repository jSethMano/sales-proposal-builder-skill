// The skill's reference files show examples and limits. These tests run the examples through the
// real scripts and compare the limits with the code, so the docs Claude reads can't drift from it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FIXTURE_PACK, run, SCRIPTS, SKILL_DIR, tempDir, writeJson } from "./helpers.ts";

const reference = (name: string): string => readFileSync(join(SKILL_DIR, "references", name), "utf8");
const jsonBlocks = (md: string): unknown[] => [...md.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1] ?? ""));

describe("reference examples run through the scripts", () => {
  const dir = tempDir();
  const [quote] = jsonBlocks(reference("quoting.md"));
  const pricingFile = join(dir, "pricing.json");
  const priced = run("price.cjs", [writeJson(dir, "quote.json", quote), "--pack", FIXTURE_PACK, "--out", pricingFile]);

  it("the example in quoting.md prices", () => {
    assert.equal(priced.code, 0, JSON.stringify(priced.json, null, 2));
  });

  it("the example in proposal-schema.md validates against it, with no warnings", () => {
    const [proposal] = jsonBlocks(reference("proposal-schema.md")) as [Record<string, unknown>];
    proposal.pricingRef = priced.json.pricingRef;
    const r = run("validate.cjs", [writeJson(dir, "proposal.json", proposal), pricingFile, "--pack", FIXTURE_PACK]);
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
    assert.deepEqual(r.json.warnings, []);
  });

  it("the custom line in quoting.md prices in the neutral pack", () => {
    const [, custom] = jsonBlocks(reference("quoting.md"));
    const q = { schemaVersion: 1, quoteDate: "2027-01-15", termMonths: 12, currency: "NZD", lines: [custom] };
    const r = run("price.cjs", [writeJson(dir, "custom.json", q), "--pack", join(SKILL_DIR, "company")]);
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
  });
});

describe("limits in the docs match the code", () => {
  const { LENGTH_GUIDE, MAX_TIMELINE_ROWS, PROSE_TOKENS } = createRequire(import.meta.url)(join(SCRIPTS, "lib/rules.cjs")) as {
    LENGTH_GUIDE: Record<string, { min: number; max: number }>;
    MAX_TIMELINE_ROWS: number;
    PROSE_TOKENS: string[];
  };

  it("proposal-structure.md quotes every word range", () => {
    const md = reference("proposal-structure.md");
    for (const [key, { min, max }] of Object.entries(LENGTH_GUIDE)) assert.ok(md.includes(`${min}–${max}`), `${key}: ${min}–${max}`);
    assert.ok(md.includes(`at most ${MAX_TIMELINE_ROWS} rows`));
  });

  it("proposal-schema.md lists every token, and no others", () => {
    const md = reference("proposal-schema.md");
    const listed = [...md.matchAll(/^\| `\{\{([^}]+)\}\}` \|/gm)].map((m) => m[1]);
    assert.deepEqual(listed.sort(), [...PROSE_TOKENS].sort());
  });
});
