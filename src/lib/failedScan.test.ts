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
  it("keys by name + mtime", () => {
    expect(cacheKey("a/b.jsonl", 123)).toBe("a/b.jsonl:123");
  });
  it("round-trips and tolerates missing/corrupt", () => {
    const s = fakeStorage();
    saveFailedCache({ "a:1": 3, "b:2": 0 }, s); // error counts
    expect(loadFailedCache(s)).toEqual({ "a:1": 3, "b:2": 0 });
    expect(loadFailedCache(fakeStorage())).toEqual({});
    expect(loadFailedCache(fakeStorage({ "tracelens:failed": "nope" }))).toEqual({});
  });
  it("exposes a 30MB scan cap", () => {
    expect(MAX_SCAN_BYTES).toBe(30 * 1024 * 1024);
  });
});
