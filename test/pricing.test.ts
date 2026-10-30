// price.cjs: the numbers in every proposal come from here, so each rule is pinned by a test.
// Fixture pack (test/fixtures/packs/test-usd): tiers 1+ 0%, 50+ 5%, 100+ 10%; terms 12/24/36 at
// 0/5/10%; approval above 15% by the Sales Director.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BASE_QUOTE,
  codes,
  DEMO_PACKS,
  editedPack,
  error,
  FIXTURE_PACK,
  NEUTRAL_PACK,
  priceQuote,
  pricing,
  run,
  tempDir,
  writeJson,
} from "./helpers.ts";

const quote = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ ...BASE_QUOTE, ...overrides });
const extra = (bps: number, appliesTo = "all"): { extraDiscount: unknown } => ({
  extraDiscount: { bps, appliesTo, reason: "Test" },
});

describe("worked example (design §5)", () => {
  it("80 users × 45.00, 50+ tier, 24 months, extra 10% → 2,924.10 a month", () => {
    const p = pricing(quote(extra(1000)));
    const line = p.lines[0];
    assert.ok(line);
    assert.equal(line.baseMinor, 360000);
    assert.deepEqual(line.steps, [
      { kind: "volume", bps: 500, amountMinor: 18000 },
      { kind: "term", bps: 500, amountMinor: 17100 },
      { kind: "extra", bps: 1000, amountMinor: 32490 },
    ]);
    assert.equal(line.netMinor, 292410);
    assert.equal(p.totals.monthlyRecurringMinor, 292410);
    assert.equal(p.totals.termTotalMinor, 292410 * 24);
    assert.equal(p.totals.listTermTotalMinor, 360000 * 24);
    assert.equal(p.totals.savingsMinor, 360000 * 24 - 292410 * 24);
    assert.equal(p.formatted.monthlyRecurring, "$2,924.10");
    assert.equal(p.formatted.termTotal, "$70,178.40");
    assert.equal(p.formatted.extraDiscountPct, "10%");
    assert.equal(p.approval.needed, false);
  });

  it("records the pack, version, rule and the canonical quote it came from", () => {
    const p = pricing(quote({ _note: "comments are dropped", ...extra(1000) }));
    assert.equal(p.packId, "test-usd");
    assert.match(p.skillVersion, /^\d+\.\d+\.\d+$/);
    assert.match(p._rule, /volume → term → extra/);
    assert.deepEqual(Object.keys(p.quote), ["schemaVersion", "quoteDate", "termMonths", "lines", "extraDiscount"]);
    assert.equal(p.priceSource, "catalog");
    assert.equal(p.validUntil, "2027-02-14");
    assert.equal(p.formatted.validUntil, "February 14, 2027");
  });
});

describe("volume tiers", () => {
  for (const [quantity, bps] of [[1, 0], [49, 0], [50, 500], [99, 500], [100, 1000], [500, 1000]] as const) {
    it(`${quantity} users → ${bps} bps`, () => {
      const p = pricing(quote({ termMonths: 12, lines: [{ sku: "SUPPORT", quantity }] }));
      const volume = p.lines[0]?.steps.find((s) => s.kind === "volume");
      assert.equal(volume?.bps, bps === 0 ? undefined : bps);
    });
  }

  it("apply to one-time items marked volumeTiered, and skip items that aren't", () => {
    const p = pricing(quote({ lines: [{ sku: "MIGRATION", quantity: 60 }, { sku: "SETUP", quantity: 60 }] }));
    assert.deepEqual(p.lines[0]?.steps, [{ kind: "volume", bps: 500, amountMinor: 28500 }]);
    assert.deepEqual(p.lines[1]?.steps, []);
  });
});

describe("terms", () => {
  for (const [months, bps] of [[12, 0], [24, 500], [36, 1000]] as const) {
    it(`${months} months → ${bps} bps on monthly items`, () => {
      const p = pricing(quote({ termMonths: months, lines: [{ sku: "SUPPORT", quantity: 10 }] }));
      assert.equal(p.lines[0]?.steps.find((s) => s.kind === "term")?.bps, bps === 0 ? undefined : bps);
      assert.equal(p.totals.termTotalMinor, p.totals.monthlyRecurringMinor * months);
    });
  }

  it("rejects a term the pack doesn't offer, listing the ones it does", () => {
    const r = priceQuote(quote({ termMonths: 18 }));
    assert.equal(r.code, 1);
    const e = error(r, "E_TERM");
    assert.equal(e.message, "Term 18 months is not offered.");
    assert.equal(e.hint, "Choose 12, 24 or 36 months.");
  });

  it("never discount one-time items, which count once in the term total", () => {
    const p = pricing(quote({ termMonths: 36, lines: [{ sku: "SITE", quantity: 2 }, { sku: "SETUP", quantity: 1 }] }));
    assert.deepEqual(p.lines[1]?.steps, []);
    assert.equal(p.totals.oneTimeMinor, 250000);
    assert.equal(p.totals.monthlyRecurringMinor, 63000); // 2 × 350.00, less 10%
    assert.equal(p.totals.termTotalMinor, 63000 * 36 + 250000);
  });
});

