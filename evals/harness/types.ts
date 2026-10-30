// Shapes shared by the eval harness modules.
import type Anthropic from "@anthropic-ai/sdk";

export type Condition = "skill" | "baseline";

export type CheckName =
  | "docxProduced"
  | "noDocxBeforeTurn"
  | "sectionHeadings"
  | "totalsMatchFixture"
  | "containsColor"
  | "docxContains"
  | "docxContainsAll"
  | "docxNotContains"
  | "tablesNotContain"
  | "noPlaceholders"
  | "logoEmbedded"
  | "citesPackCaseStudy";

export interface CodeExpectation {
  id: string;
  kind: "code";
  check: CheckName;
  args?: Record<string, unknown>;
}

export interface ModelExpectation {
  id: string;
  kind: "model";
  rubric: string;
  /** Judge only the transcript up to the assistant's reply to this user turn (1 = the first reply). */
  turn?: number;
}

export type Expectation = CodeExpectation | ModelExpectation;

export interface Scenario {
  id: string;
  title: string;
  requirement: string;
  /** A folder in packs/, or "neutral" for the skill core's own pack. */
  pack: string;
  query: string;
  files: string[];
  /** Scripted replies, sent in order after each assistant turn. */
  turns: string[];
  fallbackReply?: string;
  expectedQuote: string | null;
  expected: Expectation[];
  /** What a correct run produces, for the oracle build in graders.test.ts (evals/harness/oracle.ts). */
  oracle: {
    client: string;
    contact: { name: string; title?: string };
    startDate: string;
    notIncluded?: string[];
    /** For an unconfigured pack: the brand given in chat, as init-pack.cjs arguments. */
    brand?: {
      name: string;
      primary: string;
      currency: string;
      locale?: string;
      signatoryName: string;
      signatoryTitle: string;
      logo?: string;
    };
  };
}

export interface OutputFile {
  /** The user turn whose reply produced the file (1-based). */
  turn: number;
  name: string;
  path: string;
}

export type CaseStatus = "ok" | "truncated" | "refusal";

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface CaseRun {
  scenario: string;
  model: string;
  servedModel: string;
  condition: Condition;
  status: CaseStatus;
  statusDetail: string;
  /** Every message sent and received, in order, exactly as exchanged with the API. */
  messages: Anthropic.MessageParam[];
  files: OutputFile[];
  userTurns: number;
  unneededQuestions: number;
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
}

export interface Grade {
  behavior: string;
  kind: "code" | "model";
  /** null when the behavior couldn't be graded, e.g. the judge call failed. */
  pass: boolean | null;
  detail: string;
  evidence?: string;
  judgeCostUsd?: number;
}

export interface ResultRow extends Grade {
  runId: string;
  scenario: string;
  model: string;
  servedModel: string;
  condition: Condition;
  status: CaseStatus;
  caseCostUsd: number;
  durationMs: number;
  userTurns: number;
  unneededQuestions: number;
}

/** Totals the expected quote prices to, as plain numbers with grouping ("3,537.80"), without currency. */
export interface ExpectedTotals {
  monthlyRecurring: string;
  oneTime: string | null;
  termTotal: string;
}
