// Compiled from src/skill/validate.cts. Edit the source, then run npm run build.
//
//   node validate.cjs <proposal.json> <pricing.json> [--pack <dir>]
//
// Checks a proposal before it's built: structure, dates, client, scope against the pricing,
// approved case studies, placeholders, typed amounts and markdown (design §8). It reports every
// problem at once. Fix them all and run it again until it passes; build-docx.cjs runs the same
// checks and won't build an invalid proposal.
import { basename } from "node:path";
import { parseCommandLine, readJsonFile, readTextFile, runScript } from "./lib/cli.cjs";
import { defaultPackDir, loadPack } from "./lib/pack.cjs";
import { checkProposal } from "./lib/proposal.cjs";

const USAGE = "node validate.cjs <proposal.json> <pricing.json> [--pack <dir>]";

runScript((argv) => {
  const cmd = parseCommandLine(argv, USAGE, { min: 2, max: 2 }, { strings: ["pack"] });
  const [proposalFile, pricingFile] = cmd.positionals as [string, string];
  const pack = loadPack(cmd.strings.pack ?? defaultPackDir(__dirname));
  const { pricing, warnings } = checkProposal(readJsonFile(proposalFile), pack, readTextFile(pricingFile), {
    proposal: basename(proposalFile),
    pricing: basename(pricingFile),
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
