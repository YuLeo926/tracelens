// Pure icicle-flamegraph layout over the parsed tree, weighted by a metric.

import type { RunNode, SpanKind, SpanStatus } from "./types";

export type FlameMetric = "duration" | "tokens" | "cost";

export interface FlameCell {
  spanId: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  depth: number; // 0 = roots
  x0: number; // [0,1]
  x1: number; // [0,1]
  value: number; // aggregate for the metric
}

export interface FlameLayout {
  cells: FlameCell[];
  maxDepth: number;
  total: number;
  metric: FlameMetric;
}

function selfValue(node: RunNode, metric: FlameMetric): number {
  if (metric === "tokens") return (node.tokensIn ?? 0) + (node.tokensOut ?? 0);
  if (metric === "cost") return node.costUsd ?? 0;
  const childDur = node.children.reduce((s, c) => s + c.durationMs, 0);
  return Math.max(0, node.durationMs - childDur); // exclusive (self) time
}

/** subtree aggregate per spanId, in one pass. */
function aggregates(roots: RunNode[], metric: FlameMetric): Map<string, number> {
  const map = new Map<string, number>();
  const visit = (node: RunNode): number => {
    let total = selfValue(node, metric);
    for (const c of node.children) total += visit(c);
    map.set(node.spanId, total);
    return total;
  };
  for (const r of roots) visit(r);
  return map;
}

export function metricTotal(roots: RunNode[], metric: FlameMetric): number {
  const agg = aggregates(roots, metric);
  return roots.reduce((s, r) => s + (agg.get(r.spanId) ?? 0), 0);
}

export function layoutFlame(roots: RunNode[], metric: FlameMetric): FlameLayout {
  const agg = aggregates(roots, metric);
  const total = roots.reduce((s, r) => s + (agg.get(r.spanId) ?? 0), 0);
  const cells: FlameCell[] = [];
  if (total <= 0) return { cells, maxDepth: 0, total: 0, metric };

  let maxDepth = 0;
  const place = (node: RunNode, x0: number, x1: number, depth: number) => {
    if (x1 <= x0) return;
    maxDepth = Math.max(maxDepth, depth);
    const a = agg.get(node.spanId) ?? 0;
    cells.push({
      spanId: node.spanId,
      name: node.name,
      kind: node.kind,
      status: node.status,
      depth,
      x0,
      x1,
      value: a,
    });
    if (a <= 0) return;
    const scale = (x1 - x0) / a;
    let cursor = x0;
    for (const child of node.children) {
      const w = (agg.get(child.spanId) ?? 0) * scale;
      if (w > 0) place(child, cursor, cursor + w, depth + 1);
      cursor += w;
    }
  };

  let cursor = 0;
  for (const root of roots) {
    const w = (agg.get(root.spanId) ?? 0) / total;
    if (w > 0) place(root, cursor, cursor + w, 0);
    cursor += w;
  }
  return { cells, maxDepth, total, metric };
}
