// check-pack.cjs and init-pack.cjs: a bad pack must fail before any proposal work, with a message
// that tells the admin (or Claude) exactly what to fix.
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  codes,
  DEMO_PACKS,
  editedPack,
  error,
  FIXTURE_PACK,
  NEUTRAL_PACK,
  type PackEdits,
  pricing,
  readJson,
  run,
  SKILL_DIR,
  tempDir,
} from "./helpers.ts";

// The smallest byte sequence our JPEG reader accepts: SOI, a JFIF APP0 segment, and a SOF0 frame
// header for a 3×2 image. Enough to test logo handling; it isn't a picture.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

type Json = Record<string, any>;

describe("check-pack: valid packs", () => {
  for (const [name, dir] of [["Lumen Ridge IT", DEMO_PACKS.lumen], ["Ironbark", DEMO_PACKS.ironbark], ["fixture", FIXTURE_PACK]]) {
    it(`${name} passes`, () => {
      const r = run("check-pack.cjs", [dir as string]);
      assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
      assert.equal(r.json.configured, true);
      assert.deepEqual(r.json.warnings, []);
    });
  }

  it("with no argument, checks the skill's own pack: neutral, so unconfigured mode", () => {
    const r = run("check-pack.cjs", []);
    assert.equal(r.code, 0);
    assert.equal(r.json.pack, NEUTRAL_PACK);
    assert.equal(r.json.packId, "neutral");
    assert.equal(r.json.configured, false);
    assert.deepEqual(r.json.warnings?.map((w) => w.code), ["W_UNCONFIGURED"]);
  });
});

describe("check-pack: rejections", () => {
  const cases: { what: string; edits: PackEdits; code: string; text?: RegExp }[] = [
    { what: "a font outside the allowlist", edits: { brand: (b: Json) => void (b.fonts.heading = "Garamond") }, code: "E_PACK_FONT", text: /Garamond/ },
    { what: "a color that isn't hex", edits: { brand: (b: Json) => void (b.colors.primary = "navy") }, code: "E_PACK_SCHEMA" },
    { what: "a missing logo file", edits: { files: { "logo.png": null } }, code: "E_PACK_LOGO" },
    { what: "an SVG logo", edits: { files: { "logo.png": SVG } }, code: "E_PACK_LOGO", text: /SVG/ },
    {
      what: "a JPEG logo in a packaged pack",
      edits: { brand: (b: Json) => void (b.logo = "logo.jpg"), files: { "logo.jpg": JPEG } },
      code: "E_PACK_LOGO",
      text: /need a PNG/,
    },
    {
      what: "tiers out of order",
      edits: { pricing: (p: Json) => void (p.volumeTiers = [{ minQty: 1, bps: 0 }, { minQty: 100, bps: 1000 }, { minQty: 50, bps: 1000 }]) },
      code: "E_PACK_PRICING",
      text: /ascending/,
    },
    { what: "a first tier above 1", edits: { pricing: (p: Json) => void (p.volumeTiers = [{ minQty: 5, bps: 0 }]) }, code: "E_PACK_PRICING" },
    {
      what: "a larger tier with a smaller discount",
      edits: { pricing: (p: Json) => void (p.volumeTiers = [{ minQty: 1, bps: 500 }, { minQty: 50, bps: 100 }]) },
      code: "E_PACK_PRICING",
    },
    { what: "a term listed twice", edits: { pricing: (p: Json) => void p.termDiscounts.push({ months: 12, bps: 100 }) }, code: "E_PACK_PRICING" },
    { what: "a duplicate SKU", edits: { catalog: (c) => void c.items.push({ ...c.items[0] }) }, code: "E_PACK_CATALOG" },
    { what: "a unit that doesn't match billing", edits: { catalog: (c) => void ((c.items[0] as Json).billing = "one-time") }, code: "E_PACK_CATALOG" },
    { what: "a lowercase SKU", edits: { catalog: (c) => void ((c.items[0] as Json).sku = "support") }, code: "E_PACK_SCHEMA" },
    { what: "minor units that don't match the currency", edits: { pricing: (p: Json) => void (p.minorUnits = 0) }, code: "E_PACK_PRICING", text: /USD uses 2/ },
    { what: "a currency code that doesn't exist", edits: { pricing: (p: Json) => void (p.currency = "XYZ") }, code: "E_PACK_PRICING" },
    {
      what: "a catalog with no currency",
      edits: { pricing: (p: Json) => Object.assign(p, { currency: null, minorUnits: null }) },
      code: "E_PACK_PRICING",
      text: /no currency/,
    },
    {
      what: "an approval limit of 100%",
      edits: { pricing: (p: Json) => void (p.approval = { maxExtraDiscountBps: 10000, approver: "CFO" }) },
      code: "E_PACK_SCHEMA",
    },
    { what: "a configured pack using the neutral id", edits: { brand: (b: Json) => void (b.packId = "neutral") }, code: "E_PACK_SCHEMA" },
    {
      what: "a configured pack still holding a placeholder",
      edits: { brand: (b: Json) => void (b.signatory.name = "Your Name") },
      code: "E_PACK_SCHEMA",
      text: /placeholder/,
    },
    { what: "an unknown footer token", edits: { brand: (b: Json) => void (b.footer = "For {customer}") }, code: "E_PACK_SCHEMA", text: /\{customer\}/ },
    { what: "a locale nothing can format", edits: { brand: (b: Json) => void (b.locale = "not a locale") }, code: "E_PACK_SCHEMA" },
    { what: "a missing terms.md", edits: { files: { "terms.md": null } }, code: "E_PACK_MISSING_FILE" },
    { what: "an empty terms.md", edits: { files: { "terms.md": "  \n" } }, code: "E_PACK_TERMS" },
    { what: "invalid JSON", edits: { files: { "brand.json": "{" } }, code: "E_PACK_JSON" },
  ];

  for (const { what, edits, code, text } of cases) {
    it(`rejects ${what}`, () => {
      const r = run("check-pack.cjs", [editedPack(FIXTURE_PACK, edits)]);
      assert.equal(r.code, 1);
      const e = error(r, code);
      if (text) assert.match(`${e.message} ${e.hint ?? ""}`, text);
    });
  }

  it("suggests the intended name for a misspelled field", () => {
    const pack = editedPack(FIXTURE_PACK, {
      pricing: (p: Json) => {
        p.validityDay = p.validityDays;
        delete p.validityDays;
      },
    });
    const r = run("check-pack.cjs", [pack]);
    assert.deepEqual(
      r.json.errors?.map((e) => [e.path, e.hint ?? e.message]),
      [
        ["pricing.json:validityDay", "Did you mean 'validityDays'?"],
        ["pricing.json:validityDays", "Missing required field."],
      ],
    );
  });

  it("reports problems from every file in one run", () => {
    const pack = editedPack(FIXTURE_PACK, {
      brand: (b: Json) => void (b.fonts.body = "Comic Sans MS"),
      catalog: (c) => void c.items.push({ ...c.items[0] }),
      pricing: (p: Json) => void (p.minorUnits = 3),
      files: { "case-studies.md": "## CS-001 | Story\nIndustry: X\n" },
    });
    assert.deepEqual(codes(run("check-pack.cjs", [pack])).sort(), ["E_PACK_CASE_STUDY", "E_PACK_CATALOG", "E_PACK_FONT", "E_PACK_PRICING"]);
  });

  it("says when the folder doesn't exist", () => {
    assert.deepEqual(codes(run("check-pack.cjs", [join(tempDir(), "nope")])), ["E_PACK_MISSING"]);
  });
});

