import type { RunNode } from "../../../core/types";
import { kindColor } from "../../../lib/kinds";
import { formatDuration } from "../../../core/format";

interface Props {
  node: RunNode;
  traceStart: number;
  traceDuration: number;
  selected: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

export function SpanRow({
  node,
  traceStart,
  traceDuration,
  selected,
  hasChildren,
  collapsed,
  onSelect,
  onToggle,
}: Props) {
  const isError = node.status === "error";
  const color = isError ? "var(--error)" : kindColor(node.kind);
  const leftPct =
    traceDuration > 0 ? ((node.startMs - traceStart) / traceDuration) * 100 : 0;
  const widthPct =
    traceDuration > 0 ? Math.max(0.8, (node.durationMs / traceDuration) * 100) : 100;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_150px_56px] items-center gap-2.5 border-l-2 py-1.5 pr-3 text-[12px] ${
        selected ? "bg-elev" : "hover:bg-panel-2"
      }`}
      style={{ borderLeftColor: selected ? color : "transparent" }}
    >
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: 6 + node.depth * 18 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mono flex h-4 w-3 shrink-0 items-center justify-center text-[9px] text-faint"
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▶" : "▾"}
        </button>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate" style={isError ? { color: "var(--error)" } : undefined}>
          {node.name}
        </span>
        {node.model && (
          <span className="mono shrink-0 rounded border border-border bg-bg px-1 text-[10px] text-muted">
            {node.model}
          </span>
        )}
      </div>

      <div className="relative h-1.5 rounded-full bg-track">
        <div
          className="absolute top-0 h-1.5 rounded-full"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color, opacity: 0.9 }}
        />
      </div>

      <span className="mono text-right text-[11px] text-muted">
        {formatDuration(node.durationMs)}
      </span>
    </div>
  );
}
