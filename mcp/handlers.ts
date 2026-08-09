import type { SessionRepository } from "../cli/repository";
import type { ViewerService } from "../cli/server";
import type { SpanKind, SpanStatus } from "../src/core/types";
import type { EventDetail, EventPreview, QueryPage, SessionProvider, SessionSummary } from "../src/core/session/types";

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

function result<T>(data: T): TraceLensToolResult<T> {
  return { dataClassification: "untrusted-local-log", data };
}

function requireEvent(event: EventDetail | null): EventDetail {
  if (event === null) throw new Error("Event not found.");
  return event;
}

export function createTraceLensHandlers(repository: SessionRepository, viewer: ViewerService): TraceLensHandlers {
  return {
    async listSessions(args) {
      return result(await repository.list({
        scope: args.scope ?? "current_project",
        ...(args.provider === undefined ? {} : { provider: args.provider }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }));
    },
    async getSessionOverview({ sessionId }) {
      return result((await repository.load(sessionId)).summary);
    },
    async getSessionTimeline({ sessionId, cursor, limit, kinds, status }) {
      const loaded = await repository.load(sessionId);
      return result(loaded.query.timeline({
        ...(cursor === undefined ? {} : { cursor }),
        ...(limit === undefined ? {} : { limit }),
        ...(kinds === undefined ? {} : { kinds }),
        ...(status === undefined ? {} : { status }),
      }));
    },
    async searchSession({ sessionId, query, cursor, limit }) {
      const loaded = await repository.load(sessionId);
      return result(loaded.query.search({
        query,
        ...(cursor === undefined ? {} : { cursor }),
        ...(limit === undefined ? {} : { limit }),
      }));
    },
    async getEventDetail({ sessionId, eventId }) {
      const loaded = await repository.load(sessionId);
      return result(requireEvent(loaded.query.detail(eventId)));
    },
    async getViewerLink({ sessionId, eventId }) {
      const loaded = await repository.load(sessionId);
      if (eventId !== undefined) requireEvent(loaded.query.detail(eventId));
      return result({
        sessionId,
        ...(eventId === undefined ? {} : { eventId }),
        url: await viewer.getLink(sessionId, eventId),
      });
    },
  };
}
