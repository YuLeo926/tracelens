// Maps loosely-typed incoming spans onto our canonical RawSpan.
// Primary target: OpenInference (the de-facto attribute set for agent traces).
// Fallback: OTel GenAI semantic conventions (gen_ai.*). Add more mappings here —
// this is the single place where "what framework emitted this" is resolved.

import type { RawSpan, SpanKind, SpanStatus } from "./types";
import { extractSpansAuto } from "./adapters";

const KIND_MAP: Record<string, SpanKind> = {
  AGENT: "agent",
  LLM: "llm",
  TOOL: "tool",
  RETRIEVER: "retriever",
  CHAIN: "chain",
  EMBEDDING: "embedding",
  RERANKER: "reranker",
  GUARDRAIL: "guardrail",
  EVALUATOR: "evaluator",
};

// OTel GenAI operation.name -> kind (used when OpenInference kind is absent).
const GENAI_OP_MAP: Record<string, SpanKind> = {
  chat: "llm",
  text_completion: "llm",
  embeddings: "embedding",
  execute_tool: "tool",
  invoke_agent: "agent",
};

export interface LooseSpan {
  span_id?: string;
  spanId?: string;
  parent_span_id?: string | null;
  parentSpanId?: string | null;
  trace_id?: string;
  traceId?: string;
  name?: string;
  start_time?: unknown;
  startTime?: unknown;
  start_time_unix_nano?: unknown;
  end_time?: unknown;
  endTime?: unknown;
  end_time_unix_nano?: unknown;
  status_code?: string;
  statusCode?: string;
  status_message?: string;
  statusMessage?: string;
  attributes?: Record<string, unknown>;
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/** Accepts ISO strings, epoch ms, or OTLP unix-nano numbers. Returns epoch ms. */
export function toMs(v: unknown): number {
  if (typeof v === "number") {
    if (v > 1e17) return v / 1e6; // nanoseconds (OTLP)
    if (v > 1e14) return v / 1e3; // microseconds
    return v; // assume milliseconds
  }
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (!Number.isNaN(parsed)) return parsed;
    const n = Number(v);
    if (Number.isFinite(n)) return toMs(n);
  }
  return NaN;
}

function pickStatus(raw: LooseSpan): SpanStatus {
  const code = (raw.status_code ?? raw.statusCode ?? "").toString().toUpperCase();
  if (code.includes("ERROR")) return "error";
  if (code.includes("OK")) return "ok";
  return "unset";
}

function pickKind(attrs: Record<string, unknown>): SpanKind {
  const oi = attrs["openinference.span.kind"];
  if (typeof oi === "string" && KIND_MAP[oi.toUpperCase()]) {
    return KIND_MAP[oi.toUpperCase()];
  }
  const op = attrs["gen_ai.operation.name"];
  if (typeof op === "string" && GENAI_OP_MAP[op]) return GENAI_OP_MAP[op];
  return "unknown";
}

export function normalizeSpan(raw: LooseSpan): RawSpan {
  const attrs = raw.attributes ?? {};

  const input =
    asString(attrs["input.value"]) ??
    asString(attrs["tool.parameters"]) ??
    asString(attrs["llm.input_messages"]) ??
    asString(attrs["gen_ai.prompt"]);

  const output =
    asString(attrs["output.value"]) ??
    asString(attrs["llm.output_messages"]) ??
    asString(attrs["gen_ai.completion"]);

  const model =
    asString(attrs["llm.model_name"]) ??
    asString(attrs["gen_ai.request.model"]) ??
    asString(attrs["gen_ai.response.model"]);

  return {
    spanId: (raw.span_id ?? raw.spanId ?? "").toString(),
    parentSpanId: (raw.parent_span_id ?? raw.parentSpanId ?? null) as string | null,
    traceId: (raw.trace_id ?? raw.traceId ?? "").toString(),
    name: raw.name ?? "(unnamed span)",
    kind: pickKind(attrs),
    startMs: toMs(raw.start_time ?? raw.startTime ?? raw.start_time_unix_nano),
    endMs: toMs(raw.end_time ?? raw.endTime ?? raw.end_time_unix_nano),
    status: pickStatus(raw),
    statusMessage: raw.status_message ?? raw.statusMessage,
    input,
    output,
    model,
    tokensIn:
      asNumber(attrs["llm.token_count.prompt"]) ??
      asNumber(attrs["gen_ai.usage.input_tokens"]),
    tokensOut:
      asNumber(attrs["llm.token_count.completion"]) ??
      asNumber(attrs["gen_ai.usage.output_tokens"]),
    costUsd:
      asNumber(attrs["llm.cost.total"]) ?? asNumber(attrs["gen_ai.usage.cost"]),
    attributes: attrs,
  };
}

/** Detects the input format (OTLP, span array, { spans }, { data }) and flattens to LooseSpan[]. */
export function extractSpans(json: unknown): LooseSpan[] {
  return extractSpansAuto(json);
}
