// Compiled from src/skill/lib/pricing.cts. Edit the source, then run npm run build.
// The pricing engine (design §5). price() is a pure function of (quote, pack, version): no clock,
// no network, no randomness, so the same inputs always give byte-identical output (design X8).
import { addDays, at, Checker, formatDate, isIsoDate } from "./check.cjs";
import { Problems } from "./cli.cjs";
import { closest } from "./closest.cjs";
import { currencyMinorUnits, discountMinor, formatBps, formatMoney, isCurrencyCode, toSafeNumber } from "./money.cjs";
import { MAX_DISCOUNT_BPS, MAX_PRICE_MINOR, MAX_QUANTITY, MAX_TERM_MONTHS } from "./pack.cjs";
import type {
  Approval,
  Billing,
  DiscountKind,
  DiscountStep,
  Pack,
  PricedLine,
  PricingOutput,
  Problem,
  Quote,
  QuoteLine,
} from "./types.cjs";

/** Written into every pricing.json so the rule travels with the numbers. */
export const PRICING_RULE_TEXT =
  "Discounts compound in the order volume → term → extra, and each discount is rounded half-up to a whole minor unit. " +
  "Volume tiers apply to catalog items marked volumeTiered, term discounts to monthly items, and the extra discount " +
  "to the billing types in appliesTo. Approval is needed when the extra discount is above the pack's limit; " +
  "volume and term discounts are pack policy and never need approval.";

const APPLIES_TO = ["all", "recurring", "one-time"] as const;
const BILLINGS: readonly Billing[] = ["monthly", "one-time"];

export interface CheckedQuote {
  quote: Quote;
  warnings: Problem[];
}

/** Checks a quote against the pack and returns it in canonical form, or throws with every problem. */
export function checkQuote(raw: unknown, pack: Pack, file = "quote.json"): CheckedQuote {
  const problems: Problems = new Problems();
  const c = new Checker(problems, "E_QUOTE_SCHEMA", file);
  const q = c.object(raw, "", ["schemaVersion", "quoteDate", "termMonths", "currency", "lines", "extraDiscount"]);
  if (!q) problems.throwNow();

  c.literal(q.schemaVersion, "schemaVersion", 1);

  const quoteDate = c.string(q.quoteDate, "quoteDate");
  if (quoteDate !== undefined && !isIsoDate(quoteDate)) {
    c.fail("quoteDate", `'${quoteDate}' is not a real date in YYYY-MM-DD form.`, "Use the proposal's date, e.g. \"2027-01-15\".", "E_DATE");
  }

  const termMonths = c.int(q.termMonths, "termMonths", 1, MAX_TERM_MONTHS);
  const offered = pack.pricing.termDiscounts.map((t) => t.months).sort((a, b) => a - b);
  if (termMonths !== undefined && offered.length > 0 && !offered.includes(termMonths)) {
    c.fail("termMonths", `Term ${termMonths} months is not offered.`, `Choose ${listWords(offered.map(String))} months.`, "E_TERM");
  }

  const currency = checkCurrency(c, q.currency, pack);
  const lines = checkLines(c, q.lines, pack);
  const extraDiscount = checkExtraDiscount(c, q.extraDiscount);
  problems.throwIfAny();

  const quote: Quote = {
    schemaVersion: 1,
    quoteDate: quoteDate as string,
    termMonths: termMonths as number,
    ...(currency !== undefined ? { currency } : {}),
    lines,
    ...(extraDiscount ? { extraDiscount } : {}),
  };
  return { quote, warnings: quoteWarnings(quote, pack) };
}

