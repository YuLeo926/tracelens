// Pure, dependency-free helpers for the live-tail feature.

import type { RunNode } from "./types";

export interface TraceFileEntry {
  name: string; // relative path within the watched folder
  lastModified: number; // epoch ms
}

const TRACE_EXT = /\.(jsonl?|json)$/i;

/** Newest .json/.jsonl entry by lastModified; ties broken by name (desc). null if none. */
export function pickNewestTraceFile(entries: TraceFileEntry[]): string | null {
  let best: TraceFileEntry | null = null;
  for (const e of entries) {
    if (!TRACE_EXT.test(e.name)) continue;
    if (
      !best ||
      e.lastModified > best.lastModified ||
      (e.lastModified === best.lastModified && e.name > best.name)
    ) {
      best = e;
    }
  }
  return best ? best.name : null;
}

/** Id of the span with the greatest startMs (the most recently started step). */
export function latestSpanId(roots: RunNode[]): string | null {
  let bestId: string | null = null;
  let bestStart = -Infinity;
  const walk = (node: RunNode) => {
    if (node.startMs > bestStart) {
      bestStart = node.startMs;
      bestId = node.spanId;
    }
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return bestId;
}