describe("check-pack: case-studies.md", () => {
  const check = (text: string) => run("check-pack.cjs", [editedPack(FIXTURE_PACK, { files: { "case-studies.md": text } })]);

  it("names the line that's wrong", () => {
    const e = error(check("# Case studies\n\n## CS-001 | Story\nIndustry: X\nSector: Y\nSummary: S\nOutcome: O\n"), "E_PACK_CASE_STUDY");
    assert.equal(e.path, "case-studies.md:5");
    assert.match(e.message, /Sector: Y/);
  });

  it("lists missing fields", () => {
    assert.equal(error(check("## CS-001 | Story\nIndustry: X\nSummary: S\n"), "E_PACK_CASE_STUDY").message, "CS-001 is missing Outcome.");
  });

  it("rejects duplicate IDs and text before the first story", () => {
    const story = (id: string) => `## ${id} | Story\nIndustry: X\nSummary: S\nOutcome: O\n`;
    assert.match(error(check(story("CS-001") + story("CS-001")), "E_PACK_CASE_STUDY").message, /Duplicate case study ID CS-001/);
    assert.match(error(check(`Some intro\n${story("CS-001")}`), "E_PACK_CASE_STUDY").message, /before the first case study/);
  });

  it("accepts a file with a title and no stories", () => {
    assert.equal(check("# Case studies\n").code, 0);
  });
});

