import { describe, it, expect } from "vitest";
import { parseTrace } from "./parse";
import { diffTraces, flattenDiff } from "./diff";

const A = [
  { span_id: "a1", name: "agent.run", start_time: 0, end_time: 1000, attributes: { "openinference.span.kind": "AGENT" } },
  { span_id: "a2", parent_span_id: "a1", name: "llm.plan", start_time: 0, end_time: 300, attributes: { "openinference.span.kind": "LLM", "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 50 } },
  { span_id: "a3", parent_span_id: "a1", name: "tool.search", start_time: 300, end_time: 600, attributes: { "openinference.span.kind": "TOOL" } },
  { span_id: "a4", parent_span_id: "a1", name: "llm.answer", start_time: 600, end_time: 1000, attributes: { "openinference.span.kind": "LLM" } },
];
const B = [
  { span_id: "b1", name: "agent.run", start_time: 0, end_time: 1500, attributes: { "openinference.span.kind": "AGENT" } },
  { span_id: "b2", parent_span_id: "b1", name: "llm.plan", start_time: 0, end_time: 400, attributes: { "openinference.span.kind": "LLM", "gen_ai.usage.input_tokens": 120, "gen_ai.usage.output_tokens": 60 } },
  { span_id: "b3", parent_span_id: "b1", name: "tool.search", start_time: 400, end_time: 900, attributes: { "openinference.span.kind": "TOOL" } },
  { span_id: "b5", parent_span_id: "b1", name: "tool.extra", start_time: 900, end_time: 1100, status_code: "ERROR", attributes: { "openinference.span.kind": "TOOL" } },
];

const diff = diffTraces(parseTrace(A), parseTrace(B));
const all = flattenDiff(diff.roots);
const byName = (n: string) => all.find((d) => d.name === n)!;

describe("diffTraces alignment", () => {
  it("matches the root", () => {
    expect(diff.roots).toHaveLength(1);
    expect(diff.roots[0].status).toBe("matched");
    expect(diff.roots[0].name).toBe("agent.run");
  });
  it("flags matched / removed / added children", () => {
    expect(byName("llm.plan").status).toBe("matched");
    expect(byName("tool.search").status).toBe("matched");
    expect(byName("llm.answer").status).toBe("removed");
    expect(byName("llm.answer").b).toBeNull();
    expect(byName("tool.extra").status).toBe("added");
    expect(byName("tool.extra").a).toBeNull();
  });
});

describe("diff summary", () => {
  it("computes signed deltas", () => {
    expect(diff.summary.durationMs).toEqual({ a: 1000, b: 1500, delta: 500 });
    expect(diff.summary.errors.delta).toBe(1);
    expect(diff.summary.tokens).toEqual({ a: 150, b: 180, delta: 30 });
  });
});

describe("duplicate-name siblings align by order", () => {
  it("pairs first-with-first, extra A is removed", () => {
    const a2 = parseTrace([
      { span_id: "r", name: "root", start_time: 0, end_time: 10, attributes: {} },
      { span_id: "x1", parent_span_id: "r", name: "step", start_time: 0, end_time: 2, attributes: {} },
      { span_id: "x2", parent_span_id: "r", name: "step", start_time: 2, end_time: 4, attributes: {} },
    ]);
    const b2 = parseTrace([
      { span_id: "r", name: "root", start_time: 0, end_time: 10, attributes: {} },
      { span_id: "y1", parent_span_id: "r", name: "step", start_time: 0, end_time: 3, attributes: {} },
    ]);
    const steps = flattenDiff(diffTraces(a2, b2).roots).filter((n) => n.name === "step");
    expect(steps.map((s) => s.status)).toEqual(["matched", "removed"]);
  });
});
