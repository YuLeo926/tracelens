import type { SpanKind, SpanStatus } from "../types";

export type SessionProvider = "codex" | "claude" | "generic";
export type SessionLifecycle = "active" | "complete" | "failed" | "unknown";
export type ProjectMatch = "exact" | "related" | "fallback";

export interface EventRef {
  eventId: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  startMs: number;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
  tokenSharePercent?: number;
}

export interface EventPreview extends EventRef {
  inputSnippet?: string;
  outputSnippet?: string;
  statusMessage?: string;
}

export interface RepeatedOperationFact {
  operationName: string;
  count: number;
  failureCount: number;
  eventIds: string[];
  eventIdsOmitted: number;
}

export interface RunFacts {
  lifecycle: SessionLifecycle;
  totals: {
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd?: number;
    toolCalls: number;
    errors: number;
  };
  errorEvents: EventRef[];
  slowestEvents: EventRef[];
  highestTokenEvents: EventRef[];
  repeatedOperations: RepeatedOperationFact[];
}

export interface SessionSummary {
  id: string;
  provider: SessionProvider;
  title?: string;
  project?: string;
  modifiedAt: number;
  sizeBytes: number;
  startMs?: number;
  lifecycle: SessionLifecycle;
  match: ProjectMatch;
  selectionReason: string;
  facts: RunFacts;
}

export interface QueryPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface EventDetail extends EventPreview {
  input?: string;
  output?: string;
  attributes: Record<string, string | number | boolean | null>;
  truncated: { input: boolean; output: boolean; attributes: boolean };
}
