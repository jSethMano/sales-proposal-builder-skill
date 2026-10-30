// Code-checked behaviors (design §13): end-state checks on the .docx the model returned, plus
// when it was returned. No API calls, so graders.test.ts runs them in CI against known-good and
// known-bad documents.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { type Docx, openDocx } from "../../tools/lib/docx-text.ts";
import { ROOT } from "../../tools/lib/package.ts";
import type { CheckName, CodeExpectation, ExpectedTotals, Grade, OutputFile } from "./types.ts";

const { SECTION_TITLES } = createRequire(import.meta.url)(join(ROOT, "skill/sales-proposal-builder/scripts/lib/docx/sections.cjs")) as {
  SECTION_TITLES: Record<string, string>;
};

export interface CheckInput {
  files: OutputFile[];
  expected: ExpectedTotals | null;
  /** The pack the scenario uses, for company names and case-study titles. */
  packDir: string;
}

interface Doc {
  docx: Docx;
  /** Body, header and footer text, one paragraph per line. */
  text: string;
  /** Raw XML of every part, for colors. */
  xml: string;
}

type Check = (doc: Doc | null, input: CheckInput, args: Record<string, unknown>) => { pass: boolean; detail: string };

const NO_DOCX = { pass: false, detail: "No .docx was returned." };
const str = (args: Record<string, unknown>, key: string): string => String(args[key] ?? "");

function finalDocx(files: OutputFile[]): OutputFile | undefined {
  return files.filter((f) => f.name.toLowerCase().endsWith(".docx")).at(-1);
}

function load(files: OutputFile[]): Doc | null {
  const file = finalDocx(files);
  if (!file) return null;
  const docx = openDocx(file.path);
  const parts = ["word/document.xml", ...docx.headers(), ...docx.footers()];
  return { docx, text: parts.map((p) => docx.text(p)).join("\n"), xml: docx.allXml() };
}

