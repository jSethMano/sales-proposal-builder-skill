// Compiled from src/skill/lib/money.cts. Edit the source, then run npm run build.
// Money is integer minor units (cents for USD, yen for JPY) until it's formatted for people.
// Discount math uses BigInt so no intermediate product can lose precision (design X7).

/** 1 basis point is 0.01%, so 10,000 basis points is 100%. */
export const BPS_PER_WHOLE = 10_000;
const BPS_PER_WHOLE_N = 10_000n;
const HALF_N = 5_000n;

/**
 * The discount on baseMinor at bps basis points, rounded half-up to a whole minor unit.
 * Ties round up, so they favor the client. baseMinor and bps are never negative here.
 */
export function discountMinor(baseMinor: bigint, bps: number): bigint {
  return (baseMinor * BigInt(bps) + HALF_N) / BPS_PER_WHOLE_N;
}

/** Converts back to a JSON-safe number, failing loudly rather than silently losing precision. */
export function toSafeNumber(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`${what} (${value}) is too large to represent exactly.`);
  }
  return Number(value);
}

/** Decimal string for minor units, e.g. 292410 with 2 minor units → "2924.10". */
export function minorToDecimalString(minor: number, minorUnits: number): string {
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(minorUnits + 1, "0");
  const whole = minorUnits === 0 ? digits : digits.slice(0, -minorUnits);
  const fraction = minorUnits === 0 ? "" : `.${digits.slice(-minorUnits)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/**
 * Formats minor units as currency for the locale. The value goes to Intl as a decimal string, so
 * there is no float rounding; on runtimes that only take numbers, the conversion is still exact
 * for any amount a proposal can hold.
 */
export function formatMoney(minor: number, currency: string, minorUnits: number, locale: string): string {
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  });
  // Intl accepts decimal strings (ES2023 Intl.NumberFormat v3); the ES2022 lib types only declare
  // numbers. `format` is a bound getter, so calling it detached is safe.
  const formatDecimal = format.format as unknown as (value: string) => string;
  return formatDecimal(minorToDecimalString(minor, minorUnits));
}

/** Formats basis points as a percentage, e.g. 1500 → "15%", 1501 → "15.01%". */
export function formatBps(bps: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(
    bps / BPS_PER_WHOLE,
  );
}

/** The number of minor units Intl uses for a currency: USD 2, JPY 0, BHD 3. */
export function currencyMinorUnits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function isCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf("currency").includes(code);
}
