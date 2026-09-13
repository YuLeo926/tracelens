import type { TraceSummary } from "../../core/types";
import { formatDuration, formatTokens, formatCost } from "../../core/format";

interface Stat {
  label: string;
  value: string;
  color?: string; // inline color for data-driven tones (e.g. LLM, errors)
  title?: string;
}

export function SummaryStrip({ summary }: { summary: TraceSummary }) {
  const stats: Stat[] = [
    { label: "Duration", value: formatDuration(summary.durationMs) },
    { label: "Spans", value: String(summary.spanCount) },
    { label: "LLM", value: String(summary.llmCalls), color: "var(--kind-llm)" },
    { label: "Tool", value: String(summary.toolCalls), color: "var(--kind-tool)" },
    {
      label: "Tokens",
      value: `${formatTokens(summary.totalTokensIn)} / ${formatTokens(summary.totalTokensOut)}`,
    },
    { label: "Cost subtotal", value: summary.costedSpanCount === 0 ? "Unavailable" : formatCost(summary.totalCostUsd), title: "Sum of available logged or adapter-estimated costs. Missing costs are excluded; this is not a billed amount." },
    {
      label: "Errors",
      value: String(summary.errors),
      color: summary.errors ? "var(--error)" : undefined,
    },
  ];

  return (
    <div className="flex flex-wrap border-b border-border bg-panel">
      {stats.map((s) => (
        <div key={s.label} title={s.title} className={`${["Duration", "Tokens", "Errors"].includes(s.label) ? "" : "hidden md:block"} border-r border-border-soft px-3 py-2`}>
          <div className="text-[10px] text-muted">{s.label}</div>
          <div className="mono text-sm text-text" style={s.color ? { color: s.color } : undefined}>
            {s.value}
          </div>
        </div>
      ))}
      <details className="w-full border-t border-border-soft px-3 py-1 text-xs text-muted md:hidden"><summary className="cursor-pointer">More totals</summary><dl className="grid grid-cols-2 gap-2 py-2">{stats.filter((s) => !["Duration", "Tokens", "Errors"].includes(s.label)).map((s) => <div key={s.label} title={s.title}><dt>{s.label}</dt><dd className="mono text-text">{s.value}</dd></div>)}</dl></details>
    </div>
  );
}
