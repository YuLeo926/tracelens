import { describe, expect, it, vi } from "vitest";
import { createViewerClient, readViewerToken } from "./viewerTransport";

const token = "a".repeat(64);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("readViewerToken", () => {
  it("accepts only a lowercase 64-character hexadecimal fragment token", () => {
    expect(readViewerToken(`#token=${token}`)).toBe(token);
    expect(readViewerToken(`#token=${token.toUpperCase()}`)).toBeNull();
    expect(readViewerToken(`#token=${token.slice(1)}`)).toBeNull();
    expect(readViewerToken("#token=not-a-token")).toBeNull();
    expect(readViewerToken("#other=value")).toBeNull();
  });

  it("requires exactly one raw token parameter in a fragment", () => {
    expect(readViewerToken(`token=${token}`)).toBeNull();
    expect(readViewerToken(`#token=${token}&mode=session`)).toBeNull();
    expect(readViewerToken(`#token=${token}&token=${token}`)).toBeNull();
    expect(readViewerToken(`#%74oken=${token}`)).toBeNull();
  });
});

describe("createViewerClient", () => {
  it("uses bearer authentication without putting the token in request URLs", async () => {
    const eventAlias = `evt_${"c".repeat(64)}`;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([{ id: "session-1" }]))
      .mockResolvedValueOnce(response({
        session: { id: "session-1" },
        source: '{"spans":[]}',
        selectedEventId: "C:\\private\\traces\\event.json",
      }));
    const client = createViewerClient(token, fetchImpl);

    await expect(client.listSessions()).resolves.toEqual([{ id: "session-1" }]);
    await expect(client.loadSession("session / one", eventAlias)).resolves.toEqual({
      session: { id: "session-1" },
      source: '{"spans":[]}',
      selectedEventId: "C:\\private\\traces\\event.json",
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/api/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, `/api/sessions/session%20%2F%20one?event=${eventAlias}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toContain(token);
  });

  it("uses specific messages for expired links and unavailable sessions", async () => {
    const unauthorized = createViewerClient(token, vi.fn<typeof fetch>().mockResolvedValue(response({}, 401)));
    const missing = createViewerClient(token, vi.fn<typeof fetch>().mockResolvedValue(response({}, 404)));

    await expect(unauthorized.listSessions()).rejects.toThrow("This TraceLens link is invalid or expired.");
    await expect(missing.loadSession("missing")).rejects.toThrow("That session is no longer available.");
  });

  it("rejects malformed and other unsuccessful responses with the generic message", async () => {
    const malformed = createViewerClient(token, vi.fn<typeof fetch>().mockResolvedValue(response({ session: {}, source: 42 })));
    const failed = createViewerClient(token, vi.fn<typeof fetch>().mockResolvedValue(response({}, 500)));

    await expect(malformed.loadSession("session-1")).rejects.toThrow("TraceLens could not load this session.");
    await expect(failed.listSessions()).rejects.toThrow("TraceLens could not load this session.");
  });
});
