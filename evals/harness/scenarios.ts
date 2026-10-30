// Loads eval scenarios and works out what each one expects. Expected totals come from running the
// shipped price.cjs on the scenario's fixture quote. The fixtures stay on the harness side and are
// never uploaded, so the model under test can't see the answer key.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_DIR, ROOT } from "../../tools/lib/package.ts";
import { plainAmount } from "./checks.ts";
import type { ExpectedTotals, Scenario } from "./types.ts";

export const SCENARIO_DIR = join(ROOT, "evals/scenarios");
export const SCRIPTS = join(CORE_DIR, "scripts");

/** All scenarios, or those whose id starts with one of the given prefixes (e.g. "03"). */
export function loadScenarios(prefixes: string[] = []): Scenario[] {
  return readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(SCENARIO_DIR, f), "utf8")) as Scenario)
    .filter((s) => prefixes.length === 0 || prefixes.some((p) => s.id.startsWith(p)));
}

export function packDirFor(pack: string): string {
  return pack === "neutral" ? join(CORE_DIR, "company") : join(ROOT, "packs", pack);
}

/** Runs a shipped script and returns its JSON, throwing with the script's errors if it fails. */
export function runSkillScript(script: string, args: string[]): Record<string, unknown> {
  let out: string;
  try {
    out = execFileSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" });
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? String(e);
  }
  const json = JSON.parse(out) as Record<string, unknown>;
  if (json.ok !== true) throw new Error(`${script} failed: ${out}`);
  return json;
}

export function expectedTotals(scenario: Scenario): ExpectedTotals | null {
  if (!scenario.expectedQuote) return null;
  const { pricing } = runSkillScript("price.cjs", [join(ROOT, scenario.expectedQuote), "--pack", packDirFor(scenario.pack)]) as {
    pricing: { minorUnits: number; totals: { monthlyRecurringMinor: number; oneTimeMinor: number; termTotalMinor: number } };
  };
  const amount = (minor: number): string => plainAmount(minor, pricing.minorUnits);
  return {
    monthlyRecurring: amount(pricing.totals.monthlyRecurringMinor),
    oneTime: pricing.totals.oneTimeMinor > 0 ? amount(pricing.totals.oneTimeMinor) : null,
    termTotal: amount(pricing.totals.termTotalMinor),
  };
}
