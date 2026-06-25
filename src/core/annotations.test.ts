import { describe, expect, it } from "vitest";
import { isAnnotated, toStored, buildRows, toJSONL, toCSV, SNAPSHOT_CAP, type StoredAnnotation } from "./annotations";
import type { RunNode } from "./types";

const node = (over: Partial<RunNode> = {}): RunNode => ({
  spanId: "s1", parentSpanId: null, traceId: "", name: "step", kind: "tool",
  startMs: 0, endMs: 1, status: "ok", attributes: {}, children: [], depth: 0, durationMs: 1,
  ...over,
});

describe("isAnnotated", () => {
  it("is false when empty/whitespace, true when any field set", () => {
    expect(isAnnotated({})).toBe(false);
    expect(isAnnotated({ note: "  " })).toBe(false);
    expect(isAnnotated({ verdict: "good" })).toBe(true);
    expect(isAnnotated({ tag: "x" })).toBe(true);
    expect(isAnnotated({ note: "hi" })).toBe(true);
  });
});

describe("toStored", () => {
  it("captures the span snapshot and truncates input/output", () => {
    const s = toStored(
      { verdict: "bad", tag: " bug ", note: "" },
      node({ name: "n", kind: "llm", model: "m", input: "x".repeat(9000), output: "y" }),
    );
    expect(s).toMatchObject({ verdict: "bad", tag: " bug ", name: "n", kind: "llm", model: "m", output: "y" });
    expect(s.note).toBeUndefined(); // "" -> not stored
    expect(s.input!.length).toBe(SNAPSHOT_CAP);
  });
});

describe("buildRows / toJSONL / toCSV", () => {
  const store: Record<string, Record<string, StoredAnnotation>> = {
    "a.jsonl": { s1: { name: "run, step", kind: "tool", verdict: "good", note: 'has "quote"\nand newline' } },
    "b.jsonl": { s2: { name: "x", kind: "llm", input: "z".repeat(500) } },
  };

  it("builds rows across the given labels", () => {
    expect(buildRows(store, ["a.jsonl"])).toHaveLength(1);
    expect(buildRows(store, ["a.jsonl", "b.jsonl"])).toHaveLength(2);
    expect(buildRows(store, ["a.jsonl"])[0]).toMatchObject({
      conversation: "a.jsonl", span_id: "s1", verdict: "good", tag: "", model: "",
    });
  });

  it("toJSONL is one parseable object per line", () => {
    const lines = toJSONL(buildRows(store, ["a.jsonl", "b.jsonl"])).split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).conversation).toBe("a.jsonl");
  });

  it("toCSV escapes commas/quotes/newlines, truncates input/output, and has a header", () => {
    const csv = toCSV(buildRows(store, ["a.jsonl", "b.jsonl"]));
    expect(csv.startsWith("conversation,span_id,name,kind,model,input,output,verdict,tag,note")).toBe(true);
    expect(csv).toContain('"run, step"');        // comma -> quoted
    expect(csv).toContain('"has ""quote""');     // quote -> doubled inside quotes
    expect(csv).toContain("z".repeat(300));
    expect(csv).not.toContain("z".repeat(301));  // input truncated to 300 in CSV
  });
});
