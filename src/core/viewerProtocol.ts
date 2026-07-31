import type { SessionSummary } from "./session/types";

export interface ViewerSessionPayload {
  session: SessionSummary;
  source: string;
}

export interface ViewerClient {
  listSessions(): Promise<SessionSummary[]>;
  loadSession(id: string): Promise<ViewerSessionPayload>;
}
