import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nextDialogFocusIndex, rankedSessions, sessionProject, sessionTitle } from "./SessionPicker";
import { SessionPicker } from "./SessionPicker";
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

  it("sanitizes titles and projects with the same policy as overview facts", () => {
    const item = session("unsafe", "exact", 1);
    item.title = "C:\\Users\\alice\\raw input root cause loop raw output";
    item.project = "C:\\work\\root cause loop";
    const rendered = `${sessionTitle(item)} ${sessionProject(item)}`.toLowerCase();

    expect(rendered).not.toContain("c:\\");
    expect(rendered).not.toContain("root cause");
    expect(rendered).not.toContain("loop");
    expect(rendered).not.toContain("raw input");
    expect(rendered).not.toContain("raw output");
  });

  it("wraps focus inside the dialog in both directions", () => {
    expect(nextDialogFocusIndex(2, 3, false)).toBe(0);
    expect(nextDialogFocusIndex(0, 3, true)).toBe(2);
    expect(nextDialogFocusIndex(-1, 3, false)).toBe(0);
    expect(nextDialogFocusIndex(-1, 3, true)).toBe(2);
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

  it("allows long unbroken title and project metadata to wrap in the packed 390 px dialog", () => {
    const item = session("long", "exact", 1);
    item.title = "t".repeat(400);
    item.project = "p".repeat(400);
    const html = renderToStaticMarkup(createElement(SessionPicker, {
      sessions: [item],
      activeId: "long",
      loading: false,
      error: null,
      onSelect: () => undefined,
      onClose: () => undefined,
    }));

    expect(html).toMatch(/data-session-title=""[^>]*class="[^"]*break-all/);
    expect(html).toMatch(/data-session-project=""[^>]*class="[^"]*break-all/);
  });
});
