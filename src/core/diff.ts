// Pure: align two parsed traces (A=baseline, B=comparison) into a merged diff tree.

import type { ParsedTrace, RunNode, SpanKind } from "./types";

export type DiffStatus = "matched" | "added" | "removed";

export interface DiffNode {
  key: string;
  name: string;
  kind: SpanKind;
  a: RunNode | null;
  b: RunNode | null;
  status: DiffStatus;
  depth: number;
  children: DiffNode[];
}

export interface DiffStat {
  a: number;
  b: number;
  delta: number; // b - a
}

export interface DiffSummary {
  durationMs: DiffStat;
  spanCount: DiffStat;
  llmCalls: DiffStat;
  toolCalls: DiffStat;
  tokens: DiffStat;
  costUsd: DiffStat;
  errors: DiffStat;
}

export interface TraceDiff {
  roots: DiffNode[];
  summary: DiffSummary;
}

function markAll(
  nodes: RunNode[],
  status: "added" | "removed",
  depth: number,
  prefix: string,
): DiffNode[] {
  return nodes.map((n, i) => {
    const key = `${prefix}/${status[0]}-${n.name}#${i}`;
    return {
      key,
      name: n.name,
      kind: n.kind,
      a: status === "removed" ? n : null,
      b: status === "added" ? n : null,
      status,
      depth,
      children: markAll(n.children, status, depth + 1, key),
    };
  });
}

function alignLevel(
  aNodes: RunNode[],
  bNodes: RunNode[],
  depth: number,
  prefix: string,
): DiffNode[] {
  const bByName = new Map<string, RunNode[]>();
  for (const bn of bNodes) {
    const q = bByName.get(bn.name);
    if (q) q.push(bn);
    else bByName.set(bn.name, [bn]);
  }
  const matchedB = new Set<RunNode>();
  const out: DiffNode[] = [];
  let ord = 0;

  for (const an of aNodes) {
    const q = bByName.get(an.name);
    const bn = q && q.length ? q.shift()! : null;
    const key = `${prefix}/${an.name}#${ord++}`;
    if (bn) {
      matchedB.add(bn);
      out.push({
        key,
        name: an.name,
        kind: an.kind,
        a: an,
        b: bn,
        status: "matched",
        depth,
        children: alignLevel(an.children, bn.children, depth + 1, key),
      });
    } else {
      out.push({
        key,
        name: an.name,
        kind: an.kind,
        a: an,
        b: null,
        status: "removed",
        depth,
        children: markAll(an.children, "removed", depth + 1, key),
      });
    }
  }

  for (const bn of bNodes) {
    if (matchedB.has(bn)) continue;
    const key = `${prefix}/+${bn.name}#${ord++}`;
    out.push({
      key,
      name: bn.name,
      kind: bn.kind,
      a: null,
      b: bn,
      status: "added",
      depth,
      children: markAll(bn.children, "added", depth + 1, key),
    });
  }

  return out;
}

function stat(a: number, b: number): DiffStat {
  return { a, b, delta: b - a };
}

function diffSummary(a: ParsedTrace, b: ParsedTrace): DiffSummary {
  const sa = a.summary;
  const sb = b.summary;
  return {
    durationMs: stat(sa.durationMs, sb.durationMs),
    spanCount: stat(sa.spanCount, sb.spanCount),
    llmCalls: stat(sa.llmCalls, sb.llmCalls),
    toolCalls: stat(sa.toolCalls, sb.toolCalls),
    tokens: stat(sa.totalTokensIn + sa.totalTokensOut, sb.totalTokensIn + sb.totalTokensOut),
    costUsd: stat(sa.totalCostUsd, sb.totalCostUsd),
    errors: stat(sa.errors, sb.errors),
  };
}

export function diffTraces(a: ParsedTrace, b: ParsedTrace): TraceDiff {
  return { roots: alignLevel(a.roots, b.roots, 0, ""), summary: diffSummary(a, b) };
}

/** Depth-first flatten of a diff tree (for rendering). */
export function flattenDiff(roots: DiffNode[]): DiffNode[] {
  const out: DiffNode[] = [];
  const walk = (n: DiffNode) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}
