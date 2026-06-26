import { useState } from "react";
import { formatRelativeTime } from "../../core/format";
import type { Conversation } from "../../hooks/useConversations";

interface Props {
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
  onOpen: (name: string) => void;
  projectFilter?: string;
}

export type ConversationListEmptyState = "folder" | "filtered";

export function filterConversationRows(
  conversations: Conversation[],
  filter: string,
  projectFilter?: string,
): { rows: Conversation[]; emptyState: ConversationListEmptyState | null } {
  const q = filter.trim().toLowerCase();
  const rows = conversations.filter((c) => {
    if (projectFilter && (c.project ?? "(unknown)") !== projectFilter) return false;
    if (!q) return true;
    return (c.title ?? c.name).toLowerCase().includes(q) || (c.project ?? "").toLowerCase().includes(q);
  });
  const emptyState = rows.length === 0
    ? conversations.length === 0
      ? "folder"
      : "filtered"
    : null;
  return { rows, emptyState };
}

export function ConversationList({ conversations, loading, error, onOpen, projectFilter }: Props) {
  const [filter, setFilter] = useState("");
  const now = Date.now();
  const { rows, emptyState } = filterConversationRows(conversations, filter, projectFilter);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={projectFilter ? `Filter in ${projectFilter}...` : "Filter by title or project..."}
          className="w-full rounded border border-border bg-bg px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="p-6 text-sm text-error">Couldn't read that folder.</div>
        ) : emptyState === "folder" && !loading ? (
          <div className="p-6 text-sm text-muted">No conversations found in this folder.</div>
        ) : emptyState === "filtered" && !loading ? (
          <div className="p-6 text-sm text-muted">No conversations match the current filter.</div>
        ) : (
          <ul>
            {rows.map((c) => {
              const active = now - c.lastModified < 120_000;
              return (
                <li key={c.name} className="border-b border-border">
                  <button
                    type="button"
                    onClick={() => onOpen(c.name)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-panel-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-text">{c.title ?? c.name}</div>
                      <div className="mono text-[11px] text-faint">
                        {c.project ?? "-"} - {formatRelativeTime(c.lastModified, now)}
                      </div>
                    </div>
                    {active && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: "var(--kind-agent)" }}
                        title="recently active"
                      />
                    )}
                  </button>
                </li>
              );
            })}
            {loading && <li className="px-4 py-3 text-[12px] text-faint">Loading titles...</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