describe("extra discount scope", () => {
  const lines = [{ sku: "SITE", quantity: 1 }, { sku: "SETUP", quantity: 1 }];
  const extraOn = (appliesTo: string): boolean[] =>
    pricing(quote({ termMonths: 12, lines, ...extra(1000, appliesTo) })).lines.map((l) => l.steps.some((s) => s.kind === "extra"));

  it("all → both", () => assert.deepEqual(extraOn("all"), [true, true]));
  it("recurring → monthly only", () => assert.deepEqual(extraOn("recurring"), [true, false]));
  it("one-time → one-time only", () => assert.deepEqual(extraOn("one-time"), [false, true]));

  it("warns when the discount applies to nothing in the quote", () => {
    const r = priceQuote(quote({ termMonths: 12, lines: [{ sku: "SETUP", quantity: 1 }], ...extra(500, "recurring") }));
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.warnings?.map((w) => w.code), ["W_DISCOUNT_UNUSED"]);
  });
});

describe("rounding", () => {
  it("rounds an exact half-cent up, in the client's favor", () => {
    // 0.50 × 1% = 0.005 → the discount rounds to 0.01, so the client pays 0.49.
    const p = pricing(quote({ termMonths: 12, lines: [{ sku: "TINY", quantity: 1 }], ...extra(100) }));
    assert.deepEqual(p.lines[0]?.steps, [{ kind: "extra", bps: 100, amountMinor: 1 }]);
    assert.equal(p.lines[0]?.netMinor, 49);
  });

  it("rounds below half down and above half up", () => {
    // 2 × 0.50 = 1.00; 1.49% of it is 0.0149 → 0.01, and 1.51% is 0.0151 → 0.02.
    const below = pricing(quote({ termMonths: 12, lines: [{ sku: "TINY", quantity: 2 }], ...extra(149) }));
    assert.equal(below.lines[0]?.steps[0]?.amountMinor, 1);
    const above = pricing(quote({ termMonths: 12, lines: [{ sku: "TINY", quantity: 2 }], ...extra(151) }));
    assert.equal(above.lines[0]?.steps[0]?.amountMinor, 2);
  });

  it("formats a zero-decimal currency without fractions", () => {
    const yen = editedPack(FIXTURE_PACK, {
      pricing: (p) => {
        p.currency = "JPY";
        p.minorUnits = 0;
      },
    });
    const p = pricing(quote({ termMonths: 12, lines: [{ sku: "SUPPORT", quantity: 3 }] }), yen);
    assert.equal(p.minorUnits, 0);
    assert.equal(p.totals.monthlyRecurringMinor, 13500);
    assert.equal(p.formatted.monthlyRecurring, "¥13,500");
  });
});

describe("approval (design X6)", () => {
  it("exactly at the 15% limit doesn't need approval", () => {
    const p = pricing(quote(extra(1500)));
    assert.equal(p.approval.needed, false);
    assert.equal(p.approval.reason, null);
    assert.equal(p.approval.limitBps, 1500);
  });

  it("one basis point over needs the approver named in the pack", () => {
    const p = pricing(quote(extra(1501)));
    assert.deepEqual(p.approval, {
      needed: true,
      approver: "Sales Director",
      reason: "Requested extra discount 15.01% exceeds the 15% limit; needs Sales Director approval.",
      requestedBps: 1501,
      limitBps: 1500,
      policy: "pack",
    });
  });

  it("volume and term discounts never count toward the limit", () => {
    // 10% volume + 10% term + 14% extra ≈ 30% off list, and still no approval.
    const p = pricing(quote({ termMonths: 36, lines: [{ sku: "SUPPORT", quantity: 120 }], ...extra(1400) }));
    assert.equal(p.approval.needed, false);
    assert.ok(p.totals.savingsMinor / p.totals.listTermTotalMinor > 0.29);
  });

  it("a pack with no approval policy never needs approval", () => {
    const noPolicy = editedPack(FIXTURE_PACK, { pricing: (p) => void (p.approval = null) });
    const p = pricing(quote(extra(5000)), noPolicy);
    assert.equal(p.approval.needed, false);
    assert.equal(p.approval.policy, "none");
    assert.equal(p.approval.requestedBps, 5000);
  });
});

