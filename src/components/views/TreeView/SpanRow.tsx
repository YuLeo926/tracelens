import type { RunNode } from "../../../core/types";
import { kindColor } from "../../../lib/kinds";
import { formatDuration } from "../../../core/format";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  node: RunNode;
  traceStart: number;
  traceDuration: number;
  selected: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  isMatch: boolean;
  query: string;
  showToggle: boolean;
  onSelect: () => void;
  onToggle: () => void;
  mark?: "good" | "bad" | "note";
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{name}</>;
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{name}</>;
  return (
    <>
      {name.slice(0, idx)}
      <mark
        className="rounded-sm"
        style={{ background: "color-mix(in srgb, var(--accent) 32%, transparent)", color: "var(--text)" }}
      >
        {name.slice(idx, idx + q.length)}
      </mark>
      {name.slice(idx + q.length)}
    </>
  );
}

export function SpanRow({
  node, traceStart, traceDuration, selected, hasChildren, collapsed,
  isMatch, query, showToggle, onSelect, onToggle, mark,
}: Props) {
  const isError = node.status === "error";
  const color = isError ? "var(--error)" : kindColor(node.kind);
  const leftPct = traceDuration > 0 ? ((node.startMs - traceStart) / traceDuration) * 100 : 0;
  const widthPct = traceDuration > 0 ? Math.max(0.8, (node.durationMs / traceDuration) * 100) : 100;

  const rowStyle: React.CSSProperties = { borderLeftColor: selected ? color : "transparent" };
  if (isMatch && !selected) {
    rowStyle.background = "color-mix(in srgb, var(--accent) 12%, transparent)";
  }

  return (
    <div
      data-span-id={node.spanId}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-label={`${node.name}${isError ? ", error" : ""}`}
      aria-pressed={selected}
      className={`span-row grid cursor-pointer items-center gap-2 border-l-2 py-2 pr-3 text-[13px] ${selected ? "bg-elev" : "hover:bg-panel-2"}`}
      style={rowStyle}
    >
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: 6 + Math.min(node.depth, 6) * 14 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex h-7 w-5 shrink-0 items-center justify-center text-muted"
          style={{ visibility: showToggle && hasChildren ? "visible" : "hidden" }}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 truncate" title={node.name} style={isError ? { color: "var(--error)" } : undefined}>
          <HighlightedName name={node.name} query={isMatch ? query : ""} />
        </span>
        {node.model && (
          <span className="span-model mono max-w-[140px] truncate rounded border border-border bg-bg px-1 text-[11px] text-muted" title={node.model}>
            {node.model}
          </span>
        )}
        {mark && (
          <span className="shrink-0 text-[11px]" title="annotated">
            {mark === "good" ? "👍" : mark === "bad" ? "👎" : "📝"}
          </span>
        )}
      </div>

      <div className="span-waterfall relative h-1.5 overflow-hidden rounded-full bg-track">
        <div
          className="absolute top-0 h-1.5 rounded-full"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color, opacity: 0.9 }}
        />
      </div>

      <span className="mono text-right text-[11px] text-muted">{formatDuration(node.durationMs)}</span>
    </div>
  );
}
