import type { RunNode } from "../core/types";
import { kindStyle, ERROR_COLOR } from "../lib/kinds";
import { formatDuration } from "../core/format";

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
  const { color } = kindStyle(node.kind);
  const barColor = node.status === "error" ? ERROR_COLOR : color;
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
      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_190px] items-center gap-3 border-l-2 py-1.5 pr-3 text-sm"
      style={{
        borderLeftColor: selected ? barColor : "transparent",
        background: selected ? "var(--elev)" : "transparent",
      }}
    >
      <div
        className="flex min-w-0 items-center gap-2"
        style={{ paddingLeft: 8 + node.depth * 18 }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mono flex h-4 w-4 shrink-0 items-center justify-center text-[9px]"
          style={{
            color: "var(--muted-2)",
            visibility: hasChildren ? "visible" : "hidden",
          }}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "\u25B6" : "\u25BC"}
        </button>
        <span
          className="h-2 w-2 shrink-0 rounded-sm"
          style={{ background: barColor }}
        />
        <span
          className="truncate"
          style={{ color: node.status === "error" ? ERROR_COLOR : "var(--text)" }}
        >
          {node.name}
        </span>
        {node.model && (
          <span
            className="mono shrink-0 text-[11px]"
            style={{ color: "var(--muted-2)" }}
          >
            {node.model}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div
          className="relative h-1.5 flex-1 rounded-full"
          style={{ background: "var(--border-soft)" }}
        >
          <div
            className="absolute top-0 h-1.5 rounded-full"
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              background: barColor,
              opacity: 0.85,
            }}
          />
        </div>
        <span
          className="mono w-14 shrink-0 text-right text-[11px]"
          style={{ color: "var(--muted)" }}
        >
          {formatDuration(node.durationMs)}
        </span>
      </div>
    </div>
  );
}
