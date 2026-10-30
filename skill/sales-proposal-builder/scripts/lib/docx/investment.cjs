"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.investmentSection = investmentSection;
// Compiled from src/skill/lib/docx/investment.cts. Edit the source, then run npm run build.
// The Investment section, built from pricing.json only, never from the proposal's text (design X1).
// The builder formats numbers but never computes one: every amount is a field of pricing.json.
const docx_1 = require("docx");
const blocks_cjs_1 = require("./blocks.cjs");
const context_cjs_1 = require("./context.cjs");
const theme_cjs_1 = require("./theme.cjs");
const UNIT_LABEL = {
    "user/month": "per user",
    "device/month": "per device",
    "site/month": "per site",
    month: "per month",
    user: "per user",
    device: "per device",
    site: "per site",
    project: "fixed price",
};
const APPLIES_TO_LABEL = { all: "all services", recurring: "monthly services", "one-time": "one-time services" };
function investmentSection(ctx, title) {
    const { pricing, theme } = ctx;
    const f = pricing.formatted;
    const small = { size: theme_cjs_1.SIZE.small, color: theme.colors.muted };
    const out = [new docx_1.Paragraph({ heading: docx_1.HeadingLevel.HEADING_1, children: [(0, context_cjs_1.run)(title)] })];
    if (pricing.priceSource === "as-supplied") {
        out.push(new docx_1.Paragraph({ children: [(0, context_cjs_1.run)("The prices below are as supplied for this proposal.", small)] }));
    }
    const monthly = pricing.lines.filter((l) => l.billing === "monthly");
    const oneTime = pricing.lines.filter((l) => l.billing === "one-time");
    if (monthly.length > 0) {
        out.push(subheading("Monthly services"), linesTable(ctx, monthly, "Monthly amount", ["Monthly total", f.monthlyRecurring]));
    }
    if (oneTime.length > 0) {
        out.push(subheading("One-time services"), linesTable(ctx, oneTime, "Amount", ["One-time total", f.oneTime]));
    }
    const summary = [];
    if (monthly.length > 0)
        summary.push(["Monthly services", `${f.monthlyRecurring} per month`]);
    summary.push(["Term", `${f.termMonths} months`]);
    if (oneTime.length > 0)
        summary.push(["One-time services", f.oneTime]);
    summary.push([`Total over ${f.termMonths} months`, f.termTotal]);
    out.push(subheading("Summary"), (0, blocks_cjs_1.brandTable)(ctx, [{ title: "", share: 0.6 }, { title: "Amount", share: 0.4, align: "right" }], summary, { totalRows: 1 }), spacer());
    const extra = pricing.quote.extraDiscount;
    if (extra) {
        out.push(new docx_1.Paragraph({ children: [(0, context_cjs_1.run)(`Includes an extra discount of ${(0, context_cjs_1.percent)(extra.bps, ctx)} on ${APPLIES_TO_LABEL[extra.appliesTo]}.`)] }));
    }
    if (pricing.totals.savingsMinor > 0) {
        out.push(new docx_1.Paragraph({ children: [(0, context_cjs_1.run)(`Against list prices, this saves ${f.savings} over the term.`)] }));
    }
    if (ctx.draft) {
        out.push(new docx_1.Paragraph({
            children: [(0, context_cjs_1.run)(`The extra discount needs ${pricing.approval.approver} approval. Until it's approved, this proposal is a draft.`, { bold: true, color: theme_cjs_1.DRAFT_COLOR })],
        }));
    }
    out.push(new docx_1.Paragraph({ spacing: { after: 0 }, children: [(0, context_cjs_1.run)(ctx.pack.pricing.taxNote, small)] }));
    out.push(new docx_1.Paragraph({ children: [(0, context_cjs_1.run)(`Prices are valid until ${f.validUntil}.`, small)] }));
    return out;
}
function subheading(text) {
    return new docx_1.Paragraph({ heading: docx_1.HeadingLevel.HEADING_3, children: [(0, context_cjs_1.run)(text)] });
}
function spacer() {
    return new docx_1.Paragraph({ spacing: { after: 120 }, children: [] });
}
function linesTable(ctx, lines, amountTitle, total) {
    // A Discounts column only when some line in this table has a discount; otherwise it would say
    // "None" on every row.
    const discounted = lines.some((l) => l.steps.length > 0);
    const columns = discounted
        ? [
            { title: "Item", share: 0.34 },
            { title: "Qty", share: 0.08, align: "right" },
            { title: "List price", share: 0.2, align: "right" },
            { title: "Discounts", share: 0.2 },
            { title: amountTitle, share: 0.18, align: "right" },
        ]
        : [
            { title: "Item", share: 0.46 },
            { title: "Qty", share: 0.1, align: "right" },
            { title: "List price", share: 0.24, align: "right" },
            { title: amountTitle, share: 0.2, align: "right" },
        ];
    const quantity = new Intl.NumberFormat(ctx.pricing.locale);
    const rows = lines.map((line) => [
        line.name,
        quantity.format(line.quantity),
        `${(0, context_cjs_1.money)(line.listUnitMinor, ctx)} ${UNIT_LABEL[line.unit] ?? `per ${line.unit}`}`,
        ...(discounted ? [line.steps.length === 0 ? "None" : line.steps.map((s) => `${kindLabel(s.kind, ctx)} ${(0, context_cjs_1.percent)(s.bps, ctx)}`).join(", ")] : []),
        (0, context_cjs_1.money)(line.netMinor, ctx),
    ]);
    rows.push([total[0], ...columns.slice(1, -1).map(() => ""), total[1]]);
    return (0, blocks_cjs_1.brandTable)(ctx, columns, rows, { totalRows: 1 });
}
function kindLabel(kind, ctx) {
    if (kind === "term")
        return `${ctx.pricing.termMonths}-month term`;
    return kind === "volume" ? "Volume" : "Extra";
}
