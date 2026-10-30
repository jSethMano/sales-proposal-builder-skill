// Compiled from src/skill/lib/pack.cts. Edit the source, then run npm run build.
// Loads and checks a company pack (design §4): brand.json, catalog.json, pricing.json,
// case-studies.md, terms.md and an optional logo. Every script loads its pack through here, so a
// malformed pack fails before any work is done, with every problem listed at once.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseCaseStudies } from "./case-studies.cjs";
import { at, Checker, type Fields } from "./check.cjs";
import { Problems, ScriptError, sha256 } from "./cli.cjs";
import { readImageHeader } from "./image.cjs";
import { currencyMinorUnits, isCurrencyCode } from "./money.cjs";
import type {
  AllowedFont,
  Billing,
  Brand,
  Catalog,
  CatalogItem,
  LogoInfo,
  Pack,
  PricingPolicy,
  Problem,
  Unit,
} from "./types.cjs";

/**
 * Fonts that ship with Word and have a metric-compatible substitute in LibreOffice (Liberation,
 * Carlito, Caladea), so a layout checked in one holds in the other.
 * Georgia is provisional: it stays only if M0 finds Gelasio in the sandbox (docs/runtime.md).
 */
export const ALLOWED_FONTS: readonly AllowedFont[] = ["Arial", "Times New Roman", "Calibri", "Cambria", "Courier New", "Georgia"];

export const NEUTRAL_PACK_ID = "neutral";
/** Values in the neutral pack that must never reach a configured pack's documents. */
export const NEUTRAL_PLACEHOLDERS: readonly string[] = ["Your Company", "Your Name", "Your Title"];
export const COMBINATION_RULE: PricingPolicy["combinationRule"] = "compound:volume>term>extra";

const MONTHLY_UNITS: readonly Unit[] = ["user/month", "device/month", "site/month", "month"];
const ONE_TIME_UNITS: readonly Unit[] = ["user", "device", "site", "project"];
const BILLINGS: readonly Billing[] = ["monthly", "one-time"];

const HEX = /^#[0-9A-Fa-f]{6}$/;
const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
const LOGO_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FOOTER_TOKENS = new Set(["{client}", "{company}"]);

// 1e9 minor units is 10,000,000.00 in a two-decimal currency: far above any unit price an IT
// services catalog lists, while keeping every total well inside exact JSON numbers.
export const MAX_PRICE_MINOR = 1_000_000_000;
// 9,999 bps is 99.99%. A limit of 100% or more means "no limit"; packs say that with approval: null.
export const MAX_DISCOUNT_BPS = 9_999;
// Five years. Longer managed-services terms are rare and are renegotiated, not quoted.
export const MAX_TERM_MONTHS = 60;
// Quantities above a million seats or devices are typos, not deals.
export const MAX_QUANTITY = 1_000_000;
// A quote valid for more than a year would outlive the price list it came from.
const MAX_VALIDITY_DAYS = 365;

/** The pack shipped inside the skill: <skill>/company, relative to a script in <skill>/scripts. */
export function defaultPackDir(scriptDir: string): string {
  return resolve(scriptDir, "..", "company");
}

export function loadPack(dir: string): Pack {
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new ScriptError([
      {
        code: "E_PACK_MISSING",
        path: abs,
        message: `Pack folder ${abs} does not exist.`,
        hint: "Pass --pack <dir> for a folder holding brand.json, catalog.json, pricing.json, case-studies.md and terms.md.",
      },
    ]);
  }
  const problems = new Problems();

  const brandRaw = readPackJson(abs, "brand.json", problems);
  const catalogRaw = readPackJson(abs, "catalog.json", problems);
  const pricingRaw = readPackJson(abs, "pricing.json", problems);
  const brand = brandRaw === undefined ? undefined : checkBrand(brandRaw, problems);
  const catalog = catalogRaw === undefined ? undefined : checkCatalog(catalogRaw, problems);
  const pricing = pricingRaw === undefined ? undefined : checkPricing(pricingRaw, problems);

  const caseStudiesText = readPackText(abs, "case-studies.md", problems);
  const caseStudies = caseStudiesText === undefined ? [] : parseCaseStudies(caseStudiesText, problems);
  const terms = readPackText(abs, "terms.md", problems);
  if (terms !== undefined && terms.trim() === "") {
    problems.add("E_PACK_TERMS", "terms.md", "terms.md is empty.", "Add the company's standard terms; they are rendered verbatim.");
  }
  const logo = brand?.logo ? checkLogo(abs, brand, problems) : null;

  if (brand) checkBrandState(brand, problems);
  if (catalog && pricing && catalog.items.length > 0 && pricing.currency === null) {
    problems.add(
      "E_PACK_PRICING",
      "pricing.json:currency",
      "The catalog has prices but pricing.json has no currency.",
      "Set currency to the ISO code the catalog prices are in, e.g. \"USD\".",
    );
  }

  problems.throwIfAny();
  // throwIfAny guarantees every part loaded; the checks above returned undefined only on a problem.
  return {
    dir: abs,
    brand: brand as Brand,
    catalog: catalog as Catalog,
    pricing: pricing as PricingPolicy,
    caseStudies,
    terms: terms ?? "",
    logo: logo ?? null,
  };
}

