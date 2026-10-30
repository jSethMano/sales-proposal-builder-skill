"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TIMELINE_ROWS = exports.LENGTH_GUIDE = exports.PROSE_TOKENS = void 0;
exports.scanText = scanText;
exports.scanMarkdown = scanMarkdown;
exports.countWords = countWords;
// Compiled from src/skill/lib/rules.cts. Edit the source, then run npm run build.
// Content rules for everything Claude writes into proposal.json (design §8):
// - no placeholders left over from drafting;
// - no typed amounts: figures reach the document only through {{pricing.*}} tokens (design X1);
// - a warning on bare percentages, which are often invented statistics (FR-8);
// - length guidance per section.
const closest_cjs_1 = require("./closest.cjs");
const markdown_cjs_1 = require("./markdown.cjs");
const PRICING_TOKENS = [
    "monthlyRecurring", "oneTime", "termTotal", "savings", "termMonths", "validUntil", "extraDiscountPct", "currency",
];
/** Every token prose may use. The build replaces each with a value from pricing.json or the proposal. */
exports.PROSE_TOKENS = [...PRICING_TOKENS.map((t) => `pricing.${t}`), "client.name"];
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const PLACEHOLDERS = [
    /\[[^\]\n]{0,60}\](?!\()/g, // [CLIENT], [Contact name], [...]; a following "(" is a link, reported as markdown
    /\{[^{}\n]{0,60}\}/g, // {client}: single braces are template leftovers; tokens use double braces
    /\b(?:TBD|TBC|TODO|FIXME)\b/gi,
    /\bX{3,}\b/g,
    /\blorem ipsum\b/gi,
    /\b(?:INSERT|PLACEHOLDER)\b/g,
];
// Currency symbols, optionally prefixed by a country letter or two (US$, A$, NZ$).
const SYMBOL_AMOUNT = /(?:\b[A-Z]{1,2})?[$€£¥₹₱₩₦₪₫฿]\s?\d[\d,.]*/g;
// Only real ISO 4217 codes count, so "ISO 27001" and "Windows 11" don't match.
const CODES = Intl.supportedValuesOf("currency").join("|");
const CODE_BEFORE_AMOUNT = new RegExp(`\\b(?:${CODES})\\s?\\d[\\d,.]*`, "g");
const CODE_AFTER_AMOUNT = new RegExp(`\\d[\\d,.]*\\s?(?:${CODES})\\b`, "g");
const WORD_AFTER_AMOUNT = /\d[\d,.]*\s?(?:dollars?|euros?|cents?|pesos?|rupees?|yen)\b/gi;
const AMOUNTS = [SYMBOL_AMOUNT, CODE_BEFORE_AMOUNT, CODE_AFTER_AMOUNT, WORD_AFTER_AMOUNT];
const PERCENT = /\d+(?:[.,]\d+)?\s?(?:%|per ?cent\b)/gi;
/**
 * Word ranges per section. They keep a proposal to roughly 8–12 pages: long enough to show the
 * client was understood, short enough to be read. Outside the range is a warning, not an error.
 */
exports.LENGTH_GUIDE = {
    "sections.executiveSummary": { min: 80, max: 250 },
    "sections.understanding": { min: 60, max: 300 },
    "sections.solution": { min: 80, max: 400 },
    "sections.nextSteps": { min: 20, max: 150 },
    "sections.whyUs.intro": { min: 15, max: 120 },
    "sections.scope[].notes": { min: 5, max: 120 },
    "sections.timeline[].detail": { min: 3, max: 80 },
};
/** More rows than this and a timeline stops being a summary. */
exports.MAX_TIMELINE_ROWS = 12;
/** Placeholder, token, amount and percentage checks for one piece of text Claude wrote. */
function scanText(text, path, scan) {
    const where = `${scan.file}:${path}`;
    for (const match of text.matchAll(TOKEN)) {
        const name = match[1] ?? "";
        if (exports.PROSE_TOKENS.includes(name))
            continue;
        const guess = (0, closest_cjs_1.closest)(name, exports.PROSE_TOKENS);
        scan.errors.add("E_PLACEHOLDER", where, `Unknown token ${match[0]}.`, guess ? `Did you mean {{${guess}}}?` : `Allowed tokens: ${exports.PROSE_TOKENS.map((t) => `{{${t}}}`).join(", ")}.`);
    }
    // Tokens are allowed; blank them out so the remaining checks only see what Claude typed.
    const typed = text.replace(TOKEN, " ");
    for (const found of unique(PLACEHOLDERS, typed)) {
        scan.errors.add("E_PLACEHOLDER", where, `Found the placeholder '${found}'.`, "Replace it with the real value from the brief or the pack. If nobody has said what it is, ask the salesperson; never invent it.");
    }
    // A sentence-ending period or comma is punctuation, not part of the amount.
    for (const found of new Set(unique(AMOUNTS, typed).map((a) => a.trim().replace(/[.,]+$/, "")))) {
        scan.errors.add("E_RAW_AMOUNT", where, `Found the amount '${found}' in prose.`, "Use a token such as {{pricing.monthlyRecurring}} or {{pricing.termTotal}}. Prices only come from pricing.json.");
    }
    for (const found of unique([PERCENT], typed)) {
        scan.warnings.add("W_PERCENT", where, `Found '${found.trim()}'.`, "Keep a percentage only if the pack or the brief states it; don't estimate results. For the discount, use {{pricing.extraDiscountPct}}.");
    }
}
/** Checks a markdown field: supported syntax, the text rules, and the length guide. */
function scanMarkdown(text, path, guideKey, scan) {
    const parsed = (0, markdown_cjs_1.parseMarkdown)(text);
    for (const issue of parsed.issues) {
        scan.errors.add("E_MARKDOWN", `${scan.file}:${path}`, `Line ${issue.line}: ${issue.message}`, issue.hint);
    }
    scanText(text, path, scan);
    const guide = exports.LENGTH_GUIDE[guideKey];
    if (!guide)
        return;
    const words = countWords((0, markdown_cjs_1.plainText)(parsed.blocks).replace(TOKEN, "amount"));
    if (words < guide.min || words > guide.max) {
        scan.warnings.add("W_LENGTH", `${scan.file}:${path}`, `${words} words; the guide for this section is ${guide.min}–${guide.max}.`, words < guide.min ? "Say more about this client specifically." : "Cut it down; the client should be able to read it in a minute or two.");
    }
}
function countWords(text) {
    return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
function unique(patterns, text) {
    const found = new Set();
    for (const pattern of patterns)
        for (const m of text.matchAll(pattern))
            found.add(m[0]);
    return [...found];
}
