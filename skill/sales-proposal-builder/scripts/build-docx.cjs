"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Compiled from src/skill/build-docx.cts. Edit the source, then run npm run build.
//
//   node build-docx.cjs <proposal.json> <pricing.json> <out.docx> [--pack <dir>]
//
// Builds the branded proposal. It runs every validate.cjs check first and refuses to build an
// invalid proposal (design X3). The Investment section comes from pricing.json only, and the
// document is marked DRAFT whenever pricing.json says approval is needed (design X4).
const node_path_1 = require("node:path");
const cli_cjs_1 = require("./lib/cli.cjs");
const document_cjs_1 = require("./lib/docx/document.cjs");
const pack_cjs_1 = require("./lib/pack.cjs");
const proposal_cjs_1 = require("./lib/proposal.cjs");
const version_cjs_1 = require("./lib/version.cjs");
const USAGE = "node build-docx.cjs <proposal.json> <pricing.json> <out.docx> [--pack <dir>]";
(0, cli_cjs_1.runScript)(async (argv) => {
    const cmd = (0, cli_cjs_1.parseCommandLine)(argv, USAGE, { min: 3, max: 3 }, { strings: ["pack"] });
    const [proposalFile, pricingFile, outFile] = cmd.positionals;
    if (!outFile.toLowerCase().endsWith(".docx"))
        throw (0, cli_cjs_1.usageError)(USAGE, `The output file must end in .docx, got ${outFile}.`);
    const pack = (0, pack_cjs_1.loadPack)(cmd.strings.pack ?? (0, pack_cjs_1.defaultPackDir)(__dirname));
    const { proposal, pricing, warnings } = (0, proposal_cjs_1.checkProposal)((0, cli_cjs_1.readJsonFile)(proposalFile), pack, (0, cli_cjs_1.readTextFile)(pricingFile), {
        proposal: (0, node_path_1.basename)(proposalFile),
        pricing: (0, node_path_1.basename)(pricingFile),
    });
    const rendered = await (0, document_cjs_1.renderDocx)(pack, proposal, pricing, version_cjs_1.SKILL_VERSION);
    (0, cli_cjs_1.writeOutputFile)(outFile, rendered.buffer);
    const approval = pricing.approval;
    return {
        path: (0, node_path_1.resolve)(outFile),
        bytes: rendered.buffer.length,
        draft: rendered.draft,
        watermark: rendered.watermark,
        warnings,
        next: rendered.draft
            ? `Deliver the .docx. Say clearly that it's a DRAFT until ${approval.approver} approves it: ${approval.reason}`
            : "Deliver the .docx with a short note: the assumptions you made, and anything not included.",
    };
});
