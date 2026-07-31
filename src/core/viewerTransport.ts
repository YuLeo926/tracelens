import type { SessionSummary } from "./session/types";
import type { ViewerClient, ViewerSessionPayload } from "./viewerProtocol";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const INVALID_LINK = "This TraceLens link is invalid or expired.";
const MISSING_SESSION = "That session is no longer available.";
const LOAD_FAILED = "TraceLens could not load this session.";

function isSessionSummary(value: unknown): value is SessionSummary {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

function failureFor(status: number): Error {
  if (status === 401) return new Error(INVALID_LINK);
  if (status === 404) return new Error(MISSING_SESSION);
  return new Error(LOAD_FAILED);
}

async function getJson(fetchImpl: typeof fetch, url: string, token: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error(LOAD_FAILED);
  }
  if (!response.ok) throw failureFor(response.status);
  try {
    return await response.json();
  } catch {
    throw new Error(LOAD_FAILED);
  }
}

export function readViewerToken(hash: string): string | null {
  const value = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get("token");
  return value !== null && TOKEN_PATTERN.test(value) ? value : null;
}

export function createViewerClient(token: string, fetchImpl: typeof fetch = fetch): ViewerClient {
  return {
    async listSessions(): Promise<SessionSummary[]> {
      const payload = await getJson(fetchImpl, "/api/sessions", token);
      if (!Array.isArray(payload) || !payload.every(isSessionSummary)) throw new Error(LOAD_FAILED);
      return payload;
    },
    async loadSession(id: string): Promise<ViewerSessionPayload> {
      const payload = await getJson(fetchImpl, `/api/sessions/${encodeURIComponent(id)}`, token);
      if (
        !payload ||
        typeof payload !== "object" ||
        !isSessionSummary((payload as { session?: unknown }).session) ||
        typeof (payload as { source?: unknown }).source !== "string"
      ) {
        throw new Error(LOAD_FAILED);
      }
      return payload as ViewerSessionPayload;
    },
  };
}
