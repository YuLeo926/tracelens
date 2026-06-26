import { describe, expect, it } from "vitest";
import { filterConversationRows, type ConversationListEmptyState } from "./ConversationList";
import type { Conversation } from "../../hooks/useConversations";

const conversations: Conversation[] = [
  { name: "a.jsonl", title: "Fix dashboard", project: "tracelens", lastModified: 10, sizeBytes: 1 },
  { name: "b.jsonl", title: "Ship listing", project: "ebay", lastModified: 9, sizeBytes: 1 },
];

describe("filterConversationRows", () => {
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
