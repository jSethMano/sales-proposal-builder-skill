// Packages the skill zips (design §11):
//   npm run package                      → dist/neutral/sales-proposal-builder.zip
//   npm run package -- --pack <name>     → dist/<name>/sales-proposal-builder.zip, from packs/<name>
//   npm run package -- --all             → the neutral zip and one per pack in packs/
// Compiles the scripts first, so a zip never ships stale code.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PackageError, packageSkill, ROOT } from "./lib/package.ts";

const { values } = parseArgs({ options: { pack: { type: "string", multiple: true }, all: { type: "boolean", default: false } } });

execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(ROOT, "tsconfig.skill.json")], { stdio: "inherit" });

const packs = values.all ? readdirSync(join(ROOT, "packs")).sort() : (values.pack ?? []);
const targets: (string | null)[] = values.all || packs.length === 0 ? [null, ...packs] : packs;

try {
  const results = targets.map((pack) => {
    const r = pack === null ? packageSkill() : packageSkill({ packDir: join(ROOT, "packs", pack) });
    return { name: r.name, packId: r.packId, version: r.version, path: r.path, sha256: r.sha256, bytes: r.bytes };
  });
  console.log(JSON.stringify({ ok: true, zips: results }, null, 2));
} catch (e) {
  if (!(e instanceof PackageError)) throw e;
  console.log(JSON.stringify({ ok: false, problems: e.problems }, null, 2));
  process.exitCode = 1;
}
