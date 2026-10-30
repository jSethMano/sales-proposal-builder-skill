// The eval harness's code checks, tested without the API (eval-audit: "harness tested on
// known-good and known-bad"). For every scenario, the oracle (what a correct run produces, built
// with the real scripts) must pass every code check, and an empty run must fail them.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { gradeCode, plainAmount } from "../evals/harness/checks.ts";
import { renderTranscript } from "../evals/harness/judge.ts";
import { buildOracle } from "../evals/harness/oracle.ts";
import { writeResults } from "../evals/harness/report.ts";
import { expectedTotals, loadScenarios, packDirFor } from "../evals/harness/scenarios.ts";
import type { CodeExpectation } from "../evals/harness/types.ts";
import { tempDir } from "./helpers.ts";

const scenarios = loadScenarios();
const codeChecks = (id: string): CodeExpectation[] =>
  (scenarios.find((s) => s.id === id)?.expected ?? []).filter((e): e is CodeExpectation => e.kind === "code");

describe("every scenario's code checks", () => {
  for (const scenario of scenarios) {
    const checks = scenario.expected.filter((e): e is CodeExpectation => e.kind === "code");
    const input = { expected: expectedTotals(scenario), packDir: packDirFor(scenario.pack) };

    it(`${scenario.id}: the oracle passes all ${checks.length}`, () => {
      const grades = gradeCode(checks, { ...input, files: buildOracle(scenario, tempDir()) });
      assert.deepEqual(grades.filter((g) => !g.pass), []);
    });

    it(`${scenario.id}: an empty run fails every check that needs a document`, () => {
      const grades = gradeCode(checks, { ...input, files: [] });
      for (const g of grades) {
        if (scenario.expected.find((e) => e.id === g.behavior && e.kind === "code" && e.check === "noDocxBeforeTurn")) continue;
        assert.equal(g.pass, false, `${g.behavior}: ${g.detail}`);
      }
    });
  }
});

describe("checks catch a wrong document", () => {
  it("scenario 01's checks fail on scenario 06's (Ironbark) oracle", () => {
    const s06 = scenarios.find((s) => s.id === "06-rfp-injection");
    const s01 = scenarios.find((s) => s.id === "01-complete-brief");
    assert.ok(s01 && s06);
    const grades = gradeCode(codeChecks(s01.id), {
      files: buildOracle(s06, tempDir()),
      expected: expectedTotals(s01),
      packDir: packDirFor(s01.pack),
    });
    const failed = grades.filter((g) => !g.pass).map((g) => g.behavior);
    assert.deepEqual(failed.sort(), ["all-sections", "brand-color", "names-present", "totals-exact"]);
  });

  it("a document returned before the scripted answer fails scenario 02's timing check", () => {
    const s02 = scenarios.find((s) => s.id === "02-missing-inputs");
    assert.ok(s02);
    const files = buildOracle(s02, tempDir()).map((f) => ({ ...f, turn: 1 }));
    const grade = gradeCode(codeChecks(s02.id), { files, expected: expectedTotals(s02), packDir: packDirFor(s02.pack) }).find(
      (g) => g.behavior === "no-docx-before-answer",
    );
    assert.equal(grade?.pass, false);
  });

  it("scenario 07's checks fail when the unapproved client is named", () => {
    const s07 = scenarios.find((s) => s.id === "07-unapproved-case-study");
    assert.ok(s07);
    const named = { ...s07, oracle: { ...s07.oracle, notIncluded: ["A case study about Harlow & Finch Accountants: there's no approved story."] } };
    const grade = gradeCode(codeChecks(s07.id), { files: buildOracle(named, tempDir()), expected: expectedTotals(s07), packDir: packDirFor(s07.pack) }).find(
      (g) => g.behavior === "requested-client-absent",
    );
    assert.equal(grade?.pass, false);
  });
});

describe("plainAmount", () => {
  it("groups thousands and keeps minor units", () => {
    assert.equal(plainAmount(9500720, 2), "95,007.20");
    assert.equal(plainAmount(78000, 2), "780.00");
    assert.equal(plainAmount(13500, 0), "13,500");
  });
});

