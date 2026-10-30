"use strict";
// M0 runtime probe (throwaway). Prints one JSON document describing the sandbox the skill runs in.
// Writes nothing except small test files in the first writable outputs folder and in the cwd.
// Makes no network calls.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

// 20 s is far more than any of these local commands needs; it only stops a hung tool from hanging the probe.
const COMMAND_TIMEOUT_MS = 20000;
// fc-list can return thousands of families on a desktop; a sandbox usually has a few dozen.
const MAX_FONT_FAMILIES = 400;

function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).split("\n")[0] };
  }
}

function sh(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  }).trim();
}

function which(bin) {
  const r = attempt(() => sh("sh", ["-c", `command -v ${bin}`]));
  return r.ok && r.value ? r.value : null;
}

function packageInfo(resolvedFile, name) {
  let dir = path.dirname(resolvedFile);
  while (dir !== path.dirname(dir)) {
    const file = path.join(dir, "package.json");
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      if (pkg.name === name) return { version: pkg.version, dir };
    }
    dir = path.dirname(dir);
  }
  return null;
}

function dirState(p) {
  if (!p) return null;
  const exists = fs.existsSync(p);
  const writable = exists && attempt(() => fs.accessSync(p, fs.constants.W_OK)).ok;
  return { path: p, exists, writable };
}

function listDir(p) {
  const r = attempt(() => fs.readdirSync(p).sort());
  return r.ok ? r.value : r.error;
}

async function main() {
  const skillDir = path.resolve(__dirname, "..");
  const cwd = process.cwd();

  // --- docx, resolved from the skill folder (how the real scripts will resolve it) and from the cwd
  const fromSkill = attempt(() => require.resolve("docx"));
  const fromCwd = attempt(() => require.resolve("docx", { paths: [cwd] }));
  const info = fromSkill.ok ? packageInfo(fromSkill.value, "docx") : null;
  const watermarks = attempt(() => require.resolve("docx/watermarks"));
  const exportsCheck = attempt(() => {
    const d = require("docx");
    return ["Document", "Packer", "ImageRun", "PageNumber", "Header", "Footer", "Table", "ShadingType"]
      .map((k) => `${k}:${typeof d[k]}`)
      .join(" ");
  });

  // --- fonts
  const fcList = attempt(() => sh("fc-list", [":", "family"]));
  const families = fcList.ok
    ? [...new Set(fcList.value.split("\n").flatMap((l) => l.split(",")).map((s) => s.trim()).filter(Boolean))].sort()
    : [];
  const wanted = /^(Arial|Times New Roman|Calibri|Cambria|Courier New|Georgia|Liberation .*|Carlito|Caladea|Gelasio|DejaVu .*|Noto Sans|Noto Serif)$/;

  // --- outputs folders (claude.ai is expected to use /mnt/user-data/outputs; the API container is unknown)
  const candidates = [
    "/mnt/user-data/outputs",
    "/mnt/outputs",
    "/outputs",
    path.join(cwd, "outputs"),
    process.env.OUTPUT_DIR || null,
    process.env.OUTPUTS_DIR || null,
  ].filter(Boolean);
  const outputs = candidates.map(dirState);
  const target = outputs.find((o) => o && o.exists && o.writable);

  // --- write test: a text file and a real .docx built with the preinstalled package
  const writes = [];
  const stamp = "runtime-probe";
  for (const dir of [target && target.path, cwd].filter(Boolean)) {
    const txt = path.join(dir, `${stamp}.txt`);
    writes.push({ file: txt, ...attempt(() => (fs.writeFileSync(txt, "M0 probe write test\n"), "written")) });
  }
  if (fromSkill.ok) {
    const out = path.join((target && target.path) || cwd, `${stamp}.docx`);
    try {
      const d = require("docx");
      const doc = new d.Document({
        sections: [{ children: [new d.Paragraph({ children: [new d.TextRun({ text: "M0 probe", bold: true })] })] }],
      });
      fs.writeFileSync(out, await d.Packer.toBuffer(doc));
      writes.push({ file: out, ok: true, value: `written ${fs.statSync(out).size} bytes` });
    } catch (e) {
      writes.push({ file: out, ok: false, error: String((e && e.message) || e).split("\n")[0] });
    }
  }

  const intl = attempt(() => ({
    enUS_USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(1234.5),
    enAU_AUD: new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(1234.5),
    jaJP_JPY: new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(1234),
    enGB_date: new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2027, 1, 1))),
  }));

  const result = {
    probe: "runtime-probe 0.0.1",
    node: {
      version: process.version,
      platform: `${process.platform}/${process.arch}`,
      icu: process.versions.icu || null,
      unicode: process.versions.unicode || null,
      fullIcuDetected: typeof Intl.DisplayNames === "function",
      intl: intl.ok ? intl.value : intl.error,
      typeStripping: process.features && "typescript" in process.features ? process.features.typescript : null,
    },
    docx: {
      resolvedFromSkillDir: fromSkill.ok ? fromSkill.value : fromSkill.error,
      resolvedFromCwd: fromCwd.ok ? fromCwd.value : fromCwd.error,
      version: info ? info.version : null,
      watermarksSubpath: watermarks.ok,
      exports: exportsCheck.ok ? exportsCheck.value : exportsCheck.error,
    },
    globalNpm: {
      root: (() => { const r = attempt(() => sh("npm", ["root", "-g"])); return r.ok ? r.value : r.error; })(),
      packages: (() => {
        const r = attempt(() => Object.entries(JSON.parse(sh("npm", ["ls", "-g", "--depth=0", "--json"])).dependencies || {}).map(([n, v]) => `${n}@${v.version}`));
        return r.ok ? r.value : r.error;
      })(),
      NODE_PATH: process.env.NODE_PATH || null,
    },
    fonts: {
      fcListAvailable: fcList.ok,
      familyCount: families.length,
      relevant: families.filter((f) => wanted.test(f)),
      all: families.slice(0, MAX_FONT_FAMILIES),
    },
    tools: Object.fromEntries(
      ["soffice", "libreoffice", "pdftoppm", "fc-list", "python3", "pip", "npm", "npx", "zip", "unzip"].map((b) => [b, which(b)]),
    ),
    paths: {
      cwd,
      home: os.homedir(),
      tmp: os.tmpdir(),
      skillDir,
      skillDirWritable: dirState(skillDir).writable,
      mnt: listDir("/mnt"),
      mntUserData: listDir("/mnt/user-data"),
      outputsCandidates: outputs,
    },
    writes,
    envVarNames: Object.keys(process.env).sort(),
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.log(JSON.stringify({ probe: "runtime-probe 0.0.1", fatal: String((e && e.stack) || e) }));
  process.exitCode = 1;
});
