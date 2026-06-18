import type { TraceSummary } from "../core/types";
import { formatDuration, formatTokens, formatCost } from "../core/format";

export function Summary({ summary }: { summary: TraceSummary }) {
  const stats: Array<{ label: string; value: string; accent?: string }> = [
    { label: "Duration", value: formatDuration(summary.durationMs) },
    { label: "Spans", value: String(summary.spanCount) },
    { label: "LLM calls", value: String(summary.llmCalls), accent: "var(--accent)" },
    { label: "Tool calls", value: String(summary.toolCalls) },
    {
      label: "Tokens in / out",
      value: `${formatTokens(summary.totalTokensIn)} / ${formatTokens(summary.totalTokensOut)}`,
    },
    { label: "Cost", value: formatCost(summary.totalCostUsd) },
    {
      label: "Errors",
      value: String(summary.errors),
      accent: summary.errors ? "var(--error)" : undefined,
    },
  ];

  return (
    <div className="flex flex-wrap items-stretch">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className="flex flex-col gap-0.5 px-4 py-2"
          style={{ borderLeft: i ? "1px solid var(--border)" : "none" }}
        >
          <span
            className="text-[11px] uppercase tracking-wider"
            style={{ color: "var(--muted-2)" }}
          >
            {s.label}
          </span>
          <span className="mono text-sm" style={{ color: s.accent ?? "var(--text)" }}>
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}
