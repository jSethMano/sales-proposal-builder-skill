"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISO_DATE = exports.Checker = void 0;
exports.at = at;
exports.describe = describe;
exports.isIsoDate = isIsoDate;
exports.addDays = addDays;
exports.formatDate = formatDate;
// Compiled from src/skill/lib/check.cts. Edit the source, then run npm run build.
// Structural checks for JSON files. Each check records a Problem and returns undefined instead of
// throwing, so one run reports every problem in a file.
const closest_cjs_1 = require("./closest.cjs");
function at(base, key) {
    if (typeof key === "number")
        return `${base}[${key}]`;
    return base === "" ? key : `${base}.${key}`;
}
class Checker {
    problems;
    /** Problem code used for structural errors, e.g. E_PACK_SCHEMA or E_QUOTE_SCHEMA. */
    code;
    /** File name shown in each problem's path, e.g. "brand.json". */
    file;
    constructor(problems, code, file) {
        this.problems = problems;
        this.code = code;
        this.file = file;
    }
    fail(path, message, hint, code = this.code) {
        this.problems.add(code, `${this.file}:${path || "(root)"}`, message, hint);
        return undefined;
    }
    /**
     * A plain object. Fields not in `allowed` fail (they are usually typos), except names starting
     * with "_", which are comments. Returns the object even when a field fails, so the caller can
     * still check the remaining fields; each field check reports its own missing value.
     */
    object(value, path, allowed) {
        if (value === undefined)
            return this.missing(path);
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return this.fail(path, `Expected an object, got ${describe(value)}.`);
        }
        const fields = value;
        for (const key of Object.keys(fields)) {
            if (key.startsWith("_") || allowed.includes(key))
                continue;
            const guess = (0, closest_cjs_1.closest)(key, allowed);
            this.fail(at(path, key), `Unknown field '${key}'.`, guess ? `Did you mean '${guess}'?` : `Allowed fields: ${allowed.join(", ")}.`);
        }
        return fields;
    }
    missing(path) {
        return this.fail(path, "Missing required field.");
    }
    string(value, path, opts = {}) {
        if (value === undefined)
            return this.missing(path);
        if (typeof value !== "string")
            return this.fail(path, `Expected a string, got ${describe(value)}.`);
        if (!opts.allowEmpty && value.trim() === "")
            return this.fail(path, "Must not be empty.");
        if (opts.pattern && !opts.pattern.test(value)) {
            return this.fail(path, `'${value}' has the wrong format.`, opts.patternHint);
        }
        return value;
    }
    optionalString(value, path) {
        return value === undefined ? undefined : this.string(value, path);
    }
    int(value, path, min, max) {
        if (value === undefined)
            return this.missing(path);
        if (typeof value !== "number" || !Number.isInteger(value)) {
            return this.fail(path, `Expected a whole number, got ${describe(value)}.`);
        }
        if (value < min || value > max)
            return this.fail(path, `${value} is out of range; allowed ${min} to ${max}.`);
        return value;
    }
    bool(value, path) {
        if (value === undefined)
            return this.missing(path);
        if (typeof value !== "boolean")
            return this.fail(path, `Expected true or false, got ${describe(value)}.`);
        return value;
    }
    oneOf(value, path, allowed) {
        if (value === undefined)
            return this.missing(path);
        if (typeof value === "string" && allowed.includes(value))
            return value;
        const guess = typeof value === "string" ? (0, closest_cjs_1.closest)(value, allowed) : null;
        return this.fail(path, `${describe(value)} is not allowed.`, guess ? `Did you mean '${guess}'? Allowed: ${allowed.join(", ")}.` : `Allowed: ${allowed.join(", ")}.`);
    }
    array(value, path, minLength = 0) {
        if (value === undefined)
            return this.missing(path);
        if (!Array.isArray(value))
            return this.fail(path, `Expected a list, got ${describe(value)}.`);
        if (value.length < minLength)
            return this.fail(path, `Needs at least ${minLength} item(s).`);
        return value;
    }
    stringList(value, path, minLength = 0) {
        const list = this.array(value, path, minLength);
        if (!list)
            return undefined;
        const out = [];
        let ok = true;
        list.forEach((item, i) => {
            const s = this.string(item, at(path, i));
            if (s === undefined)
                ok = false;
            else
                out.push(s);
        });
        return ok ? out : undefined;
    }
    literal(value, path, expected) {
        if (value === undefined)
            return this.missing(path);
        if (value !== expected)
            return this.fail(path, `Expected ${JSON.stringify(expected)}, got ${describe(value)}.`);
        return expected;
    }
}
exports.Checker = Checker;
function describe(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "a list";
    if (typeof value === "string")
        return `'${value.length > 40 ? `${value.slice(0, 40)}…` : value}'`;
    if (typeof value === "object")
        return "an object";
    return `${typeof value} ${String(value)}`;
}
exports.ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** True for a real calendar date in YYYY-MM-DD form (rejects 2027-02-30). */
function isIsoDate(value) {
    if (!exports.ISO_DATE.test(value))
        return false;
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
function addDays(isoDate, days) {
    const [y, m, d] = isoDate.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** Formats an ISO date for people, in UTC so the result never depends on the machine's timezone. */
function formatDate(isoDate, locale) {
    const [y, m, d] = isoDate.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
