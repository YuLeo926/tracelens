import { SESSION_SIGNALS, type SessionSignal } from "../core/session/types";

export const MAX_SCAN_BYTES = 30 * 1024 * 1024;

// Parser changes can change error counts even when the source file is unchanged.
const KEY = "tracelens:failed:v3";
export interface CachedRunScan { errors: number; signals: SessionSignal[]; }

export function cacheKey(folderScope: string, name: string, lastModified: number, sizeBytes: number): string {
  return `${folderScope}:${name}:${lastModified}:${sizeBytes}`;
}

function storageOf(s?: Storage): Storage | null {
  if (s) return s;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadFailedCache(s?: Storage): Record<string, CachedRunScan> {
  const storage = storageOf(s);
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) =>
      value && typeof value === "object" && Number.isSafeInteger(value.errors) && value.errors >= 0
      && Array.isArray(value.signals) && value.signals.every((signal: SessionSignal) => SESSION_SIGNALS.includes(signal)),
    ));
  } catch {
    return {};
  }
}

export function saveFailedCache(cache: Record<string, CachedRunScan>, s?: Storage): void {
  const storage = storageOf(s);
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota or unavailable — scan still works in memory this session */
  }
}
