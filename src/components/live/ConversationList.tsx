import { useState } from "react";
import { ThemeToggle } from "../shell/ThemeToggle";
import { formatRelativeTime } from "../../core/format";
import type { Conversation } from "../../hooks/useConversations";

interface Props {
  folderName: string;
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
  onOpen: (name: string) => void;
  onFollowNewest: () => void;
  onClose: () => void;
}

export function ConversationList({
  folderName, conversations, loading, error, onOpen, onFollowNewest, onClose,
}: Props) {
  const [filter, setFilter] = useState("");
  const now = Date.now();
  const q = filter.trim().toLowerCase();
  const rows = q
    ? conversations.filter(
        (c) =>
          (c.title ?? c.name).toLowerCase().includes(q) ||
          (c.project ?? "").toLowerCase().includes(q),
      )
    : conversations;

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-panel px-5 py-3">
        <span className="wordmark text-lg text-text">tracelens</span>
        <ThemeToggle />
      </header>

      <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2 text-[12px]">
        <span className="text-text">📂 {folderName}</span>
        <span className="text-faint">· {conversations.length} conversations</span>
        <button
          type="button"
          onClick={onFollowNewest}
          className="ml-2 rounded border border-accent px-2 py-0.5 text-text hover:bg-elev"
        >
          📡 Follow newest (live)
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-border px-2 py-0.5 text-text hover:border-accent"
        >
          Close
        </button>
      </div>

      <div className="border-b border-border px-4 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title or project…"
          className="w-full rounded border border-border bg-bg px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="p-6 text-sm text-error">Couldn't read that folder.</div>
        ) : conversations.length === 0 && !loading ? (
          <div className="p-6 text-sm text-muted">No conversations found in this folder.</div>
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
                        {c.project ?? "—"} · {formatRelativeTime(c.lastModified, now)}
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
            {loading && (
              <li className="px-4 py-3 text-[12px] text-faint">Loading titles…</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
