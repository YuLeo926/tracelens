export type FailedState = "ok" | "failed" | "skipped" | "unknown";
export const MAX_SCAN_BYTES = 30 * 1024 * 1024;

const KEY = "tracelens:failed";

export function cacheKey(name: string, lastModified: number): string {
  return `${name}:${lastModified}`;
}

function storageOf(s?: Storage): Storage | null {
  if (s) return s;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadFailedCache(s?: Storage): Record<string, FailedState> {
  const storage = storageOf(s);
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, FailedState>) : {};
  } catch {
    return {};
  }
}

export function saveFailedCache(cache: Record<string, FailedState>, s?: Storage): void {
  const storage = storageOf(s);
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota or unavailable — scan still works in memory this session */
  }
}
