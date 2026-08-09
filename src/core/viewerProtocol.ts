import type { SessionSummary } from "./session/types";

export interface ViewerSessionPayload {
  session: SessionSummary;
  source: string;
  selectedEventId?: string;
}

export interface ViewerClient {
  listSessions(): Promise<SessionSummary[]>;
  loadSession(id: string, eventId?: string): Promise<ViewerSessionPayload>;
}
