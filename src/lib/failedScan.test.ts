import { describe, expect, it } from "vitest";
import { cacheKey, loadFailedCache, saveFailedCache, MAX_SCAN_BYTES } from "./failedScan";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

describe("failedScan cache", () => {
  it("keys by folder scope + name + mtime + size", () => {
    expect(cacheKey("sessions", "a/b.jsonl", 123, 456)).toBe("sessions:a/b.jsonl:123:456");
  });
  it("round-trips and tolerates missing/corrupt", () => {
    const s = fakeStorage();
    const counts = { "a:1": { errors: 3, signals: ["tool_errors" as const] }, "b:2": { errors: 0, signals: [] } };
    saveFailedCache(counts, s);
    expect(loadFailedCache(s)).toEqual(counts);
    expect(loadFailedCache(fakeStorage())).toEqual({});
    expect(loadFailedCache(fakeStorage({ "tracelens:failed:v3": "nope" }))).toEqual({});
  });
  it("ignores counts calculated by the old tool-result parser", () => {
    const key = cacheKey("sessions", "run.jsonl", 123, 456);
    expect(loadFailedCache(fakeStorage({ "tracelens:failed": JSON.stringify({ [key]: 0 }) }))).toEqual({});
  });
  it("exposes a 30MB scan cap", () => {
    expect(MAX_SCAN_BYTES).toBe(30 * 1024 * 1024);
  });
});
