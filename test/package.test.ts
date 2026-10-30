// tools/lib/package.ts: the zips that get uploaded (design §11, FR-18, FR-19), and the third part
// of the leakage tests: each zip carries only its own pack.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { PackageError, packageSkill, ROOT } from "../tools/lib/package.ts";
import { DEMO_PACKS, identifyingStrings, readJson, SKILL_DIR, tempDir, writeJson } from "./helpers.ts";

const unzip = (path: string): Record<string, Uint8Array> => unzipSync(new Uint8Array(readFileSync(path)));
const textOf = (files: Record<string, Uint8Array>): string =>
  Object.entries(files)
    .filter(([name]) => !name.endsWith(".png"))
    .map(([, data]) => strFromU8(data))
    .join("\n")
    .toLowerCase();

const zips = {
  neutral: packageSkill({ outDir: join(tempDir(), "neutral") }),
  lumen: packageSkill({ packDir: DEMO_PACKS.lumen, outDir: join(tempDir(), "lumen") }),
  ironbark: packageSkill({ packDir: DEMO_PACKS.ironbark, outDir: join(tempDir(), "ironbark") }),
};

describe("zip layout", () => {
  for (const [name, zip] of Object.entries(zips)) {
    it(`${name}: the skill folder is the zip's only root, with its own pack in company/`, () => {
      const files = unzip(zip.path);
      const roots = new Set(Object.keys(files).map((f) => f.split("/")[0]));
      assert.deepEqual([...roots], ["sales-proposal-builder"]);
      for (const needed of ["SKILL.md", "scripts/price.cjs", "scripts/build-docx.cjs", "references/quoting.md", "company/brand.json"]) {
        assert.ok(files[`sales-proposal-builder/${needed}`], needed);
      }
      const brand = JSON.parse(strFromU8(files["sales-proposal-builder/company/brand.json"] as Uint8Array)) as { packId: string };
      assert.equal(brand.packId, zip.packId);
      assert.deepEqual(Object.keys(files).filter((f) => /\.(ts|cts|map)$|\/\.|\/(src|test)\//.test(f)), []);
    });
  }

  it("is byte-identical when built twice", () => {
    const again = packageSkill({ packDir: DEMO_PACKS.lumen, outDir: join(tempDir(), "again") });
    assert.equal(again.sha256, zips.lumen.sha256);
  });
});

describe("each zip carries only its own pack", () => {
  const strings = { lumen: identifyingStrings(DEMO_PACKS.lumen), ironbark: identifyingStrings(DEMO_PACKS.ironbark) };
  const absent = (text: string, needles: string[]) => needles.filter((n) => text.includes(n.toLowerCase()));

  it("Lumen's zip has nothing from Ironbark, and Ironbark's nothing from Lumen", () => {
    assert.deepEqual(absent(textOf(unzip(zips.lumen.path)), strings.ironbark), []);
    assert.deepEqual(absent(textOf(unzip(zips.ironbark.path)), strings.lumen), []);
  });

  it("the neutral zip has nothing from either", () => {
    assert.deepEqual(absent(textOf(unzip(zips.neutral.path)), [...strings.lumen, ...strings.ironbark]), []);
  });
});

describe("an unzipped package works on its own", () => {
  it("prices, validates and builds with only Node and the docx package", () => {
    const dir = tempDir();
    for (const [name, data] of Object.entries(unzip(zips.lumen.path))) {
      const target = join(dir, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
    const skill = join(dir, "sales-proposal-builder");
    // Like the sandbox: docx comes from a global location, not from a node_modules next to the skill.
    const env = { ...process.env, NODE_PATH: join(ROOT, "node_modules") };
    const node = (script: string, args: string[]) => {
      const r = spawnSync(process.execPath, [join(skill, "scripts", script), ...args], { encoding: "utf8", cwd: dir, env });
      return { code: r.status, json: JSON.parse(r.stdout) as Record<string, unknown> };
    };
    const fixture = join(ROOT, "test/fixtures/proposals/acme-lumen");
    assert.equal(node("check-pack.cjs", []).json.packId, "lumen-ridge-it");
    const priced = node("price.cjs", [join(fixture, "quote.json"), "--out", join(dir, "pricing.json")]);
    assert.equal(priced.code, 0, JSON.stringify(priced.json));
    const proposal = readJson<Record<string, unknown>>(join(fixture, "proposal.json"));
    proposal.pricingRef = priced.json.pricingRef;
    const proposalFile = writeJson(dir, "proposal.json", proposal);
    assert.equal(node("validate.cjs", [proposalFile, join(dir, "pricing.json")]).code, 0);
    const built = node("build-docx.cjs", [proposalFile, join(dir, "pricing.json"), join(dir, "out.docx")]);
    assert.equal(built.code, 0, JSON.stringify(built.json));
  });
});

describe("packaging refuses a skill that breaks the rules", () => {
  /** A copy of the core with one file changed, packaged with the neutral pack. */
  const broken = (edit: (core: string) => void): string[] => {
    const core = join(tempDir(), "core");
    cpSync(SKILL_DIR, core, { recursive: true });
    edit(core);
    try {
      packageSkill({ coreDir: core, outDir: join(tempDir(), "out") });
      return [];
    } catch (e) {
      if (!(e instanceof PackageError)) throw e;
      return e.problems;
    }
  };
  const editSkillMd = (fn: (s: string) => string) => (core: string) =>
    writeFileSync(join(core, "SKILL.md"), fn(readFileSync(join(core, "SKILL.md"), "utf8")));

  it("a description over 200 characters", () => {
    const problems = broken(editSkillMd((s) => s.replace(/^description: (.+)$/m, (_, d: string) => `description: ${d} ${"x".repeat(60)}`)));
    assert.match(problems.join("\n"), /description is \d+ characters; the limit is 200/);
  });

  it("a name that doesn't match the folder, or uses a reserved word", () => {
    assert.match(broken(editSkillMd((s) => s.replace("name: sales-proposal-builder", "name: claude-proposals"))).join("\n"), /must equal the folder name[\s\S]*can't contain 'anthropic' or 'claude'/);
  });

  it("a version that doesn't match package.json", () => {
    assert.match(broken(editSkillMd((s) => s.replace(/Skill version [\d.]+\./, "Skill version 9.9.9."))).join("\n"), /must end with "Skill version/);
  });

  it("a reference SKILL.md doesn't link, or a long one with no contents", () => {
    const problems = broken((core) => writeFileSync(join(core, "references/extra.md"), `# Extra\n${"line\n".repeat(120)}`));
    assert.match(problems.join("\n"), /references\/extra\.md isn't linked from SKILL\.md[\s\S]*"## Contents"/);
  });

  it("TypeScript source in the shipped folder", () => {
    assert.match(broken((core) => writeFileSync(join(core, "scripts/oops.cts"), "")).join("\n"), /oops\.cts is source/);
  });

  it("an invalid pack", () => {
    const pack = join(tempDir(), "pack");
    cpSync(DEMO_PACKS.lumen, pack, { recursive: true });
    writeFileSync(join(pack, "terms.md"), "");
    assert.throws(() => packageSkill({ packDir: pack, outDir: join(tempDir(), "out") }), (e: unknown) => e instanceof PackageError && /terms\.md is empty/.test(e.problems.join("\n")));
  });
});
