"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Compiled from src/skill/init-pack.cts. Edit the source, then run npm run build.
//
//   node init-pack.cjs <out-dir> --name <company> --primary <#hex>
//        [--signatory-name <name> --signatory-title <title>] [--accent <#hex>] [--logo <file>]
//        [--currency <ISO>] [--locale <tag>] [--legal-name <name>] [--from <pack-dir>] [--force]
//
// Writes a pack for a brand given in chat (FR-1, design X12). It starts from the skill's own pack
// (or --from) and replaces the brand; the catalog, pricing, case studies and terms carry over.
// It refuses to write anywhere inside the skill folder, so a chat brand never changes the skill.
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const cli_cjs_1 = require("./lib/cli.cjs");
const image_cjs_1 = require("./lib/image.cjs");
const money_cjs_1 = require("./lib/money.cjs");
const pack_cjs_1 = require("./lib/pack.cjs");
const USAGE = "node init-pack.cjs <out-dir> --name <company> --primary <#hex> [--signatory-name <name> --signatory-title <title>] " +
    "[--accent <#hex>] [--logo <file>] [--currency <ISO>] [--locale <tag>] [--legal-name <name>] [--from <pack-dir>] [--force]";
const HEX = /^#[0-9A-Fa-f]{6}$/;
const PACK_FILES = ["brand.json", "catalog.json", "pricing.json", "case-studies.md", "terms.md", "logo.png", "logo.jpg"];
// Pack ids end up in file names and test output; 40 characters keeps them readable.
const MAX_SLUG_LENGTH = 40;
(0, cli_cjs_1.runScript)((argv) => {
    const cmd = (0, cli_cjs_1.parseCommandLine)(argv, USAGE, { min: 1, max: 1 }, {
        strings: ["name", "primary", "accent", "logo", "currency", "locale", "legal-name", "signatory-name", "signatory-title", "from"],
        flags: ["force"],
    });
    const s = cmd.strings;
    const outDir = (0, node_path_1.resolve)(cmd.positionals[0]);
    const skillDir = (0, node_path_1.resolve)(__dirname, "..");
    if (isInside(outDir, skillDir)) {
        throw new cli_cjs_1.ScriptError([
            {
                code: "E_INIT_PATH",
                path: outDir,
                message: "A brand given in chat must not be written into the skill folder.",
                hint: "Use a folder in the working directory, e.g. ./proposal-work/pack.",
            },
        ]);
    }
    if (!s.name || !s.primary)
        throw (0, cli_cjs_1.usageError)(USAGE, "--name and --primary are required.");
    const base = (0, pack_cjs_1.loadPack)(s.from ?? (0, pack_cjs_1.defaultPackDir)(__dirname));
    const problems = new cli_cjs_1.Problems();
    if (!HEX.test(s.primary))
        problems.add("E_INIT_COLOR", "--primary", `'${s.primary}' is not a 6-digit hex color.`, "Use a value like \"#0055AA\".");
    if (s.accent !== undefined && !HEX.test(s.accent)) {
        problems.add("E_INIT_COLOR", "--accent", `'${s.accent}' is not a 6-digit hex color.`, "Use a value like \"#AA5500\".");
    }
    const neutralSignatory = pack_cjs_1.NEUTRAL_PLACEHOLDERS.includes(base.brand.signatory.name) || pack_cjs_1.NEUTRAL_PLACEHOLDERS.includes(base.brand.signatory.title);
    if (neutralSignatory && (!s["signatory-name"] || !s["signatory-title"])) {
        problems.add("E_INIT_SIGNATORY", "--signatory-name", "This pack has no signatory, so the proposal needs one.", "Ask whose name and title go on the signature block, then pass --signatory-name and --signatory-title.");
    }
    let currency = base.pricing.currency;
    if (base.pricing.currency === null) {
        if (!s.currency) {
            problems.add("E_INIT_CURRENCY", "--currency", "This pack has no currency.", "Ask which currency to quote in and pass --currency, e.g. USD.");
        }
        else if (!(0, money_cjs_1.isCurrencyCode)(s.currency)) {
            problems.add("E_INIT_CURRENCY", "--currency", `'${s.currency}' is not an ISO 4217 currency code.`, "Use a code like USD, AUD or EUR.");
        }
        else {
            currency = s.currency;
        }
    }
    else if (s.currency !== undefined && s.currency !== base.pricing.currency) {
        problems.add("E_INIT_CURRENCY", "--currency", `This pack's catalog is priced in ${base.pricing.currency}; it can't be re-quoted in ${s.currency}.`, "Leave --currency out.");
    }
    let logoData = null;
    let logoName = null;
    if (s.logo !== undefined) {
        if (!(0, node_fs_1.existsSync)(s.logo)) {
            problems.add("E_PACK_LOGO", "--logo", `Logo file ${s.logo} doesn't exist.`, "Pass the path of the uploaded logo.");
        }
        else {
            logoData = (0, node_fs_1.readFileSync)(s.logo);
            const kind = (0, image_cjs_1.readImageHeader)(logoData).kind;
            if (kind === "png" || kind === "jpg")
                logoName = `logo.${kind}`;
            else
                problems.add("E_PACK_LOGO", "--logo", `The logo is ${kind === "unknown" ? "not a recognised image" : `a ${kind.toUpperCase()} file`}.`, "Convert the logo to PNG or JPEG.");
        }
    }
    const existing = PACK_FILES.filter((f) => (0, node_fs_1.existsSync)((0, node_path_1.join)(outDir, f)));
    if (existing.length > 0 && !cmd.flags.force) {
        problems.add("E_INIT_EXISTS", outDir, `${outDir} already holds a pack (${existing.join(", ")}).`, "Pass --force to replace it, or choose a new folder.");
    }
    problems.throwIfAny();
    const name = s.name.trim();
    const brand = {
        ...base.brand,
        packId: `chat-${slug(name)}`,
        configured: true,
        source: "chat",
        // Contact details belonged to the base company, so they don't carry over to a new name.
        company: { displayName: name, legalName: (s["legal-name"] ?? name).trim() },
        colors: { ...base.brand.colors, primary: s.primary.toUpperCase(), accent: (s.accent ?? s.primary).toUpperCase() },
        logo: logoName,
        locale: s.locale ?? base.brand.locale,
        signatory: s["signatory-name"] && s["signatory-title"]
            ? { name: s["signatory-name"].trim(), title: s["signatory-title"].trim() }
            : base.brand.signatory,
    };
    const pricing = {
        ...base.pricing,
        currency,
        minorUnits: currency === null ? null : (0, money_cjs_1.currencyMinorUnits)(currency),
    };
    (0, node_fs_1.mkdirSync)(outDir, { recursive: true });
    for (const f of existing)
        (0, node_fs_1.unlinkSync)((0, node_path_1.join)(outDir, f));
    (0, cli_cjs_1.writeOutputFile)((0, node_path_1.join)(outDir, "brand.json"), (0, cli_cjs_1.toJsonText)(brand));
    (0, cli_cjs_1.writeOutputFile)((0, node_path_1.join)(outDir, "catalog.json"), (0, cli_cjs_1.toJsonText)(base.catalog));
    (0, cli_cjs_1.writeOutputFile)((0, node_path_1.join)(outDir, "pricing.json"), (0, cli_cjs_1.toJsonText)(pricing));
    (0, node_fs_1.copyFileSync)((0, node_path_1.join)(base.dir, "case-studies.md"), (0, node_path_1.join)(outDir, "case-studies.md"));
    (0, node_fs_1.copyFileSync)((0, node_path_1.join)(base.dir, "terms.md"), (0, node_path_1.join)(outDir, "terms.md"));
    if (logoData && logoName)
        (0, cli_cjs_1.writeOutputFile)((0, node_path_1.join)(outDir, logoName), logoData);
    const pack = (0, pack_cjs_1.loadPack)(outDir);
    return {
        pack: pack.dir,
        packId: pack.brand.packId,
        logo: pack.logo ? `${pack.logo.file} (${pack.logo.width}×${pack.logo.height})` : null,
        currency: pack.pricing.currency,
        next: `Pass --pack ${pack.dir} to price.cjs, validate.cjs and build-docx.cjs.`,
        warnings: (0, pack_cjs_1.packWarnings)(pack),
    };
});
/** True when target is dir itself or anywhere under it, following symlinks on the part that exists. */
function isInside(target, dir) {
    const real = (p) => {
        let existing = p;
        const rest = [];
        while (!(0, node_fs_1.existsSync)(existing) && (0, node_path_1.dirname)(existing) !== existing) {
            rest.unshift((0, node_path_1.basename)(existing));
            existing = (0, node_path_1.dirname)(existing);
        }
        return (0, node_path_1.join)((0, node_fs_1.realpathSync)(existing), ...rest);
    };
    const rel = (0, node_path_1.relative)(real(dir), real(target));
    return rel === "" || (!rel.startsWith("..") && !(0, node_path_1.isAbsolute)(rel));
}
function slug(name) {
    const s = name
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+$/, "");
    return s === "" ? "company" : s;
}