describe("unconfigured mode (neutral pack)", () => {
  const custom = { custom: { name: "Support", unit: "user/month", billing: "monthly", unitPriceMinor: 5000 }, quantity: 10 };

  it("prices custom lines in the quote's currency, marked as supplied", () => {
    const p = pricing(quote({ currency: "EUR", lines: [custom] }), NEUTRAL_PACK);
    assert.equal(p.priceSource, "as-supplied");
    assert.equal(p.currency, "EUR");
    assert.equal(p.totals.monthlyRecurringMinor, 50000);
    assert.deepEqual(p.lines[0]?.steps, []);
    assert.equal(p.formatted.monthlyRecurring, "€500.00");
  });

  it("needs a currency when the pack has none", () => {
    const r = priceQuote(quote({ lines: [custom] }), NEUTRAL_PACK);
    assert.deepEqual(codes(r), ["E_CURRENCY"]);
  });

  it("rejects custom lines when the pack has a catalog", () => {
    const r = priceQuote(quote({ lines: [custom] }));
    assert.equal(error(r, "E_CUSTOM_LINE").message, "Custom lines are not allowed: this pack has a catalog.");
  });
});

describe("quote problems", () => {
  it("suggests the closest SKU", () => {
    const r = priceQuote(quote({ lines: [{ sku: "MIGRAT", quantity: 5 }] }));
    const e = error(r, "E_SKU_UNKNOWN");
    assert.equal(e.message, "SKU 'MIGRAT' not in catalog.");
    assert.match(e.hint ?? "", /^Closest: MIGRATION\./);
  });

  it("reports every problem in one run, with the real file name", () => {
    const file = writeJson(tempDir(), "acme-quote.json", {
      schemaVersion: 1,
      quoteDate: "2027-02-30",
      termMonths: 24,
      currency: "EUR",
      lines: [{ sku: "SUPPORT", quantity: 0 }, { sku: "SETUP", quantity: 1 }, { sku: "SETUP", quantity: 2 }],
      extraDiscount: { bps: 0, appliesTo: "recurring", reason: "x" },
      discount: 10,
    });
    const r = run("price.cjs", [file, "--pack", FIXTURE_PACK]);
    assert.equal(r.code, 1);
    assert.deepEqual(codes(r).sort(), ["E_CURRENCY", "E_DATE", "E_DISCOUNT", "E_DUPLICATE_LINE", "E_QUANTITY", "E_QUOTE_SCHEMA"].sort());
    assert.ok(r.json.errors?.every((e) => e.path.startsWith("acme-quote.json:")));
    assert.equal(error(r, "E_QUOTE_SCHEMA").hint, "Did you mean 'extraDiscount'?");
  });

  it("needs at least one line", () => {
    assert.deepEqual(codes(priceQuote(quote({ lines: [] }))), ["E_QUOTE_SCHEMA"]);
  });

  it("rejects a quote that isn't a JSON object", () => {
    assert.deepEqual(codes(priceQuote([1, 2, 3])), ["E_QUOTE_SCHEMA"]);
  });

  it("reports invalid JSON as a fixable error", () => {
    const file = join(tempDir(), "quote.json");
    writeFileSync(file, "{ not json");
    const r = run("price.cjs", [file, "--pack", FIXTURE_PACK]);
    assert.equal(r.code, 1);
    assert.deepEqual(codes(r), ["E_JSON"]);
  });

  it("treats a wrong command line as a usage error (exit 2)", () => {
    const r = run("price.cjs", []);
    assert.equal(r.code, 2);
    assert.deepEqual(codes(r), ["E_USAGE"]);
    assert.match(error(r, "E_USAGE").hint ?? "", /^Usage: node price\.cjs/);
    assert.equal(run("price.cjs", ["q.json", "--bogus"]).code, 2);
  });
});

describe("output", () => {
  it("is byte-identical across runs, and --out reports the file's hash as pricingRef", () => {
    const dir = tempDir();
    const q = writeJson(dir, "quote.json", quote(extra(1000)));
    const a = run("price.cjs", [q, "--pack", FIXTURE_PACK, "--out", join(dir, "a.json")]);
    const b = run("price.cjs", [q, "--pack", FIXTURE_PACK, "--out", join(dir, "b.json")]);
    const bytesA = readFileSync(join(dir, "a.json"));
    assert.deepEqual(bytesA, readFileSync(join(dir, "b.json")));
    assert.equal(a.json.pricingRef, b.json.pricingRef);
    assert.equal(a.json.pricingRef, `sha256:${createHash("sha256").update(bytesA).digest("hex")}`);
    assert.deepEqual(Object.keys(a.json), ["ok", "out", "pricingRef", "totals", "approval", "warnings"]);
  });

  it("prices with both demo packs", () => {
    const lumen = pricing({ ...BASE_QUOTE, lines: [{ sku: "LR-SUPPORT-CORE", quantity: 80 }] }, DEMO_PACKS.lumen);
    assert.equal(lumen.formatted.monthlyRecurring, "$3,249.00"); // 3,600.00 less 5% volume, less 5% term
    const ironbark = pricing({ ...BASE_QUOTE, lines: [{ sku: "IB-HELPDESK", quantity: 40 }] }, DEMO_PACKS.ironbark);
    assert.equal(ironbark.currency, "AUD");
    assert.equal(ironbark.formatted.monthlyRecurring, "$2,208.96"); // 2,360.00 less 2.5% volume, less 4% term
    assert.equal(ironbark.formatted.validUntil, "5 February 2027");
  });
});
