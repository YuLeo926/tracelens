import { SessionNotFoundError, type LoadedSession, type SessionRepository } from "../cli/repository";
import type { ViewerService } from "../cli/server";
import { publicEventId } from "../src/core/session/publicIds";
import { DETAIL_CONTENT_CHARS, SEARCH_LIMIT, TIMELINE_LIMIT } from "../src/core/session/query";
import { clipText } from "../src/core/session/sanitize";
import type {
  EventDetail,
  EventPreview,
  EventRef,
  QueryPage,
  RunFacts,
  SessionProvider,
  SessionSummary,
} from "../src/core/session/types";
import type { SpanKind, SpanStatus } from "../src/core/types";

const LIST_LIMIT = 20;

export interface TraceLensToolResult<T> {
  dataClassification: "untrusted-local-log";
  data: T;
}

export interface TraceLensHandlers {
  listSessions(args: { scope?: "current_project" | "all"; provider?: SessionProvider; limit?: number }): Promise<TraceLensToolResult<SessionSummary[]>>;
  getSessionOverview(args: { sessionId: string }): Promise<TraceLensToolResult<SessionSummary>>;
  getSessionTimeline(args: { sessionId: string; cursor?: string; limit?: number; kinds?: SpanKind[]; status?: SpanStatus }): Promise<TraceLensToolResult<QueryPage<EventPreview>>>;
  searchSession(args: { sessionId: string; query: string; cursor?: string; limit?: number }): Promise<TraceLensToolResult<QueryPage<EventPreview>>>;
  getEventDetail(args: { sessionId: string; eventId: string }): Promise<TraceLensToolResult<EventDetail>>;
  getViewerLink(args: { sessionId: string; eventId?: string }): Promise<TraceLensToolResult<{ sessionId: string; eventId?: string; url: string }>>;
}

export class TraceLensPublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceLensPublicError";
  }
}

interface EventIdMap {
  opaque(rawEventId: string): string;
  raw(opaqueEventId: string): string | undefined;
}

function result<T>(data: T): TraceLensToolResult<T> {
  return { dataClassification: "untrusted-local-log", data };
}

function boundedLimit(value: number | undefined, cap: number): number {
  if (!Number.isFinite(value)) return cap;
  return Math.min(cap, Math.max(1, Math.floor(value as number)));
}

function eventIdMap(loaded: LoadedSession): EventIdMap {
  const byOpaque = new Map<string, string>();
  for (const rawEventId of loaded.trace.byId.keys()) byOpaque.set(publicEventId(loaded.summary.id, rawEventId), rawEventId);
  return {
    opaque: (rawEventId) => publicEventId(loaded.summary.id, rawEventId),
    raw: (publicEventId) => byOpaque.get(publicEventId),
  };
}

function publicEventRef(event: EventRef, sessionId: string): EventRef {
  return { ...event, eventId: publicEventId(sessionId, event.eventId) };
}

function publicFacts(facts: RunFacts, sessionId: string): RunFacts {
  return {
    ...facts,
    errorEvents: facts.errorEvents.map((event) => publicEventRef(event, sessionId)),
    slowestEvents: facts.slowestEvents.map((event) => publicEventRef(event, sessionId)),
    highestTokenEvents: facts.highestTokenEvents.map((event) => publicEventRef(event, sessionId)),
    repeatedOperations: facts.repeatedOperations.map((operation) => ({
      ...operation,
      eventIds: operation.eventIds.map((eventId) => publicEventId(sessionId, eventId)),
    })),
  };
}

function publicSummary(summary: SessionSummary): SessionSummary {
  return {
    id: summary.id,
    provider: summary.provider,
    ...(summary.project === undefined ? {} : { project: summary.project }),
    modifiedAt: summary.modifiedAt,
    sizeBytes: summary.sizeBytes,
    ...(summary.startMs === undefined ? {} : { startMs: summary.startMs }),
    lifecycle: summary.lifecycle,
    match: summary.match,
    selectionReason: summary.selectionReason,
    facts: publicFacts(summary.facts, summary.id),
  };
}

function publicPreview(preview: EventPreview, ids: EventIdMap): EventPreview {
  return { ...preview, eventId: ids.opaque(preview.eventId) };
}

function serializedDetailLength(detail: EventDetail): number {
  return JSON.stringify(result(detail)).length;
}

function boundDetailStrings(detail: EventDetail): EventDetail {
  const bounded: EventDetail = { ...detail, attributes: {}, truncated: { ...detail.truncated, attributes: true } };
  const optionalFields = ["input", "output", "statusMessage", "inputSnippet", "outputSnippet"] as const;

  while (serializedDetailLength(bounded) > DETAIL_CONTENT_CHARS) {
    const field = optionalFields
      .filter((candidate) => bounded[candidate] !== undefined)
      .sort((left, right) => (bounded[right]?.length ?? 0) - (bounded[left]?.length ?? 0))[0];
    if (field === undefined) {
      const overflow = serializedDetailLength(bounded) - DETAIL_CONTENT_CHARS;
      bounded.name = clipText(bounded.name, Math.max(0, bounded.name.length - overflow - 1)).text;
      continue;
    }

    const value = bounded[field]!;
    const overflow = serializedDetailLength(bounded) - DETAIL_CONTENT_CHARS;
    const target = Math.max(0, value.length - overflow - 1);
    if (target === 0) delete bounded[field];
    else bounded[field] = clipText(value, target).text;
    if (field === "input") bounded.truncated.input = true;
    if (field === "output") bounded.truncated.output = true;
  }
  return bounded;
}

