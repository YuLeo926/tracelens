import { useState } from "react";
import type { ParsedTrace } from "../../../core/types";
import { flatten } from "../../../core/parse";
import { SpanRow } from "./SpanRow";
import { TimeAxis } from "./TimeAxis";

interface Props {
  trace: ParsedTrace;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TreeView({ trace, selectedId, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = flatten(trace.roots, collapsed);
  const { startMs, durationMs } = trace.summary;

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TimeAxis durationMs={durationMs} />
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {rows.map((node) => (
          <SpanRow
            key={node.spanId}
            node={node}
            traceStart={startMs}
            traceDuration={durationMs}
            selected={node.spanId === selectedId}
            hasChildren={node.children.length > 0}
            collapsed={collapsed.has(node.spanId)}
            onSelect={() => onSelect(node.spanId)}
            onToggle={() => toggle(node.spanId)}
          />
        ))}
      </div>
    </div>
  );
}
