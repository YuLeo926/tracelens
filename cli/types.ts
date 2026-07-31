import type { ProjectMatch, SessionLifecycle, SessionProvider } from "../src/core/session/types";

/** Internal filesystem-backed session record. Never import this from src/ or mcp/. */
export interface SessionCandidate {
  id: string;
  path: string;
  provider: SessionProvider;
  title?: string;
  project?: string;
  projectPath?: string;
  modifiedAt: number;
  sizeBytes: number;
  startMs?: number;
  lifecycle: SessionLifecycle;
  match: ProjectMatch;
}
