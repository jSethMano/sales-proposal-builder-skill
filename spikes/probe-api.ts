// M0, API half: uploads the runtime-probe skill, runs it once in a code-execution container,
// downloads any files it created, and saves everything under spikes/out/.
//
//   npm run probe:zip && npm run probe:api -- [--model claude-opus-5-5] [--cleanup]
//
// Needs ANTHROPIC_API_KEY. Custom skills are visible to every key in the workspace, so use the
// workspace you intend to run evals in. Cost: one short request (well under US$1).
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

// pause_turn means the server-side tool loop hit its iteration limit; the probe needs one or two
// commands, so a handful of continuations is plenty and still bounds a runaway turn.
const MAX_CONTINUATIONS = 5;
// The probe's JSON is a few thousand tokens; the reply repeats it once.
const MAX_TOKENS = 16000;

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "claude-opus-5-5" },
    zip: { type: "string", default: "dist/runtime-probe/runtime-probe.zip" },
    cleanup: { type: "boolean", default: false },
  },
});
const model = values.model;
const outDir = "spikes/out";
mkdirSync(join(outDir, "files"), { recursive: true });

const client = new Anthropic();

const skill = await client.skills.create({
  files: [await toFile(createReadStream(values.zip), basename(values.zip))],
  display_name: "runtime-probe (M0, throwaway)",
});
console.error(`Uploaded skill ${skill.id} version ${skill.latest_version_id}`);

const container = (id?: string): Anthropic.Messages.ContainerParams => ({
  ...(id ? { id } : {}),
  skills: [{ type: "custom", skill_id: skill.id, version: skill.latest_version_id }],
});
const tools: Anthropic.Messages.ToolUnion[] = [{ type: "code_execution_20260521", name: "code_execution" }];
const messages: Anthropic.Messages.MessageParam[] = [
  { role: "user", content: "Run the runtime probe and reply exactly as its instructions say." },
];

let response = await client.messages.create({ model, max_tokens: MAX_TOKENS, container: container(), tools, messages });
for (let i = 0; i < MAX_CONTINUATIONS && response.stop_reason === "pause_turn"; i++) {
  messages.push({ role: "assistant", content: response.content });
  response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    container: container(response.container?.id),
    tools,
    messages,
  });
}

// Collect what the probe printed and any files the container handed back.
const stdouts: string[] = [];
const files: { id: string; name: string; bytes: number }[] = [];
for (const block of response.content) {
  if (block.type !== "bash_code_execution_tool_result") continue;
  if (block.content.type !== "bash_code_execution_result") continue;
  stdouts.push(block.content.stdout);
  for (const out of block.content.content) {
    const meta = await client.files.retrieveMetadata(out.file_id);
    const data = Buffer.from(await (await client.files.download(out.file_id)).arrayBuffer());
    writeFileSync(join(outDir, "files", basename(meta.filename)), data);
    files.push({ id: out.file_id, name: meta.filename, bytes: data.length });
  }
}

const probeJson = (() => {
  for (const s of stdouts) {
    const start = s.indexOf("{");
    if (start < 0) continue;
    try {
      return JSON.parse(s.slice(start));
    } catch {
      // not the probe's output; keep looking
    }
  }
  return null;
})();

const record = {
  ranAt: new Date().toISOString(),
  requestedModel: model,
  servedModel: response.model,
  stopReason: response.stop_reason,
  container: response.container,
  usage: response.usage,
  skill: { id: skill.id, version: skill.latest_version_id },
  filesReturned: files,
  probe: probeJson,
  finalText: response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"),
};
writeFileSync(join(outDir, "api-probe.json"), JSON.stringify(record, null, 2));
writeFileSync(join(outDir, "api-transcript.json"), JSON.stringify({ messages, final: response }, null, 2));

if (values.cleanup) {
  await client.skills.versions.delete(skill.latest_version_id, { skill_id: skill.id });
  await client.skills.delete(skill.id);
  console.error(`Deleted skill ${skill.id}`);
}

console.log(
  JSON.stringify(
    { ok: probeJson !== null, servedModel: response.model, stopReason: response.stop_reason, filesReturned: files, saved: join(outDir, "api-probe.json") },
    null,
    2,
  ),
);
