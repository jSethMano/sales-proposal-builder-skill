"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createContext = createContext;
exports.fillTokens = fillTokens;
exports.fillFooter = fillFooter;
exports.money = money;
exports.percent = percent;
exports.run = run;
exports.para = para;
// Compiled from src/skill/lib/docx/context.cts. Edit the source, then run npm run build.
// What every part of the document builder needs: the checked proposal, its pricing, the pack and
// the theme, plus small text helpers. Text never contains a number the builder made up: figures
// come from pricing.formatted, and token values from pricing.json or the proposal (design X1).
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const docx_1 = require("docx");
const money_cjs_1 = require("../money.cjs");
const theme_cjs_1 = require("./theme.cjs");
function createContext(pack, proposal, pricing) {
    let instance = 0;
    return {
        pack,
        proposal,
        pricing,
        theme: (0, theme_cjs_1.themeFor)(pack.brand),
        logo: pack.logo
            ? { data: (0, node_fs_1.readFileSync)((0, node_path_1.join)(pack.dir, pack.logo.file)), type: pack.logo.type, width: pack.logo.width, height: pack.logo.height }
            : null,
        draft: pricing.approval.needed,
        company: pack.brand.company.displayName,
        client: proposal.client.name,
        nextListInstance: () => ++instance,
    };
}
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;
/** Replaces {{pricing.*}} and {{client.name}} with their values. Validation has already rejected unknown tokens. */
function fillTokens(text, ctx) {
    return text.replace(TOKEN, (whole, name) => {
        if (name === "client.name")
            return ctx.client;
        if (name.startsWith("pricing."))
            return ctx.pricing.formatted[name.slice("pricing.".length)] ?? whole;
        return whole;
    });
}
/** Fills {client} and {company} in the brand's footer text. */
function fillFooter(text, ctx) {
    return text.replaceAll("{client}", ctx.client).replaceAll("{company}", ctx.company);
}
function money(minor, ctx) {
    return (0, money_cjs_1.formatMoney)(minor, ctx.pricing.currency, ctx.pricing.minorUnits, ctx.pricing.locale);
}
function percent(bps, ctx) {
    return (0, money_cjs_1.formatBps)(bps, ctx.pricing.locale);
}
function run(text, options = {}) {
    return new docx_1.TextRun({ text, ...options });
}
/** A body paragraph of plain runs. */
function para(children, options = {}) {
    const runs = typeof children === "string"
        ? [run(children, { ...(options.small ? { size: theme_cjs_1.SIZE.small } : {}), ...(options.muted ? { color: options.muted.theme.colors.muted } : {}) })]
        : children;
    return new docx_1.Paragraph({ children: runs, ...(options.after !== undefined ? { spacing: { after: options.after } } : {}) });
}
