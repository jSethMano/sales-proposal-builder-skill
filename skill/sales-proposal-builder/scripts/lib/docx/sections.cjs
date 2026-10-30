"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECTION_TITLES = void 0;
exports.bodySections = bodySections;
// Compiled from src/skill/lib/docx/sections.cts. Edit the source, then run npm run build.
// The body of the proposal, in the order of design §9. Claude's prose comes from proposal.json;
// approved wording (catalog includes and SLAs, case studies, terms, signatory) comes verbatim
// from the pack (design X5).
const docx_1 = require("docx");
const blocks_cjs_1 = require("./blocks.cjs");
const context_cjs_1 = require("./context.cjs");
const investment_cjs_1 = require("./investment.cjs");
const theme_cjs_1 = require("./theme.cjs");
/** Section headings, in document order. Evals check for these. */
exports.SECTION_TITLES = {
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
};
function bodySections(ctx) {
    const s = ctx.proposal.sections;
    const title = (key) => exports.SECTION_TITLES[key].replace("{company}", ctx.company);
    return [
        // The cover fills page 1, so the body starts on a new page.
        h1(title("executiveSummary"), { pageBreakBefore: true }),
        ...(0, blocks_cjs_1.markdownParagraphs)(s.executiveSummary, ctx),
        h1(title("understanding")),
        ...(0, blocks_cjs_1.markdownParagraphs)(s.understanding, ctx),
        h1(title("solution")),
        ...(0, blocks_cjs_1.markdownParagraphs)(s.solution, ctx),
        ...scope(ctx, title("scope")),
        ...timeline(ctx, title("timeline")),
        ...(0, investment_cjs_1.investmentSection)(ctx, title("investment")),
        ...whyUs(ctx, title("whyUs")),
        ...assumptions(ctx, title("assumptions")),
        h1(title("terms")),
        ...(0, blocks_cjs_1.markdownParagraphs)(ctx.pack.terms, ctx),
        ...nextSteps(ctx, title("nextSteps")),
    ];
}
function h1(text, options = {}) {
    return new docx_1.Paragraph({ heading: docx_1.HeadingLevel.HEADING_1, ...options, children: [(0, context_cjs_1.run)(text)] });
}
function h2(text) {
    return new docx_1.Paragraph({ heading: docx_1.HeadingLevel.HEADING_2, children: [(0, context_cjs_1.run)(text)] });
}
function bullets(items, ctx) {
    return items.map((item) => new docx_1.Paragraph({ bullet: { level: 0 }, children: [(0, context_cjs_1.run)((0, context_cjs_1.fillTokens)(item, ctx))] }));
}
function scope(ctx, title) {
    const out = [h1(title)];
    for (const entry of ctx.proposal.sections.scope) {
        const line = ctx.pricing.lines.find((l) => (l.sku ?? l.name) === entry.item);
        const item = ctx.pack.catalog.items.find((i) => i.sku === entry.item);
        out.push(h2(line?.name ?? item?.name ?? entry.item));
        if (item) {
            // The description and the "Includes" label stay with the list, so a label never ends a page alone.
            out.push(new docx_1.Paragraph({ keepNext: true, children: [(0, context_cjs_1.run)(item.description)] }));
            out.push(new docx_1.Paragraph({ keepNext: true, spacing: { after: 60 }, children: [(0, context_cjs_1.run)("Includes", { bold: true })] }));
            out.push(...bullets(item.includes, ctx));
            if (item.sla)
                out.push(new docx_1.Paragraph({ children: [(0, context_cjs_1.run)("Service level: ", { bold: true }), (0, context_cjs_1.run)(item.sla)] }));
        }
        out.push(...(0, blocks_cjs_1.markdownParagraphs)(entry.notes, ctx));
    }
    return out;
}
function timeline(ctx, title) {
    const rows = ctx.proposal.sections.timeline.map((row) => [
        (0, context_cjs_1.fillTokens)(row.label, ctx),
        (0, context_cjs_1.fillTokens)(row.when, ctx),
        { markdown: row.detail },
    ]);
    return [
        h1(title),
        (0, blocks_cjs_1.brandTable)(ctx, [{ title: "Phase", share: 0.24 }, { title: "When", share: 0.26 }, { title: "What happens", share: 0.5 }], rows),
    ];
}
function whyUs(ctx, title) {
    const { intro, caseStudyIds } = ctx.proposal.sections.whyUs;
    const out = [h1(title), ...(0, blocks_cjs_1.markdownParagraphs)(intro, ctx)];
    for (const id of caseStudyIds) {
        const story = ctx.pack.caseStudies.find((c) => c.id === id);
        if (!story)
            continue; // validation guarantees every ID exists
        out.push(h2(story.title), new docx_1.Paragraph({ keepNext: true, spacing: { after: 60 }, children: [(0, context_cjs_1.run)(story.industry, { size: theme_cjs_1.SIZE.small, color: ctx.theme.colors.muted })] }), new docx_1.Paragraph({ children: [(0, context_cjs_1.run)(story.summary)] }), new docx_1.Paragraph({ children: [(0, context_cjs_1.run)("Outcome: ", { bold: true }), (0, context_cjs_1.run)(story.outcome)] }));
    }
    return out;
}
function assumptions(ctx, title) {
    const { assumptions: list, notIncluded } = ctx.proposal.sections;
    const out = [h1(title)];
    if (list.length > 0)
        out.push(...bullets(list, ctx));
    else
        out.push(new docx_1.Paragraph({ children: [(0, context_cjs_1.run)("This proposal makes no assumptions beyond the terms below.")] }));
    if (notIncluded.length > 0)
        out.push(h2("Not included in this proposal"), ...bullets(notIncluded, ctx));
    return out;
}
function nextSteps(ctx, title) {
    const { signatory } = ctx.pack.brand;
    // A third of an inch above the signature line leaves room to sign by hand.
    const signHere = (text) => ({ text, spaceBefore: 480 });
    const signing = [
        [`Name: ${signatory.name}`, "Name:"],
        [`Title: ${signatory.title}`, "Title:"],
        [signHere("Signature:"), signHere("Signature:")],
        ["Date:", "Date:"],
    ];
    return [
        h1(title),
        ...(0, blocks_cjs_1.markdownParagraphs)(ctx.proposal.sections.nextSteps, ctx),
        h2("Acceptance"),
        new docx_1.Paragraph({ keepNext: true, children: [(0, context_cjs_1.run)("By signing below, both parties accept this proposal and the terms above.")] }),
        (0, blocks_cjs_1.brandTable)(ctx, [{ title: `For ${ctx.company}`, share: 0.5 }, { title: `For ${ctx.client}`, share: 0.5 }], signing),
    ];
}
