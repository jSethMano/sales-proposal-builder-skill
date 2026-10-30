"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCaseStudies = parseCaseStudies;
const HEADING = /^## (CS-\d{3}) \| (.+)$/;
const FIELD = /^(Industry|Summary|Outcome): (.+)$/;
const FIELDS = ["Industry", "Summary", "Outcome"];
function parseCaseStudies(text, problems, file = "case-studies.md") {
    const studies = [];
    let current = null;
    const finish = () => {
        if (!current)
            return;
        const missing = FIELDS.filter((f) => !current?.fields.has(f));
        if (missing.length > 0) {
            problems.add("E_PACK_CASE_STUDY", `${file}:${current.line}`, `${current.id} is missing ${missing.join(", ")}.`, "Each case study needs Industry:, Summary: and Outcome: lines.");
        }
        else {
            studies.push({
                id: current.id,
                title: current.title.trim(),
                industry: current.fields.get("Industry") ?? "",
                summary: current.fields.get("Summary") ?? "",
                outcome: current.fields.get("Outcome") ?? "",
            });
        }
    };
    text.split(/\r?\n/).forEach((raw, index) => {
        const line = raw.trimEnd();
        const lineNo = index + 1;
        if (line === "")
            return;
        const heading = HEADING.exec(line);
        if (heading) {
            finish();
            const id = heading[1] ?? "";
            if (studies.some((s) => s.id === id) || current?.id === id) {
                problems.add("E_PACK_CASE_STUDY", `${file}:${lineNo}`, `Duplicate case study ID ${id}.`, "Give each story its own CS-NNN number.");
            }
            current = { id, title: heading[2] ?? "", line: lineNo, fields: new Map() };
            return;
        }
        if (current === null) {
            if (line.startsWith("# "))
                return;
            problems.add("E_PACK_CASE_STUDY", `${file}:${lineNo}`, "Unexpected text before the first case study.", "Start each story with a heading like '## CS-001 | Title'.");
            return;
        }
        const field = FIELD.exec(line);
        if (!field) {
            problems.add("E_PACK_CASE_STUDY", `${file}:${lineNo}`, `Unexpected line in ${current.id}: '${line.slice(0, 60)}'.`, "Use only 'Industry: …', 'Summary: …' and 'Outcome: …' lines, one per field.");
            return;
        }
        const name = field[1] ?? "";
        if (current.fields.has(name)) {
            problems.add("E_PACK_CASE_STUDY", `${file}:${lineNo}`, `${current.id} has ${name}: twice.`);
        }
        current.fields.set(name, (field[2] ?? "").trim());
    });
    finish();
    return studies;
}
