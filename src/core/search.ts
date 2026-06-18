// Pure, dependency-free trace search/analysis over the parsed model.
// Used by the tree filter and the error/slowest quick-jumps.

import type { RunNode } from "./types";

export interface SearchResult {
  /** Spans that themselves match the query. */
  matchIds: Set<string>;
  /** Matches plus every ancestor of a match (so the tree keeps context). */
  visibleIds: Set<string>;
  /** Match ids in display (pre-order DFS) order, for stepping. */
  orderedMatchIds: string[];
}

function haystack(node: RunNode): string {
  return [node.name, node.model, node.input, node.output, node.statusMessage]
    .filter((s): s is string => typeof s === "string")
    .join("\n")
    .toLowerCase();
}

/** Case-insensitive substring across name/model/input/output/statusMessage. */
export function spanMatchesQuery(node: RunNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return haystack(node).includes(q);
}

export function searchTrace(roots: RunNode[], query: string): SearchResult {
  const matchIds = new Set<string>();
  const visibleIds = new Set<string>();
  const orderedMatchIds: string[] = [];
  if (!query.trim()) return { matchIds, visibleIds, orderedMatchIds };

  const visit = (node: RunNode): boolean => {
    const selfMatch = spanMatchesQuery(node, query);
    if (selfMatch) {
      matchIds.add(node.spanId);
      orderedMatchIds.push(node.spanId);
    }
    let descendantMatch = false;
    for (const child of node.children) {
      if (visit(child)) descendantMatch = true;
    }
    const visible = selfMatch || descendantMatch;
    if (visible) visibleIds.add(node.spanId);
    return visible;
  };
  for (const root of roots) visit(root);
  return { matchIds, visibleIds, orderedMatchIds };
}

/** Error spans in display (pre-order) order. */
export function errorSpanIds(roots: RunNode[]): string[] {
  const out: string[] = [];
  const walk = (node: RunNode) => {
    if (node.status === "error") out.push(node.spanId);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** Id of the span with the greatest durationMs, or null if there are none. */
export function slowestSpanId(roots: RunNode[]): string | null {
  let bestId: string | null = null;
  let bestDur = -Infinity;
  const walk = (node: RunNode) => {
    if (node.durationMs > bestDur) {
      bestDur = node.durationMs;
      bestId = node.spanId;
    }
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return bestId;
}
