"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Compiled from src/skill/validate.cts. Edit the source, then run npm run build.
//
//   node validate.cjs <proposal.json> <pricing.json> [--pack <dir>]
//
// Checks a proposal before it's built: structure, dates, client, scope against the pricing,
// approved case studies, placeholders, typed amounts and markdown (design §8). It reports every
// problem at once. Fix them all and run it again until it passes; build-docx.cjs runs the same
// checks and won't build an invalid proposal.
const node_path_1 = require("node:path");
const cli_cjs_1 = require("./lib/cli.cjs");
const pack_cjs_1 = require("./lib/pack.cjs");
const proposal_cjs_1 = require("./lib/proposal.cjs");
const USAGE = "node validate.cjs <proposal.json> <pricing.json> [--pack <dir>]";
(0, cli_cjs_1.runScript)((argv) => {
    const cmd = (0, cli_cjs_1.parseCommandLine)(argv, USAGE, { min: 2, max: 2 }, { strings: ["pack"] });
    const [proposalFile, pricingFile] = cmd.positionals;
    const pack = (0, pack_cjs_1.loadPack)(cmd.strings.pack ?? (0, pack_cjs_1.defaultPackDir)(__dirname));
    const { pricing, warnings } = (0, proposal_cjs_1.checkProposal)((0, cli_cjs_1.readJsonFile)(proposalFile), pack, (0, cli_cjs_1.readTextFile)(pricingFile), {
        proposal: (0, node_path_1.basename)(proposalFile),
        pricing: (0, node_path_1.basename)(pricingFile),
    });
    const approval = pricing.approval;
    return {
        draft: approval.needed,
        approver: approval.needed ? approval.approver : null,
        approvalReason: approval.reason,
        priceSource: pricing.priceSource,
        warnings,
        next: approval.needed
            ? `Build with build-docx.cjs; the document will be marked DRAFT. Tell the salesperson it needs ${approval.approver} approval, and why.`
            : "Build with build-docx.cjs.",
    };
});
