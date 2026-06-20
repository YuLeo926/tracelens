import { useMemo, useState } from "react";
import type { ParsedTrace } from "../../core/types";
import { layoutFlame, metricTotal, type FlameMetric } from "../../core/flame";
import { kindColor } from "../../lib/kinds";
import { formatDuration, formatTokens, formatCost } from "../../core/format";

const ROW = 22;

const METRICS: Array<{ id: FlameMetric; label: string }> = [
  { id: "duration", label: "Duration" },
  { id: "tokens", label: "Tokens" },
  { id: "cost", label: "Cost" },
];

function fmt(metric: FlameMetric, v: number): string {
  if (metric === "duration") return formatDuration(v);
  if (metric === "tokens") return formatTokens(v);
  return formatCost(v);
}

interface Props {
  trace: ParsedTrace;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FlamegraphView({ trace, selectedId, onSelect }: Props) {
  const [metric, setMetric] = useState<FlameMetric>("duration");
  const totals = useMemo(
    () => ({
      duration: metricTotal(trace.roots, "duration"),
      tokens: metricTotal(trace.roots, "tokens"),
      cost: metricTotal(trace.roots, "cost"),
    }),
    [trace],
  );
  const layout = useMemo(() => layoutFlame(trace.roots, metric), [trace, metric]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border-soft px-3.5 py-1.5">
        <span className="text-[9px] uppercase tracking-wider text-faint">Flamegraph by</span>
        {METRICS.map((m) => {
          const empty = totals[m.id] <= 0;
          const active = m.id === metric;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => !empty && setMetric(m.id)}
              disabled={empty}
              title={empty ? `No ${m.label.toLowerCase()} data` : undefined}
              className={`rounded px-2 py-0.5 text-[11px] disabled:opacity-40 ${
                active ? "bg-elev text-accent-strong" : "text-muted hover:text-text"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {layout.cells.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-muted">No {metric} data in this trace.</div>
        ) : (
          <div className="relative w-full" style={{ height: (layout.maxDepth + 1) * ROW }}>
            {layout.cells.map((c) => {
              const color = c.status === "error" ? "var(--error)" : kindColor(c.kind);
              const widthPct = (c.x1 - c.x0) * 100;
              return (
                <button
                  key={c.spanId}
                  type="button"
                  onClick={() => onSelect(c.spanId)}
                  title={`${c.name} · ${fmt(metric, c.value)} · ${widthPct.toFixed(1)}%`}
                  className="absolute overflow-hidden rounded-sm border border-panel text-left text-[10px] leading-none text-white"
                  style={{
                    left: `${c.x0 * 100}%`,
                    width: `${widthPct}%`,
                    top: c.depth * ROW,
                    height: ROW - 2,
                    background: color,
                    outline: c.spanId === selectedId ? "2px solid var(--text)" : undefined,
                    outlineOffset: "-1px",
                  }}
                >
                  {widthPct > 4 && <span className="mono px-1">{c.name}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