const CHECKS: Record<CheckName, Check> = {
  docxProduced: (doc, input) => (doc ? { pass: true, detail: `Returned ${finalDocx(input.files)?.name}.` } : NO_DOCX),

  noDocxBeforeTurn: (_doc, input, args) => {
    const turn = Number(args.turn ?? 2);
    const early = input.files.filter((f) => f.name.toLowerCase().endsWith(".docx") && f.turn < turn);
    return early.length === 0
      ? { pass: true, detail: `No .docx before turn ${turn}.` }
      : { pass: false, detail: `Returned ${early.map((f) => f.name).join(", ")} in turn ${early[0]?.turn}, before the missing details were given.` };
  },

  sectionHeadings: (doc, input) => {
    if (!doc) return NO_DOCX;
    const company = (JSON.parse(readFileSync(join(input.packDir, "brand.json"), "utf8")) as { company: { displayName: string } }).company.displayName;
    const lines = new Set(doc.text.split("\n").map((l) => l.trim()));
    const missing = Object.values(SECTION_TITLES)
      .map((t) => t.replace("{company}", company))
      .filter((t) => !lines.has(t));
    return missing.length === 0 ? { pass: true, detail: "All section headings present." } : { pass: false, detail: `Missing headings: ${missing.join("; ")}.` };
  },

  totalsMatchFixture: (doc, input) => {
    if (!doc) return NO_DOCX;
    if (!input.expected) return { pass: false, detail: "The scenario has no expected quote." };
    const wanted = [input.expected.monthlyRecurring, input.expected.termTotal, ...(input.expected.oneTime ? [input.expected.oneTime] : [])];
    const missing = wanted.filter((amount) => !doc.text.includes(amount));
    return missing.length === 0
      ? { pass: true, detail: `Found ${wanted.join(", ")}.` }
      : { pass: false, detail: `Expected amounts not in the document: ${missing.join(", ")}.` };
  },

  containsColor: (doc, _input, args) => {
    if (!doc) return NO_DOCX;
    const hex = str(args, "hex").replace("#", "").toUpperCase();
    return doc.xml.toUpperCase().includes(hex) ? { pass: true, detail: `Uses #${hex}.` } : { pass: false, detail: `#${hex} isn't used anywhere.` };
  },

  docxContains: (doc, _input, args) => {
    if (!doc) return NO_DOCX;
    const text = str(args, "text");
    return doc.text.includes(text) ? { pass: true, detail: `Contains "${text}".` } : { pass: false, detail: `Doesn't contain "${text}".` };
  },

  docxContainsAll: (doc, _input, args) => {
    if (!doc) return NO_DOCX;
    const missing = ((args.texts as string[]) ?? []).filter((t) => !doc.text.includes(t));
    return missing.length === 0 ? { pass: true, detail: "Contains every expected name." } : { pass: false, detail: `Missing: ${missing.join(", ")}.` };
  },

  docxNotContains: (doc, _input, args) => {
    if (!doc) return NO_DOCX;
    const text = str(args, "text");
    return doc.text.toLowerCase().includes(text.toLowerCase())
      ? { pass: false, detail: `Contains "${text}".` }
      : { pass: true, detail: `Doesn't contain "${text}".` };
  },

  tablesNotContain: (doc, _input, args) => {
    if (!doc) return NO_DOCX;
    const text = str(args, "text").toLowerCase();
    const hit = doc.docx.tables().flat(2).find((cell) => cell.toLowerCase().includes(text));
    return hit ? { pass: false, detail: `A table cell contains it: "${hit}".` } : { pass: true, detail: `No table mentions "${text}".` };
  },

  noPlaceholders: (doc) => {
    if (!doc) return NO_DOCX;
    const found = doc.text.match(/Your Company|Your Name|\{\{[^}]*\}\}|\[[A-Z][^\]\n]{0,40}\]|\bTBD\b|lorem ipsum/i);
    return found ? { pass: false, detail: `Found "${found[0]}".` } : { pass: true, detail: "No placeholders." };
  },

  logoEmbedded: (doc, _input, args) => {
    if (!doc) return NO_DOCX;
    const sha = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");
    const wanted = sha(readFileSync(join(ROOT, str(args, "file"))));
    return doc.docx.media().some((m) => sha(m) === wanted)
      ? { pass: true, detail: "The uploaded logo is embedded unchanged." }
      : { pass: false, detail: "The uploaded logo isn't in the document." };
  },

  citesPackCaseStudy: (doc, input) => {
    if (!doc) return NO_DOCX;
    const titles = [...readFileSync(join(input.packDir, "case-studies.md"), "utf8").matchAll(/^## CS-\d{3} \| (.+)$/gm)].map((m) => (m[1] ?? "").trim());
    const cited = titles.filter((t) => doc.text.includes(t));
    return cited.length > 0 ? { pass: true, detail: `Cites: ${cited.join("; ")}.` } : { pass: false, detail: "Cites none of the pack's case studies." };
  },
};

/** Grades every code-checked behavior of a scenario against the files a case returned. */
export function gradeCode(expectations: CodeExpectation[], input: CheckInput): Grade[] {
  let doc: Doc | null = null;
  let loadError: string | null = null;
  try {
    doc = load(input.files);
  } catch (e) {
    loadError = `The returned .docx couldn't be read: ${e instanceof Error ? e.message : String(e)}`;
  }
  return expectations.map((e) => {
    if (loadError && e.check !== "noDocxBeforeTurn") return { behavior: e.id, kind: "code", pass: false, detail: loadError };
    const { pass, detail } = CHECKS[e.check](doc, input, e.args ?? {});
    return { behavior: e.id, kind: "code", pass, detail };
  });
}

/** Minor units as a grouped decimal without currency: 9500720 with 2 minor units → "95,007.20". */
export function plainAmount(minor: number, minorUnits: number): string {
  const whole = Math.floor(minor / 10 ** minorUnits);
  const fraction = minorUnits === 0 ? "" : `.${String(minor % 10 ** minorUnits).padStart(minorUnits, "0")}`;
  return `${whole.toLocaleString("en-US")}${fraction}`;
}
