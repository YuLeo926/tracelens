import { describe, it, expect } from "vitest";
import { parseTrace, flatten, TraceParseError, decodeTraceText } from "./parse";
import { toMs } from "./openinference";
import { formatDuration, formatTokens, formatCost } from "./format";
import research from "../../public/samples/research-agent.json";
import toolError from "../../public/samples/tool-error.json";

describe("parseTrace", () => {
  it("builds a tree with a single root from the research sample", () => {
    const t = parseTrace(research);
    expect(t.roots).toHaveLength(1);
    expect(t.roots[0].name).toBe("research_agent.run");
    expect(t.roots[0].kind).toBe("agent");
  });

  it("nests the retriever under the web_search tool span", () => {
    const t = parseTrace(research);
    const root = t.roots[0];
    const webSearch = root.children.find((c) => c.name === "tool.web_search");
    expect(webSearch).toBeDefined();
    expect(webSearch!.children.map((c) => c.name)).toContain("retriever.vector_search");
    expect(webSearch!.children[0].depth).toBe(2);
  });

  it("orders children chronologically", () => {
    const t = parseTrace(research);
    const starts = t.roots[0].children.map((c) => c.startMs);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });

  it("computes a correct summary roll-up", () => {
    const { summary } = parseTrace(research);
    expect(summary.spanCount).toBe(7);
    expect(summary.llmCalls).toBe(3);
    expect(summary.toolCalls).toBe(2);
    expect(summary.errors).toBe(0);
    expect(summary.totalTokensIn).toBe(210 + 540 + 720);
    expect(summary.totalTokensOut).toBe(95 + 60 + 140);
    expect(summary.totalCostUsd).toBeCloseTo(0.01, 5);
    expect(summary.durationMs).toBe(6010);
  });

  it("flags error spans in the tool-error sample", () => {
    const t = parseTrace(toolError);
    expect(t.summary.errors).toBe(1);
    const errored = flatten(t.roots).find((n) => n.status === "error");
    expect(errored?.name).toBe("tool.web_search");
    expect(errored?.statusMessage).toContain("503");
  });

  it("throws a helpful error on empty input", () => {
    expect(() => parseTrace([])).toThrow(TraceParseError);
    expect(() => parseTrace({})).toThrow(/No spans found/);
  });

  it("rejects duplicate span ids before building the tree", () => {
    expect(() =>
      parseTrace([
        { span_id: "dup", name: "first", start_time: 0, end_time: 1, attributes: {} },
        { span_id: "dup", name: "second", start_time: 1, end_time: 2, attributes: {} },
      ]),
    ).toThrow(/Duplicate span id "dup"/);
  });

  it("rejects spans with invalid timing fields", () => {
    expect(() =>
      parseTrace([
        { span_id: "bad-time", name: "step", start_time: "not-a-date", end_time: 1, attributes: {} },
      ]),
    ).toThrow(/invalid start time/);
  });
});

describe("toMs", () => {
  it("parses ISO, epoch-ms and unix-nano", () => {
    expect(toMs("2026-06-18T10:00:00.000Z")).toBe(Date.parse("2026-06-18T10:00:00.000Z"));
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMs(1_700_000_000_000_000_000)).toBe(1_700_000_000_000);
  });
});

describe("formatting", () => {
  it("formats durations across ranges", () => {
    expect(formatDuration(30)).toBe("30ms");
    expect(formatDuration(1740)).toBe("1.74s");
    expect(formatDuration(65000)).toBe("1m 5s");
  });
  it("formats tokens and cost", () => {
    expect(formatTokens(540)).toBe("540");
    expect(formatTokens(1470)).toBe("1.5k");
    expect(formatCost(0.0021)).toBe("$0.0021");
    expect(formatCost(undefined)).toBe("—");
  });
});

describe("decodeTraceText", () => {
  it("parses whole-file JSON", () => {
    expect(decodeTraceText('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it("parses JSONL into an array, skipping blank lines", () => {
    expect(decodeTraceText('{"type":"a"}\n\n{"type":"b"}\n')).toEqual([
      { type: "a" },
      { type: "b" },
    ]);
  });
  it("rejects malformed non-empty JSONL lines instead of dropping them", () => {
    expect(() => decodeTraceText('{"type":"a"}\nnot json\n{"type":"b"}')).toThrow(
      /line 2/,
    );
  });
  it("throws on text that is neither JSON nor JSONL", () => {
    expect(() => decodeTraceText("not json at all")).toThrow(TraceParseError);
  });
});
