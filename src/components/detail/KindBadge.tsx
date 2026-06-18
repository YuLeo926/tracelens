import type { SpanKind } from "../../core/types";
import { kindStyle } from "../../lib/kinds";

export function KindBadge({ kind }: { kind: SpanKind }) {
  const { label, color } = kindStyle(kind);
  return (
    <span
      className="mono inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
