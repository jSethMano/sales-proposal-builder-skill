// Compiled from src/skill/lib/docx/context.cts. Edit the source, then run npm run build.
// What every part of the document builder needs: the checked proposal, its pricing, the pack and
// the theme, plus small text helpers. Text never contains a number the builder made up: figures
// come from pricing.formatted, and token values from pricing.json or the proposal (design X1).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Paragraph, TextRun, type IRunOptions, type ParagraphChild } from "docx";
import { formatBps, formatMoney } from "../money.cjs";
import type { Pack, PricingOutput, PricingToken, Proposal } from "../types.cjs";
import { type Theme, themeFor, SIZE } from "./theme.cjs";

export interface Logo {
  data: Buffer;
  type: "png" | "jpg";
  width: number;
  height: number;
}

export interface BuildContext {
  pack: Pack;
  proposal: Proposal;
  pricing: PricingOutput;
  theme: Theme;
  logo: Logo | null;
  draft: boolean;
  company: string;
  client: string;
  /** A new numbering instance for each numbered list, so every list starts at 1. */
  nextListInstance: () => number;
}

export function createContext(pack: Pack, proposal: Proposal, pricing: PricingOutput): BuildContext {
  let instance = 0;
  return {
    pack,
    proposal,
    pricing,
    theme: themeFor(pack.brand),
    logo: pack.logo
      ? { data: readFileSync(join(pack.dir, pack.logo.file)), type: pack.logo.type, width: pack.logo.width, height: pack.logo.height }
      : null,
    draft: pricing.approval.needed,
    company: pack.brand.company.displayName,
    client: proposal.client.name,
    nextListInstance: () => ++instance,
  };
}

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Replaces {{pricing.*}} and {{client.name}} with their values. Validation has already rejected unknown tokens. */
export function fillTokens(text: string, ctx: BuildContext): string {
  return text.replace(TOKEN, (whole, name: string) => {
    if (name === "client.name") return ctx.client;
    if (name.startsWith("pricing.")) return ctx.pricing.formatted[name.slice("pricing.".length) as PricingToken] ?? whole;
    return whole;
  });
}

/** Fills {client} and {company} in the brand's footer text. */
export function fillFooter(text: string, ctx: BuildContext): string {
  return text.replaceAll("{client}", ctx.client).replaceAll("{company}", ctx.company);
}

export function money(minor: number, ctx: BuildContext): string {
  return formatMoney(minor, ctx.pricing.currency, ctx.pricing.minorUnits, ctx.pricing.locale);
}

export function percent(bps: number, ctx: BuildContext): string {
  return formatBps(bps, ctx.pricing.locale);
}

export function run(text: string, options: Omit<IRunOptions, "text"> = {}): TextRun {
  return new TextRun({ text, ...options });
}

/** A body paragraph of plain runs. */
export function para(children: ParagraphChild[] | string, options: { muted?: BuildContext; small?: boolean; after?: number } = {}): Paragraph {
  const runs =
    typeof children === "string"
      ? [run(children, { ...(options.small ? { size: SIZE.small } : {}), ...(options.muted ? { color: options.muted.theme.colors.muted } : {}) })]
      : children;
  return new Paragraph({ children: runs, ...(options.after !== undefined ? { spacing: { after: options.after } } : {}) });
}
