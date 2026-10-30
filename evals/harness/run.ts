// Runs the evals (design §13):
//   npm run evals -- --dry-run                       plan and estimate only; no API calls
//   npm run evals -- --budget-usd 20                 every scenario × Haiku, Sonnet, Opus × skill, baseline
//   npm run evals -- --budget-usd 2 --models haiku --scenarios 01
//   npm run evals -- --judge-selftest                checks the judge on known answers (a few cents)
//   npm run evals -- --report-only                   rewrites RESULTS.md from saved runs
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { type PackageResult, packageSkill, ROOT } from "../../tools/lib/package.ts";
import { gradeCode } from "./checks.ts";
import { EFFORT, JUDGE_MODEL, MAX_RETRIES, MODELS, type ModelKey, PRIOR_CASE_COST_USD, PRIOR_JUDGE_COST_USD } from "./config.ts";
import { judge, renderTranscript } from "./judge.ts";
import { type RunConfig, RUNS_DIR, writeResults } from "./report.ts";
import { InfraError, runCase } from "./runner.ts";
import { expectedTotals, loadScenarios, packDirFor, runSkillScript } from "./scenarios.ts";
import { ensureSkill, type PinnedSkill } from "./skills.ts";
import type { CodeExpectation, Condition, Grade, ModelExpectation, ResultRow, Scenario } from "./types.ts";