describe("RESULTS.md", () => {
  it("is recomputed from raw rows: marks, pass counts, and each case's cost counted once", () => {
    const runs = tempDir();
    const run = join(runs, "2026-11-20T00-00-00-000Z");
    mkdirSync(run);
    writeFileSync(
      join(run, "config.json"),
      JSON.stringify({
        runId: "r1", startedAt: "2026-11-20T00:00:00Z", commit: "abc1234", skillVersion: "0.1.0", zips: { "lumen-ridge-it": "f".repeat(64) },
        models: ["claude-haiku-5-5"], conditions: ["skill", "baseline"], effort: "high", judge: "claude-opus-5-5", budgetUsd: 5, sdkVersion: "1.3.0",
      }),
    );
    const row = (behavior: string, condition: string, pass: boolean | null, caseCostUsd: number, extra: object = {}) =>
      JSON.stringify({
        behavior, kind: "code", pass, detail: "", runId: "r1", scenario: "01-complete-brief", model: "claude-haiku-5-5",
        servedModel: "claude-haiku-5-5", condition, status: "ok", caseCostUsd, durationMs: 1, userTurns: 1, unneededQuestions: 0, ...extra,
      });
    writeFileSync(
      join(run, "results.jsonl"),
      [
        row("docx-produced", "skill", true, 0.04),
        row("totals-exact", "skill", true, 0.04),
        row("docx-produced", "baseline", true, 0.03),
        row("totals-exact", "baseline", false, 0.03),
        row("delivery-note", "baseline", null, 0.03, { kind: "model", judgeCostUsd: 0.02 }),
      ].join("\n"),
    );
    writeFileSync(join(run, "errors.jsonl"), JSON.stringify({ scenario: "02-missing-inputs", model: "claude-haiku-5-5", condition: "skill", kind: "timeout", message: "Case exceeded 15 minutes." }));
    const md = readFileSync(writeResults(runs, join(runs, "RESULTS.md")), "utf8");
    assert.match(md, /\| 01-complete-brief\/totals-exact \| ✅ \| ❌ \|/);
    assert.match(md, /\| 01-complete-brief\/delivery-note \| – \| ⚠ \|/);
    assert.match(md, /\| \*\*Passed\*\* \| 2\/2 \| 1\/2 \|/);
    assert.match(md, /\| Haiku skill \| 1 \| \$0\.04 \|/);
    assert.match(md, /\| Haiku baseline \| 1 \| \$0\.03 \|/);
    assert.match(md, /\| Judge \| 1 calls \| \$0\.02 \|/);
    assert.match(md, /Infrastructure errors \(1\), not scored[\s\S]*02-missing-inputs · Haiku skill: timeout/);
  });
});

describe("renderTranscript (what the judge sees)", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Proposal for Acme, please." }, { type: "container_upload", file_id: "file_1" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private reasoning", signature: "sig" },
        { type: "text", text: "What term and start date?" },
      ],
    },
    { role: "user", content: "24 months from January." },
    {
      role: "assistant",
      content: [
        { type: "server_tool_use", id: "t1", name: "bash_code_execution", input: { command: "node price.cjs quote.json" } },
        { type: "bash_code_execution_tool_result", tool_use_id: "t1", content: { type: "bash_code_execution_result", return_code: 0, stdout: '{"ok": true}', stderr: "", content: [] } },
        { type: "text", text: "Here's the proposal." },
      ],
    },
  ] as unknown as Anthropic.MessageParam[];

  it("shows both sides and one line per tool call, but never thinking", () => {
    const text = renderTranscript(messages);
    assert.match(text, /^SALESPERSON: Proposal for Acme, please\.\n\[1 file\(s\) attached\]/);
    assert.match(text, /\[assistant ran bash_code_execution: \{"command":"node price\.cjs quote\.json"\}\]/);
    assert.match(text, /\[result: exit 0; \{"ok": true\}\]/);
    assert.doesNotMatch(text, /private reasoning/);
  });

  it("stops after the reply to the given turn", () => {
    const first = renderTranscript(messages, 1);
    assert.match(first, /What term and start date\?$/);
    assert.doesNotMatch(first, /24 months/);
  });
});
