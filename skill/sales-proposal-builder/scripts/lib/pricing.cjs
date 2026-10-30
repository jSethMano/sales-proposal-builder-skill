"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRICING_RULE_TEXT = void 0;
exports.checkQuote = checkQuote;
exports.price = price;
// Compiled from src/skill/lib/pricing.cts. Edit the source, then run npm run build.
// The pricing engine (design §5). price() is a pure function of (quote, pack, version): no clock,
// no network, no randomness, so the same inputs always give byte-identical output (design X8).
const check_cjs_1 = require("./check.cjs");
const cli_cjs_1 = require("./cli.cjs");
const closest_cjs_1 = require("./closest.cjs");
const money_cjs_1 = require("./money.cjs");
const pack_cjs_1 = require("./pack.cjs");
/** Written into every pricing.json so the rule travels with the numbers. */
exports.PRICING_RULE_TEXT = "Discounts compound in the order volume → term → extra, and each discount is rounded half-up to a whole minor unit. " +
    "Volume tiers apply to catalog items marked volumeTiered, term discounts to monthly items, and the extra discount " +
    "to the billing types in appliesTo. Approval is needed when the extra discount is above the pack's limit; " +
    "volume and term discounts are pack policy and never need approval.";
const APPLIES_TO = ["all", "recurring", "one-time"];
const BILLINGS = ["monthly", "one-time"];
/** Checks a quote against the pack and returns it in canonical form, or throws with every problem. */
function checkQuote(raw, pack, file = "quote.json") {
    const problems = new cli_cjs_1.Problems();
    const c = new check_cjs_1.Checker(problems, "E_QUOTE_SCHEMA", file);
    const q = c.object(raw, "", ["schemaVersion", "quoteDate", "termMonths", "currency", "lines", "extraDiscount"]);
    if (!q)
        problems.throwNow();
    c.literal(q.schemaVersion, "schemaVersion", 1);
    const quoteDate = c.string(q.quoteDate, "quoteDate");
    if (quoteDate !== undefined && !(0, check_cjs_1.isIsoDate)(quoteDate)) {
        c.fail("quoteDate", `'${quoteDate}' is not a real date in YYYY-MM-DD form.`, "Use the proposal's date, e.g. \"2027-01-15\".", "E_DATE");
    }
    const termMonths = c.int(q.termMonths, "termMonths", 1, pack_cjs_1.MAX_TERM_MONTHS);
    const offered = pack.pricing.termDiscounts.map((t) => t.months).sort((a, b) => a - b);
    if (termMonths !== undefined && offered.length > 0 && !offered.includes(termMonths)) {
        c.fail("termMonths", `Term ${termMonths} months is not offered.`, `Choose ${listWords(offered.map(String))} months.`, "E_TERM");
    }
    const currency = checkCurrency(c, q.currency, pack);
    const lines = checkLines(c, q.lines, pack);
    const extraDiscount = checkExtraDiscount(c, q.extraDiscount);
    problems.throwIfAny();
    const quote = {
        schemaVersion: 1,
        quoteDate: quoteDate,
        termMonths: termMonths,
        ...(currency !== undefined ? { currency } : {}),
        lines,
        ...(extraDiscount ? { extraDiscount } : {}),
    };
    return { quote, warnings: quoteWarnings(quote, pack) };
}
function checkCurrency(c, value, pack) {
    const packCurrency = pack.pricing.currency;
    if (packCurrency === null) {
        if (value === undefined) {
            c.fail("currency", "The pack has no currency, so the quote must set one.", "Ask which currency to quote in and set currency, e.g. \"USD\".", "E_CURRENCY");
            return undefined;
        }
        const code = c.string(value, "currency");
        if (code !== undefined && !(0, money_cjs_1.isCurrencyCode)(code)) {
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
function checkLines(c, value, pack) {
    const list = c.array(value, "lines", 1);
    if (!list)
        return [];
    const skus = pack.catalog.items.map((i) => i.sku);
    const hasCatalog = skus.length > 0;
    const seen = new Set();
    const out = [];
    list.forEach((rawLine, i) => {
        const path = (0, check_cjs_1.at)("lines", i);
        const line = c.object(rawLine, path, ["sku", "quantity", "custom"]);
        if (!line)
            return;
        const quantity = checkQuantity(c, line.quantity, (0, check_cjs_1.at)(path, "quantity"));
        if (line.sku !== undefined && line.custom !== undefined) {
            c.fail(path, "A line has either sku or custom, not both.");
            return;
        }
        if (line.sku !== undefined) {
            const sku = c.string(line.sku, (0, check_cjs_1.at)(path, "sku"));
            if (sku === undefined)
                return;
            if (!skus.includes(sku)) {
                const guess = (0, closest_cjs_1.closest)(sku, skus);
                c.fail((0, check_cjs_1.at)(path, "sku"), hasCatalog ? `SKU '${sku}' not in catalog.` : `SKU '${sku}' not in catalog: this pack has no catalog.`, hasCatalog
                    ? `${guess ? `Closest: ${guess}. ` : `Catalog SKUs: ${skus.join(", ")}. `}If the client wants something the catalog doesn't sell, list it in notIncluded instead of pricing it.`
                    : "Use a custom line with the price the salesperson gives you.", "E_SKU_UNKNOWN");
                return;
            }
            if (seen.has(sku)) {
                c.fail((0, check_cjs_1.at)(path, "sku"), `SKU ${sku} appears on more than one line.`, "Combine them into one line with the total quantity.", "E_DUPLICATE_LINE");
                return;
            }
            seen.add(sku);
            if (quantity !== undefined)
                out.push({ sku, quantity });
            return;
        }
        if (line.custom !== undefined) {
            if (hasCatalog) {
                c.fail((0, check_cjs_1.at)(path, "custom"), "Custom lines are not allowed: this pack has a catalog.", "Sell only catalog SKUs. Put out-of-catalog requests in the proposal's notIncluded list, unpriced.", "E_CUSTOM_LINE");
                return;
            }
            const custom = c.object(line.custom, (0, check_cjs_1.at)(path, "custom"), ["name", "unit", "billing", "unitPriceMinor"]);
            if (!custom)
                return;
            const name = c.string(custom.name, (0, check_cjs_1.at)(path, "custom.name"));
            const unit = c.string(custom.unit, (0, check_cjs_1.at)(path, "custom.unit"));
            const billing = c.oneOf(custom.billing, (0, check_cjs_1.at)(path, "custom.billing"), BILLINGS);
            const unitPriceMinor = c.int(custom.unitPriceMinor, (0, check_cjs_1.at)(path, "custom.unitPriceMinor"), 1, pack_cjs_1.MAX_PRICE_MINOR);
            if ([name, unit, billing, unitPriceMinor, quantity].includes(undefined))
                return;
            out.push({
                custom: { name: name, unit: unit, billing: billing, unitPriceMinor: unitPriceMinor },
                quantity: quantity,
            });
            return;
        }
        c.fail(path, "The line has no sku.", hasCatalog ? "Add a catalog sku." : "Add a custom item with the salesperson's price.");
    });
    return out;
}
function checkQuantity(c, value, path) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= pack_cjs_1.MAX_QUANTITY)
        return value;
    c.fail(path, value === undefined ? "Missing quantity." : `Quantity must be a whole number from 1 to ${pack_cjs_1.MAX_QUANTITY.toLocaleString("en-US")}.`, "Use the seat, device or site count from the brief. Ask if it isn't there; don't estimate.", "E_QUANTITY");
    return undefined;
}
function checkExtraDiscount(c, value) {
    if (value === undefined)
        return undefined;
    const d = c.object(value, "extraDiscount", ["bps", "appliesTo", "reason"]);
    if (!d)
        return undefined;
    let bps;
    if (typeof d.bps === "number" && Number.isInteger(d.bps) && d.bps >= 1 && d.bps <= pack_cjs_1.MAX_DISCOUNT_BPS) {
        bps = d.bps;
    }
    else {
        c.fail("extraDiscount.bps", `Extra discount must be a whole number of basis points from 1 to ${pack_cjs_1.MAX_DISCOUNT_BPS}.`, "1 basis point is 0.01%, so 12.5% is 1250. Leave extraDiscount out when there is none.", "E_DISCOUNT");
    }
    const appliesTo = c.oneOf(d.appliesTo, "extraDiscount.appliesTo", APPLIES_TO);
    const reason = c.string(d.reason, "extraDiscount.reason");
    if (bps === undefined || appliesTo === undefined || reason === undefined)
        return undefined;
    return { bps, appliesTo, reason };
}
function quoteWarnings(quote, pack) {
    const warnings = [];
    const d = quote.extraDiscount;
    if (d && d.appliesTo !== "all") {
        const target = d.appliesTo === "recurring" ? "monthly" : "one-time";
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
function resolveLine(line, pack) {
    if ("custom" in line) {
        const c = line.custom;
        // Prices supplied in chat get no volume tiers: the salesperson already chose the price.
        return { sku: null, name: c.name, billing: c.billing, unit: c.unit, listUnitMinor: c.unitPriceMinor, volumeTiered: false };
    }
    const item = pack.catalog.items.find((i) => i.sku === line.sku);
    if (!item)
        throw new Error(`SKU ${line.sku} passed checkQuote but is not in the catalog.`);
    return { sku: item.sku, name: item.name, billing: item.billing, unit: item.unit, listUnitMinor: item.listPriceMinor, volumeTiered: item.volumeTiered };
}
function tierBps(pack, quantity) {
    let bps = 0;
    for (const tier of pack.pricing.volumeTiers)
        if (quantity >= tier.minQty)
            bps = tier.bps;
    return bps;
}
function extraApplies(appliesTo, billing) {
    return appliesTo === "all" || (appliesTo === "recurring" ? billing === "monthly" : billing === "one-time");
}
/** Prices a checked quote. Every number in a proposal comes from here (design X1). */
function price(quote, pack, skillVersion) {
    const currency = pack.pricing.currency ?? quote.currency;
    if (!currency)
        throw new Error("price() needs a currency; checkQuote should have caught this.");
    const minorUnits = pack.pricing.minorUnits ?? (0, money_cjs_1.currencyMinorUnits)(currency);
    const locale = pack.brand.locale;
    const termBps = pack.pricing.termDiscounts.find((t) => t.months === quote.termMonths)?.bps ?? 0;
    const extra = quote.extraDiscount;
    let monthly = 0n;
    let oneTime = 0n;
    let listMonthly = 0n;
    let listOneTime = 0n;
    const lines = quote.lines.map((line) => {
        const item = resolveLine(line, pack);
        const base = BigInt(item.listUnitMinor) * BigInt(line.quantity);
        let running = base;
        const steps = [];
        const apply = (kind, bps) => {
            if (bps <= 0)
                return;
            const amount = (0, money_cjs_1.discountMinor)(running, bps);
            running -= amount;
            steps.push({ kind, bps, amountMinor: (0, money_cjs_1.toSafeNumber)(amount, `${kind} discount on ${item.name}`) });
        };
        if (item.volumeTiered)
            apply("volume", tierBps(pack, line.quantity));
        if (item.billing === "monthly")
            apply("term", termBps);
        if (extra && extraApplies(extra.appliesTo, item.billing))
            apply("extra", extra.bps);
        if (item.billing === "monthly") {
            monthly += running;
            listMonthly += base;
        }
        else {
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
            baseMinor: (0, money_cjs_1.toSafeNumber)(base, `list total for ${item.name}`),
            steps,
            netMinor: (0, money_cjs_1.toSafeNumber)(running, `net total for ${item.name}`),
        };
    });
    const term = BigInt(quote.termMonths);
    const termTotal = monthly * term + oneTime;
    const listTermTotal = listMonthly * term + listOneTime;
    const totals = {
        monthlyRecurringMinor: (0, money_cjs_1.toSafeNumber)(monthly, "monthly recurring total"),
        oneTimeMinor: (0, money_cjs_1.toSafeNumber)(oneTime, "one-time total"),
        termTotalMinor: (0, money_cjs_1.toSafeNumber)(termTotal, "term total"),
        listTermTotalMinor: (0, money_cjs_1.toSafeNumber)(listTermTotal, "list term total"),
        savingsMinor: (0, money_cjs_1.toSafeNumber)(listTermTotal - termTotal, "savings"),
    };
    const validUntil = (0, check_cjs_1.addDays)(quote.quoteDate, pack.pricing.validityDays);
    const money = (minor) => (0, money_cjs_1.formatMoney)(minor, currency, minorUnits, locale);
    return {
        schemaVersion: 1,
        _rule: exports.PRICING_RULE_TEXT,
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
            validUntil: (0, check_cjs_1.formatDate)(validUntil, locale),
            extraDiscountPct: (0, money_cjs_1.formatBps)(extra?.bps ?? 0, locale),
            currency,
        },
    };
}
/** Design X6: only the discretionary extra discount counts against the approval limit. */
function approvalFor(quote, pack, locale) {
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
            ? `Requested extra discount ${(0, money_cjs_1.formatBps)(requestedBps, locale)} exceeds the ${(0, money_cjs_1.formatBps)(policy.maxExtraDiscountBps, locale)} limit; needs ${policy.approver} approval.`
            : null,
        requestedBps,
        limitBps: policy.maxExtraDiscountBps,
        policy: "pack",
    };
}
/** "12, 24 or 36" */
function listWords(items) {
    if (items.length <= 1)
        return items.join("");
    return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
