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
      'No spans found. Expected a JSON array of spans, or an object with a "spans" array.',
    );
  }

  const spans: RawSpan[] = loose.map(normalizeSpan).filter((s) => s.spanId);
  if (spans.length === 0) {
    throw new TraceParseError(
      "Spans were found but none had a span id. Check the trace format.",
    );
  }

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
