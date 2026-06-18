import { describe, it, expect } from "vitest";
import { KIND_STYLES, kindStyle, kindColor } from "./kinds";

const ALL_KINDS = [
  "agent", "llm", "tool", "retriever", "chain",
  "embedding", "reranker", "guardrail", "evaluator", "unknown",
] as const;

describe("kinds", () => {
  it("maps every SpanKind to a label and a var(--kind-*) color", () => {
    for (const k of ALL_KINDS) {
      const style = KIND_STYLES[k];
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.color).toMatch(/^var\(--kind-/);
    }
  });

  it("kindColor returns a var() reference", () => {
    expect(kindColor("llm")).toBe("var(--kind-llm)");
    expect(kindColor("tool")).toBe("var(--kind-tool)");
  });

  it("falls back to unknown for an unrecognized kind", () => {
    // @ts-expect-error testing the runtime fallback
    expect(kindStyle("bogus").color).toBe("var(--kind-unknown)");
  });
});