function checkCurrency(c: Checker, value: unknown, pack: Pack): string | undefined {
  const packCurrency = pack.pricing.currency;
  if (packCurrency === null) {
    if (value === undefined) {
      c.fail("currency", "The pack has no currency, so the quote must set one.", "Ask which currency to quote in and set currency, e.g. \"USD\".", "E_CURRENCY");
      return undefined;
    }
    const code = c.string(value, "currency");
    if (code !== undefined && !isCurrencyCode(code)) {
      c.fail("currency", `'${code}' is not an ISO 4217 currency code.`, "Use a code like \"USD\", \"AUD\" or \"EUR\".", "E_CURRENCY");
      return undefined;
    }
    return code;
  }
  if (value !== undefined && value !== packCurrency) {
    c.fail("currency", `This pack prices in ${packCurrency}.`, "Remove currency from the quote; the pack sets it.", "E_CURRENCY");
  }
  return undefined;
}

function checkLines(c: Checker, value: unknown, pack: Pack): QuoteLine[] {
  const list = c.array(value, "lines", 1);
  if (!list) return [];
  const skus = pack.catalog.items.map((i) => i.sku);
  const hasCatalog = skus.length > 0;
  const seen = new Set<string>();
  const out: QuoteLine[] = [];

  list.forEach((rawLine, i) => {
    const path = at("lines", i);
    const line = c.object(rawLine, path, ["sku", "quantity", "custom"]);
    if (!line) return;
    const quantity = checkQuantity(c, line.quantity, at(path, "quantity"));

    if (line.sku !== undefined && line.custom !== undefined) {
      c.fail(path, "A line has either sku or custom, not both.");
      return;
    }
    if (line.sku !== undefined) {
      const sku = c.string(line.sku, at(path, "sku"));
      if (sku === undefined) return;
      if (!skus.includes(sku)) {
        const guess = closest(sku, skus);
        c.fail(
          at(path, "sku"),
          hasCatalog ? `SKU '${sku}' not in catalog.` : `SKU '${sku}' not in catalog: this pack has no catalog.`,
          hasCatalog
            ? `${guess ? `Closest: ${guess}. ` : `Catalog SKUs: ${skus.join(", ")}. `}If the client wants something the catalog doesn't sell, list it in notIncluded instead of pricing it.`
            : "Use a custom line with the price the salesperson gives you.",
          "E_SKU_UNKNOWN",
        );
        return;
      }
      if (seen.has(sku)) {
        c.fail(at(path, "sku"), `SKU ${sku} appears on more than one line.`, "Combine them into one line with the total quantity.", "E_DUPLICATE_LINE");
        return;
      }
      seen.add(sku);
      if (quantity !== undefined) out.push({ sku, quantity });
      return;
    }
    if (line.custom !== undefined) {
      if (hasCatalog) {
        c.fail(
          at(path, "custom"),
          "Custom lines are not allowed: this pack has a catalog.",
          "Sell only catalog SKUs. Put out-of-catalog requests in the proposal's notIncluded list, unpriced.",
          "E_CUSTOM_LINE",
        );
        return;
      }
      const custom = c.object(line.custom, at(path, "custom"), ["name", "unit", "billing", "unitPriceMinor"]);
      if (!custom) return;
      const name = c.string(custom.name, at(path, "custom.name"));
      const unit = c.string(custom.unit, at(path, "custom.unit"));
      const billing = c.oneOf(custom.billing, at(path, "custom.billing"), BILLINGS);
      const unitPriceMinor = c.int(custom.unitPriceMinor, at(path, "custom.unitPriceMinor"), 1, MAX_PRICE_MINOR);
      if ([name, unit, billing, unitPriceMinor, quantity].includes(undefined)) return;
      out.push({
        custom: { name: name as string, unit: unit as string, billing: billing as Billing, unitPriceMinor: unitPriceMinor as number },
        quantity: quantity as number,
      });
      return;
    }
    c.fail(path, "The line has no sku.", hasCatalog ? "Add a catalog sku." : "Add a custom item with the salesperson's price.");
  });
  return out;
}

function checkQuantity(c: Checker, value: unknown, path: string): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY) return value;
  c.fail(
    path,
    value === undefined ? "Missing quantity." : `Quantity must be a whole number from 1 to ${MAX_QUANTITY.toLocaleString("en-US")}.`,
    "Use the seat, device or site count from the brief. Ask if it isn't there; don't estimate.",
    "E_QUANTITY",
  );
  return undefined;
}

