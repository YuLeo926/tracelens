import type { ParsedTrace, RunNode } from "../types";
import { clipText } from "./sanitize";
import type { EventRef, RepeatedOperationFact, RunFacts, SessionLifecycle } from "./types";

export const FACT_LIST_LIMIT = 10;
export const FACT_NAME_CHARS = 120;
export const REPEATED_EVENT_ID_LIMIT = 10;

function flattenChronologically(trace: ParsedTrace): RunNode[] {
  return [...trace.byId.values()].sort((a, b) => a.startMs - b.startMs || a.spanId.localeCompare(b.spanId));
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalInput(input: string | undefined): unknown {
  if (input === undefined) return undefined;
  try {
    return canonicalize(JSON.parse(input));
  } catch {
    return canonicalize(input);
  }
}

export function canonicalOperationKey(node: RunNode): string {
  return JSON.stringify([node.name, canonicalInput(node.input)]);
}

function factName(value: string): string {
  return clipText(value, FACT_NAME_CHARS).text;
}

function eventRef(node: RunNode, tokenSharePercent?: number): EventRef {
  return {
    eventId: node.spanId,
    name: factName(node.name),
    kind: node.kind,
    status: node.status,
    startMs: node.startMs,
    durationMs: node.durationMs,
    ...(node.tokensIn === undefined ? {} : { tokensIn: node.tokensIn }),
    ...(node.tokensOut === undefined ? {} : { tokensOut: node.tokensOut }),
    ...(tokenSharePercent === undefined ? {} : { tokenSharePercent }),
  };
}

export function buildRunFacts(trace: ParsedTrace, lifecycle: SessionLifecycle): RunFacts {
  const events = flattenChronologically(trace);
  const byStart = (left: RunNode, right: RunNode) => left.startMs - right.startMs || left.spanId.localeCompare(right.spanId);
  const byDuration = (left: RunNode, right: RunNode) => right.durationMs - left.durationMs || byStart(left, right);
  const byTokens = (left: RunNode, right: RunNode) =>
    (right.tokensIn ?? 0) + (right.tokensOut ?? 0) - ((left.tokensIn ?? 0) + (left.tokensOut ?? 0)) || byStart(left, right);

  const operationGroups = new Map<string, { operationName: string; nodes: RunNode[] }>();
  for (const node of events) {
    if (node.kind !== "tool") continue;
    const key = canonicalOperationKey(node);
    const group = operationGroups.get(key);
    if (group) group.nodes.push(node);
    else operationGroups.set(key, { operationName: factName(node.name), nodes: [node] });
  }

  const repeatedOperations: RepeatedOperationFact[] = [...operationGroups.values()]
    .filter(({ nodes }) => nodes.length > 1)
    .map(({ operationName, nodes }) => ({
      operationName,
      count: nodes.length,
      failureCount: nodes.filter((node) => node.status === "error").length,
      eventIds: nodes.slice(0, REPEATED_EVENT_ID_LIMIT).map((node) => node.spanId),
      eventIdsOmitted: Math.max(0, nodes.length - REPEATED_EVENT_ID_LIMIT),
    }))
    .sort((left, right) => left.eventIds[0].localeCompare(right.eventIds[0]))
    .slice(0, FACT_LIST_LIMIT);

  const totalCostUsd = trace.summary.totalCostUsd;
  const sessionTokens = trace.summary.totalTokensIn + trace.summary.totalTokensOut;
  const highestTokenEvents = [...events]
    .filter((node) => (node.tokensIn ?? 0) + (node.tokensOut ?? 0) > 0)
    .sort(byTokens)
    .slice(0, FACT_LIST_LIMIT)
    .map((node) => {
      const eventTokens = (node.tokensIn ?? 0) + (node.tokensOut ?? 0);
      const share = sessionTokens > 0 ? (eventTokens / sessionTokens) * 100 : 0;
      return eventRef(node, Math.min(100, Math.max(0, Math.round(share * 10) / 10)));
    });
  return {
    lifecycle,
    totals: {
      durationMs: trace.summary.durationMs,
      tokensIn: trace.summary.totalTokensIn,
      tokensOut: trace.summary.totalTokensOut,
      ...(totalCostUsd > 0 ? { estimatedCostUsd: totalCostUsd } : {}),
      toolCalls: trace.summary.toolCalls,
      errors: trace.summary.errors,
    },
    errorEvents: events.filter((node) => node.status === "error").sort(byStart).slice(0, FACT_LIST_LIMIT).map(eventRef),
    slowestEvents: [...events].filter((node) => node.durationMs > 0).sort(byDuration).slice(0, FACT_LIST_LIMIT).map((node) => eventRef(node)),
    highestTokenEvents,
    repeatedOperations,
  };
}
