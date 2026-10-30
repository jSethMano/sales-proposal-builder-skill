// Compiled from src/skill/lib/types.cts. Edit the source, then run npm run build.
// Shared types for company packs, quotes and pricing output (docs/design.md §4–5).
// Tests and the eval harness import these with `import type`, so this file holds types only.

/** One fixable problem, reported to Claude as JSON. */
export interface Problem {
  code: string;
  /** Where the problem is, e.g. "quote.json:lines[2].sku" or "case-studies.md:14". */
  path: string;
  message: string;
  hint?: string;
}

// ---------- company pack ----------

export type AllowedFont = "Arial" | "Times New Roman" | "Calibri" | "Cambria" | "Courier New" | "Georgia";

export interface Brand {
  schemaVersion: 1;
  packId: string;
  configured: boolean;
  source?: "packaged" | "chat";
  company: {
    displayName: string;
    legalName: string;
    website?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  colors: { primary: string; accent: string; text: string; muted: string };
  fonts: { heading: AllowedFont; body: AllowedFont };
  logo: string | null;
  locale: string;
  voice: string;
  footer: string;
  signatory: { name: string; title: string };
}

export type Billing = "monthly" | "one-time";
export type MonthlyUnit = "user/month" | "device/month" | "site/month" | "month";
export type OneTimeUnit = "user" | "device" | "site" | "project";
export type Unit = MonthlyUnit | OneTimeUnit;

export interface CatalogItem {
  sku: string;
  name: string;
  description: string;
  includes: string[];
  unit: Unit;
  billing: Billing;
  listPriceMinor: number;
  volumeTiered: boolean;
  sla?: string;
  requires?: string[];
}

export interface Catalog {
  schemaVersion: 1;
  items: CatalogItem[];
}

export interface PricingPolicy {
  schemaVersion: 1;
  currency: string | null;
  minorUnits: number | null;
  /** The only rule in v1: compound discounts in the order volume → term → extra. */
  combinationRule: "compound:volume>term>extra";
  volumeTiers: { minQty: number; bps: number }[];
  termDiscounts: { months: number; bps: number }[];
  approval: { maxExtraDiscountBps: number; approver: string } | null;
  validityDays: number;
  taxNote: string;
}

export interface CaseStudy {
  id: string;
  title: string;
  industry: string;
  summary: string;
  outcome: string;
}

export interface LogoInfo {
  file: string;
  type: "png" | "jpg";
  width: number;
  height: number;
  sha256: string;
}

export interface Pack {
  dir: string;
  brand: Brand;
  catalog: Catalog;
  pricing: PricingPolicy;
  caseStudies: CaseStudy[];
  terms: string;
  logo: LogoInfo | null;
}

// ---------- quote (written by Claude) ----------

export interface CatalogLine {
  sku: string;
  quantity: number;
}

export interface CustomLine {
  custom: { name: string; unit: string; billing: Billing; unitPriceMinor: number };
  quantity: number;
}

export type QuoteLine = CatalogLine | CustomLine;

export interface Quote {
  schemaVersion: 1;
  quoteDate: string;
  termMonths: number;
  currency?: string;
  lines: QuoteLine[];
  extraDiscount?: { bps: number; appliesTo: "all" | "recurring" | "one-time"; reason: string };
}

// ---------- pricing output (written by price.cjs) ----------

export type DiscountKind = "volume" | "term" | "extra";

export interface DiscountStep {
  kind: DiscountKind;
  bps: number;
  amountMinor: number;
}

export interface PricedLine {
  sku: string | null;
  name: string;
  billing: Billing;
  unit: string;
  quantity: number;
  listUnitMinor: number;
  baseMinor: number;
  steps: DiscountStep[];
  netMinor: number;
}

export interface Approval {
  needed: boolean;
  approver: string | null;
  reason: string | null;
  requestedBps: number | null;
  limitBps: number | null;
  policy: "pack" | "none";
}

export type PricingToken =
  | "monthlyRecurring"
  | "oneTime"
  | "termTotal"
  | "savings"
  | "termMonths"
  | "validUntil"
  | "extraDiscountPct"
  | "currency";

export interface PricingOutput {
  schemaVersion: 1;
  _rule: string;
  skillVersion: string;
  packId: string;
  quote: Quote;
  currency: string;
  minorUnits: number;
  locale: string;
  priceSource: "catalog" | "as-supplied";
  termMonths: number;
  quoteDate: string;
  validUntil: string;
  lines: PricedLine[];
  totals: {
    monthlyRecurringMinor: number;
    oneTimeMinor: number;
    termTotalMinor: number;
    listTermTotalMinor: number;
    savingsMinor: number;
  };
  approval: Approval;
  formatted: Record<PricingToken, string>;
}
