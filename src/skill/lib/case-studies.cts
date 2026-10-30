// Compiled from src/skill/lib/case-studies.cts. Edit the source, then run npm run build.
// Parses case-studies.md. The format is strict so the pack check can tell an admin exactly which
// line is wrong, and so Claude can only cite stories that parse (design §4):
//
//   # Case studies                      (optional title)
//   ## CS-001 | Title of the story
//   Industry: Logistics
//   Summary: Rendered verbatim.
//   Outcome: Rendered verbatim.
import type { Problems } from "./cli.cjs";
import type { CaseStudy } from "./types.cjs";

const HEADING = /^## (CS-\d{3}) \| (.+)$/;
const FIELD = /^(Industry|Summary|Outcome): (.+)$/;
const FIELDS = ["Industry", "Summary", "Outcome"] as const;

export function parseCaseStudies(text: string, problems: Problems, file = "case-studies.md"): CaseStudy[] {
  const studies: CaseStudy[] = [];
  let current: { id: string; title: string; line: number; fields: Map<string, string> } | null = null;

  const finish = (): void => {
    if (!current) return;
    const missing = FIELDS.filter((f) => !current?.fields.has(f));
    if (missing.length > 0) {
      problems.add(
        "E_PACK_CASE_STUDY",
        `${file}:${current.line}`,
        `${current.id} is missing ${missing.join(", ")}.`,
        "Each case study needs Industry:, Summary: and Outcome: lines.",
      );
    } else {
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
    if (line === "") return;
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
      if (line.startsWith("# ")) return;
      problems.add(
        "E_PACK_CASE_STUDY",
        `${file}:${lineNo}`,
        "Unexpected text before the first case study.",
        "Start each story with a heading like '## CS-001 | Title'.",
      );
      return;
    }
    const field = FIELD.exec(line);
    if (!field) {
      problems.add(
        "E_PACK_CASE_STUDY",
        `${file}:${lineNo}`,
        `Unexpected line in ${current.id}: '${line.slice(0, 60)}'.`,
        "Use only 'Industry: …', 'Summary: …' and 'Outcome: …' lines, one per field.",
      );
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
