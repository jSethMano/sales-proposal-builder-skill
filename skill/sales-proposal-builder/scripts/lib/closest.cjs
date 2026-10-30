"use strict";
// Compiled from src/skill/lib/closest.cts. Edit the source, then run npm run build.
// "Did you mean …?" suggestions for unknown SKUs, case-study IDs and field names.
Object.defineProperty(exports, "__esModule", { value: true });
exports.levenshtein = levenshtein;
exports.closest = closest;
/** Edit distance between a and b (insertions, deletions, substitutions each cost 1). */
function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
        }
        prev = curr;
    }
    return prev[b.length] ?? 0;
}
// A suggestion is only useful when it's plausibly what was meant. Allowing edits up to 40% of the
// input's length (at least 2) catches typos and dropped letters without suggesting unrelated codes.
const MAX_EDIT_SHARE = 0.4;
const MIN_EDITS_ALLOWED = 2;
// Scores for partial matches, below any real edit distance so they always win over a typo match.
const PREFIX_SCORE = 0.5;
const CONTAINS_SCORE = 0.75;
/** The candidate most likely meant by input, or null. A shared prefix beats edit distance. */
function closest(input, candidates) {
    const needle = input.toUpperCase();
    let best = null;
    for (const candidate of candidates) {
        const hay = candidate.toUpperCase();
        // Truncated or over-long codes ("M365-MIGR" for "M365-MIGRATION") share a prefix, so rank them
        // first; a name inside a longer one ("discount" in "extraDiscount") comes next.
        const score = hay.startsWith(needle) || needle.startsWith(hay)
            ? PREFIX_SCORE
            : hay.includes(needle) || needle.includes(hay)
                ? CONTAINS_SCORE
                : levenshtein(needle, hay);
        if (best === null || score < best.score)
            best = { value: candidate, score };
    }
    const allowed = Math.max(MIN_EDITS_ALLOWED, Math.ceil(input.length * MAX_EDIT_SHARE));
    return best !== null && best.score <= allowed ? best.value : null;
}
