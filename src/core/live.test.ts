import { describe, expect, it } from "vitest";
import { pickNewestTraceFile, latestSpanId } from "./live";
import { parseTrace } from "./parse";

describe("pickNewestTraceFile", () => {
  it("picks the newest .json/.jsonl by lastModified", () => {
    expect(
      pickNewestTraceFile([
        { name: "a/old.jsonl", lastModified: 1 },
        { name: "a/new.jsonl", lastModified: 2 },
      ]),
    ).toBe("a/new.jsonl");
  });

  it("ignores files that are not .json or .jsonl", () => {
    expect(
      pickNewestTraceFile([
        { name: "run.jsonl", lastModified: 1 },
        { name: "notes.txt", lastModified: 99 },
      ]),
    ).toBe("run.jsonl");
  });

  it("breaks ties by name descending", () => {
    expect(
      pickNewestTraceFile([
        { name: "a.jsonl", lastModified: 5 },
        { name: "b.jsonl", lastModified: 5 },
      ]),
    ).toBe("b.jsonl");
  });

  it("returns null when there are no trace files", () => {
    expect(pickNewestTraceFile([{ name: "x.txt", lastModified: 1 }])).toBeNull();
    expect(pickNewestTraceFile([])).toBeNull();
  });
});

describe("latestSpanId", () => {
  it("returns the span with the greatest startMs", () => {
    const trace = parseTrace([
      { span_id: "first", name: "a", start_time: 0, end_time: 1, attributes: {} },
      { span_id: "later", name: "b", start_time: 5, end_time: 6, attributes: {} },
    ]);
    expect(latestSpanId(trace.roots)).toBe("later");
  });

  it("returns null for an empty list", () => {
    expect(latestSpanId([])).toBeNull();
  });
});
