// M0: zips the runtime-probe skill for upload.
//   dist/runtime-probe/runtime-probe.zip              frontmatter includes metadata.version
//   dist/runtime-probe/runtime-probe-no-metadata.zip  the same skill without it
// Upload the first one. If the upload rejects its frontmatter, upload the second; that tells us
// where packaging should stamp the version (design §11 step 4).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipFolder } from "../tools/lib/zip.ts";

const src = "spikes/runtime-probe";
const outDir = "dist/runtime-probe";

const withMeta = zipFolder(src, "runtime-probe", join(outDir, "runtime-probe.zip"));

const plain = mkdtempSync(join(tmpdir(), "runtime-probe-"));
try {
  cpSync(src, plain, { recursive: true });
  const skillMd = join(plain, "SKILL.md");
  writeFileSync(skillMd, readFileSync(skillMd, "utf8").replace(/^metadata:\n(?: {2}.*\n)+/m, ""));
  zipFolder(plain, "runtime-probe", join(outDir, "runtime-probe-no-metadata.zip"));
} finally {
  rmSync(plain, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, outDir, entries: withMeta }, null, 2));
