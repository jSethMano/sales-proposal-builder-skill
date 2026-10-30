// Compiled from src/skill/lib/docx/investment.cts. Edit the source, then run npm run build.
// The Investment section, built from pricing.json only, never from the proposal's text (design X1).
// The builder formats numbers but never computes one: every amount is a field of pricing.json.
import { HeadingLevel, Paragraph, type Table } from "docx";
import type { DiscountKind, PricedLine } from "../types.cjs";
import { brandTable, type Cell, type Column } from "./blocks.cjs";
import { type BuildContext, money, percent, run } from "./context.cjs";
import { DRAFT_COLOR, SIZE } from "./theme.cjs";

const UNIT_LABEL: Readonly<Record<string, string>> = {
  "user/month": "per user",
  "device/month": "per device",
  "site/month": "per site",
  month: "per month",
  user: "per user",
  device: "per device",
  site: "per site",
  project: "fixed price",
};

const APPLIES_TO_LABEL = { all: "all services", recurring: "monthly services", "one-time": "one-time services" } as const;

export function investmentSection(ctx: BuildContext, title: string): (Paragraph | Table)[] {
  const { pricing, theme } = ctx;
  const f = pricing.formatted;
  const small = { size: SIZE.small, color: theme.colors.muted };
  const out: (Paragraph | Table)[] = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(title)] })];

  if (pricing.priceSource === "as-supplied") {
    out.push(new Paragraph({ children: [run("The prices below are as supplied for this proposal.", small)] }));
  }

  const monthly = pricing.lines.filter((l) => l.billing === "monthly");
  const oneTime = pricing.lines.filter((l) => l.billing === "one-time");
  if (monthly.length > 0) {
    out.push(subheading("Monthly services"), linesTable(ctx, monthly, "Monthly amount", ["Monthly total", f.monthlyRecurring]));
  }
  if (oneTime.length > 0) {
    out.push(subheading("One-time services"), linesTable(ctx, oneTime, "Amount", ["One-time total", f.oneTime]));
  }

  const summary: Cell[][] = [];
  if (monthly.length > 0) summary.push(["Monthly services", `${f.monthlyRecurring} per month`]);
  summary.push(["Term", `${f.termMonths} months`]);
  if (oneTime.length > 0) summary.push(["One-time services", f.oneTime]);
  summary.push([`Total over ${f.termMonths} months`, f.termTotal]);
  out.push(
    subheading("Summary"),
    brandTable(ctx, [{ title: "", share: 0.6 }, { title: "Amount", share: 0.4, align: "right" }], summary, { totalRows: 1 }),
    spacer(),
  );

  const extra = pricing.quote.extraDiscount;
  if (extra) {
    out.push(new Paragraph({ children: [run(`Includes an extra discount of ${percent(extra.bps, ctx)} on ${APPLIES_TO_LABEL[extra.appliesTo]}.`)] }));
  }
  if (pricing.totals.savingsMinor > 0) {
    out.push(new Paragraph({ children: [run(`Against list prices, this saves ${f.savings} over the term.`)] }));
  }
  if (ctx.draft) {
    out.push(
      new Paragraph({
        children: [run(`The extra discount needs ${pricing.approval.approver} approval. Until it's approved, this proposal is a draft.`, { bold: true, color: DRAFT_COLOR })],
      }),
    );
  }
  out.push(new Paragraph({ spacing: { after: 0 }, children: [run(ctx.pack.pricing.taxNote, small)] }));
  out.push(new Paragraph({ children: [run(`Prices are valid until ${f.validUntil}.`, small)] }));
  return out;
}

function subheading(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run(text)] });
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

function linesTable(ctx: BuildContext, lines: PricedLine[], amountTitle: string, total: [string, string]): Table {
  // A Discounts column only when some line in this table has a discount; otherwise it would say
  // "None" on every row.
  const discounted = lines.some((l) => l.steps.length > 0);
  const columns: Column[] = discounted
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
  const rows: Cell[][] = lines.map((line) => [
    line.name,
    quantity.format(line.quantity),
    `${money(line.listUnitMinor, ctx)} ${UNIT_LABEL[line.unit] ?? `per ${line.unit}`}`,
    ...(discounted ? [line.steps.length === 0 ? "None" : line.steps.map((s) => `${kindLabel(s.kind, ctx)} ${percent(s.bps, ctx)}`).join(", ")] : []),
    money(line.netMinor, ctx),
  ]);
  rows.push([total[0], ...columns.slice(1, -1).map(() => ""), total[1]]);
  return brandTable(ctx, columns, rows, { totalRows: 1 });
}

function kindLabel(kind: DiscountKind, ctx: BuildContext): string {
  if (kind === "term") return `${ctx.pricing.termMonths}-month term`;
  return kind === "volume" ? "Volume" : "Extra";
}
