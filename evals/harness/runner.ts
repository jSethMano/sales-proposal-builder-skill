// Runs one case (scenario × model × condition) in a fresh code-execution container (design §13).
// The container is reused only across the turns of this case. Every message is kept exactly as
// exchanged, and appended to, never edited, so thinking blocks stay valid across turns.
import { createReadStream, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { ROOT } from "../../tools/lib/package.ts";
import {
  BASELINE_NOTE,
  CASE_TIMEOUT_MS,
  DEFAULT_FALLBACK_REPLY,
  EFFORT,
  MAX_CONTINUATIONS,
  MAX_FALLBACK_REPLIES,
  MAX_TOKENS,
  UPLOAD_TTL_SECONDS,
} from "./config.ts";
import { addUsage, callCost, emptyUsage, usageOf } from "./cost.ts";
import type { PinnedSkill } from "./skills.ts";
import type { CaseRun, CaseStatus, Condition, OutputFile, Scenario } from "./types.ts";

/** A failure of the plumbing rather than the model: recorded in errors.jsonl, never scored. */
export class InfraError extends Error {
  readonly kind: "timeout" | "api" | "model-mismatch" | "harness";
  constructor(kind: InfraError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface CaseOptions {
  client: Anthropic;
  scenario: Scenario;
  model: string;
  condition: Condition;
  /** The pinned custom skill, for the skill condition. */
  skill?: PinnedSkill;
  packDir: string;
  /** Whether the pack is a configured company pack (the baseline then gets its files). */
  packConfigured: boolean;
  outDir: string;
}

const TOOLS: Anthropic.Messages.ToolUnion[] = [{ type: "code_execution_20260521", name: "code_execution" }];

export async function runCase(o: CaseOptions): Promise<CaseRun> {
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CASE_TIMEOUT_MS);
  const uploaded: string[] = [];
  mkdirSync(o.outDir, { recursive: true });
  try {
    return await converse(o, abort.signal, uploaded, started);
  } catch (e) {
    if (abort.signal.aborted) throw new InfraError("timeout", `Case exceeded ${CASE_TIMEOUT_MS / 60000} minutes.`);
    if (e instanceof InfraError) throw e;
    if (e instanceof Anthropic.APIError) throw new InfraError("api", `${e.status ?? "?"} ${e.message}`);
    throw e;
  } finally {
    clearTimeout(timer);
    // Best effort: uploads also expire on their own after UPLOAD_TTL_SECONDS.
    await Promise.allSettled(uploaded.map((id) => o.client.files.delete(id)));
  }
}

async function converse(o: CaseOptions, signal: AbortSignal, uploaded: string[], started: number): Promise<CaseRun> {
  const { client, scenario, model } = o;
  const skills: Anthropic.Messages.SkillParams[] =
    o.condition === "skill" && o.skill
      ? [{ type: "custom", skill_id: o.skill.skillId, version: o.skill.versionId }]
      : [{ type: "anthropic", skill_id: "docx", version: "latest" }];

  // Inputs: the scenario's files, and for the baseline, the company's own files (design X13).
  const inputs = scenario.files.map((f) => join(ROOT, f));
  if (o.condition === "baseline" && o.packConfigured) {
    inputs.push(...readdirSync(o.packDir).filter((f) => !f.startsWith(".")).map((f) => join(o.packDir, f)));
  }
  const uploads: Anthropic.Messages.ContainerUploadBlockParam[] = [];
  for (const path of inputs) {
    const file = await client.files.upload({ file: await toFile(createReadStream(path), basename(path)), expires_in_seconds: UPLOAD_TTL_SECONDS }, { signal });
    uploaded.push(file.id);
    uploads.push({ type: "container_upload", file_id: file.id });
  }
  const text = o.condition === "baseline" && o.packConfigured ? `${scenario.query}\n\n${BASELINE_NOTE}` : scenario.query;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: [{ type: "text", text }, ...uploads] }];

  let containerId: string | undefined;
  let usage = emptyUsage();
  let costUsd = 0;
  let servedModel = model;
  const files: OutputFile[] = [];
  let status: CaseStatus = "ok";
  let statusDetail = "";
  let userTurn = 1;
  let scripted = 0;
  let fallbacks = 0;

  const call = async (): Promise<Anthropic.Message> => {
    const response = await client.messages
      .stream(
        {
          model,
          max_tokens: MAX_TOKENS,
          container: { ...(containerId ? { id: containerId } : {}), skills },
          tools: TOOLS,
          output_config: { effort: EFFORT },
          messages,
        },
        { signal },
      )
      .finalMessage();
    // A score served by a different model measures nothing (eval-audit), so fail loudly.
    if (!response.model.startsWith(model)) throw new InfraError("model-mismatch", `Asked for ${model}, served by ${response.model}.`);
    servedModel = response.model;
    containerId = response.container?.id ?? containerId;
    const u = usageOf(response.usage);
    usage = addUsage(usage, u);
    costUsd += callCost(model, u);
    await collectFiles(client, response, userTurn, o.outDir, files, signal);
    return response;
  };

  for (;;) {
    let response = await call();
    let continuations = 0;
    while (response.stop_reason === "pause_turn" && continuations < MAX_CONTINUATIONS) {
      // Resume the paused turn: send it back as is, with no extra user message.
      messages.push({ role: "assistant", content: response.content });
      response = await call();
      continuations++;
    }
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      status = "refusal";
      statusDetail = response.stop_details?.category ?? "refusal";
      break;
    }
    if (response.stop_reason === "max_tokens" || response.stop_reason === "pause_turn") {
      status = "truncated";
      statusDetail = response.stop_reason === "pause_turn" ? `Still paused after ${MAX_CONTINUATIONS} continuations.` : "Hit max_tokens.";
      break;
    }

    const next = scenario.turns[scripted];
    if (next !== undefined) {
      scripted++;
    } else if (!files.some((f) => f.name.toLowerCase().endsWith(".docx")) && asksQuestion(response) && fallbacks < MAX_FALLBACK_REPLIES) {
      fallbacks++;
    } else {
      break;
    }
    messages.push({ role: "user", content: next ?? scenario.fallbackReply ?? DEFAULT_FALLBACK_REPLY });
    userTurn++;
  }

  return {
    scenario: scenario.id,
    model,
    servedModel,
    condition: o.condition,
    status,
    statusDetail,
    messages,
    files,
    userTurns: userTurn,
    unneededQuestions: fallbacks,
    usage,
    costUsd,
    durationMs: Date.now() - started,
  };
}

function asksQuestion(response: Anthropic.Message): boolean {
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  return text.includes("?");
}

/** Downloads every file the code-execution tool returned in this response, then deletes the remote copy. */
async function collectFiles(client: Anthropic, response: Anthropic.Message, turn: number, outDir: string, files: OutputFile[], signal: AbortSignal): Promise<void> {
  for (const block of response.content) {
    if (block.type !== "bash_code_execution_tool_result" || block.content.type !== "bash_code_execution_result") continue;
    for (const out of block.content.content) {
      const meta = await client.files.retrieveMetadata(out.file_id, {}, { signal });
      const name = basename(meta.filename);
      if (!name || name === "." || name === "..") continue;
      const data = Buffer.from(await (await client.files.download(out.file_id, {}, { signal })).arrayBuffer());
      const path = join(outDir, `turn${turn}-${files.length + 1}-${name}`);
      writeFileSync(path, data);
      files.push({ turn, name, path });
      await client.files.delete(out.file_id, {}, { signal }).catch(() => undefined);
    }
  }
}
