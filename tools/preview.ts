// Builds the example proposals with each pack and renders every page to PNG for a visual check:
//   npm run preview            → dist/preview/<name>.docx, .pdf and <name>-<page>.png
// Needs LibreOffice (soffice) and poppler (pdftoppm): the same tools as the claude.ai sandbox.
// This is a development tool; it isn't shipped in the skill.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPTS = join(ROOT, "skill/sales-proposal-builder/scripts");
const OUT = join(ROOT, "dist/preview");
const WORK = join(OUT, "work");
// 70 dpi is enough to judge layout while keeping each page image small.
const DPI = "70";

interface Variant {
  name: string;
  fixture: string;
  /** A pack folder, or "chat": run init-pack.cjs with the fixture's brand-args.json on the neutral pack. */
  pack: string;
  editQuote?: (q: Record<string, unknown>) => void;
}

const VARIANTS: Variant[] = [
  { name: "acme-lumen", fixture: "acme-lumen", pack: "packs/lumen-ridge-it" },
  { name: "acme-ironbark", fixture: "acme-ironbark", pack: "packs/ironbark-msp" },
  {
    name: "acme-lumen-DRAFT",
    fixture: "acme-lumen",
    pack: "packs/lumen-ridge-it",
    editQuote: (q) => void (q.extraDiscount = { bps: 2000, appliesTo: "recurring", reason: "Client asked for 20%" }),
  },
  // The neutral zip, branded in chat (unconfigured mode).
  { name: "kauri-harbour-light", fixture: "kauri-harbour", pack: "chat" },
];

function node(script: string, args: string[]): Record<string, unknown> {
  const out = execFileSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" });
  const json = JSON.parse(out) as Record<string, unknown>;
  if (json.ok !== true) throw new Error(`${script} failed:\n${out}`);
  return json;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

for (const v of VARIANTS) {
  const fixture = join(ROOT, "test/fixtures/proposals", v.fixture);
  if (v.pack === "chat") {
    const { args } = JSON.parse(readFileSync(join(fixture, "brand-args.json"), "utf8")) as { args: string[] };
    const pack = join(WORK, `${v.name}-pack`);
    node("init-pack.cjs", [pack, ...args.map((a) => (a.startsWith("evals/") ? join(ROOT, a) : a))]);
    v.pack = pack;
  }
  const quote = JSON.parse(readFileSync(join(fixture, "quote.json"), "utf8")) as Record<string, unknown>;
  v.editQuote?.(quote);
  const quoteFile = join(WORK, `${v.name}-quote.json`);
  const pricingFile = join(WORK, `${v.name}-pricing.json`);
  writeFileSync(quoteFile, JSON.stringify(quote, null, 2));
  const priced = node("price.cjs", [quoteFile, "--pack", v.pack, "--out", pricingFile]);
  const proposal = JSON.parse(readFileSync(join(fixture, "proposal.json"), "utf8")) as Record<string, unknown>;
  proposal.pricingRef = priced.pricingRef;
  const proposalFile = join(WORK, `${v.name}-proposal.json`);
  writeFileSync(proposalFile, JSON.stringify(proposal, null, 2));
  const docx = join(OUT, `${v.name}.docx`);
  const built = node("build-docx.cjs", [proposalFile, pricingFile, docx, "--pack", v.pack]);
  execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", OUT, docx], { stdio: "ignore" });
  execFileSync("pdftoppm", ["-r", DPI, "-png", join(OUT, `${v.name}.pdf`), join(OUT, v.name)]);
  const pages = readdirSync(OUT).filter((f) => f.startsWith(`${v.name}-`) && f.endsWith(".png") && !f.includes("DRAFT", v.name.length)).length;
  console.log(`${v.name}: ${pages} pages, draft ${built.draft}, watermark ${built.watermark}`);
}

// --screenshots: the README's images, rendered at a readable resolution into docs/images/.
// Pages are found by their content, so the shots stay right if the page count changes.
if (process.argv.includes("--screenshots")) {
  const IMAGES = join(ROOT, "docs/images");
  // 100 dpi makes a Letter page 850 × 1100 px: readable on GitHub, small enough to commit.
  const SHOT_DPI = "100";
  mkdirSync(IMAGES, { recursive: true });
  const pageWith = (pdf: string, text: string): number => {
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [pdf], { encoding: "utf8" }))?.[1] ?? 0);
    for (let p = 1; p <= pages; p++) {
      const pageText = execFileSync("pdftotext", ["-f", String(p), "-l", String(p), pdf, "-"], { encoding: "utf8" });
      if (pageText.split("\n").some((line) => line.trim() === text)) return p;
    }
    throw new Error(`No page in ${pdf} has a line "${text}".`);
  };
  const shots: [string, string, number | string][] = [
    ["lumen-cover", "acme-lumen", 1],
    ["ironbark-cover", "acme-ironbark", 1],
    ["chat-brand-cover", "kauri-harbour-light", 1],
    ["draft-cover", "acme-lumen-DRAFT", 1],
    ["lumen-investment", "acme-lumen", "Investment"],
    ["ironbark-investment", "acme-ironbark", "Investment"],
  ];
  for (const [image, name, where] of shots) {
    const pdf = join(OUT, `${name}.pdf`);
    const page = typeof where === "number" ? where : pageWith(pdf, where);
    execFileSync("pdftoppm", ["-f", String(page), "-l", String(page), "-r", SHOT_DPI, "-png", "-singlefile", pdf, join(IMAGES, image)]);
    console.log(`docs/images/${image}.png  (${name}, page ${page})`);
  }
}
