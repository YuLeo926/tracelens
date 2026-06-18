import type { TraceSummary } from "../../core/types";
import { formatDuration, formatTokens, formatCost } from "../../core/format";

interface Stat {
  label: string;
  value: string;
  color?: string; // inline color for data-driven tones (e.g. LLM, errors)
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
    { label: "Cost", value: formatCost(summary.totalCostUsd) },
    {
      label: "Errors",
      value: String(summary.errors),
      color: summary.errors ? "var(--error)" : undefined,
    },
  ];

  return (
    <div className="flex flex-wrap border-b border-border bg-panel">
      {stats.map((s) => (
        <div key={s.label} className="border-r border-border-soft px-4 py-2">
          <div className="text-[9px] uppercase tracking-wider text-faint">{s.label}</div>
          <div className="mono text-sm text-text" style={s.color ? { color: s.color } : undefined}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
