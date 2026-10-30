"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkProposal = checkProposal;
// Compiled from src/skill/lib/proposal.cts. Edit the source, then run npm run build.
// Checks a proposal against its pack and pricing (design §8). validate.cjs runs this for fast
// feedback; build-docx.cjs runs the same function and refuses to build on any error (design X3).
const check_cjs_1 = require("./check.cjs");
const cli_cjs_1 = require("./cli.cjs");
const closest_cjs_1 = require("./closest.cjs");
const pricing_cjs_1 = require("./pricing.cjs");
const rules_cjs_1 = require("./rules.cjs");
const version_cjs_1 = require("./version.cjs");
const PRICING_REF = /^sha256:[0-9a-f]{64}$/;
function checkProposal(raw, pack, pricingText, names) {
    const errors = new cli_cjs_1.Problems();
    const warnings = new cli_cjs_1.Problems();
    const scan = { errors, warnings, file: names.proposal };
    const pricing = loadPricing(pricingText, pack, errors, names.pricing);
    const c = new check_cjs_1.Checker(errors, "E_SCHEMA", names.proposal);
    const p = c.object(raw, "", ["schemaVersion", "pricingRef", "title", "date", "startDate", "client", "sections"]);
    if (!p)
        errors.throwNow();
    c.literal(p.schemaVersion, "schemaVersion", 1);
    const ref = c.string(p.pricingRef, "pricingRef", { pattern: PRICING_REF, patternHint: "Copy pricingRef from price.cjs's output." });
    if (ref !== undefined && PRICING_REF.test(ref) && ref !== `sha256:${(0, cli_cjs_1.sha256)(pricingText)}`) {
        c.fail("pricingRef", `pricingRef doesn't match ${names.pricing}.`, "The proposal was written for a different pricing. Copy pricingRef from the latest price.cjs output, and update any prose the change affects.", "E_PRICING_REF");
    }
    const title = c.string(p.title, "title");
    if (title !== undefined)
        (0, rules_cjs_1.scanText)(title, "title", scan);
    checkDates(c, p, pricing, names.pricing);
    checkClient(c, p.client, scan);
    const sections = c.object(p.sections, "sections", [
        "executiveSummary", "understanding", "solution", "scope", "timeline", "whyUs", "assumptions", "notIncluded", "nextSteps",
    ]);
    if (sections)
        checkSections(c, sections, pack, pricing, scan);
    errors.throwIfAny();
    if (!pricing)
        throw new Error("pricing missing without an error; loadPricing must report one.");
    return { proposal: p, pricing, warnings: warnings.list };
}
/**
 * Parses pricing.json and recomputes it from the quote it embeds (design X2). Returns the
 * recomputed pricing (the authoritative numbers), or undefined if it can't be recomputed.
 */
