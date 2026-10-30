// Eval settings (design §13). Every value is recorded in each run's config.json.

/** The models under test, cheapest first: runs go in this order so a budget stop hits Opus last. */
export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
} as const;
export type ModelKey = keyof typeof MODELS;

/** Same effort for every model, so the comparison is between models, not settings. */
export const EFFORT = "high" as const;

/**
 * The judge for model-graded behaviors. It's from the same family as the models under test, so
 * most behaviors are code-checked instead, and each rubric asks for quoted evidence.
 */
export const JUDGE_MODEL = "claude-opus-5-5";
export const JUDGE_EFFORT = "medium" as const;

// Refusal fallbacks are deliberately off (design X14): a fallback would answer with a different
// model than the one under test. Refusals are recorded as their own outcome instead.

/** Room for long agentic turns; requests stream, so a large cap doesn't risk HTTP timeouts. */
export const MAX_TOKENS = 64000;
/** pause_turn continuations allowed per user turn before the case counts as truncated. */
export const MAX_CONTINUATIONS = 10;
/** Fallback replies allowed when the model asks something no scripted turn covers. */
export const MAX_FALLBACK_REPLIES = 2;
export const DEFAULT_FALLBACK_REPLY = "You have what you need from me. Please go ahead.";
/** A hard ceiling per case, independent of the connection: a hung stream can't hold a worker forever. */
export const CASE_TIMEOUT_MS = 15 * 60 * 1000;
/** The SDK retries 429, 5xx and connection errors with backoff; four gives a busy API time to recover. */
export const MAX_RETRIES = 4;
/** Uploaded scenario files expire after a day, so nothing lingers in the workspace if a run dies. */
export const UPLOAD_TTL_SECONDS = 24 * 60 * 60;

/**
 * USD per million tokens. Input and output rates are from the claude-api skill's model table
 * (cached 2026-10-06). Cache writes and Haiku's cache reads aren't listed there, so they use the
 * usual multiples of the input rate (1.25× to write, 0.1× to read). Code-execution container time
 * is billed separately and isn't included. Check current pricing before quoting these numbers.
 */
export const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number; longInput?: number; longOutput?: number }> = {
  // Haiku 5.5 charges $0.50 / $2.50 per million for prompts over 100K tokens.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01, longInput: 0.5, longOutput: 2.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};
export const HAIKU_LONG_PROMPT_TOKENS = 100_000;

/** Rough cost of one case before any are measured; replaced by the measured average as cases finish. */
export const PRIOR_CASE_COST_USD: Record<string, number> = {
  "claude-haiku-5-5": 0.05,
  "claude-sonnet-5-5": 0.75,
  "claude-opus-5-5": 1.5,
};
export const PRIOR_JUDGE_COST_USD = 0.03;

export const BASELINE_NOTE = "Our company's brand, catalog, pricing rules, case studies and terms are in the attached files.";
