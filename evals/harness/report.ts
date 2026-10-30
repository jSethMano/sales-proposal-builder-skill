// Writes evals/RESULTS.md from every run's raw results.jsonl, so every number in it is recomputed
// from the per-behavior rows and nothing is copied from an aggregate.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../tools/lib/package.ts";
import type { ResultRow } from "./types.ts";

export const RUNS_DIR = join(ROOT, "evals/runs");
const RESULTS = join(ROOT, "evals/RESULTS.md");

export interface RunConfig {
  runId: string;
  startedAt: string;
  commit: string;
  skillVersion: string;
  zips: Record<string, string>;
  models: string[];
  conditions: string[];
  effort: string;
  judge: string;
  budgetUsd: number;
  sdkVersion: string;
}

const SHORT: Record<string, string> = { "claude-haiku-5-5": "Haiku", "claude-sonnet-5-5": "Sonnet", "claude-opus-5-5": "Opus" };
const short = (model: string): string => SHORT[model] ?? model;
const mark = (r: ResultRow | undefined): string => {
  if (!r) return "–";
  if (r.pass === null) return "⚠";
  if (r.status !== "ok") return r.pass ? `✅ (${r.status})` : `❌ (${r.status})`;
  return r.pass ? "✅" : "❌";
};
const usd = (n: number): string => `$${n.toFixed(2)}`;

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as T);
}

function runSection(dir: string): string {
  const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as RunConfig;
  const rows = readJsonl<ResultRow>(join(dir, "results.jsonl"));
  const errors = readJsonl<{ scenario: string; model: string; condition: string; kind: string; message: string }>(join(dir, "errors.jsonl"));
  const columns = config.models.flatMap((m) => config.conditions.map((c) => ({ model: m, condition: c })));
  const behaviors = [...new Map(rows.map((r) => [`${r.scenario}/${r.behavior}`, r])).keys()].sort();
  const find = (key: string, model: string, condition: string) =>
    rows.find((r) => `${r.scenario}/${r.behavior}` === key && r.model === model && r.condition === condition);

  const header = `| Scenario / behavior | ${columns.map((c) => `${short(c.model)} ${c.condition === "skill" ? "skill" : "base"}`).join(" | ")} |`;
  const lines = [header, `|---|${columns.map(() => "---").join("|")}|`];
  for (const key of behaviors) lines.push(`| ${key} | ${columns.map((c) => mark(find(key, c.model, c.condition))).join(" | ")} |`);
  const passed = columns.map((c) => {
    const graded = rows.filter((r) => r.model === c.model && r.condition === c.condition && r.pass !== null);
    return `${graded.filter((r) => r.pass).length}/${graded.length}`;
  });
  lines.push(`| **Passed** | ${passed.join(" | ")} |`);

  // Case cost is repeated on each behavior row, so count each case once.
  const cases = [...new Map(rows.map((r) => [`${r.scenario}|${r.model}|${r.condition}`, r])).values()];
  const costLines = columns.map((c) => {
    const these = cases.filter((r) => r.model === c.model && r.condition === c.condition);
    return `| ${short(c.model)} ${c.condition} | ${these.length} | ${usd(these.reduce((s, r) => s + r.caseCostUsd, 0))} |`;
  });
  const judgeCost = rows.reduce((s, r) => s + (r.judgeCostUsd ?? 0), 0);

  return [
    `## Run ${config.runId}`,
    "",
    `- **Date:** ${config.startedAt.slice(0, 10)} · **commit:** \`${config.commit}\` · **skill:** ${config.skillVersion} · **SDK:** ${config.sdkVersion}`,
    `- **Zips:** ${Object.entries(config.zips).map(([n, sha]) => `${n} \`${sha.slice(0, 12)}\``).join(", ")}`,
    `- **Effort:** ${config.effort} · **judge:** ${config.judge} · **trials:** 1 per case`,
    "",
    ...lines,
    "",
    "✅ pass · ❌ fail · ⚠ couldn't be graded · – not run. A status in brackets means the case was truncated or refused.",
    "",
    "| Cases | Count | Cost |",
    "|---|---|---|",
    ...costLines,
    `| Judge | ${rows.filter((r) => r.kind === "model").length} calls | ${usd(judgeCost)} |`,
    "",
    "Costs cover tokens only; code-execution container time is billed separately.",
    ...(errors.length > 0
      ? ["", `**Infrastructure errors (${errors.length}), not scored:**`, "", ...errors.map((e) => `- ${e.scenario} · ${short(e.model)} ${e.condition}: ${e.kind}: ${e.message}`)]
      : []),
    "",
  ].join("\n");
}

export function writeResults(runsDir: string = RUNS_DIR, out: string = RESULTS): string {
  const runs = existsSync(runsDir)
    ? readdirSync(runsDir)
        .filter((d) => existsSync(join(runsDir, d, "config.json")))
        .sort()
        .reverse()
    : [];
  const intro = [
    "# Eval results",
    "",
    "Written by `evals/harness/report.ts` from each run's `results.jsonl`. Newest run first. Scenarios are in `evals/scenarios/`.",
    "",
    "How to read this:",
    "- **skill** runs the packaged skill. **base** is the same model with code execution, Anthropic's docx skill and the company's files attached, so it shows what the skill adds beyond the data.",
    "- Each case runs **once**. With 7 scenarios, a single flip is within run-to-run noise, so read differences of one or two behaviors as indicative, not proven.",
    "- API runs have no claude.ai system prompt. `MANUAL.md` covers the claude.ai check.",
    "",
  ];
  const body = runs.length > 0 ? runs.map((r) => runSection(join(runsDir, r))) : ["No runs yet. Run `npm run evals -- --budget-usd <amount>`; see `evals/README.md`.", ""];
  const text = [...intro, ...body].join("\n");
  writeFileSync(out, text);
  return out;
}
