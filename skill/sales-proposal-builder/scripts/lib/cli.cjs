"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Problems = exports.ScriptError = exports.EXIT = void 0;
exports.usageError = usageError;
exports.parseCommandLine = parseCommandLine;
exports.runScript = runScript;
exports.toJsonText = toJsonText;
exports.sha256 = sha256;
exports.readTextFile = readTextFile;
exports.readJsonFile = readJsonFile;
exports.writeOutputFile = writeOutputFile;
// Compiled from src/skill/lib/cli.cts. Edit the source, then run npm run build.
// The contract every script shares (docs/design.md §7): one JSON document on stdout, problems as
// {code, path, message, hint}, and fixed exit codes. Only internal errors print a stack, to stderr.
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_util_1 = require("node:util");
exports.EXIT = {
    ok: 0,
    /** The input has problems Claude can fix. */
    input: 1,
    /** The command line itself is wrong. */
    usage: 2,
    /** A bug in the script. */
    internal: 3,
};
class ScriptError extends Error {
    problems;
    exitCode;
    constructor(problems, exitCode = exports.EXIT.input) {
        super(problems.map((p) => p.message).join("; "));
        this.problems = problems;
        this.exitCode = exitCode;
    }
}
exports.ScriptError = ScriptError;
/** Collects problems so one run reports all of them, instead of stopping at the first. */
class Problems {
    list = [];
    add(code, path, message, hint) {
        this.list.push(hint === undefined ? { code, path, message } : { code, path, message, hint });
    }
    get size() {
        return this.list.length;
    }
    throwIfAny() {
        if (this.list.length > 0)
            throw new ScriptError(this.list);
    }
    /** For checks that can't continue, e.g. the file isn't a JSON object at all. */
    throwNow() {
        throw new ScriptError(this.list);
    }
}
exports.Problems = Problems;
function usageError(usage, message) {
    return new ScriptError([{ code: "E_USAGE", path: "argv", message, hint: `Usage: ${usage}` }], exports.EXIT.usage);
}
/** Parses argv strictly: unknown options and a wrong number of positionals are usage errors. */
function parseCommandLine(argv, usage, positionals, options = {}) {
    const spec = {};
    for (const name of options.strings ?? [])
        spec[name] = { type: "string" };
    for (const name of options.flags ?? [])
        spec[name] = { type: "boolean" };
    let parsed;
    try {
        parsed = (0, node_util_1.parseArgs)({ args: argv, options: spec, allowPositionals: true, strict: true });
    }
    catch (e) {
        throw usageError(usage, e instanceof Error ? e.message : String(e));
    }
    const count = parsed.positionals.length;
    if (count < positionals.min || count > positionals.max) {
        const expected = positionals.min === positionals.max ? `${positionals.min}` : `${positionals.min}–${positionals.max}`;
        throw usageError(usage, `Expected ${expected} file argument(s), got ${count}.`);
    }
    const strings = {};
    const flags = {};
    for (const name of options.strings ?? []) {
        const v = parsed.values[name];
        strings[name] = typeof v === "string" ? v : undefined;
    }
    for (const name of options.flags ?? [])
        flags[name] = parsed.values[name] === true;
    return { positionals: parsed.positionals, strings, flags };
}
/** Runs a script's main function and turns its result or error into the JSON envelope. */
function runScript(main) {
    Promise.resolve()
        .then(() => main(process.argv.slice(2)))
        .then((result) => {
        print({ ok: true, ...result });
        process.exitCode = exports.EXIT.ok;
    }, (err) => {
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
        process.exitCode = exports.EXIT.internal;
    });
}
function print(value) {
    process.stdout.write(toJsonText(value));
}
/** The one way scripts serialize JSON, so the same value always gives the same bytes and hash. */
function toJsonText(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}
function sha256(data) {
    return (0, node_crypto_1.createHash)("sha256").update(data).digest("hex");
}
function readTextFile(file) {
    try {
        return (0, node_fs_1.readFileSync)(file, "utf8");
    }
    catch (e) {
        const reason = e.code ?? String(e);
        throw new ScriptError([
            { code: "E_FILE", path: file, message: `Cannot read ${file} (${reason}).`, hint: "Check the path. Write the file first if it doesn't exist yet." },
        ]);
    }
}
function readJsonFile(file) {
    const text = readTextFile(file);
    try {
        return JSON.parse(text);
    }
    catch (e) {
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
function writeOutputFile(file, data) {
    try {
        (0, node_fs_1.writeFileSync)(file, data);
    }
    catch (e) {
        const reason = e.code ?? String(e);
        throw new ScriptError([
            { code: "E_WRITE", path: file, message: `Cannot write ${file} (${reason}).`, hint: "Write to a folder you created in the working directory." },
        ]);
    }
}