function checkExtraDiscount(c: Checker, value: unknown): Quote["extraDiscount"] {
  if (value === undefined) return undefined;
  const d = c.object(value, "extraDiscount", ["bps", "appliesTo", "reason"]);
  if (!d) return undefined;
  let bps: number | undefined;
  if (typeof d.bps === "number" && Number.isInteger(d.bps) && d.bps >= 1 && d.bps <= MAX_DISCOUNT_BPS) {
    bps = d.bps;
  } else {
    c.fail(
      "extraDiscount.bps",
      `Extra discount must be a whole number of basis points from 1 to ${MAX_DISCOUNT_BPS}.`,
      "1 basis point is 0.01%, so 12.5% is 1250. Leave extraDiscount out when there is none.",
      "E_DISCOUNT",
    );
  }
  const appliesTo = c.oneOf(d.appliesTo, "extraDiscount.appliesTo", APPLIES_TO);
  const reason = c.string(d.reason, "extraDiscount.reason");
  if (bps === undefined || appliesTo === undefined || reason === undefined) return undefined;
  return { bps, appliesTo, reason };
}

function quoteWarnings(quote: Quote, pack: Pack): Problem[] {
  const warnings: Problem[] = [];
  const d = quote.extraDiscount;
  if (d && d.appliesTo !== "all") {
    const target: Billing = d.appliesTo === "recurring" ? "monthly" : "one-time";
    if (!quote.lines.some((l) => resolveLine(l, pack).billing === target)) {
      warnings.push({
        code: "W_DISCOUNT_UNUSED",
        path: "quote.json:extraDiscount.appliesTo",
        message: `The extra discount applies to ${d.appliesTo} items, but the quote has none.`,
        hint: "Check appliesTo, or remove the discount.",
      });
    }
  }
  return warnings;
}

interface ResolvedLine {
  sku: string | null;
  name: string;
  billing: Billing;
  unit: string;
  listUnitMinor: number;
  volumeTiered: boolean;
}

function resolveLine(line: QuoteLine, pack: Pack): ResolvedLine {
  if ("custom" in line) {
    const c = line.custom;
    // Prices supplied in chat get no volume tiers: the salesperson already chose the price.
    return { sku: null, name: c.name, billing: c.billing, unit: c.unit, listUnitMinor: c.unitPriceMinor, volumeTiered: false };
  }
  const item = pack.catalog.items.find((i) => i.sku === line.sku);
  if (!item) throw new Error(`SKU ${line.sku} passed checkQuote but is not in the catalog.`);
  return { sku: item.sku, name: item.name, billing: item.billing, unit: item.unit, listUnitMinor: item.listPriceMinor, volumeTiered: item.volumeTiered };
}

function tierBps(pack: Pack, quantity: number): number {
  let bps = 0;
  for (const tier of pack.pricing.volumeTiers) if (quantity >= tier.minQty) bps = tier.bps;
  return bps;
}

function extraApplies(appliesTo: "all" | "recurring" | "one-time", billing: Billing): boolean {
  return appliesTo === "all" || (appliesTo === "recurring" ? billing === "monthly" : billing === "one-time");
}

