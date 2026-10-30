// Builds what a correct run of a scenario produces, using the real scripts: the known-good case for
// testing the graders. If a code check fails on its oracle, the check is wrong, not the model.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../tools/lib/package.ts";
import { packDirFor, runSkillScript } from "./scenarios.ts";
import type { OutputFile, Scenario } from "./types.ts";

// Plain prose that meets every section's length guide, so the oracle validates without warnings.
const PARAGRAPH =
  "We will look after {{client.name}} with the services set out below, agree the plan with the team before any work starts, and report on progress every month so that nothing is a surprise.";

export function buildOracle(scenario: Scenario, workDir: string): OutputFile[] {
  const o = scenario.oracle;
  let pack = packDirFor(scenario.pack);
  if (o.brand) {
    const b = o.brand;
    pack = join(workDir, "pack");
    runSkillScript("init-pack.cjs", [
      pack, "--name", b.name, "--primary", b.primary, "--currency", b.currency,
      "--signatory-name", b.signatoryName, "--signatory-title", b.signatoryTitle,
      ...(b.locale ? ["--locale", b.locale] : []),
      ...(b.logo ? ["--logo", join(ROOT, b.logo)] : []),
    ]);
  }
  if (!scenario.expectedQuote) throw new Error(`${scenario.id} has no expected quote to build an oracle from.`);
  const quotePath = join(ROOT, scenario.expectedQuote);
  const quote = JSON.parse(readFileSync(quotePath, "utf8")) as {
    quoteDate: string;
    lines: ({ sku: string } | { custom: { name: string } })[];
  };
  const pricingFile = join(workDir, "pricing.json");
  const priced = runSkillScript("price.cjs", [quotePath, "--pack", pack, "--out", pricingFile]);
  const caseStudies = runSkillScript("check-pack.cjs", [pack]).caseStudies as string[];

  const proposal = {
    schemaVersion: 1,
    pricingRef: priced.pricingRef,
    title: "IT services proposal",
    date: quote.quoteDate,
    startDate: o.startDate,
    client: { name: o.client, contact: o.contact },
    sections: {
      executiveSummary: `${PARAGRAPH} ${PARAGRAPH}\n\nThe ongoing services cost {{pricing.monthlyRecurring}} per month over {{pricing.termMonths}} months, {{pricing.termTotal}} in total.`,
      understanding: `${PARAGRAPH}\n\n${PARAGRAPH}`,
      solution: `${PARAGRAPH} ${PARAGRAPH}\n\n${PARAGRAPH}`,
      scope: quote.lines.map((l) => ({ item: "sku" in l ? l.sku : l.custom.name, notes: "Covers everyone named in the brief, from the start date." })),
      timeline: [{ label: "Start", when: "From the start date", detail: "Services begin for everyone." }],
      whyUs: { intro: PARAGRAPH, caseStudyIds: caseStudies.slice(0, 1) },
      assumptions: ["Access to current systems is provided before work starts."],
      notIncluded: o.notIncluded ?? [],
      nextSteps: `${PARAGRAPH} This proposal is valid until {{pricing.validUntil}}.`,
    },
  };
  const proposalFile = join(workDir, "proposal.json");
  writeFileSync(proposalFile, JSON.stringify(proposal, null, 2));
  const out = join(workDir, `${scenario.id}.docx`);
  runSkillScript("build-docx.cjs", [proposalFile, pricingFile, out, "--pack", pack]);
  // The document arrives in the last turn, after any scripted replies.
  return [{ turn: scenario.turns.length + 1, name: `${scenario.id}.docx`, path: out }];
}
