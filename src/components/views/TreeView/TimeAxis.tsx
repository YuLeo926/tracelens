import { formatDuration } from "../../../core/format";

export function TimeAxis({ durationMs }: { durationMs: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border-soft px-3.5 py-1.5 text-[9px] uppercase tracking-wider text-faint">
      <span>Call tree</span>
      <span className="mono">waterfall · {formatDuration(durationMs)}</span>
    </div>
  );
}
