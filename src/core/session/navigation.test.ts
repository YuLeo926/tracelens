import { describe, expect, it } from "vitest";
import {
  completeSessionRequest,
  createSessionNavigation,
  failSessionRequest,
  isCurrentSessionRequest,
  localSessionRoute,
  sessionEventSelection,
  sessionAnnotationKey,
  sessionLocationForEvent,
  sessionLocationForSelection,
  sessionLocationForReset,
  shouldPreferLocalSession,
  startSessionRequest,
} from "./navigation";

describe("local session navigation", () => {
  const token = "#token=" + "a".repeat(64);

  it("gives local session routes precedence over a share hash", () => {
    const route = localSessionRoute("?mode=session&session=run-1&event=span-1");
    expect(route).toEqual({ sessionId: "run-1", eventId: "span-1" });
    expect(shouldPreferLocalSession(route)).toBe(true);
  });

  it("updates session routes, clears stale evidence, and preserves the fragment token", () => {
    expect(sessionLocationForSelection("/tracelens/", "?mode=session&session=old&event=old-span", token, "new run")).toBe(
      "/tracelens/?mode=session&session=new+run#token=" + "a".repeat(64),
    );
    expect(sessionLocationForEvent("/tracelens/", "?mode=session&session=new+run", token, "event & one")).toBe(
      "/tracelens/?mode=session&session=new+run&event=event+%26+one#token=" + "a".repeat(64),
    );
    expect(sessionLocationForReset("/tracelens/", "?mode=session&session=new+run", token)).toBe("/tracelens/");
  });

  it("opens only valid evidence events and otherwise remains on overview", () => {
    expect(sessionEventSelection("known", new Set(["known"]), "root")).toEqual({ selectedId: "known", view: "tree" });
    expect(sessionEventSelection("missing", new Set(["known"]), "root")).toEqual({ selectedId: "root", view: "overview" });
  });

  it("uses an opaque session scope for local annotations and preserves labels otherwise", () => {
    expect(sessionAnnotationKey("session-1", "Shared title")).toBe("session:session-1");
    expect(sessionAnnotationKey(null, "Imported trace")).toBe("Imported trace");
  });

  it("rejects stale rapid requests and retains the current session after a failed switch", () => {
    const initial = completeSessionRequest(createSessionNavigation({ sessionId: "current", eventId: null }), 1, "current");
    const first = startSessionRequest(initial, { sessionId: "first", eventId: null });
    const second = startSessionRequest(first, { sessionId: "second", eventId: null });

    expect(isCurrentSessionRequest(second, first.requestId, first.route)).toBe(false);
    expect(isCurrentSessionRequest(second, second.requestId, second.route)).toBe(true);
    expect(failSessionRequest(second, second.requestId, "Unavailable")).toMatchObject({
      activeSessionId: "current",
      route: { sessionId: "second", eventId: null },
      loading: false,
      error: "Unavailable",
    });
  });
});
