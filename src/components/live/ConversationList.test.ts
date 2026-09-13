import { describe, expect, it } from "vitest";
import { filterConversationRows, type ConversationListEmptyState } from "./ConversationList";
import type { Conversation } from "../../hooks/useConversations";
import { EMPTY_SESSION_FILTERS, sessionDateRange } from "../session/SessionFilters";

const conversations: Conversation[] = [
  { name: "a.jsonl", title: "Fix dashboard", project: "tracelens", lastModified: 10, sizeBytes: 1 },
  { name: "b.jsonl", title: "Ship listing", project: "ebay", lastModified: 9, sizeBytes: 1 },
];

describe("filterConversationRows", () => {
  it("combines inclusive dates and observed signals without labeling unscanned sessions", () => {
    const result = filterConversationRows(conversations, "", undefined, { since: 10, until: 10, signal: "recovered", signals: new Map([["a.jsonl", ["tool_errors", "recovered"]]]) });
    expect(result.rows.map((row) => row.name)).toEqual(["a.jsonl"]);
    expect(filterConversationRows(conversations, "", undefined, { signal: "unknown" }).rows).toEqual([]);
    expect(filterConversationRows(conversations, "", undefined, { invalid: true }).emptyState).toBe("filtered");
  });
  it("uses the full local calendar day and rejects reversed or invalid ranges", () => {
    const range = sessionDateRange({ ...EMPTY_SESSION_FILTERS, from: "2026-09-01", to: "2026-09-01" });
    expect(range.since).toBe(new Date(2026, 8, 1).getTime());
    expect(range.until).toBe(new Date(2026, 8, 2).getTime() - 1);
    expect(range.invalid).toBe(false);
    expect(sessionDateRange({ ...EMPTY_SESSION_FILTERS, from: "2026-09-02", to: "2026-09-01" }).invalid).toBe(true);
    expect(sessionDateRange({ ...EMPTY_SESSION_FILTERS, from: "invalid" }).invalid).toBe(true);
  });
  it("distinguishes an empty folder from a filtered no-match state", () => {
    expect(filterConversationRows([], "", undefined).emptyState).toBe<ConversationListEmptyState>("folder");

    const filtered = filterConversationRows(conversations, "missing", undefined);
    expect(filtered.rows).toEqual([]);
    expect(filtered.emptyState).toBe<ConversationListEmptyState>("filtered");
  });

  it("filters by project and text", () => {
    const filtered = filterConversationRows(conversations, "ship", "ebay");
    expect(filtered.rows.map((c) => c.name)).toEqual(["b.jsonl"]);
    expect(filtered.emptyState).toBeNull();
  });
});
