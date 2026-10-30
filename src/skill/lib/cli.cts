// Compiled from src/skill/lib/cli.cts. Edit the source, then run npm run build.
// The contract every script shares (docs/design.md §7): one JSON document on stdout, problems as
// {code, path, message, hint}, and fixed exit codes. Only internal errors print a stack, to stderr.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Problem } from "./types.cjs";

export const EXIT = {
  ok: 0,
  /** The input has problems Claude can fix. */
  input: 1,
  /** The command line itself is wrong. */
  usage: 2,
  /** A bug in the script. */
  internal: 3,
} as const;

export class ScriptError extends Error {
  readonly problems: Problem[];
  readonly exitCode: number;

  constructor(problems: Problem[], exitCode: number = EXIT.input) {
    super(problems.map((p) => p.message).join("; "));
    this.problems = problems;
    this.exitCode = exitCode;
  }
}

/** Collects problems so one run reports all of them, instead of stopping at the first. */
export class Problems {
  readonly list: Problem[] = [];

  add(code: string, path: string, message: string, hint?: string): void {
    this.list.push(hint === undefined ? { code, path, message } : { code, path, message, hint });
  }

  get size(): number {
    return this.list.length;
  }

  throwIfAny(): void {
    if (this.list.length > 0) throw new ScriptError(this.list);
  }

  /** For checks that can't continue, e.g. the file isn't a JSON object at all. */
  throwNow(): never {
    throw new ScriptError(this.list);
  }
}

export function usageError(usage: string, message: string): ScriptError {
  return new ScriptError([{ code: "E_USAGE", path: "argv", message, hint: `Usage: ${usage}` }], EXIT.usage);
}

export interface CommandLine {
  positionals: string[];
  strings: Record<string, string | undefined>;
  flags: Record<string, boolean>;
}

/** Parses argv strictly: unknown options and a wrong number of positionals are usage errors. */
export function parseCommandLine(
  argv: string[],
  usage: string,
  positionals: { min: number; max: number },
  options: { strings?: string[]; flags?: string[] } = {},
): CommandLine {
  const spec: Record<string, { type: "string" | "boolean" }> = {};
  for (const name of options.strings ?? []) spec[name] = { type: "string" };
  for (const name of options.flags ?? []) spec[name] = { type: "boolean" };

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv, options: spec, allowPositionals: true, strict: true });
  } catch (e) {
    throw usageError(usage, e instanceof Error ? e.message : String(e));
  }
  const count = parsed.positionals.length;
  if (count < positionals.min || count > positionals.max) {
    const expected = positionals.min === positionals.max ? `${positionals.min}` : `${positionals.min}–${positionals.max}`;
    throw usageError(usage, `Expected ${expected} file argument(s), got ${count}.`);
  }

  const strings: Record<string, string | undefined> = {};
  const flags: Record<string, boolean> = {};
  for (const name of options.strings ?? []) {
    const v = parsed.values[name];
    strings[name] = typeof v === "string" ? v : undefined;
  }
  for (const name of options.flags ?? []) flags[name] = parsed.values[name] === true;
  return { positionals: parsed.positionals, strings, flags };
}

/** Runs a script's main function and turns its result or error into the JSON envelope. */
export function runScript(main: (argv: string[]) => object | Promise<object>): void {
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .then(
      (result) => {
        print({ ok: true, ...result });
        process.exitCode = EXIT.ok;
      },
      (err: unknown) => {
        if (err instanceof ScriptError) {
          print({ ok: false, errors: err.problems });
          process.exitCode = err.exitCode;
          return;
        }
        process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
        print({
          ok: false,
          errors: [
            {
              code: "E_INTERNAL",
              path: "",
              message: err instanceof Error ? err.message : String(err),
              hint: "This is a bug in the skill's script, not in your input. Tell the user, and include the input files.",
            },
          ],
        });
        process.exitCode = EXIT.internal;
      },
    );
}

function print(value: unknown): void {
  process.stdout.write(toJsonText(value));
}

/** The one way scripts serialize JSON, so the same value always gives the same bytes and hash. */
export function toJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function readTextFile(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    const reason = (e as NodeJS.ErrnoException).code ?? String(e);
    throw new ScriptError([
      { code: "E_FILE", path: file, message: `Cannot read ${file} (${reason}).`, hint: "Check the path. Write the file first if it doesn't exist yet." },
    ]);
  }
}

export function readJsonFile(file: string): unknown {
  const text = readTextFile(file);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ScriptError([
      {
        code: "E_JSON",
        path: file,
        message: `${file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        hint: "Fix the JSON syntax (quotes, commas, brackets) and run again.",
      },
    ]);
  }
}

export function writeOutputFile(file: string, data: string | Uint8Array): void {
  try {
    writeFileSync(file, data);
  } catch (e) {
    const reason = (e as NodeJS.ErrnoException).code ?? String(e);
    throw new ScriptError([
      { code: "E_WRITE", path: file, message: `Cannot write ${file} (${reason}).`, hint: "Write to a folder you created in the working directory." },
    ]);
  }
}
