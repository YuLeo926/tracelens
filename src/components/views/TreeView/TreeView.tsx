import { useEffect, useRef, useState } from "react";
import type { ParsedTrace } from "../../../core/types";
import type { StoredAnnotation } from "../../../core/annotations";
import { flatten } from "../../../core/parse";
import { SpanRow } from "./SpanRow";
import { TimeAxis } from "./TimeAxis";

interface Props {
  trace: ParsedTrace;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filtering: boolean;
  visibleIds: Set<string> | null;
  matchIds: Set<string> | null;
  currentMatchId: string | null;
  query: string;
  followId?: string | null;
  onUserScroll?: () => void;
  annotations?: Record<string, StoredAnnotation> | null;
}

export function TreeView({
  trace, selectedId, onSelect, filtering, visibleIds, matchIds, currentMatchId, query,
  followId, onUserScroll, annotations,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { startMs, durationMs } = trace.summary;
  const containerRef = useRef<HTMLDivElement>(null);

  // When filtering, ignore the collapse set and show matches + ancestors only.
  const allRows = flatten(trace.roots, filtering ? undefined : collapsed);
  const rows = filtering && visibleIds ? allRows.filter((n) => visibleIds.has(n.spanId)) : allRows;

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!currentMatchId) return;
    const el = containerRef.current?.querySelector(`[data-span-id="${currentMatchId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [currentMatchId]);

  useEffect(() => {
    if (!followId) return;
    const el = containerRef.current?.querySelector(`[data-span-id="${followId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [followId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TimeAxis durationMs={durationMs} />
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto py-1"
        onWheel={onUserScroll}
        onTouchMove={onUserScroll}
      >
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-muted">No spans match "{query}".</div>
        ) : (
          rows.map((node) => (
            <SpanRow
              key={node.spanId}
              node={node}
              traceStart={startMs}
              traceDuration={durationMs}
              selected={node.spanId === selectedId}
              hasChildren={node.children.length > 0}
              collapsed={collapsed.has(node.spanId)}
              isMatch={matchIds?.has(node.spanId) ?? false}
              query={query}
              showToggle={!filtering}
              onSelect={() => onSelect(node.spanId)}
              onToggle={() => toggle(node.spanId)}
              mark={(() => {
                const a = annotations?.[node.spanId];
                return a ? (a.verdict ?? "note") : undefined;
              })()}
            />
          ))
        )}
      </div>
    </div>
  );
}
