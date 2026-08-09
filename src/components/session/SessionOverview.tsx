import type { RefObject } from "react";
import { formatCost, formatDuration, formatTokens } from "../../core/format";
import { sessionDisplayText } from "../../core/session/display";
import type { SessionLifecycle, SessionSummary } from "../../core/session/types";

export interface FactRow {
  id: string;
  label: string;
  value: string;
  eventId?: string;
}

const LIFECYCLE_LABEL: Record<SessionLifecycle, string> = {
  active: "Active",
  complete: "Complete",
  failed: "Failed",
  unknown: "Unknown",
};

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/** Maps server-provided, redacted facts to compact objective rows. */
export function sessionFactRows(session: SessionSummary): FactRow[] {
  const { facts } = session;
  const rows: FactRow[] = [
    { id: "lifecycle", label: "Lifecycle", value: LIFECYCLE_LABEL[facts.lifecycle] },
    { id: "duration", label: "Duration", value: formatDuration(facts.totals.durationMs) },
    { id: "errors", label: "Errors", value: String(facts.totals.errors) },
    { id: "tokens", label: "Tokens", value: `${formatTokens(facts.totals.tokensIn)} in / ${formatTokens(facts.totals.tokensOut)} out` },
    { id: "tool-calls", label: "Tool calls", value: String(facts.totals.toolCalls) },
  ];

  if (facts.totals.estimatedCostUsd !== undefined) {
    rows.push({ id: "estimated-cost", label: "Estimated cost", value: formatCost(facts.totals.estimatedCostUsd) });
  }

  rows.push(
    ...facts.errorEvents.map((event) => ({ id: `error-${event.eventId}`, label: `Error event: ${sessionDisplayText(event.name)}`, value: formatDuration(event.durationMs), eventId: event.eventId })),
    ...facts.slowestEvents.map((event) => ({ id: `slowest-${event.eventId}`, label: `Slowest event: ${sessionDisplayText(event.name)}`, value: formatDuration(event.durationMs), eventId: event.eventId })),
    ...facts.highestTokenEvents.map((event) => ({ id: `tokens-${event.eventId}`, label: `Highest-token event: ${sessionDisplayText(event.name)}`, value: `${formatTokens(event.tokensIn)} in / ${formatTokens(event.tokensOut)} out${event.tokenSharePercent === undefined ? "" : ` (${event.tokenSharePercent}%)`}`, eventId: event.eventId })),
    ...facts.repeatedOperations.map((operation) => ({
      id: `repeated-${operation.eventIds[0] ?? operation.operationName}`,
      label: `Repeated operation: ${sessionDisplayText(operation.operationName)}`,
      value: `${plural(operation.count, "call")}${operation.failureCount ? `, ${plural(operation.failureCount, "error")}` : ""}`,
      ...(operation.eventIds[0] === undefined ? {} : { eventId: operation.eventIds[0] }),
    })),
  );
  return rows;
}

function rowsWithPrefix(rows: FactRow[], prefix: string): FactRow[] {
  return rows.filter((row) => row.id.startsWith(prefix));
}

function FactSection({ title, rows, onOpenEvent }: { title: string; rows: FactRow[]; onOpenEvent: (eventId: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <section className="border-b border-border" aria-label={title}>
      <h2 className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{title}</h2>
      <div>
        {rows.map((row) => {
          const content = <><span className="min-w-0 break-words text-[13px] text-text">{row.label}</span><span className="mono shrink-0 text-[12px] text-muted">{row.value}</span></>;
          return row.eventId ? (
            <button key={row.id} type="button" onClick={() => onOpenEvent(row.eventId!)} className="flex min-h-10 w-full items-center justify-between gap-4 border-t border-border-soft px-4 py-2 text-left hover:bg-panel-2">
              {content}
            </button>
          ) : (
            <div key={row.id} className="flex min-h-10 items-center justify-between gap-4 border-t border-border-soft px-4 py-2">{content}</div>
          );
        })}
      </div>
    </section>
  );
}

interface Props {
  session: SessionSummary;
  onOpenEvent: (eventId: string) => void;
  onOpenPicker: () => void;
  sessionsButtonRef?: RefObject<HTMLButtonElement>;
}

export function SessionOverview({ session, onOpenEvent, onOpenPicker, sessionsButtonRef }: Props) {
  const rows = sessionFactRows(session);
  const totals = ["lifecycle", "duration", "errors", "tokens"].map((id) => rows.find((row) => row.id === id)!);
  const runRows = rows.filter((row) => !row.id.startsWith("error-") && !row.id.startsWith("slowest-") && !row.id.startsWith("tokens-") && !totals.includes(row));

  return (
    <div className="col-span-2 flex min-h-0 flex-1 flex-col overflow-auto bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h1 className="break-words text-sm font-semibold text-text">{sessionDisplayText(session.title, "Untitled session")}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted"><span className="capitalize">{session.provider}</span><span>{sessionDisplayText(session.project, "No project")}</span><span>{LIFECYCLE_LABEL[session.lifecycle]}</span></div>
        </div>
        <button ref={sessionsButtonRef} type="button" onClick={onOpenPicker} className="shrink-0 rounded border border-border px-2.5 py-1.5 text-[12px] text-muted hover:text-text">Sessions</button>
      </header>
      <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
        {totals.map((row) => <div key={row.id} className="border-r border-border-soft px-4 py-2 last:border-r-0"><div className="text-[9px] uppercase tracking-wider text-faint">{row.label}</div><div className="mono mt-0.5 text-[12px] text-text">{row.value}</div></div>)}
      </div>

      <FactSection title="Run facts" rows={runRows} onOpenEvent={onOpenEvent} />
      <FactSection title="Error events" rows={rowsWithPrefix(rows, "error-")} onOpenEvent={onOpenEvent} />
      <FactSection title="Slowest events" rows={rowsWithPrefix(rows, "slowest-")} onOpenEvent={onOpenEvent} />
      <FactSection title="Highest token events" rows={rowsWithPrefix(rows, "tokens-")} onOpenEvent={onOpenEvent} />
      <FactSection title="Repeated operations" rows={rowsWithPrefix(rows, "repeated-")} onOpenEvent={onOpenEvent} />
    </div>
  );
}
