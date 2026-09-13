import { SESSION_SIGNALS, type SessionSignal } from "../../core/session/types";
import { SIGNAL_LABELS } from "../../core/session/signals";
import { FilterX } from "lucide-react";

export interface SessionFilterValues { query: string; from: string; to: string; signal: "" | SessionSignal; }
export const EMPTY_SESSION_FILTERS: SessionFilterValues = { query: "", from: "", to: "", signal: "" };

export function sessionDateRange(values: SessionFilterValues) {
  const since = values.from ? new Date(`${values.from}T00:00:00`).getTime() : undefined;
  const end = values.to ? new Date(`${values.to}T00:00:00`) : undefined;
  if (end) end.setDate(end.getDate() + 1);
  const until = end ? end.getTime() - 1 : undefined;
  return { since, until, invalid: (since !== undefined && !Number.isFinite(since)) || (until !== undefined && !Number.isFinite(until)) || (since !== undefined && until !== undefined && since > until) };
}

export function SessionFilters({ values, onChange }: { values: SessionFilterValues; onChange: (values: SessionFilterValues) => void }) {
  const inputClass = "min-w-0 w-full rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-text";
  return <div className="border-b border-border px-4 py-2">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label className="col-span-2 text-[11px] text-muted sm:col-span-1">Keyword<input aria-label="Session keyword" placeholder="Title or project" value={values.query} onChange={(event) => onChange({ ...values, query: event.target.value })} className={inputClass} /></label>
      <label className="text-[11px] text-muted">Modified from<input aria-label="Modified from" type="date" value={values.from} onChange={(event) => onChange({ ...values, from: event.target.value })} className={inputClass} /></label>
      <label className="text-[11px] text-muted">Modified through<input aria-label="Modified through" type="date" value={values.to} onChange={(event) => onChange({ ...values, to: event.target.value })} className={inputClass} /></label>
      <div className="relative col-span-2 pr-11 sm:col-span-1"><label className="block text-[11px] text-muted">Observed signal<select aria-label="Observed signal" value={values.signal} onChange={(event) => onChange({ ...values, signal: event.target.value as SessionFilterValues["signal"] })} className={inputClass}>
        <option value="">All signals</option>{SESSION_SIGNALS.map((signal) => <option key={signal} value={signal}>{SIGNAL_LABELS[signal]}</option>)}
      </select></label>
      {(values.query || values.from || values.to || values.signal) && <button type="button" className="icon-button absolute bottom-0 right-0" title="Clear session filters" aria-label="Clear session filters" onClick={() => onChange(EMPTY_SESSION_FILTERS)}><FilterX size={16} /></button>}
      </div>
    </div>
    {sessionDateRange(values).invalid && <p role="alert" className="mt-1 text-[12px] text-error">Choose a valid date range.</p>}
  </div>;
}
