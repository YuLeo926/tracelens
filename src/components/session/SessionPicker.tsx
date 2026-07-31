import { useEffect } from "react";
import { formatRelativeTime, formatTokens } from "../../core/format";
import { redactText } from "../../core/session/sanitize";
import type { ProjectMatch, SessionSummary } from "../../core/session/types";

const MATCH_RANK: Record<ProjectMatch, number> = { exact: 0, related: 1, fallback: 2 };

export function sessionTitle(session: SessionSummary): string {
  return redactText(session.title ?? "").trim() || "Untitled session";
}

export function sessionProject(session: SessionSummary): string {
  return redactText(session.project ?? "").trim() || "No project";
}

export function rankedSessions(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((left, right) => MATCH_RANK[left.match] - MATCH_RANK[right.match] || right.modifiedAt - left.modifiedAt || (right.startMs ?? Number.NEGATIVE_INFINITY) - (left.startMs ?? Number.NEGATIVE_INFINITY) || left.id.localeCompare(right.id));
}

interface Props {
  sessions: SessionSummary[];
  activeId: string;
  loading: boolean;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

export function SessionPicker({ sessions, activeId, loading, onSelect, onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = rankedSessions(sessions);
  const now = Date.now();
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-text/20 p-2" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="session-picker-title" className="flex max-h-[min(40rem,calc(100vh-1rem))] w-[min(44rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-lg" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border px-4 py-3"><h2 id="session-picker-title" className="text-sm font-semibold text-text">Sessions</h2><button type="button" autoFocus onClick={onClose} aria-label="Close session picker" title="Close" className="h-7 w-7 rounded text-[16px] text-muted hover:bg-panel-2 hover:text-text">x</button></header>
        <div className="min-h-0 overflow-auto">
          {rows.map((session) => {
            const active = session.id === activeId;
            const facts = session.facts.totals;
            return <button key={session.id} type="button" onClick={() => onSelect(session.id)} disabled={loading} aria-current={active ? "true" : undefined} className={`flex min-h-[76px] w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left hover:bg-panel-2 disabled:cursor-wait ${active ? "bg-elev" : ""}`}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: session.lifecycle === "failed" ? "var(--error)" : "var(--kind-agent)" }} />
              <span className="min-w-0 flex-1"><span className="block break-words text-[13px] leading-5 text-text">{sessionTitle(session)}</span><span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted"><span className="capitalize">{session.provider}</span><span>{sessionProject(session)}</span><span>{formatRelativeTime(session.modifiedAt, now)}</span><span className="capitalize">{session.lifecycle}</span><span>{facts.errors} errors</span><span className="mono">{formatTokens(facts.tokensIn)} / {formatTokens(facts.tokensOut)}</span></span></span>
            </button>;
          })}
          {rows.length === 0 && <div className="px-4 py-5 text-sm text-muted">No sessions are available.</div>}
        </div>
      </section>
    </div>
  );
}
