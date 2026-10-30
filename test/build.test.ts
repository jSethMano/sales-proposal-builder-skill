// build-docx.cjs: unzips the built .docx and checks the XML Word will read (design §9, FR-15).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { openDocx } from "./docx.ts";
import { buildFixture, codes, DEMO_PACKS, error, identifyingStrings, readJson, ROOT, run, tempDir, writeJson } from "./helpers.ts";

type Json = Record<string, any>;
const sha = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
const SECTION_TITLES = [
  "Executive summary",
  "Understanding of your needs",
  "Proposed solution",
  "Scope and deliverables",
  "Timeline",
  "Investment",
  "Assumptions",
  "Terms",
  "Next steps and acceptance",
];

describe("Acme Logistics with the Lumen Ridge pack", () => {
  const built = buildFixture("acme-lumen", DEMO_PACKS.lumen);
  const docx = openDocx(built.out);
  const body = docx.text();

  it("builds, not as a draft", () => {
    assert.equal(built.result.code, 0, JSON.stringify(built.result.json, null, 2));
    assert.equal(built.result.json.draft, false);
    assert.deepEqual(built.result.json.warnings, []);
    assert.equal(built.result.json.path, built.out);
  });

  it("has the cover and every section heading, in order", () => {
    const headings = [...SECTION_TITLES.slice(0, 6), "Why Lumen Ridge IT", ...SECTION_TITLES.slice(6)];
    let from = body.indexOf("Proposal for Acme Logistics");
    assert.ok(from >= 0, "cover subtitle");
    for (const h of headings) {
      const at = body.indexOf(`\n${h}\n`, from);
      assert.ok(at > from, `heading "${h}" after the one before it`);
      from = at;
    }
  });

  it("uses the brand's fonts and colors", () => {
    const styles = docx.xml("word/styles.xml");
    assert.match(styles, /w:styleId="Normal"[\s\S]*?w:ascii="Calibri"/);
    assert.match(styles, /w:styleId="Heading1"[\s\S]*?w:ascii="Cambria"[\s\S]*?w:color w:val="1F3A5F"/);
    assert.match(docx.xml("word/document.xml"), /w:color="E07A2E"/, "accent rule on the cover");
  });

  it("puts brand-colored headers on tables, with readable text", () => {
    assert.match(docx.xml("word/document.xml"), /<w:shd w:fill="1F3A5F"[^>]*\/>[\s\S]{0,400}?<w:color w:val="FFFFFF"\/>/);
  });

  it("takes every figure in the Investment tables from pricing.json", () => {
    const f = built.pricing.formatted;
    const tables = docx.tables();
    const cells = tables.flat(2);
    for (const line of built.pricing.lines) {
      const row = tables.flat().find((r) => r[0] === line.name);
      assert.ok(row, `a row for ${line.name}`);
      assert.equal(row[1], String(line.quantity));
      assert.equal(row.at(-1), `$${(line.netMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    }
    assert.ok(cells.includes(f.monthlyRecurring), "monthly total");
    assert.ok(cells.includes(f.oneTime), "one-time total");
    assert.ok(cells.includes(f.termTotal), "term total");
    assert.ok(cells.includes("Total over 24 months"));
    assert.deepEqual([f.monthlyRecurring, f.oneTime, f.termTotal], ["$3,537.80", "$10,100.00", "$95,007.20"]);
  });

  it("shows a Discounts column only on tables where something is discounted", () => {
    const headers = docx.tables().map((t) => t[0] ?? []);
    const monthly = headers.find((h) => h.includes("Monthly amount"));
    const oneTime = headers.find((h) => h.at(-1) === "Amount" && h[0] === "Item");
    assert.deepEqual(monthly, ["Item", "Qty", "List price", "Discounts", "Monthly amount"]);
    assert.deepEqual(oneTime, ["Item", "Qty", "List price", "Amount"]);
  });

  it("fills every token, and leaves no placeholder", () => {
    assert.match(body, /\$3,537\.80 per month over a 24-month term/);
    assert.match(body, /valid until December 16, 2026/);
    assert.doesNotMatch(docx.allXml(), /\{\{|\{client\}|\{company\}|TBD|Your Company/);
  });

  it("renders the pack's approved wording verbatim", () => {
    const pack = DEMO_PACKS.lumen;
    assert.ok(body.includes("Patch management for Windows and macOS"), "catalog includes");
    assert.ok(body.includes("Priority 1 incidents: response within 1 business hour."), "catalog SLA");
    const story = readFileSync(join(pack, "case-studies.md"), "utf8").match(/^Summary: (.+)$/m)?.[1] ?? "";
    assert.ok(story.length > 0 && body.includes(story), "case study CS-001 summary");
    assert.ok(body.includes("Invoices are payable within 30 days."), "terms.md");
    assert.ok(body.includes("Name: Jordan Avery") && body.includes("Title: Head of Sales"), "signatory");
  });

  it("renders markdown as Word formatting", () => {
    const xml = docx.xml("word/document.xml");
    assert.match(xml, /<w:b\/>[\s\S]{0,200}?<w:t xml:space="preserve">Managed IT Support \(Core\)<\/w:t>/);
    assert.match(xml, /<w:pStyle w:val="Heading3"\/>[\s\S]{0,300}?Ongoing services/);
  });

  it("has a running header and a footer with page numbers; the cover has its own", () => {
    const headerText = docx.headers().map((h) => docx.text(h)).join("\n");
    assert.match(headerText, /\tProposal for Acme Logistics/);
    const footers = docx.footers().map((f) => docx.xml(f));
    assert.ok(footers.some((x) => x.includes("Confidential. Prepared for Acme Logistics by Lumen Ridge IT.") && /PAGE/.test(x) && /NUMPAGES/.test(x)));
    assert.match(docx.xml("word/document.xml"), /<w:titlePg\/>/);
  });

  it("embeds the pack's logo unchanged", () => {
    const logo = sha(readFileSync(join(DEMO_PACKS.lumen, "logo.png")));
    assert.ok(docx.media().some((m) => sha(m) === logo));
  });

  it("uses US Letter for an en-US pack, and records the skill version", () => {
    assert.match(docx.xml("word/document.xml"), /<w:pgSz w:w="12240" w:h="15840"/);
    const core = docx.xml("docProps/core.xml");
    assert.match(core, new RegExp(`<dc:creator>sales-proposal-builder ${readJson<{ version: string }>(join(ROOT, "package.json")).version}</dc:creator>`));
    assert.match(core, /<dc:title>Managed IT Support and Microsoft 365 Migration<\/dc:title>/);
  });

  it("keeps each table on one page: every row but the last keeps with the next", () => {
    const tables = [...docx.xml("word/document.xml").matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((m) => m[0]);
    assert.ok(tables.length >= 5, "timeline, monthly, one-time, summary and signature tables");
    for (const table of tables) {
      const rows = [...table.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
      rows.slice(0, -1).forEach((row, i) => assert.match(row, /<w:keepNext\/>/, `row ${i + 1} of ${rows.length}`));
      assert.doesNotMatch(rows.at(-1) ?? "", /<w:keepNext\/>/, "last row");
    }
  });

  it("leaves room to sign", () => {
    assert.match(docx.xml("word/document.xml"), /<w:spacing [^>]*w:before="480"[^>]*\/>[\s\S]{0,300}?Signature:/);
  });

  it("has no DRAFT marking", () => {
    assert.doesNotMatch(docx.allXml(), /DRAFT/);
  });
});

describe("Acme Logistics with the Ironbark pack", () => {
  const built = buildFixture("acme-ironbark", DEMO_PACKS.ironbark);
  const docx = openDocx(built.out);

  it("builds on A4 in Australian English and dollars", () => {
    assert.equal(built.result.code, 0, JSON.stringify(built.result.json, null, 2));
    assert.match(docx.xml("word/document.xml"), /<w:pgSz w:w="11906" w:h="16838"/);
    const body = docx.text();
    assert.match(body, /Date: 16 November 2026/);
    assert.match(body, /\nWhy Ironbark Managed Services\n/);
    assert.ok(docx.tables().flat(2).includes(built.pricing.formatted.termTotal));
    assert.match(docx.xml("word/styles.xml"), /w:styleId="Normal"[\s\S]*?w:ascii="Arial"/);
  });
});

describe("DRAFT when the discount needs approval (FR-6, design X4, X11)", () => {
  const built = buildFixture("acme-lumen", DEMO_PACKS.lumen, {
    quote: (q) => void (q.extraDiscount = { bps: 2000, appliesTo: "recurring", reason: "Client asked for 20%" }),
  });
  const docx = openDocx(built.out);

  it("reports the draft and its approver", () => {
    assert.equal(built.result.code, 0, JSON.stringify(built.result.json, null, 2));
    assert.equal(built.result.json.draft, true);
    assert.match(String(built.result.json.next), /DRAFT until Sales Director approves it: Requested extra discount 20% exceeds the 15% limit/);
  });

  it("puts the banner in every header, the cover included", () => {
    const headers = docx.headers().map((h) => docx.text(h));
    assert.ok(headers.length >= 2);
    for (const h of headers) assert.match(h, /DRAFT, pending approval by Sales Director/);
  });

  it("adds a watermark when docx supports it (9.8.0+), and says whether it did", () => {
    const version = readJson<{ version: string }>(join(ROOT, "node_modules/docx/package.json")).version;
    const [major, minor] = version.split(".").map(Number) as [number, number];
    const supported = major > 9 || (major === 9 && minor >= 8);
    assert.equal(built.result.json.watermark, supported);
    if (supported) assert.ok(docx.headers().some((h) => /DRAFT/.test(docx.xml(h)) && /<w:pict>|<v:shape/.test(docx.xml(h))));
  });

  it("explains the approval on the cover and in Investment", () => {
    const body = docx.text();
    assert.match(body, /DRAFT, pending approval by Sales Director\. Requested extra discount 20% exceeds the 15% limit; needs Sales Director approval\./);
    assert.match(body, /The extra discount needs Sales Director approval\. Until it's approved, this proposal is a draft\./);
    assert.match(body, /Includes an extra discount of 20% on monthly services\./);
  });
});

describe("refuses to build what validation rejects (design X3)", () => {
  it("an invalid proposal: no file is written", () => {
    const built = buildFixture("acme-lumen", DEMO_PACKS.lumen, {
      proposal: (p) => void (p.sections.executiveSummary += "\n\nOnly $3,000 a month for [CLIENT]."),
    });
    assert.equal(built.result.code, 1);
    assert.deepEqual(codes(built.result).sort(), ["E_PLACEHOLDER", "E_RAW_AMOUNT"]);
    assert.equal(existsSync(built.out), false);
  });

  it("stale pricing: no file is written", () => {
    const built = buildFixture("acme-lumen", DEMO_PACKS.lumen, { proposal: (p) => void (p.pricingRef = `sha256:${"0".repeat(64)}`) });
    assert.deepEqual(codes(built.result), ["E_PRICING_REF"]);
    assert.equal(existsSync(built.out), false);
  });

  it("an output name that isn't .docx is a usage error", () => {
    const r = run("build-docx.cjs", ["proposal.json", "pricing.json", "out.pdf"]);
    assert.equal(r.code, 2);
    assert.match(error(r, "E_USAGE").message, /must end in \.docx/);
  });
});

describe("numbered lists", () => {
  it("each list starts again at 1", () => {
    const built = buildFixture("acme-lumen", DEMO_PACKS.lumen, {
      proposal: (p) => {
        p.sections.understanding += "\n\n1. First\n2. Second";
        p.sections.nextSteps += "\n\n1. Sign\n2. Return";
      },
    });
    assert.equal(built.result.code, 0, JSON.stringify(built.result.json, null, 2));
    const xml = openDocx(built.out).xml("word/document.xml");
    const numIds = [...xml.matchAll(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="(\d+)"\/><\/w:numPr>/g)].map((m) => m[1]);
    const numbered = [...new Set(numIds)].filter((id) => numIds.filter((x) => x === id).length === 2);
    assert.equal(numbered.length, 2, `two separate two-item lists, got numIds ${numIds.join(",")}`);
  });
});

describe("unconfigured mode: a brand given in chat (FR-2, US-5)", () => {
  const dir = tempDir();
  const pack = join(dir, "pack");
  const logo = join(ROOT, "test/fixtures/packs/test-usd/logo.png");
  const init = run("init-pack.cjs", [
    pack, "--name", "Harbour Light Tech", "--primary", "#F5E6A8", "--currency", "NZD", "--locale", "en-NZ",
    "--signatory-name", "Mere Walker", "--signatory-title", "Director", "--logo", logo,
  ]);
  const custom = (name: string, unitPriceMinor: number, billing: string, unit: string, quantity: number) => ({ custom: { name, unit, billing, unitPriceMinor }, quantity });
  const quote = {
    schemaVersion: 1,
    quoteDate: "2026-11-16",
    termMonths: 12,
    lines: [custom("Managed support", 6500, "monthly", "user/month", 12), custom("Network setup", 180000, "one-time", "project", 1)],
  };
  const priced = run("price.cjs", [writeJson(dir, "quote.json", quote), "--pack", pack, "--out", join(dir, "pricing.json")]);
  const fixture = readJson<Json>(join(ROOT, "test/fixtures/proposals/acme-lumen/proposal.json"));
  fixture.pricingRef = priced.json.pricingRef;
  fixture.startDate = "2026-12-01";
  fixture.sections.scope = [
    { item: "Managed support", notes: "All 12 staff, during business hours." },
    { item: "Network setup", notes: "New firewall and wireless at the office." },
  ];
  fixture.sections.whyUs = { intro: "We are a small local team, and the people who set you up are the people who support you.", caseStudyIds: [] };
  fixture.sections.executiveSummary = fixture.sections.executiveSummary.replaceAll("Lumen Ridge IT", "Harbour Light Tech");
  const out = join(dir, "proposal.docx");
  const built = run("build-docx.cjs", [writeJson(dir, "proposal.json", fixture), join(dir, "pricing.json"), out, "--pack", pack]);

  it("builds with the chat brand, and nothing from the neutral pack shows", () => {
    assert.equal(init.code, 0, JSON.stringify(init.json, null, 2));
    assert.equal(built.code, 0, JSON.stringify(built.json, null, 2));
    const docx = openDocx(out);
    const all = docx.allXml();
    assert.ok(all.includes("Harbour Light Tech"));
    assert.ok(all.includes("F5E6A8"));
    for (const placeholder of ["Your Company", "Your Name", "Your Title"]) assert.ok(!all.includes(placeholder), placeholder);
    const demo = Object.values(DEMO_PACKS).flatMap(identifyingStrings).filter((s) => all.toLowerCase().includes(s.toLowerCase()));
    assert.deepEqual(demo, [], "nothing from either demo pack");
    assert.ok(docx.media().some((m) => sha(m) === sha(readFileSync(logo))), "uploaded logo");
  });

  it("labels the prices as supplied and uses the quote's currency", () => {
    const body = openDocx(out).text();
    assert.match(body, /The prices below are as supplied for this proposal\./);
    assert.match(body, /\$780\.00 per month/); // 12 × NZ$65.00, no discounts in the neutral pack
  });

  it("puts black text on a light primary color", () => {
    assert.match(openDocx(out).xml("word/document.xml"), /<w:shd w:fill="F5E6A8"[^>]*\/>[\s\S]{0,400}?<w:color w:val="000000"\/>/);
  });
});
