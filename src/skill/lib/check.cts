// Compiled from src/skill/lib/check.cts. Edit the source, then run npm run build.
// Structural checks for JSON files. Each check records a Problem and returns undefined instead of
// throwing, so one run reports every problem in a file.
import { closest } from "./closest.cjs";
import type { Problems } from "./cli.cjs";

export type Fields = Record<string, unknown>;

export function at(base: string, key: string | number): string {
  if (typeof key === "number") return `${base}[${key}]`;
  return base === "" ? key : `${base}.${key}`;
}

export class Checker {
  readonly problems: Problems;
  /** Problem code used for structural errors, e.g. E_PACK_SCHEMA or E_QUOTE_SCHEMA. */
  readonly code: string;
  /** File name shown in each problem's path, e.g. "brand.json". */
  readonly file: string;

  constructor(problems: Problems, code: string, file: string) {
    this.problems = problems;
    this.code = code;
    this.file = file;
  }

  fail(path: string, message: string, hint?: string, code: string = this.code): undefined {
    this.problems.add(code, `${this.file}:${path || "(root)"}`, message, hint);
    return undefined;
  }

  /**
   * A plain object. Fields not in `allowed` fail (they are usually typos), except names starting
   * with "_", which are comments. Returns the object even when a field fails, so the caller can
   * still check the remaining fields; each field check reports its own missing value.
   */
  object(value: unknown, path: string, allowed: readonly string[]): Fields | undefined {
    if (value === undefined) return this.missing(path);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return this.fail(path, `Expected an object, got ${describe(value)}.`);
    }
    const fields = value as Fields;
    for (const key of Object.keys(fields)) {
      if (key.startsWith("_") || allowed.includes(key)) continue;
      const guess = closest(key, allowed);
      this.fail(at(path, key), `Unknown field '${key}'.`, guess ? `Did you mean '${guess}'?` : `Allowed fields: ${allowed.join(", ")}.`);
    }
    return fields;
  }

  missing(path: string): undefined {
    return this.fail(path, "Missing required field.");
  }

  string(value: unknown, path: string, opts: { pattern?: RegExp; patternHint?: string; allowEmpty?: boolean } = {}): string | undefined {
    if (value === undefined) return this.missing(path);
    if (typeof value !== "string") return this.fail(path, `Expected a string, got ${describe(value)}.`);
    if (!opts.allowEmpty && value.trim() === "") return this.fail(path, "Must not be empty.");
    if (opts.pattern && !opts.pattern.test(value)) {
      return this.fail(path, `'${value}' has the wrong format.`, opts.patternHint);
    }
    return value;
  }

  optionalString(value: unknown, path: string): string | undefined {
    return value === undefined ? undefined : this.string(value, path);
  }

  int(value: unknown, path: string, min: number, max: number): number | undefined {
    if (value === undefined) return this.missing(path);
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return this.fail(path, `Expected a whole number, got ${describe(value)}.`);
    }
    if (value < min || value > max) return this.fail(path, `${value} is out of range; allowed ${min} to ${max}.`);
    return value;
  }

  bool(value: unknown, path: string): boolean | undefined {
    if (value === undefined) return this.missing(path);
    if (typeof value !== "boolean") return this.fail(path, `Expected true or false, got ${describe(value)}.`);
    return value;
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | undefined {
    if (value === undefined) return this.missing(path);
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
    const guess = typeof value === "string" ? closest(value, allowed) : null;
    return this.fail(
      path,
      `${describe(value)} is not allowed.`,
      guess ? `Did you mean '${guess}'? Allowed: ${allowed.join(", ")}.` : `Allowed: ${allowed.join(", ")}.`,
    );
  }

  array(value: unknown, path: string, minLength = 0): unknown[] | undefined {
    if (value === undefined) return this.missing(path);
    if (!Array.isArray(value)) return this.fail(path, `Expected a list, got ${describe(value)}.`);
    if (value.length < minLength) return this.fail(path, `Needs at least ${minLength} item(s).`);
    return value;
  }

  stringList(value: unknown, path: string, minLength = 0): string[] | undefined {
    const list = this.array(value, path, minLength);
    if (!list) return undefined;
    const out: string[] = [];
    let ok = true;
    list.forEach((item, i) => {
      const s = this.string(item, at(path, i));
      if (s === undefined) ok = false;
      else out.push(s);
    });
    return ok ? out : undefined;
  }

  literal<T>(value: unknown, path: string, expected: T): T | undefined {
    if (value === undefined) return this.missing(path);
    if (value !== expected) return this.fail(path, `Expected ${JSON.stringify(expected)}, got ${describe(value)}.`);
    return expected;
  }
}

export function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return `'${value.length > 40 ? `${value.slice(0, 40)}…` : value}'`;
  if (typeof value === "object") return "an object";
  return `${typeof value} ${String(value)}`;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2027-02-30). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Formats an ISO date for people, in UTC so the result never depends on the machine's timezone. */
export function formatDate(isoDate: string, locale: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