describe("init-pack", () => {
  const logo = join(FIXTURE_PACK, "logo.png");
  const neutralArgs = (out: string, extra: string[] = []): string[] => [
    out, "--name", "Acme Widgets", "--primary", "#0055aa", "--currency", "AUD",
    "--signatory-name", "Sam Lee", "--signatory-title", "Director", "--logo", logo, ...extra,
  ];

  it("writes a valid chat pack from the neutral pack", () => {
    const out = join(tempDir(), "pack");
    const r = run("init-pack.cjs", neutralArgs(out));
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
    assert.equal(r.json.packId, "chat-acme-widgets");
    assert.equal(r.json.logo, "logo.png (40×20)");

    const brand = readJson<Json>(join(out, "brand.json"));
    assert.equal(brand.configured, true);
    assert.equal(brand.source, "chat");
    assert.deepEqual(brand.company, { displayName: "Acme Widgets", legalName: "Acme Widgets" });
    assert.equal(brand.colors.primary, "#0055AA");
    assert.equal(brand.colors.accent, "#0055AA");
    assert.deepEqual(brand.signatory, { name: "Sam Lee", title: "Director" });
    assert.ok(!JSON.stringify(brand).includes("Your "), "no neutral placeholder survives");

    const p = pricing(
      { schemaVersion: 1, quoteDate: "2027-01-15", termMonths: 12, lines: [{ custom: { name: "Support", unit: "user/month", billing: "monthly", unitPriceMinor: 5000 }, quantity: 4 }] },
      out,
    );
    assert.equal(p.currency, "AUD");
    assert.equal(p.priceSource, "as-supplied");
  });

  it("accepts a JPEG logo for a chat pack", () => {
    const dir = tempDir();
    const jpg = join(dir, "upload.jpg");
    writeFileSync(jpg, JPEG);
    const r = run("init-pack.cjs", [...neutralArgs(join(dir, "pack")).filter((a) => a !== logo && a !== "--logo"), "--logo", jpg]);
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
    assert.equal(r.json.logo, "logo.jpg (3×2)");
  });

  it("refuses to write inside the skill folder", () => {
    const out = join(SKILL_DIR, "chat-pack");
    const r = run("init-pack.cjs", neutralArgs(out));
    assert.deepEqual(codes(r), ["E_INIT_PATH"]);
    assert.equal(existsSync(out), false);
    assert.deepEqual(codes(run("init-pack.cjs", neutralArgs(join(SKILL_DIR, "company")))), ["E_INIT_PATH"]);
  });

  it("asks for what the neutral pack lacks: currency and signatory", () => {
    const r = run("init-pack.cjs", [join(tempDir(), "pack"), "--name", "Acme", "--primary", "#123456"]);
    assert.deepEqual(codes(r).sort(), ["E_INIT_CURRENCY", "E_INIT_SIGNATORY"]);
  });

  it("rejects a bad color and an SVG logo", () => {
    const dir = tempDir();
    const svg = join(dir, "logo.svg");
    writeFileSync(svg, SVG);
    const args = neutralArgs(join(dir, "pack")).map((a) => (a === "#0055aa" ? "blue" : a === logo ? svg : a));
    const r = run("init-pack.cjs", args);
    assert.deepEqual(codes(r).sort(), ["E_INIT_COLOR", "E_PACK_LOGO"]);
    assert.match(error(r, "E_PACK_LOGO").hint ?? "", /PNG or JPEG/);
  });

  it("won't overwrite a pack without --force", () => {
    const out = join(tempDir(), "pack");
    assert.equal(run("init-pack.cjs", neutralArgs(out)).code, 0);
    assert.deepEqual(codes(run("init-pack.cjs", neutralArgs(out))), ["E_INIT_EXISTS"]);
    const again = run("init-pack.cjs", neutralArgs(out, ["--force"]).map((a) => (a === "#0055aa" ? "#AA5500" : a)));
    assert.equal(again.code, 0);
    assert.equal(readJson<Json>(join(out, "brand.json")).colors.primary, "#AA5500");
  });

  it("keeps a configured pack's catalog, pricing and signatory, but not its contact details", () => {
    const out = join(tempDir(), "pack");
    const r = run("init-pack.cjs", [out, "--from", DEMO_PACKS.lumen, "--name", "Other Co", "--primary", "#000000"]);
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
    const brand = readJson<Json>(join(out, "brand.json"));
    assert.deepEqual(brand.company, { displayName: "Other Co", legalName: "Other Co" });
    assert.deepEqual(brand.signatory, { name: "Jordan Avery", title: "Head of Sales" });
    assert.equal(brand.logo, null);
    assert.deepEqual(readJson(join(out, "catalog.json")), readJson(join(DEMO_PACKS.lumen, "catalog.json")));
    assert.equal(readJson<Json>(join(out, "pricing.json")).currency, "USD");

    const euro = run("init-pack.cjs", [join(tempDir(), "p"), "--from", DEMO_PACKS.lumen, "--name", "X", "--primary", "#000000", "--currency", "EUR"]);
    assert.deepEqual(codes(euro), ["E_INIT_CURRENCY"]);
  });

  it("needs --name and --primary", () => {
    const r = run("init-pack.cjs", [join(tempDir(), "pack")]);
    assert.equal(r.code, 2);
    assert.deepEqual(codes(r), ["E_USAGE"]);
  });
});
