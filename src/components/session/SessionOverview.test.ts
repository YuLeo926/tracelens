import { describe, expect, it } from "vitest";
import { sessionFactRows } from "./SessionOverview";
import type { SessionSummary } from "../../core/session/types";

function session(): SessionSummary {
  return {
    id: "session-1",
    provider: "codex",
    title: "Inspect session facts",
    project: "tracelens",
    modifiedAt: 1_720_000_000_000,
    sizeBytes: 1200,
    lifecycle: "complete",
    match: "exact",
    selectionReason: "Matches current project.",
    facts: {
      lifecycle: "complete",
      totals: {
        durationMs: 4_250,
        tokensIn: 1200,
        tokensOut: 340,
        toolCalls: 3,
        errors: 1,
      },
      errorEvents: [
        { eventId: "error-1", name: "shell", kind: "tool", status: "error", startMs: 1, durationMs: 50 },
      ],
      slowestEvents: [
        { eventId: "slow-1", name: "read_file", kind: "tool", status: "ok", startMs: 2, durationMs: 2_000 },
      ],
      highestTokenEvents: [],
      repeatedOperations: [
        { operationName: "search_code", count: 3, failureCount: 1, eventIds: ["repeat-1", "repeat-2", "repeat-3"] },
      ],
    },
  };
}

describe("sessionFactRows", () => {
  it("builds objective lifecycle, totals, slowest-event, and repeated-operation rows", () => {
    const rows = sessionFactRows(session());

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Lifecycle", value: "Complete" }),
      expect.objectContaining({ label: "Duration", value: "4.25s" }),
      expect.objectContaining({ label: "Errors", value: "1" }),
      expect.objectContaining({ label: "Tokens", value: "1.2k in / 340 out" }),
      expect.objectContaining({ label: "Slowest event: read_file", value: "2.00s", eventId: "slow-1" }),
      expect.objectContaining({ label: "Repeated operation: search_code", value: "3 calls, 1 error", eventId: "repeat-1" }),
    ]));
  });

  it("does not expose diagnostic language, paths, or raw event contents", () => {
    const input = session();
    input.facts.slowestEvents[0].name = "C:\\Users\\alice\\raw input root cause loop raw output";
    input.facts.repeatedOperations[0].operationName = "C:\\work\\root cause loop";
    const rows = sessionFactRows(input);
    const rendered = rows.map((row) => `${row.label} ${row.value}`).join(" ").toLowerCase();

    expect(rendered).not.toContain("root cause");
    expect(rendered).not.toContain("loop");
    expect(rendered).not.toContain("c:\\");
    expect(rendered).not.toContain("raw input");
    expect(rendered).not.toContain("raw output");
  });
});