function boundedDetail(detail: EventDetail): EventDetail {
  if (serializedDetailLength(detail) <= DETAIL_CONTENT_CHARS) return detail;
  const entries = Object.entries(detail.attributes);
  const base = boundDetailStrings(detail);
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const count = Math.ceil((low + high) / 2);
    const candidate: EventDetail = { ...base, attributes: Object.fromEntries(entries.slice(0, count)) };
    if (serializedDetailLength(candidate) <= DETAIL_CONTENT_CHARS) low = count;
    else high = count - 1;
  }
  return { ...base, attributes: Object.fromEntries(entries.slice(0, low)) };
}

async function loadSession(repository: SessionRepository, sessionId: string): Promise<LoadedSession> {
  try {
    return await repository.load(sessionId);
  } catch (error) {
    if (error instanceof SessionNotFoundError) throw new TraceLensPublicError("Session not found. Call list_sessions again.");
    throw new TraceLensPublicError("Unable to read session evidence.");
  }
}

function rawEventId(ids: EventIdMap, publicEventId: string): string {
  const raw = ids.raw(publicEventId);
  if (raw === undefined) throw new TraceLensPublicError("Event not found in the selected session.");
  return raw;
}

function publicViewerUrl(url: string, eventId: string | undefined): string {
  if (eventId === undefined) return url;
  const publicUrl = new URL(url);
  publicUrl.searchParams.set("event", eventId);
  return publicUrl.toString();
}

export function createTraceLensHandlers(repository: SessionRepository, viewer: ViewerService): TraceLensHandlers {
  return {
    async listSessions(args) {
      const limit = boundedLimit(args.limit, LIST_LIMIT);
      try {
        const summaries = await repository.list({
          scope: args.scope ?? "current_project",
          ...(args.provider === undefined ? {} : { provider: args.provider }),
          limit,
        });
        return result(summaries.slice(0, limit).map(publicSummary));
      } catch {
        throw new TraceLensPublicError("Unable to list sessions.");
      }
    },
    async getSessionOverview({ sessionId }) {
      return result(publicSummary((await loadSession(repository, sessionId)).summary));
    },
    async getSessionTimeline({ sessionId, cursor, limit, kinds, status }) {
      const loaded = await loadSession(repository, sessionId);
      const ids = eventIdMap(loaded);
      try {
        const page = loaded.query.timeline({
          ...(cursor === undefined ? {} : { cursor }),
          limit: boundedLimit(limit, TIMELINE_LIMIT),
          ...(kinds === undefined ? {} : { kinds }),
          ...(status === undefined ? {} : { status }),
        });
        return result({ ...page, items: page.items.map((event) => publicPreview(event, ids)) });
      } catch {
        throw new TraceLensPublicError("Unable to query session evidence.");
      }
    },
    async searchSession({ sessionId, query, cursor, limit }) {
      const loaded = await loadSession(repository, sessionId);
      const ids = eventIdMap(loaded);
      try {
        const page = loaded.query.search({
          query,
          ...(cursor === undefined ? {} : { cursor }),
          limit: boundedLimit(limit, SEARCH_LIMIT),
        });
        return result({ ...page, items: page.items.map((event) => publicPreview(event, ids)) });
      } catch {
        throw new TraceLensPublicError("Unable to query session evidence.");
      }
    },
    async getEventDetail({ sessionId, eventId }) {
      const loaded = await loadSession(repository, sessionId);
      const ids = eventIdMap(loaded);
      const raw = rawEventId(ids, eventId);
      try {
        const detail = loaded.query.detail(raw);
        if (detail === null) throw new TraceLensPublicError("Event not found in the selected session.");
        return result(boundedDetail({ ...detail, eventId }));
      } catch (error) {
        if (error instanceof TraceLensPublicError) throw error;
        throw new TraceLensPublicError("Unable to read event evidence.");
      }
    },
    async getViewerLink({ sessionId, eventId }) {
      const loaded = await loadSession(repository, sessionId);
      const ids = eventIdMap(loaded);
      const raw = eventId === undefined ? undefined : rawEventId(ids, eventId);
      try {
        const url = await viewer.getLink(sessionId, raw, eventId);
        return result({
          sessionId,
          ...(eventId === undefined ? {} : { eventId }),
          url: publicViewerUrl(url, eventId),
        });
      } catch {
        throw new TraceLensPublicError("Unable to create viewer link.");
      }
    },
  };
}
