"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Compiled from src/skill/check-pack.cts. Edit the source, then run npm run build.
//
//   node check-pack.cjs [pack-dir]
//
// Checks a company pack and summarizes it. With no argument it checks the pack shipped in the
// skill. Claude runs this first in every conversation: a neutral pack means unconfigured mode.
const cli_cjs_1 = require("./lib/cli.cjs");
const pack_cjs_1 = require("./lib/pack.cjs");
const USAGE = "node check-pack.cjs [pack-dir]";
(0, cli_cjs_1.runScript)((argv) => {
    const cmd = (0, cli_cjs_1.parseCommandLine)(argv, USAGE, { min: 0, max: 1 });
    const pack = (0, pack_cjs_1.loadPack)(cmd.positionals[0] ?? (0, pack_cjs_1.defaultPackDir)(__dirname));
    return {
        pack: pack.dir,
        packId: pack.brand.packId,
        configured: pack.brand.configured,
        source: pack.brand.source ?? "packaged",
        company: pack.brand.company.displayName,
        currency: pack.pricing.currency,
        catalogSkus: pack.catalog.items.map((i) => i.sku),
        caseStudies: pack.caseStudies.map((s) => s.id),
        termsOffered: pack.pricing.termDiscounts.map((t) => t.months),
        approval: pack.pricing.approval,
        warnings: (0, pack_cjs_1.packWarnings)(pack),
    };
});
