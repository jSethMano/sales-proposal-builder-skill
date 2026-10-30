// Compiled from src/skill/price.cts. Edit the source, then run npm run build.
//
//   node price.cjs <quote.json> [--pack <dir>] [--out <pricing.json>]
//
// Prices a quote against the company pack. pricing.json is the only source of numbers for the
// proposal: proposal.json references it by hash (pricingRef) and never contains amounts.
// With --out, stdout carries a short summary so the full pricing doesn't fill Claude's context.
import { basename } from "node:path";
import { checkQuote, price } from "./lib/pricing.cjs";
import { parseCommandLine, readJsonFile, runScript, sha256, toJsonText, writeOutputFile } from "./lib/cli.cjs";
import { defaultPackDir, loadPack } from "./lib/pack.cjs";
import { SKILL_VERSION } from "./lib/version.cjs";

const USAGE = "node price.cjs <quote.json> [--pack <dir>] [--out <pricing.json>]";

runScript((argv) => {
  const cmd = parseCommandLine(argv, USAGE, { min: 1, max: 1 }, { strings: ["pack", "out"] });
  const pack = loadPack(cmd.strings.pack ?? defaultPackDir(__dirname));
  const quoteFile = cmd.positionals[0] as string;
  const { quote, warnings } = checkQuote(readJsonFile(quoteFile), pack, basename(quoteFile));
  const pricing = price(quote, pack, SKILL_VERSION);
  const text = toJsonText(pricing);
  const hash = sha256(text);

  if (cmd.strings.out === undefined) return { pricing, sha256: hash, warnings };
  writeOutputFile(cmd.strings.out, text);
  return {
    out: cmd.strings.out,
    pricingRef: `sha256:${hash}`,
    totals: pricing.formatted,
    approval: pricing.approval,
    warnings,
  };
});
