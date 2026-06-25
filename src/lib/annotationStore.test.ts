import { describe, expect, it } from "vitest";
import { loadStore, loadForLabel, saveForLabel } from "./annotationStore";
import type { StoredAnnotation } from "../core/annotations";

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

const ann: StoredAnnotation = { name: "n", kind: "tool", verdict: "good" };

describe("annotationStore", () => {
  it("round-trips save/load for a label", () => {
    const s = fakeStorage();
    saveForLabel("a.jsonl", { s1: ann }, s);
    expect(loadForLabel("a.jsonl", s)).toEqual({ s1: ann });
    expect(loadStore(s)).toEqual({ "a.jsonl": { s1: ann } });
  });

  it("deletes a label's bucket when saved empty", () => {
    const s = fakeStorage();
    saveForLabel("a.jsonl", { s1: ann }, s);
    saveForLabel("a.jsonl", {}, s);
    expect(loadStore(s)).toEqual({});
  });

  it("returns {} for missing or corrupt data", () => {
    expect(loadStore(fakeStorage())).toEqual({});
    expect(loadStore(fakeStorage({ "tracelens:annotations": "not json" }))).toEqual({});
  });

  it("swallows a throwing storage", () => {
    const throwing = {
      length: 0, clear() {}, key: () => null, removeItem() {},
      getItem: () => { throw new Error("x"); },
      setItem: () => { throw new Error("x"); },
    } as unknown as Storage;
    expect(() => saveForLabel("a", { s1: ann }, throwing)).not.toThrow();
    expect(loadStore(throwing)).toEqual({});
  });
});
