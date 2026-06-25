// Small formatting helpers shared across the UI. Pure and unit-testable.

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatTokens(n: number | undefined): string {
  if (!n) return "—";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

export function formatCost(usd: number | undefined): string {
  if (!usd) return "—";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour12: false });
  return `${time}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" / a date for older. */
export function formatRelativeTime(then: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString();
}
