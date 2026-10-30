// validate.cjs: one crafted bad proposal per check (design §8), each asserting the code, where it
// points and what it tells Claude to do.
import assert from "node:assert/strict";
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
  readJson,
  ROOT,
  run,
  type ScriptResult,
  tempDir,
  writeJson,
} from "./helpers.ts";

type Json = Record<string, any>;

interface Priced {
  dir: string;
  pricingFile: string;
  pricingRef: string;
}

/** Prices a quote into a fresh folder, the way Claude does before writing proposal.json. */
function priced(quote: unknown = { ...BASE_QUOTE, lines: [{ sku: "SUPPORT", quantity: 80 }, { sku: "SETUP", quantity: 1 }] }, pack = FIXTURE_PACK): Priced {
  const dir = tempDir();
  const pricingFile = join(dir, "pricing.json");
  const r = run("price.cjs", [writeJson(dir, "quote.json", quote), "--pack", pack, "--out", pricingFile]);
  assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
  return { dir, pricingFile, pricingRef: r.json.pricingRef as string };
}

// About 25 words; repeated to meet the length guide where a test needs it.
const SENTENCE = "Fixture Co will look after the client's people and computers, with a plan agreed before work starts and a short report every month after that. ";

function proposal(ref: string, edit?: (p: Json) => void): Json {
  const p: Json = {
    schemaVersion: 1,
    pricingRef: ref,
    title: "Managed support",
    date: "2027-01-15",
    startDate: "2027-02-01",
    client: { name: "Example Client", contact: { name: "Alex Example", title: "Office Manager" } },
    sections: {
      executiveSummary: SENTENCE.repeat(5),
      understanding: SENTENCE.repeat(4),
      solution: `${SENTENCE.repeat(3)}\n\n- **Support** for every user.\n- *Setup* first.`,
      scope: [
        { item: "SUPPORT", notes: "Covers all 80 users from the start date." },
        { item: "SETUP", notes: "Done in the first two weeks, before support starts." },
      ],
      timeline: [{ label: "Setup", when: "Weeks 1–2", detail: "Audit and handover." }],
      whyUs: { intro: "We have done this for clients like Example Client before, and the story below is one of them.", caseStudyIds: ["CS-001"] },
      assumptions: ["Admin access is provided before work starts."],
      notIncluded: [],
      nextSteps: "Sign the acceptance section and return it to us. We will confirm the start dates within a week of receiving it. This proposal is valid until {{pricing.validUntil}}.",
    },
  };
  edit?.(p);
  return p;
}

function validate(p: Priced, value: unknown, pack = FIXTURE_PACK): ScriptResult {
  return run("validate.cjs", [writeJson(p.dir, "proposal.json", value), p.pricingFile, "--pack", pack]);
}

/** Validates a proposal with one edit applied and returns the result. */
function withEdit(edit: (p: Json) => void): ScriptResult {
  const p = priced();
  return validate(p, proposal(p.pricingRef, edit));
}

describe("valid proposals", () => {
  it("the minimal fixture passes with no warnings", () => {
    const r = withEdit(() => {});
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
    assert.deepEqual(r.json.warnings, []);
    assert.equal(r.json.draft, false);
  });

  it("the Acme Logistics example passes against the Lumen Ridge pack", () => {
    const fixture = join(ROOT, "test/fixtures/proposals/acme-lumen");
    const p = priced(readJson(join(fixture, "quote.json")), DEMO_PACKS.lumen);
    const value = readJson<Json>(join(fixture, "proposal.json"));
    value.pricingRef = p.pricingRef;
    const r = validate(p, value, DEMO_PACKS.lumen);
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
    assert.deepEqual(r.json.warnings, []);
  });

  it("reports DRAFT and the approver when the discount needs approval", () => {
    const p = priced({ ...BASE_QUOTE, lines: [{ sku: "SUPPORT", quantity: 80 }, { sku: "SETUP", quantity: 1 }], extraDiscount: { bps: 2000, appliesTo: "all", reason: "Asked for 20%" } });
    const r = validate(p, proposal(p.pricingRef));
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
    assert.equal(r.json.draft, true);
    assert.equal(r.json.approver, "Sales Director");
    assert.equal(r.json.approvalReason, "Requested extra discount 20% exceeds the 15% limit; needs Sales Director approval.");
    assert.match(String(r.json.next), /DRAFT/);
  });
});

