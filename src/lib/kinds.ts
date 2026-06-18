// The visual signature of Tracelens: span kind == color.
// Used everywhere — the tree, the waterfall bars, the detail badge, the legend —
// so the colour itself tells you what kind of step you are looking at.

import type { SpanKind } from "../core/types";

export interface KindStyle {
  label: string;
  color: string;
}

export const KIND_STYLES: Record<SpanKind, KindStyle> = {
  agent: { label: "Agent", color: "#8B7CF6" }, // indigo — the host/orchestrator
  llm: { label: "LLM", color: "#E8A23D" }, // amber — model calls
  tool: { label: "Tool", color: "#2DD4BF" }, // teal — tool / function calls
  retriever: { label: "Retriever", color: "#A78BFA" }, // purple — retrieval
  chain: { label: "Chain", color: "#8A93A6" }, // grey-blue — generic chains
  embedding: { label: "Embedding", color: "#5FB6E8" }, // light blue
  reranker: { label: "Reranker", color: "#C77DFF" }, // violet
  guardrail: { label: "Guardrail", color: "#E8C84D" }, // yellow
  evaluator: { label: "Evaluator", color: "#6FD08C" }, // green
  unknown: { label: "Span", color: "#6B7486" }, // neutral grey
};

export const ERROR_COLOR = "#F0556B";

export function kindStyle(kind: SpanKind): KindStyle {
  return KIND_STYLES[kind] ?? KIND_STYLES.unknown;
}
