// Pure, dependency-free: turn a flat list of spans into a tree + summary.
// This is the heart of Tracelens and is covered by parse.test.ts.

import type { ParsedTrace, RawSpan, RunNode, TraceSummary } from "./types";
import { extractSpans, normalizeSpan } from "./openinference";

export class TraceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceParseError";
  }
}

export function parseTrace(json: unknown): ParsedTrace {
  const loose = extractSpans(json);
  if (loose.length === 0) {
    throw new TraceParseError(
      'No spans found. Expected a JSON array of spans, an object with a "spans" array, or an OpenTelemetry (OTLP) export.',
    );
  }

  const spans: RawSpan[] = loose.map(normalizeSpan).filter((s) => s.spanId);
  if (spans.length === 0) {
    throw new TraceParseError(
      "Spans were found but none had a span id. Check the trace format.",
    );
  }
  validateSpans(spans);

  const byId = new Map<string, RunNode>();
  for (const span of spans) {
    byId.set(span.spanId, {
      ...span,
      children: [],
      depth: 0,
      durationMs: Math.max(0, span.endMs - span.startMs),
    });
  }

  const roots: RunNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentSpanId ? byId.get(node.parentSpanId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byStart = (a: RunNode, b: RunNode) => a.startMs - b.startMs;
  const assignDepth = (node: RunNode, depth: number) => {
    node.depth = depth;
    node.children.sort(byStart);
    for (const child of node.children) assignDepth(child, depth + 1);
  };
  roots.sort(byStart);
  for (const root of roots) assignDepth(root, 0);

  return { roots, byId, summary: summarize(spans) };
}

/** Decode raw file text as JSON, or as JSONL (newline-delimited JSON objects). */
export function decodeTraceText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const objs: unknown[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t) continue;
      try {
        objs.push(JSON.parse(t));
      } catch (err) {
        const message = err instanceof Error ? err.message : "invalid JSON";
        throw new TraceParseError(`Invalid JSONL on line ${i + 1}: ${message}`);
      }
    }
    if (objs.length === 0) {
      throw new TraceParseError("That file is not valid JSON or JSONL.");
    }
    return objs;
  }
}

function validateSpans(spans: RawSpan[]): void {
  const seen = new Set<string>();
  for (const span of spans) {
    if (seen.has(span.spanId)) {
      throw new TraceParseError(`Duplicate span id "${span.spanId}".`);
    }
    seen.add(span.spanId);
    if (!Number.isFinite(span.startMs)) {
      throw new TraceParseError(`Span "${span.spanId}" has invalid start time.`);
    }
    if (!Number.isFinite(span.endMs)) {
      throw new TraceParseError(`Span "${span.spanId}" has invalid end time.`);
    }
  }
}

/** Decode raw file text (JSON or JSONL) and parse it into a trace. */
export function parseTraceText(text: string): ParsedTrace {
  return parseTrace(decodeTraceText(text));
}

function summarize(spans: RawSpan[]): TraceSummary {
  let toolCalls = 0;
  let llmCalls = 0;
  let errors = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCostUsd = 0;
  let startMs = Infinity;
  let endMs = -Infinity;

  for (const span of spans) {
    if (span.kind === "tool") toolCalls++;
    if (span.kind === "llm") llmCalls++;
    if (span.status === "error") errors++;
    totalTokensIn += span.tokensIn ?? 0;
    totalTokensOut += span.tokensOut ?? 0;
    totalCostUsd += span.costUsd ?? 0;
    if (Number.isFinite(span.startMs)) startMs = Math.min(startMs, span.startMs);
    if (Number.isFinite(span.endMs)) endMs = Math.max(endMs, span.endMs);
  }
  if (!Number.isFinite(startMs)) startMs = 0;
  if (!Number.isFinite(endMs)) endMs = startMs;

  return {
    spanCount: spans.length,
    toolCalls,
    llmCalls,
    errors,
    totalTokensIn,
    totalTokensOut,
    totalCostUsd,
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
  };
}

/** Depth-first flatten honoring an optional collapsed set (drives the tree view). */
export function flatten(roots: RunNode[], collapsed?: Set<string>): RunNode[] {
  const out: RunNode[] = [];
  const walk = (node: RunNode) => {
    out.push(node);
    if (collapsed?.has(node.spanId)) return;
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}