/** Advice for Claude that isn't an error, e.g. that this is the neutral pack. */
export function packWarnings(pack: Pack): Problem[] {
  if (pack.brand.configured) return [];
  return [
    {
      code: "W_UNCONFIGURED",
      path: join(pack.dir, "brand.json"),
      message: "This is the neutral pack: no company brand, catalog or pricing policy.",
      hint: "Ask for the company name, primary color, logo, currency and signatory, then run init-pack.cjs and pass --pack to every script.",
    },
  ];
}

function readPackText(dir: string, file: string, problems: Problems): string | undefined {
  const full = join(dir, file);
  if (!existsSync(full)) {
    problems.add("E_PACK_MISSING_FILE", file, `The pack has no ${file}.`, "A pack needs brand.json, catalog.json, pricing.json, case-studies.md and terms.md.");
    return undefined;
  }
  return readFileSync(full, "utf8");
}

function readPackJson(dir: string, file: string, problems: Problems): unknown {
  const text = readPackText(dir, file, problems);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch (e) {
    problems.add("E_PACK_JSON", file, `${file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, "Fix the JSON syntax.");
    return undefined;
  }
}

function checkBrand(raw: unknown, problems: Problems): Brand | undefined {
  const before = problems.size;
  const c = new Checker(problems, "E_PACK_SCHEMA", "brand.json");
  const b = c.object(raw, "", [
    "schemaVersion", "packId", "configured", "source", "company", "colors", "fonts", "logo", "locale", "voice", "footer", "signatory",
  ]);
  if (!b) return undefined;

  c.literal(b.schemaVersion, "schemaVersion", 1);
  c.string(b.packId, "packId", { pattern: PACK_ID, patternHint: "Use lowercase letters, numbers and hyphens, e.g. 'example-it'." });
  c.bool(b.configured, "configured");
  if (b.source !== undefined) c.oneOf(b.source, "source", ["packaged", "chat"] as const);

  const company = c.object(b.company, "company", ["displayName", "legalName", "website", "email", "phone", "address"]);
  if (company) {
    c.string(company.displayName, "company.displayName");
    c.string(company.legalName, "company.legalName");
    for (const key of ["website", "email", "phone", "address"]) c.optionalString(company[key], at("company", key));
  }

  const colors = c.object(b.colors, "colors", ["primary", "accent", "text", "muted"]);
  if (colors) {
    for (const key of ["primary", "accent", "text", "muted"]) {
      c.string(colors[key], at("colors", key), { pattern: HEX, patternHint: "Use a 6-digit hex color like \"#1A2B3C\"." });
    }
  }

  const fonts = c.object(b.fonts, "fonts", ["heading", "body"]);
  if (fonts) {
    for (const key of ["heading", "body"]) {
      const font = c.string(fonts[key], at("fonts", key));
      if (font !== undefined && !(ALLOWED_FONTS as readonly string[]).includes(font)) {
        c.fail(
          at("fonts", key),
          `Font '${font}' is not on the allowlist.`,
          `Use one of: ${ALLOWED_FONTS.join(", ")}. They ship with Word and have same-size substitutes in LibreOffice, so the layout holds everywhere.`,
          "E_PACK_FONT",
        );
      }
    }
  }

  if (b.logo !== null) {
    c.string(b.logo, "logo", { pattern: LOGO_FILE, patternHint: "Use a file name inside the pack folder, e.g. \"logo.png\", or null." });
  }
  const locale = c.string(b.locale, "locale");
  if (locale !== undefined && !isSupportedLocale(locale)) {
    c.fail("locale", `'${locale}' is not a locale this runtime can format.`, "Use a BCP 47 tag such as \"en-US\", \"en-AU\" or \"en-GB\".");
  }
  c.string(b.voice, "voice");
  const footer = c.string(b.footer, "footer");
  if (footer !== undefined) {
    for (const token of footer.match(/\{[^}]*\}/g) ?? []) {
      if (!FOOTER_TOKENS.has(token)) c.fail("footer", `Unknown token ${token} in footer.`, "The footer may use {client} and {company} only.");
    }
  }
  const signatory = c.object(b.signatory, "signatory", ["name", "title"]);
  if (signatory) {
    c.string(signatory.name, "signatory.name");
    c.string(signatory.title, "signatory.title");
  }
  return problems.size === before ? (b as unknown as Brand) : undefined;
}

/** Rules that need the whole brand: a configured pack must not still look like the neutral one. */
function checkBrandState(brand: Brand, problems: Problems): void {
  if (!brand.configured) return;
  if (brand.packId === NEUTRAL_PACK_ID) {
    problems.add("E_PACK_SCHEMA", "brand.json:packId", "A configured pack can't use the packId 'neutral'.", "Give the pack its own id, e.g. 'example-it'.");
  }
  const values: [string, string][] = [
    ["company.displayName", brand.company.displayName],
    ["company.legalName", brand.company.legalName],
    ["signatory.name", brand.signatory.name],
    ["signatory.title", brand.signatory.title],
  ];
  for (const [path, value] of values) {
    if (NEUTRAL_PLACEHOLDERS.includes(value)) {
      problems.add("E_PACK_SCHEMA", `brand.json:${path}`, `'${value}' is the neutral pack's placeholder.`, "Replace it with the company's real value.");
    }
  }
}