function loadPricing(text, pack, errors, file) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (e) {
        errors.add("E_JSON", file, `${file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, "Re-run price.cjs with --out; don't edit pricing.json.");
        return undefined;
    }
    const rerun = `Re-run price.cjs quote.json --out ${file}; never edit ${file} by hand.`;
    if (typeof parsed !== "object" || parsed === null || !("quote" in parsed)) {
        errors.add("E_PRICING_STALE", file, `${file} wasn't written by price.cjs.`, rerun);
        return undefined;
    }
    let recomputed;
    try {
        recomputed = (0, pricing_cjs_1.price)((0, pricing_cjs_1.checkQuote)(parsed.quote, pack, `${file}:quote`).quote, pack, version_cjs_1.SKILL_VERSION);
    }
    catch (e) {
        if (!(e instanceof cli_cjs_1.ScriptError))
            throw e;
        errors.add("E_PRICING_STALE", file, `The quote inside ${file} is no longer valid for this pack: ${e.problems[0]?.message ?? "unknown problem"}`, `Fix quote.json, then ${rerun.charAt(0).toLowerCase()}${rerun.slice(1)}`);
        return undefined;
    }
    if ((0, cli_cjs_1.toJsonText)(recomputed) !== text) {
        errors.add("E_PRICING_STALE", file, `${file} doesn't match what price.cjs computes from its quote.`, `It was edited, or the pack or skill version changed since it was written. ${rerun}`);
    }
    return recomputed;
}
function checkDates(c, p, pricing, pricingFile) {
    const date = c.string(p.date, "date");
    const start = c.string(p.startDate, "startDate");
    const valid = (value, path) => {
        if (value === undefined)
            return false;
        if ((0, check_cjs_1.isIsoDate)(value))
            return true;
        c.fail(path, `'${value}' is not a real date in YYYY-MM-DD form.`, "Use a date like \"2027-01-15\".", "E_DATE");
        return false;
    };
    const dateOk = valid(date, "date");
    const startOk = valid(start, "startDate");
    if (dateOk && pricing && date !== pricing.quoteDate) {
        c.fail("date", `date ${date} doesn't match quoteDate ${pricing.quoteDate} in ${pricingFile}.`, "Use the same date in quote.json and proposal.json, and re-price if it changed.", "E_DATE");
    }
    if (dateOk && startOk && start < date) {
        c.fail("startDate", `startDate ${start} is before the proposal date ${date}.`, "Use the start date the salesperson gave you; ask if there isn't one.", "E_DATE");
    }
}
function checkClient(c, value, scan) {
    const client = c.object(value, "client", ["name", "contact", "address", "sites"]);
    if (!client)
        return;
    const ask = "Use the name from the brief. If there isn't one, ask the salesperson; never invent a client or contact.";
    if (typeof client.name !== "string" || client.name.trim() === "")
        c.fail("client.name", "The client's name is missing.", ask, "E_CLIENT");
    else
        (0, rules_cjs_1.scanText)(client.name, "client.name", scan);
    const contact = c.object(client.contact, "client.contact", ["name", "title", "email"]);
    if (contact) {
        if (typeof contact.name !== "string" || contact.name.trim() === "") {
            c.fail("client.contact.name", "The client contact's name is missing.", ask, "E_CLIENT");
        }
        else {
            (0, rules_cjs_1.scanText)(contact.name, "client.contact.name", scan);
        }
        for (const key of ["title", "email"]) {
            const v = c.optionalString(contact[key], (0, check_cjs_1.at)("client.contact", key));
            if (v !== undefined)
                (0, rules_cjs_1.scanText)(v, (0, check_cjs_1.at)("client.contact", key), scan);
        }
    }
    const address = c.optionalString(client.address, "client.address");
    if (address !== undefined)
        (0, rules_cjs_1.scanText)(address, "client.address", scan);
    if (client.sites !== undefined) {
        c.stringList(client.sites, "client.sites")?.forEach((site, i) => (0, rules_cjs_1.scanText)(site, (0, check_cjs_1.at)("client.sites", i), scan));
    }
}
function checkSections(c, s, pack, pricing, scan) {
    for (const key of ["executiveSummary", "understanding", "solution", "nextSteps"]) {
        const path = (0, check_cjs_1.at)("sections", key);
        const text = c.string(s[key], path);
        if (text !== undefined)
            (0, rules_cjs_1.scanMarkdown)(text, path, path, scan);
    }
    checkScope(c, s.scope, pack, pricing, scan);
    checkTimeline(c, s.timeline, scan);
    checkWhyUs(c, s.whyUs, pack, scan);
    for (const key of ["assumptions", "notIncluded"]) {
        c.stringList(s[key], (0, check_cjs_1.at)("sections", key))?.forEach((item, i) => (0, rules_cjs_1.scanText)(item, (0, check_cjs_1.at)((0, check_cjs_1.at)("sections", key), i), scan));
    }
}
function checkScope(c, value, pack, pricing, scan) {
    const list = c.array(value, "sections.scope", 1);
    if (!list)
        return;
    const items = [];
    list.forEach((raw, i) => {
        const path = (0, check_cjs_1.at)("sections.scope", i);
        const entry = c.object(raw, path, ["item", "notes"]);
        if (!entry)
            return;
        const item = c.string(entry.item, (0, check_cjs_1.at)(path, "item"));
        if (item !== undefined)
            items.push(item);
        const notes = c.string(entry.notes, (0, check_cjs_1.at)(path, "notes"));
        if (notes !== undefined)
            (0, rules_cjs_1.scanMarkdown)(notes, (0, check_cjs_1.at)(path, "notes"), "sections.scope[].notes", scan);
    });
    if (!pricing)
        return;
    // One scope entry per priced line, keyed by SKU (or the name of a custom line).
    const priced = pricing.lines.map((l) => l.sku ?? l.name);
    const catalog = pack.catalog.items.map((i) => i.sku);
    const seen = new Set();
    items.forEach((item) => {
        if (seen.has(item))
            c.fail("sections.scope", `${item} has more than one scope entry.`, "Merge them into one entry.", "E_SCOPE");
        seen.add(item);
        if (priced.includes(item))
            return;
        if (catalog.includes(item)) {
            c.fail("sections.scope", `${item} is in scope but not in the pricing.`, "Add it to quote.json and re-run price.cjs, or remove it from scope.", "E_SCOPE");
            return;
        }
        const guess = (0, closest_cjs_1.closest)(item, [...priced, ...catalog]);
        c.fail("sections.scope", `'${item}' is not a priced item or a catalog SKU.`, `${guess ? `Closest: ${guess}. ` : ""}Scope lists exactly the priced items: ${priced.join(", ")}.`, "E_SKU_UNKNOWN");
    });
    for (const item of priced) {
        if (!seen.has(item))
            c.fail("sections.scope", `Priced item ${item} has no scope entry.`, "Add a scope entry with notes for this client.", "E_SCOPE");
    }
}
function checkTimeline(c, value, scan) {
    const rows = c.array(value, "sections.timeline", 1);
    if (!rows)
        return;
    if (rows.length > rules_cjs_1.MAX_TIMELINE_ROWS) {
        scan.warnings.add("W_LENGTH", `${scan.file}:sections.timeline`, `${rows.length} timeline rows; the guide is at most ${rules_cjs_1.MAX_TIMELINE_ROWS}.`, "Group steps into phases.");
    }
    rows.forEach((raw, i) => {
        const path = (0, check_cjs_1.at)("sections.timeline", i);
        const row = c.object(raw, path, ["label", "when", "detail"]);
        if (!row)
            return;
        for (const key of ["label", "when"]) {
            const text = c.string(row[key], (0, check_cjs_1.at)(path, key));
            if (text !== undefined)
                (0, rules_cjs_1.scanText)(text, (0, check_cjs_1.at)(path, key), scan);
        }
        const detail = c.string(row.detail, (0, check_cjs_1.at)(path, "detail"));
        if (detail !== undefined)
            (0, rules_cjs_1.scanMarkdown)(detail, (0, check_cjs_1.at)(path, "detail"), "sections.timeline[].detail", scan);
    });
}
function checkWhyUs(c, value, pack, scan) {
    const whyUs = c.object(value, "sections.whyUs", ["intro", "caseStudyIds"]);
    if (!whyUs)
        return;
    const intro = c.string(whyUs.intro, "sections.whyUs.intro");
    if (intro !== undefined)
        (0, rules_cjs_1.scanMarkdown)(intro, "sections.whyUs.intro", "sections.whyUs.intro", scan);
    const ids = c.stringList(whyUs.caseStudyIds, "sections.whyUs.caseStudyIds");
    if (!ids)
        return;
    const available = pack.caseStudies.map((s) => s.id);
    const list = available.length > 0 ? `Approved case studies: ${available.join(", ")}.` : "This pack has no case studies.";
    if (available.length > 0 && ids.length === 0) {
        c.fail("sections.whyUs.caseStudyIds", "Cite at least one approved case study.", `Pick the closest match to this client. ${list}`, "E_CASE_STUDY");
    }
    const seen = new Set();
    ids.forEach((id, i) => {
        const path = (0, check_cjs_1.at)("sections.whyUs.caseStudyIds", i);
        if (seen.has(id))
            c.fail(path, `${id} is cited twice.`, undefined, "E_CASE_STUDY");
        seen.add(id);
        if (!available.includes(id)) {
            c.fail(path, `${id} is not in case-studies.md.`, `Only approved stories may be cited, and never invent one. ${list}`, "E_CASE_STUDY");
        }
    });
}