const { values } = parseArgs({
  options: {
    "budget-usd": { type: "string" },
    models: { type: "string", default: "haiku,sonnet,opus" },
    scenarios: { type: "string", default: "" },
    conditions: { type: "string", default: "skill,baseline" },
    concurrency: { type: "string", default: "3" },
    "dry-run": { type: "boolean", default: false },
    "judge-selftest": { type: "boolean", default: false },
    "report-only": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

if (values["report-only"]) {
  console.log(`Wrote ${writeResults()}`);
  process.exit(0);
}
if (values["judge-selftest"]) {
  await judgeSelftest();
  process.exit(0);
}

const modelKeys = values.models.split(",").map((m) => m.trim()) as ModelKey[];
for (const k of modelKeys) if (!(k in MODELS)) fail(`Unknown model '${k}'. Use: ${Object.keys(MODELS).join(", ")}.`);
// Cheapest first, so if the budget runs out it's the expensive model that's cut short.
const models = (Object.keys(MODELS) as ModelKey[]).filter((k) => modelKeys.includes(k)).map((k) => MODELS[k]);
const conditions = values.conditions.split(",").map((c) => c.trim()) as Condition[];
for (const c of conditions) if (c !== "skill" && c !== "baseline") fail(`Unknown condition '${c}'. Use: skill, baseline.`);
const scenarios = loadScenarios(values.scenarios ? values.scenarios.split(",").map((s) => s.trim()) : []);
if (scenarios.length === 0) fail("No scenarios match.");
const concurrency = Math.max(1, Number(values.concurrency));

// Package the zips the scenarios need, from freshly compiled scripts.
execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(ROOT, "tsconfig.skill.json")], { stdio: "inherit" });
const zips = new Map<string, PackageResult>();
for (const pack of new Set(scenarios.map((s) => s.pack))) {
  zips.set(pack, pack === "neutral" ? packageSkill() : packageSkill({ packDir: packDirFor(pack) }));
}
const expected = new Map(scenarios.map((s) => [s.id, expectedTotals(s)]));
const configured = new Map([...zips.keys()].map((p) => [p, runSkillScript("check-pack.cjs", [packDirFor(p)]).configured === true]));

interface Case {
  scenario: Scenario;
  model: string;
  condition: Condition;
}
const cases: Case[] = models.flatMap((model) => scenarios.flatMap((scenario) => conditions.map((condition) => ({ scenario, model, condition }))));
const judgeCalls = (s: Scenario) => s.expected.filter((e) => e.kind === "model").length;
const estimate = (c: Case) => (PRIOR_CASE_COST_USD[c.model] ?? 1) + judgeCalls(c.scenario) * PRIOR_JUDGE_COST_USD;
const estimated = cases.reduce((sum, c) => sum + estimate(c), 0);

if (values["dry-run"]) {
  console.log(
    JSON.stringify(
      {
        cases: cases.length,
        perModel: Object.fromEntries(models.map((m) => [m, cases.filter((c) => c.model === m).length])),
        judgeCalls: cases.reduce((n, c) => n + judgeCalls(c.scenario), 0),
        // A prior until the first cases are measured; it can be off by a factor of two either way.
        estimatedUsd: { low: +(estimated * 0.5).toFixed(2), high: +(estimated * 2).toFixed(2) },
        zips: Object.fromEntries([...zips].map(([p, z]) => [p, { sha256: z.sha256, bytes: z.bytes }])),
        expectedTotals: Object.fromEntries(expected),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const budget = Number(values["budget-usd"]);
if (!values["budget-usd"] || !(budget > 0)) fail("--budget-usd is required (a positive amount in US dollars). Try --dry-run first for an estimate.");

const client = new Anthropic({ maxRetries: MAX_RETRIES });
const pins = new Map<string, PinnedSkill>();
if (conditions.includes("skill")) for (const [pack, zip] of zips) pins.set(pack, await ensureSkill(client, zip));

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(RUNS_DIR, runId);
mkdirSync(join(runDir, "transcripts"), { recursive: true });
const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const config: RunConfig = {
  runId,
  startedAt: new Date().toISOString(),
  commit: `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain") ? "+dirty" : ""}`,
  skillVersion: [...zips.values()][0]?.version ?? "",
  zips: Object.fromEntries([...zips].map(([p, z]) => [p, z.sha256])),
  models,
  conditions,
  effort: EFFORT,
  judge: JUDGE_MODEL,
  budgetUsd: budget,
  sdkVersion: (JSON.parse(readFileSync(join(ROOT, "node_modules/@anthropic-ai/sdk/package.json"), "utf8")) as { version: string }).version,
};
writeFileSync(join(runDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
console.log(`Run ${runId}: ${cases.length} cases, budget $${budget}, prior estimate $${estimated.toFixed(2)}.`);

let spent = 0;
let reserved = 0;
const measured = new Map<string, number[]>();
const nextEstimate = (c: Case): number => {
  const seen = measured.get(c.model) ?? [];
  const caseCost = seen.length > 0 ? seen.reduce((a, b) => a + b, 0) / seen.length : (PRIOR_CASE_COST_USD[c.model] ?? 1);
  return caseCost + judgeCalls(c.scenario) * PRIOR_JUDGE_COST_USD;
};

async function runOne(c: Case): Promise<void> {
  const label = `${c.scenario.id} · ${c.model} · ${c.condition}`;
  const est = nextEstimate(c);
  if (spent + reserved + est > budget) {
    appendFileSync(join(runDir, "errors.jsonl"), `${JSON.stringify({ scenario: c.scenario.id, model: c.model, condition: c.condition, kind: "budget", message: `Skipped: would pass the $${budget} budget.` })}\n`);
    console.log(`skip  ${label} (budget)`);
    return;
  }
  reserved += est;
  const caseName = `${c.scenario.id}--${c.model}--${c.condition}`;
  try {
    const run = await runCase({
      client,
      scenario: c.scenario,
      model: c.model,
      condition: c.condition,
      skill: pins.get(c.scenario.pack),
      packDir: packDirFor(c.scenario.pack),
      packConfigured: configured.get(c.scenario.pack) === true,
      outDir: join(runDir, "outputs", caseName),
    });
    measured.set(c.model, [...(measured.get(c.model) ?? []), run.costUsd]);
    writeFileSync(join(runDir, "transcripts", `${caseName}.json`), `${JSON.stringify(run, null, 2)}\n`);

    const grades: Grade[] = gradeCode(
      c.scenario.expected.filter((e): e is CodeExpectation => e.kind === "code"),
      { files: run.files, expected: expected.get(c.scenario.id) ?? null, packDir: packDirFor(c.scenario.pack) },
    );
    for (const e of c.scenario.expected.filter((x): x is ModelExpectation => x.kind === "model")) {
      try {
        const v = await judge(client, e.rubric, renderTranscript(run.messages, e.turn));
        grades.push({ behavior: e.id, kind: "model", pass: v.pass, detail: v.reason, evidence: v.evidence, judgeCostUsd: v.costUsd });
        spent += v.costUsd;
      } catch (err) {
        // A judge failure is the grader's problem, not the model's: ungraded, never a fail.
        grades.push({ behavior: e.id, kind: "model", pass: null, detail: `Judge failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    const rows: ResultRow[] = grades.map((g) => ({
      ...g,
      runId,
      scenario: c.scenario.id,
      model: c.model,
      servedModel: run.servedModel,
      condition: c.condition,
      status: run.status,
      caseCostUsd: run.costUsd,
      durationMs: run.durationMs,
      userTurns: run.userTurns,
      unneededQuestions: run.unneededQuestions,
    }));
    appendFileSync(join(runDir, "results.jsonl"), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
    spent += run.costUsd;
    const passed = grades.filter((g) => g.pass === true).length;
    console.log(`done  ${label}: ${passed}/${grades.length} · $${run.costUsd.toFixed(3)} · ${run.status}`);
  } catch (err) {
    const kind = err instanceof InfraError ? err.kind : "harness";
    appendFileSync(join(runDir, "errors.jsonl"), `${JSON.stringify({ scenario: c.scenario.id, model: c.model, condition: c.condition, kind, message: err instanceof Error ? err.message : String(err) })}\n`);
    console.log(`error ${label}: ${kind}`);
  } finally {
    reserved -= est;
  }
}

let next = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
    while (next < cases.length) await runOne(cases[next++] as Case);
  }),
);
writeResults();
console.log(JSON.stringify({ runId, spentUsd: +spent.toFixed(2), results: join(runDir, "results.jsonl"), report: "evals/RESULTS.md" }, null, 2));

/** The judge on four known answers: one that meets the rubric, and three that must fail (eval-audit). */
async function judgeSelftest(): Promise<void> {
  const rubric = (loadScenarios(["03"])[0]?.expected.find((e) => e.kind === "model") as ModelExpectation).rubric;
  const ask = "SALESPERSON: Quote for Coastal Dental Group with 25% off the monthly services, please.";
  const cases: [string, string, boolean][] = [
    ["meets the rubric", `${ask}\n\nASSISTANT: Here's the proposal. It's a DRAFT: the 25% discount is above our 15% limit, so it needs the Operations Director's approval before it goes to the client.`, true],
    ["empty reply", `${ask}\n\nASSISTANT: `, false],
    ["no answer", `${ask}\n\nASSISTANT: I don't know.`, false],
    ["confidently wrong", `${ask}\n\nASSISTANT: Done! I've applied the 25% discount and the proposal is final and ready to send.`, false],
  ];
  const client = new Anthropic({ maxRetries: MAX_RETRIES });
  let ok = true;
  let cost = 0;
  for (const [name, transcript, want] of cases) {
    const v = await judge(client, rubric, transcript);
    cost += v.costUsd;
    const right = v.pass === want;
    ok &&= right;
    console.log(`${right ? "ok  " : "FAIL"} ${name}: judged ${v.pass ? "pass" : "fail"} (${v.reason})`);
  }
  console.log(`Judge self-test ${ok ? "passed" : "FAILED"} · $${cost.toFixed(3)}`);
  if (!ok) process.exitCode = 1;
}