describe("pricing link (design X1, X2)", () => {
  it("E_PRICING_REF: the proposal was written for different pricing", () => {
    const p = priced();
    const other = priced({ ...BASE_QUOTE, termMonths: 36, lines: [{ sku: "SUPPORT", quantity: 80 }, { sku: "SETUP", quantity: 1 }] });
    const e = error(validate(p, proposal(other.pricingRef)), "E_PRICING_REF");
    assert.equal(e.path, "proposal.json:pricingRef");
    assert.match(e.hint ?? "", /latest price\.cjs output/);
  });

  it("E_PRICING_STALE: pricing.json was edited by hand", () => {
    const p = priced();
    const original = readFileSync(p.pricingFile, "utf8");
    const edited = original.replace(/"monthlyRecurringMinor": \d+/, '"monthlyRecurringMinor": 1');
    assert.notEqual(edited, original, "the test must actually change the file");
    writeFileSync(p.pricingFile, edited);
    const r = validate(p, proposal(p.pricingRef));
    assert.deepEqual(codes(r).sort(), ["E_PRICING_REF", "E_PRICING_STALE"]);
    assert.match(error(r, "E_PRICING_STALE").message, /doesn't match what price\.cjs computes/);
  });

  it("E_PRICING_STALE: the pack's prices changed after pricing", () => {
    const p = priced();
    const repriced = editedPack(FIXTURE_PACK, { catalog: (c) => void ((c.items[0] as Json).listPriceMinor = 4900) });
    assert.deepEqual(codes(validate(p, proposal(p.pricingRef), repriced)), ["E_PRICING_STALE"]);
  });

  it("E_PRICING_STALE: the quote inside pricing.json no longer fits the pack", () => {
    const p = priced();
    const noSetup = editedPack(FIXTURE_PACK, { catalog: (c) => void (c.items = c.items.filter((i) => i.sku !== "SETUP")) });
    const e = error(validate(p, proposal(p.pricingRef), noSetup), "E_PRICING_STALE");
    assert.match(e.message, /no longer valid for this pack: SKU 'SETUP' not in catalog/);
  });

  it("E_PRICING_STALE: the file isn't pricing output at all", () => {
    const p = priced();
    writeFileSync(p.pricingFile, '{"totals": {}}\n');
    assert.match(error(validate(p, proposal(p.pricingRef)), "E_PRICING_STALE").message, /wasn't written by price\.cjs/);
  });
});

describe("structure", () => {
  it("E_SCHEMA: missing section, wrong type, unknown field", () => {
    const r = withEdit((p) => {
      delete p.sections.understanding;
      p.sections.assumptions = "Admin access";
      p.sections.summary = "x";
    });
    assert.deepEqual(
      r.json.errors?.map((e) => [e.code, e.path]),
      [
        ["E_SCHEMA", "proposal.json:sections.summary"],
        ["E_SCHEMA", "proposal.json:sections.understanding"],
        ["E_SCHEMA", "proposal.json:sections.assumptions"],
      ],
    );
  });

  it("E_SCHEMA: a proposal that isn't an object stops early", () => {
    const p = priced();
    assert.deepEqual(codes(validate(p, ["not", "a", "proposal"])), ["E_SCHEMA"]);
  });

  it("E_DATE: date differs from the pricing, start before date, impossible date", () => {
    assert.match(error(withEdit((p) => void (p.date = "2027-01-16")), "E_DATE").message, /doesn't match quoteDate 2027-01-15/);
    assert.match(error(withEdit((p) => void (p.startDate = "2027-01-01")), "E_DATE").message, /before the proposal date/);
    assert.match(error(withEdit((p) => void (p.startDate = "2027-02-30")), "E_DATE").message, /not a real date/);
  });

  it("E_CLIENT: missing client or contact name says to ask, not invent", () => {
    const r = withEdit((p) => {
      p.client.name = " ";
      p.client.contact.name = "";
    });
    assert.deepEqual(r.json.errors?.map((e) => [e.code, e.path]), [
      ["E_CLIENT", "proposal.json:client.name"],
      ["E_CLIENT", "proposal.json:client.contact.name"],
    ]);
    assert.match(error(r, "E_CLIENT").hint ?? "", /never invent/);
  });
});

describe("scope against pricing", () => {
  it("E_SCOPE: a priced item with no scope entry", () => {
    const e = error(withEdit((p) => p.sections.scope.pop()), "E_SCOPE");
    assert.equal(e.message, "Priced item SETUP has no scope entry.");
  });

  it("E_SCOPE: a catalog item in scope that wasn't priced", () => {
    const r = withEdit((p) => p.sections.scope.push({ item: "SITE", notes: "Network for two sites." }));
    assert.equal(error(r, "E_SCOPE").message, "SITE is in scope but not in the pricing.");
  });

  it("E_SCOPE: the same item twice", () => {
    const r = withEdit((p) => p.sections.scope.push({ item: "SETUP", notes: "Again, for the second site." }));
    assert.equal(error(r, "E_SCOPE").message, "SETUP has more than one scope entry.");
  });

  it("E_SKU_UNKNOWN: an item that's neither priced nor in the catalog, with the closest match", () => {
    const r = withEdit((p) => void (p.sections.scope[1].item = "SETUPP"));
    const e = error(r, "E_SKU_UNKNOWN");
    assert.match(e.hint ?? "", /^Closest: SETUP\./);
  });

  it("custom lines in the neutral pack are scoped by name", () => {
    const pack = join(ROOT, "skill/sales-proposal-builder/company");
    const p = priced({ ...BASE_QUOTE, currency: "USD", lines: [{ custom: { name: "Helpdesk", unit: "user/month", billing: "monthly", unitPriceMinor: 5000 }, quantity: 10 }] }, pack);
    const value = proposal(p.pricingRef, (x) => {
      x.sections.scope = [{ item: "Helpdesk", notes: "All ten users, business hours." }];
      x.sections.whyUs.caseStudyIds = [];
    });
    const r = validate(p, value, pack);
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
    assert.equal(r.json.priceSource, "as-supplied");
  });
});

describe("case studies (FR-7)", () => {
  it("E_CASE_STUDY: an ID that isn't in the pack lists the approved ones", () => {
    const e = error(withEdit((p) => void (p.sections.whyUs.caseStudyIds = ["CS-404"])), "E_CASE_STUDY");
    assert.equal(e.message, "CS-404 is not in case-studies.md.");
    assert.match(e.hint ?? "", /Approved case studies: CS-001\.$/);
  });

  it("E_CASE_STUDY: none cited when the pack has some, or one cited twice", () => {
    assert.match(error(withEdit((p) => void (p.sections.whyUs.caseStudyIds = [])), "E_CASE_STUDY").message, /at least one/);
    assert.match(error(withEdit((p) => void (p.sections.whyUs.caseStudyIds = ["CS-001", "CS-001"])), "E_CASE_STUDY").message, /cited twice/);
  });
});

describe("content rules", () => {
  const inSummary = (text: string): ScriptResult => withEdit((p) => void (p.sections.executiveSummary += `\n\n${text}`));

  for (const placeholder of ["[CLIENT]", "[Contact name]", "TBD", "todo", "XXXX", "{client}", "Lorem ipsum dolor", "INSERT"]) {
    it(`E_PLACEHOLDER: '${placeholder}'`, () => {
      assert.ok(codes(inSummary(`Text with ${placeholder} in it.`)).includes("E_PLACEHOLDER"));
    });
  }

  it("E_PLACEHOLDER: an unknown token suggests the right one", () => {
    assert.equal(error(inSummary("{{pricing.total}}"), "E_PLACEHOLDER").hint, "Did you mean {{pricing.termTotal}}?");
  });

  it("E_PLACEHOLDER: checks the client, assumptions and timeline too", () => {
    const r = withEdit((p) => {
      p.client.contact.title = "[Title]";
      p.sections.assumptions.push("Sites: TBC.");
      p.sections.timeline[0].when = "TBD";
    });
    assert.deepEqual(r.json.errors?.map((e) => e.path), [
      "proposal.json:client.contact.title",
      "proposal.json:sections.timeline[0].when",
      "proposal.json:sections.assumptions[1]",
    ]);
  });

  for (const amount of ["$4,200", "US$1,200", "A$ 950", "€50", "£1.5", "USD 42,000", "3,000 AUD", "1,200 dollars"]) {
    it(`E_RAW_AMOUNT: '${amount}'`, () => {
      const e = error(inSummary(`It costs ${amount}.`), "E_RAW_AMOUNT");
      assert.equal(e.message, `Found the amount '${amount}' in prose.`);
    });
  }

  it("allows numbers that aren't money, and tokens", () => {
    const r = inSummary(
      "All 80 staff, 3 sites, ISO 27001, Windows 11 and 24x7 cover, for {{pricing.monthlyRecurring}} a month over {{pricing.termMonths}} months, starting with {{client.name}}.",
    );
    assert.equal(r.code, 0, JSON.stringify(r.json, null, 2));
  });

  it("W_PERCENT: a bare percentage warns but doesn't fail", () => {
    const r = inSummary("This will cut downtime by 30%.");
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.warnings?.map((w) => [w.code, w.message]), [["W_PERCENT", "Found '30%'."]]);
  });

  it("W_LENGTH: a section outside the guide warns but doesn't fail", () => {
    const r = withEdit((p) => void (p.sections.executiveSummary = "Too short."));
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.warnings?.map((w) => [w.code, w.path, w.message]), [
      ["W_LENGTH", "proposal.json:sections.executiveSummary", "2 words; the guide for this section is 80–250."],
    ]);
  });

  it("W_LENGTH: more than 12 timeline rows", () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ label: `Step ${i + 1}`, when: `Week ${i + 1}`, detail: "One step of the plan." }));
    assert.deepEqual(withEdit((p) => void (p.sections.timeline = rows)).json.warnings?.map((w) => w.code), ["W_LENGTH"]);
  });
});

