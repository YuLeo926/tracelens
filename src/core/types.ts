// Canonical, framework-agnostic model that the whole UI renders.
// Raw traces (OpenInference / OTel GenAI / vendor exports) are normalized into this,
// so the viewer never has to care which framework produced the trace.

export type SpanKind =
  | "agent"
  | "llm"
  | "tool"
  | "retriever"
  | "chain"
  | "embedding"
  | "reranker"
  | "guardrail"
  | "evaluator"
  | "unknown";

export type SpanStatus = "ok" | "error" | "unset";

/** A single span after normalization (flat list; parents referenced by id). */
export interface RawSpan {
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  name: string;
  kind: SpanKind;
  startMs: number; // epoch milliseconds
  endMs: number; // epoch milliseconds
  status: SpanStatus;
  statusMessage?: string;
  input?: string; // human-readable: prompt / tool args / query
  output?: string; // human-readable: completion / tool result
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  /** Everything else, kept verbatim for the detail panel. */
  attributes: Record<string, unknown>;
}

/** A span placed in the tree, with fields derived for rendering. */
export interface RunNode extends RawSpan {
  children: RunNode[];
  depth: number;
  durationMs: number;
}

/** Roll-up across a whole trace, shown in the summary bar. */
export interface TraceSummary {
  spanCount: number;
  toolCalls: number;
  llmCalls: number;
  errors: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface ParsedTrace {
  roots: RunNode[];
  byId: Map<string, RunNode>;
  summary: TraceSummary;
}
