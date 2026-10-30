// Token accounting from the API's own usage blocks (never estimated from text), and cost from the
// tokens and the model that actually served the call.
import type Anthropic from "@anthropic-ai/sdk";
import { HAIKU_LONG_PROMPT_TOKENS, PRICES } from "./config.ts";
import type { TokenUsage } from "./types.ts";

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

export function usageOf(u: Anthropic.Usage): TokenUsage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead };
}

/** Cost of one API call in USD. Long-prompt rates apply per call, so this is called per response. */
export function callCost(model: string, u: TokenUsage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price for ${model}; add it to PRICES in evals/harness/config.ts.`);
  const promptTokens = u.input + u.cacheWrite + u.cacheRead;
  const long = p.longInput !== undefined && promptTokens > HAIKU_LONG_PROMPT_TOKENS;
  const input = long ? (p.longInput as number) : p.input;
  const output = long ? (p.longOutput ?? p.output) : p.output;
  return (u.input * input + u.output * output + u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead) / 1_000_000;
}
