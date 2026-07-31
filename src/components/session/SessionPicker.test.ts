import { describe, expect, it } from "vitest";
import { rankedSessions, sessionProject, sessionTitle } from "./SessionPicker";
import type { SessionSummary } from "../../core/session/types";

function session(id: string, match: SessionSummary["match"], modifiedAt: number): SessionSummary {
  return {
    id,
    provider: "codex",
    modifiedAt,
    sizeBytes: 0,
    lifecycle: "unknown",
    match,
    selectionReason: "",
    facts: {
      lifecycle: "unknown",
      totals: { durationMs: 0, tokensIn: 0, tokensOut: 0, toolCalls: 0, errors: 0 },
      errorEvents: [],
      slowestEvents: [],
      highestTokenEvents: [],
      repeatedOperations: [],
    },
  };
}

describe("SessionPicker display model", () => {
  it("uses compact title and project fallbacks", () => {
    const item = session("empty", "fallback", 1);
    expect(sessionTitle(item)).toBe("Untitled session");
    expect(sessionProject(item)).toBe("No project");
  });

  it("keeps project rank and lists newer sessions first within each rank", () => {
    const rows = rankedSessions([
      session("fallback-new", "fallback", 40),
      session("exact-old", "exact", 10),
      session("related", "related", 50),
      session("exact-new", "exact", 30),
    ]);

    expect(rows.map((item) => item.id)).toEqual(["exact-new", "exact-old", "related", "fallback-new"]);
  });
});
