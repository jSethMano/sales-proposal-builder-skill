"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Compiled from src/skill/price.cts. Edit the source, then run npm run build.
//
//   node price.cjs <quote.json> [--pack <dir>] [--out <pricing.json>]
//
// Prices a quote against the company pack. pricing.json is the only source of numbers for the
// proposal: proposal.json references it by hash (pricingRef) and never contains amounts.
// With --out, stdout carries a short summary so the full pricing doesn't fill Claude's context.
const node_path_1 = require("node:path");
const pricing_cjs_1 = require("./lib/pricing.cjs");
const cli_cjs_1 = require("./lib/cli.cjs");
const pack_cjs_1 = require("./lib/pack.cjs");
const version_cjs_1 = require("./lib/version.cjs");
const USAGE = "node price.cjs <quote.json> [--pack <dir>] [--out <pricing.json>]";
(0, cli_cjs_1.runScript)((argv) => {
    const cmd = (0, cli_cjs_1.parseCommandLine)(argv, USAGE, { min: 1, max: 1 }, { strings: ["pack", "out"] });
    const pack = (0, pack_cjs_1.loadPack)(cmd.strings.pack ?? (0, pack_cjs_1.defaultPackDir)(__dirname));
    const quoteFile = cmd.positionals[0];
    const { quote, warnings } = (0, pricing_cjs_1.checkQuote)((0, cli_cjs_1.readJsonFile)(quoteFile), pack, (0, node_path_1.basename)(quoteFile));
    const pricing = (0, pricing_cjs_1.price)(quote, pack, version_cjs_1.SKILL_VERSION);
    const text = (0, cli_cjs_1.toJsonText)(pricing);
    const hash = (0, cli_cjs_1.sha256)(text);
    if (cmd.strings.out === undefined)
        return { pricing, sha256: hash, warnings };
    (0, cli_cjs_1.writeOutputFile)(cmd.strings.out, text);
    return {
        out: cmd.strings.out,
        pricingRef: `sha256:${hash}`,
        totals: pricing.formatted,
        approval: pricing.approval,
        warnings,
    };
});
