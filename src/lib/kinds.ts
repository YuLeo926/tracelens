// The visual signature of Tracelens: span kind == color.
// Colors live in styles/tokens.css as --kind-* variables (one value per theme),
// so a kind looks correct in light and dark automatically. This module only
// says WHICH variable a kind maps to.

import type { SpanKind } from "../core/types";

export interface KindStyle {
  label: string;
  color: string; // CSS var reference, e.g. "var(--kind-llm)" — themeable
}

export const KIND_STYLES: Record<SpanKind, KindStyle> = {
  agent: { label: "Agent", color: "var(--kind-agent)" },
  llm: { label: "LLM", color: "var(--kind-llm)" },
  tool: { label: "Tool", color: "var(--kind-tool)" },
  retriever: { label: "Retriever", color: "var(--kind-retriever)" },
  chain: { label: "Chain", color: "var(--kind-chain)" },
  embedding: { label: "Embedding", color: "var(--kind-embedding)" },
  reranker: { label: "Reranker", color: "var(--kind-reranker)" },
  guardrail: { label: "Guardrail", color: "var(--kind-guardrail)" },
  evaluator: { label: "Evaluator", color: "var(--kind-evaluator)" },
  unknown: { label: "Span", color: "var(--kind-unknown)" },
};

export function kindStyle(kind: SpanKind): KindStyle {
  return KIND_STYLES[kind] ?? KIND_STYLES.unknown;
}

/** CSS color reference for a kind, e.g. "var(--kind-llm)". */
export function kindColor(kind: SpanKind): string {
  return kindStyle(kind).color;
}