/** Prices a checked quote. Every number in a proposal comes from here (design X1). */
export function price(quote: Quote, pack: Pack, skillVersion: string): PricingOutput {
  const currency = pack.pricing.currency ?? quote.currency;
  if (!currency) throw new Error("price() needs a currency; checkQuote should have caught this.");
  const minorUnits = pack.pricing.minorUnits ?? currencyMinorUnits(currency);
  const locale = pack.brand.locale;
  const termBps = pack.pricing.termDiscounts.find((t) => t.months === quote.termMonths)?.bps ?? 0;
  const extra = quote.extraDiscount;

  let monthly = 0n;
  let oneTime = 0n;
  let listMonthly = 0n;
  let listOneTime = 0n;

  const lines: PricedLine[] = quote.lines.map((line) => {
    const item = resolveLine(line, pack);
    const base = BigInt(item.listUnitMinor) * BigInt(line.quantity);
    let running = base;
    const steps: DiscountStep[] = [];
    const apply = (kind: DiscountKind, bps: number): void => {
      if (bps <= 0) return;
      const amount = discountMinor(running, bps);
      running -= amount;
      steps.push({ kind, bps, amountMinor: toSafeNumber(amount, `${kind} discount on ${item.name}`) });
    };
    if (item.volumeTiered) apply("volume", tierBps(pack, line.quantity));
    if (item.billing === "monthly") apply("term", termBps);
    if (extra && extraApplies(extra.appliesTo, item.billing)) apply("extra", extra.bps);

    if (item.billing === "monthly") {
      monthly += running;
      listMonthly += base;
    } else {
      oneTime += running;
      listOneTime += base;
    }
    return {
      sku: item.sku,
      name: item.name,
      billing: item.billing,
      unit: item.unit,
      quantity: line.quantity,
      listUnitMinor: item.listUnitMinor,
      baseMinor: toSafeNumber(base, `list total for ${item.name}`),
      steps,
      netMinor: toSafeNumber(running, `net total for ${item.name}`),
    };
  });

  const term = BigInt(quote.termMonths);
  const termTotal = monthly * term + oneTime;
  const listTermTotal = listMonthly * term + listOneTime;
  const totals = {
    monthlyRecurringMinor: toSafeNumber(monthly, "monthly recurring total"),
    oneTimeMinor: toSafeNumber(oneTime, "one-time total"),
    termTotalMinor: toSafeNumber(termTotal, "term total"),
    listTermTotalMinor: toSafeNumber(listTermTotal, "list term total"),
    savingsMinor: toSafeNumber(listTermTotal - termTotal, "savings"),
  };

  const validUntil = addDays(quote.quoteDate, pack.pricing.validityDays);
  const money = (minor: number): string => formatMoney(minor, currency, minorUnits, locale);

  return {
    schemaVersion: 1,
    _rule: PRICING_RULE_TEXT,
    skillVersion,
    packId: pack.brand.packId,
    quote,
    currency,
    minorUnits,
    locale,
    priceSource: pack.catalog.items.length > 0 ? "catalog" : "as-supplied",
    termMonths: quote.termMonths,
    quoteDate: quote.quoteDate,
    validUntil,
    lines,
    totals,
    approval: approvalFor(quote, pack, locale),
    formatted: {
      monthlyRecurring: money(totals.monthlyRecurringMinor),
      oneTime: money(totals.oneTimeMinor),
      termTotal: money(totals.termTotalMinor),
      savings: money(totals.savingsMinor),
      termMonths: String(quote.termMonths),
      validUntil: formatDate(validUntil, locale),
      extraDiscountPct: formatBps(extra?.bps ?? 0, locale),
      currency,
    },
  };
}

/** Design X6: only the discretionary extra discount counts against the approval limit. */
function approvalFor(quote: Quote, pack: Pack, locale: string): Approval {
  const policy = pack.pricing.approval;
  const requestedBps = quote.extraDiscount?.bps ?? null;
  if (!policy) {
    return { needed: false, approver: null, reason: null, requestedBps, limitBps: null, policy: "none" };
  }
  const needed = requestedBps !== null && requestedBps > policy.maxExtraDiscountBps;
  return {
    needed,
    approver: policy.approver,
    reason: needed
      ? `Requested extra discount ${formatBps(requestedBps, locale)} exceeds the ${formatBps(policy.maxExtraDiscountBps, locale)} limit; needs ${policy.approver} approval.`
      : null,
    requestedBps,
    limitBps: policy.maxExtraDiscountBps,
    policy: "pack",
  };
}

/** "12, 24 or 36" */
function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
