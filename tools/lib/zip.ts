// Builds a skill zip with the skill folder at the zip root, as claude.ai and /v1/skills expect:
// <name>.zip → <name>/SKILL.md, <name>/scripts/…
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { zipSync, type Zippable } from "fflate";

// Every entry gets this timestamp so the same input always produces byte-identical zips.
// ZIP stores DOS dates in local time, so the constant is built in local time too: a UTC instant
// would encode differently on machines in different timezones. DOS dates start in 1980.
const FIXED_MTIME = new Date(2026, 0, 1, 0, 0, 0);

/** Lists files under dir, depth first, sorted, skipping dotfiles and dot-folders. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Zips srcDir so that every entry sits under rootName/.
 * Returns the sorted list of entry paths written.
 */
export function zipFolder(srcDir: string, rootName: string, outFile: string): string[] {
  const entries: Zippable = {};
  const names: string[] = [];
  for (const file of listFiles(srcDir)) {
    const entry = `${rootName}/${relative(srcDir, file).split(sep).join("/")}`;
    entries[entry] = [readFileSync(file), { mtime: FIXED_MTIME }];
    names.push(entry);
  }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, zipSync(entries, { level: 9 }));
  return names;
}
