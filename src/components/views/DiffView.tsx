import { useCallback, useMemo, useState } from "react";
import type { ParsedTrace } from "../../core/types";
import { parseTraceText } from "../../core/parse";
import { diffTraces, flattenDiff, type DiffStat } from "../../core/diff";
import { kindColor } from "../../lib/kinds";
import { formatDuration, formatTokens, formatCost } from "../../core/format";

interface Props {
  trace: ParsedTrace;
  label: string;
}

// undefined polarity = neutral (muted); true = higher is worse (red when up).
function deltaColor(delta: number, worseWhenUp?: boolean): string {
  if (delta === 0 || worseWhenUp === undefined) return "var(--muted)";
  const worse = worseWhenUp ? delta > 0 : delta < 0;
  return worse ? "var(--error)" : "var(--kind-evaluator)";
}

function pct(s: DiffStat): string {
  if (s.a <= 0) return "";
  return ` (${s.delta >= 0 ? "+" : ""}${((s.delta / s.a) * 100).toFixed(0)}%)`;
}

function StatCell({
  label,
  s,
  fmt,
  worseWhenUp,
}: {
  label: string;
  s: DiffStat;
  fmt: (n: number) => string;
  worseWhenUp?: boolean;
}) {
  return (
    <div className="border-r border-border-soft px-4 py-2">
      <div className="text-[9px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mono text-[12px] text-text">
        {fmt(s.a)} → {fmt(s.b)}
      </div>
      <div className="mono text-[11px]" style={{ color: deltaColor(s.delta, worseWhenUp) }}>
        {s.delta === 0 ? "no change" : `${s.delta > 0 ? "+" : "-"}${fmt(Math.abs(s.delta))}${pct(s)}`}
      </div>
    </div>
  );
}

export function DiffView({ trace, label }: Props) {
  const [traceB, setTraceB] = useState<ParsedTrace | null>(null);
  const [labelB, setLabelB] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const ingest = useCallback((text: string, name: string) => {
    try {
      setTraceB(parseTraceText(text));
      setLabelB(name);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse that trace.");
    }
  }, []);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      f.text().then((t) => ingest(t, f.name)).catch(() => setError("Could not read that file."));
    },
    [ingest],
  );

  const diff = useMemo(() => (traceB ? diffTraces(trace, traceB) : null), [trace, traceB]);
  const rows = useMemo(() => (diff ? flattenDiff(diff.roots) : []), [diff]);

  if (!traceB || !diff) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          className="flex w-full max-w-md cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center"
          style={{
            borderColor: dragging ? "var(--accent)" : "var(--border)",
            background: dragging ? "var(--elev)" : "var(--panel)",
          }}
        >
          <span className="text-sm text-text">
            Compare <span className="mono">{label || "this trace"}</span> against another run
          </span>
          <span className="text-[12px] text-faint">drop a second trace here, or click to choose</span>
          <input
            type="file"
            accept="application/json,.json,.jsonl"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
        {error && <div className="mt-3 text-[12px] text-error">{error}</div>}
      </div>
    );
  }

  const s = diff.summary;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-stretch border-b border-border bg-panel">
        <div className="flex items-center border-r border-border-soft px-3 py-2 text-[10px] text-faint">
          <span className="mono truncate text-text">{label || "A"}</span>
          <span className="px-1">→</span>
          <span className="mono truncate text-text">{labelB}</span>
          <button
            type="button"
            onClick={() => {
              setTraceB(null);
              setLabelB("");
            }}
            className="ml-2 shrink-0 rounded border border-border px-1.5 text-[10px] text-muted hover:text-text"
          >
            change
          </button>
        </div>
        <StatCell label="Duration" s={s.durationMs} fmt={formatDuration} worseWhenUp />
        <StatCell label="Tokens" s={s.tokens} fmt={formatTokens} worseWhenUp />
        <StatCell label="Cost" s={s.costUsd} fmt={formatCost} worseWhenUp />
        <StatCell label="Errors" s={s.errors} fmt={(n) => String(n)} worseWhenUp />
        <StatCell label="Spans" s={s.spanCount} fmt={(n) => String(n)} />
      </div>

      <div className="flex items-center justify-between border-b border-border-soft px-3.5 py-1.5 text-[9px] uppercase tracking-wider text-faint">
        <span>Merged call tree</span>
        <span>A → B · Δ</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {rows.map((n) => {
          const node = n.b ?? n.a!;
          const color = node.status === "error" ? "var(--error)" : kindColor(n.kind);
          const aDur = n.a ? formatDuration(n.a.durationMs) : "—";
          const bDur = n.b ? formatDuration(n.b.durationMs) : "—";
          const dDelta = (n.b?.durationMs ?? 0) - (n.a?.durationMs ?? 0);
          const rowBg =
            n.status === "added"
              ? "color-mix(in srgb, var(--kind-evaluator) 12%, transparent)"
              : n.status === "removed"
                ? "color-mix(in srgb, var(--error) 10%, transparent)"
                : undefined;
          return (
            <div
              key={n.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1 pr-3 text-[12px]"
              style={rowBg ? { background: rowBg } : undefined}
            >
              <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: 10 + n.depth * 16 }}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                <span className={`truncate ${n.status === "removed" ? "line-through opacity-70" : ""}`}>
                  {n.name}
                </span>
                {n.status === "added" && (
                  <span className="mono shrink-0 text-[10px]" style={{ color: "var(--kind-evaluator)" }}>＋ only in B</span>
                )}
                {n.status === "removed" && (
                  <span className="mono shrink-0 text-[10px]" style={{ color: "var(--error)" }}>－ only in A</span>
                )}
              </div>
              <div className="mono flex shrink-0 items-center gap-2 text-[11px] text-muted">
                <span>
                  {aDur} → {bDur}
                </span>
                {n.status === "matched" && dDelta !== 0 && (
                  <span style={{ color: deltaColor(dDelta, true) }}>
                    {dDelta > 0 ? "+" : "-"}
                    {formatDuration(Math.abs(dDelta))}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
