import { describe, it, expect } from "vitest";
import { parseTrace } from "./parse";
import { metricTotal, layoutFlame } from "./flame";
import research from "../../public/samples/research-agent.json";

const t = parseTrace(research);

describe("metricTotal", () => {
  it("duration total equals the root's wall-clock duration", () => {
    expect(metricTotal(t.roots, "duration")).toBe(t.roots[0].durationMs);
  });
  it("tokens total sums in+out across the trace", () => {
    expect(metricTotal(t.roots, "tokens")).toBe(
      t.summary.totalTokensIn + t.summary.totalTokensOut,
    );
  });
  it("cost is positive for the sample; empty forest is 0", () => {
    expect(metricTotal(t.roots, "cost")).toBeGreaterThan(0);
    expect(metricTotal([], "duration")).toBe(0);
  });
});

describe("layoutFlame", () => {
  const f = layoutFlame(t.roots, "duration");
  it("places the root across the full width at depth 0", () => {
    const root = f.cells.find((c) => c.depth === 0)!;
    expect(root.spanId).toBe(t.roots[0].spanId);
    expect(root.x0).toBeCloseTo(0, 5);
    expect(root.x1).toBeCloseTo(1, 5);
  });
  it("nests children left-to-right without overlap", () => {
    expect(f.maxDepth).toBeGreaterThanOrEqual(2);
    const d1 = f.cells.filter((c) => c.depth === 1).sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < d1.length; i++) {
      expect(d1[i].x0).toBeGreaterThanOrEqual(d1[i - 1].x1 - 1e-9);
    }
  });
  it("returns empty cells when the metric total is 0", () => {
    expect(layoutFlame([], "cost").cells).toEqual([]);
  });
});
