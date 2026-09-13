import { useState } from "react";
import { formatRelativeTime } from "../../core/format";
import type { Conversation } from "../../hooks/useConversations";
import type { SessionSignal } from "../../core/session/types";
import { SIGNAL_LABELS } from "../../core/session/signals";
import { EMPTY_SESSION_FILTERS, SessionFilters, sessionDateRange } from "../session/SessionFilters";

interface Props {
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
  onOpen: (name: string) => void;
  projectFilter?: string;
  signals?: Map<string, SessionSignal[]>;
  selectedName?: string;
}

export type ConversationListEmptyState = "folder" | "filtered";

export function filterConversationRows(
  conversations: Conversation[],
  filter: string,
  projectFilter?: string,
  options: { since?: number; until?: number; signal?: SessionSignal; signals?: Map<string, SessionSignal[]>; invalid?: boolean } = {},
): { rows: Conversation[]; emptyState: ConversationListEmptyState | null } {
  const q = filter.trim().toLowerCase();
  const rows = conversations.filter((c) => {
    if (options.invalid) return false;
    if (options.since !== undefined && c.lastModified < options.since) return false;
    if (options.until !== undefined && c.lastModified > options.until) return false;
    if (options.signal && !options.signals?.get(c.name)?.includes(options.signal)) return false;
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

export function ConversationList({ conversations, loading, error, onOpen, projectFilter, signals, selectedName }: Props) {
  const [filters, setFilters] = useState(EMPTY_SESSION_FILTERS);
  const now = Date.now();
  const { rows, emptyState } = filterConversationRows(conversations, filters.query, projectFilter, { ...sessionDateRange(filters), signal: filters.signal || undefined, signals });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionFilters values={filters} onChange={setFilters} />
      <div className="border-b border-border px-4 py-1 text-xs text-muted" role="status">{rows.length} of {conversations.length} conversations</div>
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
                    aria-current={c.name === selectedName ? "true" : undefined}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-panel-2 ${c.name === selectedName ? "bg-elev" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-text">{c.title ?? c.name}</div>
                      <div className="mono break-words text-[12px] text-muted">
                        {c.project ?? "-"} - {formatRelativeTime(c.lastModified, now)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted">
                        {(signals?.get(c.name) ?? []).map((signal) => <span key={signal} title={signal === "recovered" ? "The same operation later succeeded; the overall task may still have failed." : undefined}>{SIGNAL_LABELS[signal]}</span>)}
                        {!signals?.has(c.name) && <span>Not analyzed</span>}
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
