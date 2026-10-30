// Test helpers. Tests run the shipped, compiled scripts through their command line, the same way
// Claude does (design X10), so what's tested is what ships.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PricingOutput, Problem } from "../src/skill/lib/types.cts";

export const ROOT = resolve(import.meta.dirname, "..");
export const SKILL_DIR = join(ROOT, "skill/sales-proposal-builder");
export const SCRIPTS = join(SKILL_DIR, "scripts");
export const NEUTRAL_PACK = join(SKILL_DIR, "company");
export const FIXTURE_PACK = join(ROOT, "test/fixtures/packs/test-usd");
export const DEMO_PACKS = {
  lumen: join(ROOT, "packs/lumen-ridge-it"),
  ironbark: join(ROOT, "packs/ironbark-msp"),
} as const;

export interface ScriptResult {
  code: number | null;
  json: { ok: boolean; errors?: Problem[]; warnings?: Problem[]; [key: string]: unknown };
  stdout: string;
  stderr: string;
}

export function run(script: string, args: string[], cwd: string = ROOT): ScriptResult {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8", cwd });
  let json: ScriptResult["json"];
  try {
    json = JSON.parse(r.stdout) as ScriptResult["json"];
  } catch {
    throw new Error(`${script} did not print JSON.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

/** Error codes from a failed run, in order. */
export function codes(result: ScriptResult): string[] {
  return (result.json.errors ?? []).map((e) => e.code);
}

export function error(result: ScriptResult, code: string): Problem {
  const found = (result.json.errors ?? []).find((e) => e.code === code);
  if (!found) throw new Error(`No ${code} in ${JSON.stringify(result.json, null, 2)}`);
  return found;
}

const temps: string[] = [];
process.on("exit", () => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spb-test-"));
  temps.push(dir);
  return dir;
}

export function writeJson(dir: string, name: string, value: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

type Json = Record<string, unknown>;

export interface PackEdits {
  brand?: (b: Json) => void;
  catalog?: (c: Json & { items: Json[] }) => void;
  pricing?: (p: Json) => void;
  /** Files to write (string or bytes) or delete (null). */
  files?: Record<string, string | Uint8Array | null>;
}

/** Copies a pack to a temp folder and applies edits, for tests that need a slightly different pack. */
export function editedPack(source: string, edits: PackEdits = {}): string {
  const dir = join(tempDir(), "pack");
  cpSync(source, dir, { recursive: true });
  const editJson = (name: string, edit?: (v: never) => void): void => {
    if (!edit) return;
    const value = readJson<Json>(join(dir, name));
    edit(value as never);
    writeJson(dir, name, value);
  };
  editJson("brand.json", edits.brand);
  editJson("catalog.json", edits.catalog);
  editJson("pricing.json", edits.pricing);
  for (const [name, content] of Object.entries(edits.files ?? {})) {
    if (content === null) rmSync(join(dir, name), { force: true });
    else writeFileSync(join(dir, name), content);
  }
  return dir;
}

export const BASE_QUOTE = {
  schemaVersion: 1,
  quoteDate: "2027-01-15",
  termMonths: 24,
  lines: [{ sku: "SUPPORT", quantity: 80 }],
};

/** Runs price.cjs on a quote (without --out) and returns the result. */
export function priceQuote(quote: unknown, pack: string = FIXTURE_PACK): ScriptResult {
  const file = writeJson(tempDir(), "quote.json", quote);
  return run("price.cjs", [file, "--pack", pack]);
}

/** Prices a quote that must succeed and returns the pricing output. */
export function pricing(quote: unknown, pack: string = FIXTURE_PACK): PricingOutput {
  const r = priceQuote(quote, pack);
  if (r.code !== 0) throw new Error(`price.cjs failed: ${JSON.stringify(r.json, null, 2)}`);
  return r.json.pricing as PricingOutput;
}
