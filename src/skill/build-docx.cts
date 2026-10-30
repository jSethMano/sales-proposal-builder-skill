// Compiled from src/skill/build-docx.cts. Edit the source, then run npm run build.
//
//   node build-docx.cjs <proposal.json> <pricing.json> <out.docx> [--pack <dir>]
//
// Builds the branded proposal. It runs every validate.cjs check first and refuses to build an
// invalid proposal (design X3). The Investment section comes from pricing.json only, and the
// document is marked DRAFT whenever pricing.json says approval is needed (design X4).
import { basename, resolve } from "node:path";
import { parseCommandLine, readJsonFile, readTextFile, runScript, usageError, writeOutputFile } from "./lib/cli.cjs";
import { renderDocx } from "./lib/docx/document.cjs";
import { defaultPackDir, loadPack } from "./lib/pack.cjs";
import { checkProposal } from "./lib/proposal.cjs";
import { SKILL_VERSION } from "./lib/version.cjs";

const USAGE = "node build-docx.cjs <proposal.json> <pricing.json> <out.docx> [--pack <dir>]";

runScript(async (argv) => {
  const cmd = parseCommandLine(argv, USAGE, { min: 3, max: 3 }, { strings: ["pack"] });
  const [proposalFile, pricingFile, outFile] = cmd.positionals as [string, string, string];
  if (!outFile.toLowerCase().endsWith(".docx")) throw usageError(USAGE, `The output file must end in .docx, got ${outFile}.`);

  const pack = loadPack(cmd.strings.pack ?? defaultPackDir(__dirname));
  const { proposal, pricing, warnings } = checkProposal(readJsonFile(proposalFile), pack, readTextFile(pricingFile), {
    proposal: basename(proposalFile),
    pricing: basename(pricingFile),
  });
  const rendered = await renderDocx(pack, proposal, pricing, SKILL_VERSION);
  writeOutputFile(outFile, rendered.buffer);

  const approval = pricing.approval;
  return {
    path: resolve(outFile),
    bytes: rendered.buffer.length,
    draft: rendered.draft,
    watermark: rendered.watermark,
    warnings,
    next: rendered.draft
      ? `Deliver the .docx. Say clearly that it's a DRAFT until ${approval.approver} approves it: ${approval.reason}`
      : "Deliver the .docx with a short note: the assumptions you made, and anything not included.",
  };
});
