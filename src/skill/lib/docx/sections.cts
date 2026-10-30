// Compiled from src/skill/lib/docx/sections.cts. Edit the source, then run npm run build.
// The body of the proposal, in the order of design §9. Claude's prose comes from proposal.json;
// approved wording (catalog includes and SLAs, case studies, terms, signatory) comes verbatim
// from the pack (design X5).
import { HeadingLevel, Paragraph, type Table } from "docx";
import { brandTable, type Cell, markdownParagraphs } from "./blocks.cjs";
import { type BuildContext, fillTokens, run } from "./context.cjs";
import { investmentSection } from "./investment.cjs";
import { SIZE } from "./theme.cjs";

/** Section headings, in document order. Evals check for these. */
export const SECTION_TITLES = {
  executiveSummary: "Executive summary",
  understanding: "Understanding of your needs",
  solution: "Proposed solution",
  scope: "Scope and deliverables",
  timeline: "Timeline",
  investment: "Investment",
  whyUs: "Why {company}",
  assumptions: "Assumptions",
  terms: "Terms",
  nextSteps: "Next steps and acceptance",
} as const;

type Body = (Paragraph | Table)[];

export function bodySections(ctx: BuildContext): Body {
  const s = ctx.proposal.sections;
  const title = (key: keyof typeof SECTION_TITLES): string => SECTION_TITLES[key].replace("{company}", ctx.company);
  return [
    // The cover fills page 1, so the body starts on a new page.
    h1(title("executiveSummary"), { pageBreakBefore: true }),
    ...markdownParagraphs(s.executiveSummary, ctx),
    h1(title("understanding")),
    ...markdownParagraphs(s.understanding, ctx),
    h1(title("solution")),
    ...markdownParagraphs(s.solution, ctx),
    ...scope(ctx, title("scope")),
    ...timeline(ctx, title("timeline")),
    ...investmentSection(ctx, title("investment")),
    ...whyUs(ctx, title("whyUs")),
    ...assumptions(ctx, title("assumptions")),
    h1(title("terms")),
    ...markdownParagraphs(ctx.pack.terms, ctx),
    ...nextSteps(ctx, title("nextSteps")),
  ];
}

function h1(text: string, options: { pageBreakBefore?: boolean } = {}): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, ...options, children: [run(text)] });
}

function h2(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(text)] });
}

function bullets(items: string[], ctx: BuildContext): Paragraph[] {
  return items.map((item) => new Paragraph({ bullet: { level: 0 }, children: [run(fillTokens(item, ctx))] }));
}

function scope(ctx: BuildContext, title: string): Body {
  const out: Body = [h1(title)];
  for (const entry of ctx.proposal.sections.scope) {
    const line = ctx.pricing.lines.find((l) => (l.sku ?? l.name) === entry.item);
    const item = ctx.pack.catalog.items.find((i) => i.sku === entry.item);
    out.push(h2(line?.name ?? item?.name ?? entry.item));
    if (item) {
      // The description and the "Includes" label stay with the list, so a label never ends a page alone.
      out.push(new Paragraph({ keepNext: true, children: [run(item.description)] }));
      out.push(new Paragraph({ keepNext: true, spacing: { after: 60 }, children: [run("Includes", { bold: true })] }));
      out.push(...bullets(item.includes, ctx));
      if (item.sla) out.push(new Paragraph({ children: [run("Service level: ", { bold: true }), run(item.sla)] }));
    }
    out.push(...markdownParagraphs(entry.notes, ctx));
  }
  return out;
}

function timeline(ctx: BuildContext, title: string): Body {
  const rows: Cell[][] = ctx.proposal.sections.timeline.map((row) => [
    fillTokens(row.label, ctx),
    fillTokens(row.when, ctx),
    { markdown: row.detail },
  ]);
  return [
    h1(title),
    brandTable(ctx, [{ title: "Phase", share: 0.24 }, { title: "When", share: 0.26 }, { title: "What happens", share: 0.5 }], rows),
  ];
}

function whyUs(ctx: BuildContext, title: string): Body {
  const { intro, caseStudyIds } = ctx.proposal.sections.whyUs;
  const out: Body = [h1(title), ...markdownParagraphs(intro, ctx)];
  for (const id of caseStudyIds) {
    const story = ctx.pack.caseStudies.find((c) => c.id === id);
    if (!story) continue; // validation guarantees every ID exists
    out.push(
      h2(story.title),
      new Paragraph({ keepNext: true, spacing: { after: 60 }, children: [run(story.industry, { size: SIZE.small, color: ctx.theme.colors.muted })] }),
      new Paragraph({ children: [run(story.summary)] }),
      new Paragraph({ children: [run("Outcome: ", { bold: true }), run(story.outcome)] }),
    );
  }
  return out;
}

function assumptions(ctx: BuildContext, title: string): Body {
  const { assumptions: list, notIncluded } = ctx.proposal.sections;
  const out: Body = [h1(title)];
  if (list.length > 0) out.push(...bullets(list, ctx));
  else out.push(new Paragraph({ children: [run("This proposal makes no assumptions beyond the terms below.")] }));
  if (notIncluded.length > 0) out.push(h2("Not included in this proposal"), ...bullets(notIncluded, ctx));
  return out;
}

function nextSteps(ctx: BuildContext, title: string): Body {
  const { signatory } = ctx.pack.brand;
  // A third of an inch above the signature line leaves room to sign by hand.
  const signHere = (text: string): Cell => ({ text, spaceBefore: 480 });
  const signing: Cell[][] = [
    [`Name: ${signatory.name}`, "Name:"],
    [`Title: ${signatory.title}`, "Title:"],
    [signHere("Signature:"), signHere("Signature:")],
    ["Date:", "Date:"],
  ];
  return [
    h1(title),
    ...markdownParagraphs(ctx.proposal.sections.nextSteps, ctx),
    h2("Acceptance"),
    new Paragraph({ keepNext: true, children: [run("By signing below, both parties accept this proposal and the terms above.")] }),
    brandTable(ctx, [{ title: `For ${ctx.company}`, share: 0.5 }, { title: `For ${ctx.client}`, share: 0.5 }], signing),
  ];
}