function checkCatalog(raw: unknown, problems: Problems): Catalog | undefined {
  const before = problems.size;
  const c = new Checker(problems, "E_PACK_SCHEMA", "catalog.json");
  const root = c.object(raw, "", ["schemaVersion", "items"]);
  if (!root) return undefined;
  c.literal(root.schemaVersion, "schemaVersion", 1);
  const items = c.array(root.items, "items");
  const seen = new Set<string>();
  items?.forEach((rawItem, i) => {
    const path = at("items", i);
    const item = c.object(rawItem, path, [
      "sku", "name", "description", "includes", "unit", "billing", "listPriceMinor", "volumeTiered", "sla", "requires",
    ]);
    if (!item) return;
    const sku = c.string(item.sku, at(path, "sku"), {
      pattern: SKU_PATTERN,
      patternHint: "Use 2–32 capital letters, digits and hyphens, e.g. \"MS-SUPPORT\".",
    });
    if (sku !== undefined) {
      if (seen.has(sku)) c.fail(at(path, "sku"), `Duplicate SKU ${sku}.`, "Each catalog item needs its own SKU.", "E_PACK_CATALOG");
      seen.add(sku);
    }
    c.string(item.name, at(path, "name"));
    c.string(item.description, at(path, "description"));
    c.stringList(item.includes, at(path, "includes"), 1);
    const unit = c.oneOf(item.unit, at(path, "unit"), [...MONTHLY_UNITS, ...ONE_TIME_UNITS]);
    const billing = c.oneOf(item.billing, at(path, "billing"), BILLINGS);
    if (unit !== undefined && billing !== undefined) checkUnitBilling(c, path, unit, billing);
    c.int(item.listPriceMinor, at(path, "listPriceMinor"), 1, MAX_PRICE_MINOR);
    c.bool(item.volumeTiered, at(path, "volumeTiered"));
    c.optionalString(item.sla, at(path, "sla"));
    if (item.requires !== undefined) c.stringList(item.requires, at(path, "requires"));
  });
  return problems.size === before ? (root as unknown as Catalog) : undefined;
}

function checkUnitBilling(c: Checker, path: string, unit: Unit, billing: Billing): void {
  const monthlyUnit = MONTHLY_UNITS.includes(unit);
  if (monthlyUnit !== (billing === "monthly")) {
    c.fail(
      at(path, "unit"),
      `Unit '${unit}' doesn't match billing '${billing}'.`,
      `Monthly items use ${MONTHLY_UNITS.join(", ")}; one-time items use ${ONE_TIME_UNITS.join(", ")}.`,
      "E_PACK_CATALOG",
    );
  }
}

