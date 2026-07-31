import type { ParsedTrace, RunNode, SpanKind, SpanStatus } from "../types";
import { clipText, safeAttributes } from "./sanitize";
import type { EventDetail, EventPreview, QueryPage } from "./types";

export const TIMELINE_LIMIT = 50;
export const SEARCH_LIMIT = 20;
export const PREVIEW_CHARS = 240;
export const DETAIL_CONTENT_CHARS = 24_000;

export interface SessionQuery {
  timeline(args?: {
    cursor?: string;
    limit?: number;
    kinds?: SpanKind[];
    status?: SpanStatus;
  }): QueryPage<EventPreview>;
  search(args: { query: string; cursor?: string; limit?: number }): QueryPage<EventPreview>;
  detail(eventId: string): EventDetail | null;
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^\d+$/.test(cursor)) throw new Error("Invalid cursor.");
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset)) throw new Error("Invalid cursor.");
  return offset;
}

function page<T>(items: T[], cursor: string | undefined, requestedLimit: number | undefined, cap: number): QueryPage<T> {
  const offset = parseCursor(cursor);
  const limit = Number.isFinite(requestedLimit) ? Math.min(cap, Math.max(1, Math.floor(requestedLimit as number))) : cap;
  const result = items.slice(offset, offset + limit);
  return {
    items: result,
    ...(offset + result.length < items.length ? { nextCursor: String(offset + result.length) } : {}),
  };
}

function preview(node: RunNode): EventPreview {
  const name = clipText(node.name, PREVIEW_CHARS).text;
  return {
    eventId: node.spanId,
    name,
    kind: node.kind,
    status: node.status,
    startMs: node.startMs,
    durationMs: node.durationMs,
    ...(node.tokensIn === undefined ? {} : { tokensIn: node.tokensIn }),
    ...(node.tokensOut === undefined ? {} : { tokensOut: node.tokensOut }),
    ...(node.input === undefined ? {} : { inputSnippet: clipText(node.input, PREVIEW_CHARS).text }),
    ...(node.output === undefined ? {} : { outputSnippet: clipText(node.output, PREVIEW_CHARS).text }),
    ...(node.statusMessage === undefined ? {} : { statusMessage: clipText(node.statusMessage, PREVIEW_CHARS).text }),
  };
}

function primitiveSearchText(node: RunNode): string[] {
  return Object.values(node.attributes).flatMap((value) =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
      ? [String(value)]
      : [],
  );
}

function detailFor(node: RunNode): EventDetail {
  const input = node.input === undefined ? undefined : clipText(node.input, Number.MAX_SAFE_INTEGER).text;
  const output = node.output === undefined ? undefined : clipText(node.output, Number.MAX_SAFE_INTEGER).text;
  const half = DETAIL_CONTENT_CHARS / 2;
  const inputLimit = input === undefined ? 0 : Math.min(DETAIL_CONTENT_CHARS, Math.max(half, DETAIL_CONTENT_CHARS - (output?.length ?? 0)));
  const outputLimit = output === undefined ? 0 : Math.min(DETAIL_CONTENT_CHARS, Math.max(half, DETAIL_CONTENT_CHARS - (input?.length ?? 0)));
  const clippedInput = input === undefined ? undefined : clipText(input, inputLimit);
  const clippedOutput = output === undefined ? undefined : clipText(output, outputLimit);
  const safe = safeAttributes(node.attributes);

  return {
    ...preview(node),
    ...(clippedInput === undefined ? {} : { input: clippedInput.text }),
    ...(clippedOutput === undefined ? {} : { output: clippedOutput.text }),
    attributes: safe,
    truncated: {
      input: clippedInput?.truncated ?? false,
      output: clippedOutput?.truncated ?? false,
      attributes: Object.keys(safe).length !== Object.keys(node.attributes).length,
    },
  };
}

export function createSessionQuery(trace: ParsedTrace): SessionQuery {
  const events = [...trace.byId.values()].sort((left, right) => left.startMs - right.startMs || left.spanId.localeCompare(right.spanId));
  const byId = new Map(events.map((event) => [event.spanId, event]));

  return {
    timeline(args = {}) {
      const filtered = events.filter((node) =>
        (!args.kinds || args.kinds.includes(node.kind)) && (!args.status || args.status === node.status),
      );
      return page(filtered.map(preview), args.cursor, args.limit, TIMELINE_LIMIT);
    },
    search(args) {
      const query = args.query.toLowerCase();
      const filtered = events.filter((node) =>
        [node.name, node.input, node.output, node.statusMessage, ...primitiveSearchText(node)]
          .filter((value): value is string => value !== undefined)
          .some((value) => value.toLowerCase().includes(query)),
      );
      return page(filtered.map(preview), args.cursor, args.limit, SEARCH_LIMIT);
    },
    detail(eventId) {
      const node = byId.get(eventId);
      return node ? detailFor(node) : null;
    },
  };
}