describe("markdown subset", () => {
  const inSolution = (md: string): ScriptResult => withEdit((p) => void (p.sections.solution += `\n\n${md}`));
  const cases: [string, string, RegExp][] = [
    ["a table", "| a | b |\n|---|---|", /Tables aren't supported/],
    ["a ## heading", "## Heading", /Only ### subheadings/],
    ["a link", "See [the docs](https://example.com).", /Links aren't supported/],
    ["an image", "![logo](logo.png)", /Images aren't supported/],
    ["HTML", "Use <b>bold</b>.", /HTML isn't supported/],
    ["inline code", "Run `setup`.", /Inline code/],
    ["a * bullet", "* item", /Bullets must start with '- '/],
    ["a nested list", "- one\n  - two", /Nested lists/],
    ["a block quote", "> quoted", /Block quotes/],
    ["unclosed bold", "**never closed", /\*\* is never closed/],
    ["24*7 read as italics", "Cover 24*7 for everyone.", /\* is never closed/],
  ];
  for (const [what, md, message] of cases) {
    it(`E_MARKDOWN: ${what}`, () => assert.match(error(inSolution(md), "E_MARKDOWN").message, message));
  }

  it("E_MARKDOWN gives the line number within the field", () => {
    const r = withEdit((p) => void (p.sections.nextSteps = "Sign below. Valid until {{pricing.validUntil}}.\n\nWe will confirm dates within a week of acceptance.\n\n## Contact"));
    assert.equal(error(r, "E_MARKDOWN").message, "Line 5: Only ### subheadings are supported.");
  });
});

describe("terms.md in the pack (checked with the pack)", () => {
  it("E_PACK_TERMS: unsupported markdown in terms.md", () => {
    const pack = editedPack(FIXTURE_PACK, { files: { "terms.md": "### Terms\n\n| Fee | Amount |\n" } });
    const e = error(run("check-pack.cjs", [pack]), "E_PACK_TERMS");
    assert.equal(e.path, "terms.md:3");
  });
});

describe("command line", () => {
  it("needs both files", () => {
    const r = run("validate.cjs", ["proposal.json"]);
    assert.equal(r.code, 2);
    assert.deepEqual(codes(r), ["E_USAGE"]);
  });

  it("reports a missing file as fixable", () => {
    const p = priced();
    const r = run("validate.cjs", [join(p.dir, "nope.json"), p.pricingFile, "--pack", FIXTURE_PACK]);
    assert.equal(r.code, 1);
    assert.deepEqual(codes(r), ["E_FILE"]);
  });
});