function checkPricing(raw: unknown, problems: Problems): PricingPolicy | undefined {
  const before = problems.size;
  const c = new Checker(problems, "E_PACK_SCHEMA", "pricing.json");
  const p = c.object(raw, "", [
    "schemaVersion", "currency", "minorUnits", "combinationRule", "volumeTiers", "termDiscounts", "approval", "validityDays", "taxNote",
  ]);
  if (!p) return undefined;
  c.literal(p.schemaVersion, "schemaVersion", 1);

  if (p.currency === null) {
    if (p.minorUnits !== null) c.fail("minorUnits", "minorUnits must be null when currency is null.", undefined, "E_PACK_PRICING");
  } else {
    const currency = c.string(p.currency, "currency");
    if (currency !== undefined && !isCurrencyCode(currency)) {
      c.fail("currency", `'${currency}' is not an ISO 4217 currency code.`, "Use a code like \"USD\", \"AUD\" or \"EUR\".", "E_PACK_PRICING");
    } else if (currency !== undefined) {
      const units = c.int(p.minorUnits, "minorUnits", 0, 3);
      const expected = currencyMinorUnits(currency);
      if (units !== undefined && units !== expected) {
        c.fail("minorUnits", `${currency} uses ${expected} minor units, not ${units}.`, `Set minorUnits to ${expected}.`, "E_PACK_PRICING");
      }
    }
  }
  c.literal(p.combinationRule, "combinationRule", COMBINATION_RULE);
  checkTiers(c, p);
  checkTerms(c, p);
  if (p.approval !== null) {
    const approval = c.object(p.approval, "approval", ["maxExtraDiscountBps", "approver"]);
    if (approval) {
      c.int(approval.maxExtraDiscountBps, "approval.maxExtraDiscountBps", 0, MAX_DISCOUNT_BPS);
      c.string(approval.approver, "approval.approver");
    }
  }
  c.int(p.validityDays, "validityDays", 1, MAX_VALIDITY_DAYS);
  c.string(p.taxNote, "taxNote");
  return problems.size === before ? (p as unknown as PricingPolicy) : undefined;
}

function checkTiers(c: Checker, p: Fields): void {
  const tiers = c.array(p.volumeTiers, "volumeTiers", 1);
  if (!tiers) return;
  let previous: { minQty: number; bps: number } | null = null;
  tiers.forEach((rawTier, i) => {
    const path = at("volumeTiers", i);
    const tier = c.object(rawTier, path, ["minQty", "bps"]);
    if (!tier) return;
    const minQty = c.int(tier.minQty, at(path, "minQty"), 1, MAX_QUANTITY);
    const bps = c.int(tier.bps, at(path, "bps"), 0, MAX_DISCOUNT_BPS);
    if (minQty === undefined || bps === undefined) return;
    if (i === 0 && minQty !== 1) {
      c.fail(at(path, "minQty"), "The first tier must start at minQty 1.", "Every quantity needs a tier; use bps 0 for no discount.", "E_PACK_PRICING");
    }
    if (previous && minQty <= previous.minQty) {
      c.fail(at(path, "minQty"), "Tiers must be in ascending minQty order.", undefined, "E_PACK_PRICING");
    }
    if (previous && bps < previous.bps) {
      c.fail(at(path, "bps"), "A larger tier has a smaller discount than the one before it.", "Volume discounts should not decrease as quantity grows.", "E_PACK_PRICING");
    }
    previous = { minQty, bps };
  });
}

function checkTerms(c: Checker, p: Fields): void {
  const terms = c.array(p.termDiscounts, "termDiscounts");
  if (!terms) return;
  const seen = new Set<number>();
  terms.forEach((rawTerm, i) => {
    const path = at("termDiscounts", i);
    const term = c.object(rawTerm, path, ["months", "bps"]);
    if (!term) return;
    const months = c.int(term.months, at(path, "months"), 1, MAX_TERM_MONTHS);
    c.int(term.bps, at(path, "bps"), 0, MAX_DISCOUNT_BPS);
    if (months !== undefined) {
      if (seen.has(months)) c.fail(at(path, "months"), `Term ${months} is listed twice.`, undefined, "E_PACK_PRICING");
      seen.add(months);
    }
  });
}

function checkLogo(dir: string, brand: Brand, problems: Problems): LogoInfo | null {
  const name = brand.logo as string;
  const full = join(dir, name);
  if (!existsSync(full)) {
    problems.add("E_PACK_LOGO", `brand.json:logo`, `Logo file ${name} is not in the pack.`, "Put the logo in the pack folder, or set logo to null.");
    return null;
  }
  const data = readFileSync(full);
  const header = readImageHeader(data);
  const chat = brand.source === "chat";
  if (header.kind === "jpg" && !chat) {
    problems.add("E_PACK_LOGO", name, "Packaged packs need a PNG logo.", "Convert the logo to PNG.");
    return null;
  }
  if (header.kind !== "png" && header.kind !== "jpg") {
    const what = header.kind === "unknown" ? "not a recognised image" : `a ${header.kind.toUpperCase()} file`;
    problems.add("E_PACK_LOGO", name, `The logo is ${what}.`, chat ? "Convert the logo to PNG or JPEG." : "Convert the logo to PNG.");
    return null;
  }
  if (!header.width || !header.height) {
    problems.add("E_PACK_LOGO", name, "Can't read the logo's pixel size.", "Re-export the logo as a standard PNG.");
    return null;
  }
  return { file: name, type: header.kind, width: header.width, height: header.height, sha256: sha256(data) };
}

function isSupportedLocale(locale: string): boolean {
  try {
    return Intl.getCanonicalLocales(locale).length === 1 && Intl.NumberFormat.supportedLocalesOf(locale).length === 1;
  } catch {
    return false;
  }
}
