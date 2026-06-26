import { describe, expect, it } from "vitest";
import { extractTokens, startMsOf, modelOf, estimateCostUsd, aggregateDashboard, type ConvStat } from "./folderStats";

const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n");

describe("extractTokens", () => {
  it("sums the LAST token_count event in the tail", () => {
    const tail = lines(
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, output_tokens: 2 } } } },
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 70, output_tokens: 20 } } } },
    );
    expect(extractTokens(tail)).toEqual({ tokensIn: 100, tokensOut: 20, cachedIn: 70 });
  });
  it("returns null when there is no token_count (ignores a partial first line)", () => {
    expect(extractTokens('truncated...\n{"type":"event_msg","payload":{"type":"other"}}')).toBeNull();
  });
  it("sums Claude Code message usage, including cache read/write tokens", () => {
    const tail = lines(
      { type: "assistant", message: { role: "assistant", model: "claude-haiku-4-5", usage: { input_tokens: 30, cache_read_input_tokens: 300, cache_creation_input_tokens: 20, output_tokens: 12 } } },
      { type: "assistant", message: { role: "assistant", model: "claude-haiku-4-5", usage: { input_tokens: 40, cache_read_input_tokens: 100, output_tokens: 5 } } },
    );
    expect(extractTokens(tail)).toEqual({
      tokensIn: 490,
      tokensOut: 17,
      cachedIn: 400,
      cacheWriteIn: 20,
    });
  });
  it("sums Claude API usage from a JSON array file", () => {
    const tail = JSON.stringify([
      { response: { model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 20 } } },
      { response: { model: "claude-sonnet-4-6", usage: { input_tokens: 200, cache_read_input_tokens: 50, output_tokens: 30 } } },
    ]);
    expect(extractTokens(tail)).toEqual({ tokensIn: 350, tokensOut: 50, cachedIn: 50, cacheWriteIn: 0 });
  });
});

describe("startMsOf / modelOf", () => {
  it("reads the first timestamp and the model from the head", () => {
    const head = lines(
      { timestamp: "2026-06-21T10:00:00.000Z", type: "session_meta", payload: { cwd: "/x" } },
      { timestamp: "2026-06-21T10:00:01.000Z", type: "turn_context", payload: { model: "gpt-5.5" } },
    );
    expect(startMsOf(head)).toBe(Date.parse("2026-06-21T10:00:00.000Z"));
    expect(modelOf(head)).toBe("gpt-5.5");
  });
  it("reads Claude Code models from message.model", () => {
    const head = lines(
      { type: "user", timestamp: "2026-06-21T10:00:00.000Z", message: { role: "user", content: "hi" } },
      { type: "assistant", timestamp: "2026-06-21T10:00:01.000Z", message: { role: "assistant", model: "claude-haiku-4-5-20251001", content: [{ type: "text", text: "hello" }] } },
    );
    expect(modelOf(head)).toBe("claude-haiku-4-5-20251001");
  });
  it("reads models from a JSON array file", () => {
    const head = JSON.stringify([
      { request: { model: "claude-sonnet-4-6" }, response: { usage: { input_tokens: 1 } } },
    ]);
    expect(modelOf(head)).toBe("claude-sonnet-4-6");
  });
  it("returns undefined when absent", () => {
    expect(startMsOf("{}")).toBeUndefined();
    expect(modelOf("{}")).toBeUndefined();
  });
});

describe("estimateCostUsd", () => {
  it("uses current OpenAI model-specific rates instead of a broad GPT-5 bucket", () => {
    expect(estimateCostUsd(1_000_000, 1_000_000, 0, "gpt-5.5")).toBeCloseTo(35);
    expect(estimateCostUsd(1_000_000, 1_000_000, 0, "gpt-5.4")).toBeCloseTo(17.5);
    expect(estimateCostUsd(1_000_000, 1_000_000, 0, "gpt-5.4-mini")).toBeCloseTo(5.25);
    expect(estimateCostUsd(1_000_000, 1_000_000, 0, "gpt-5.4-nano")).toBeCloseTo(1.45);
    expect(estimateCostUsd(1_000_000, 1_000_000, 0, "gpt-5.3-codex")).toBeCloseTo(15.75);
    expect(estimateCostUsd(0, 0, 0, "gpt-5.5")).toBe(0);
  });
  it("uses current Claude family-specific rates", () => {
    expect(estimateCostUsd(1_000_000, 1_000_000, 0, "claude-haiku-4-5")).toBeCloseTo(6);
    expect(estimateCostUsd(1_000_000, 1_000_000, 0, "claude-sonnet-4-6")).toBeCloseTo(18);
    expect(estimateCostUsd(1_000_000, 1_000_000, 0, "claude-opus-4-6")).toBeCloseTo(30);
  });
  it("prices cached input far cheaper than fresh input", () => {
    const allFresh = estimateCostUsd(1_000_000, 0, 0, "gpt-5.5");
    const allCached = estimateCostUsd(1_000_000, 0, 1_000_000, "gpt-5.5");
    expect(allCached).toBeLessThan(allFresh);
    expect(allCached).toBeCloseTo(allFresh * 0.1, 5); // ~10x cheaper
  });
  it("prices Claude cache writes separately from cache reads", () => {
    expect(estimateCostUsd(1_000_000, 0, 0, "claude-sonnet-4-6", 1_000_000)).toBeCloseTo(3.75);
    expect(estimateCostUsd(1_000_000, 0, 1_000_000, "claude-sonnet-4-6", 0)).toBeCloseTo(0.3);
  });
  it("clamps cached input to the available input total", () => {
    expect(estimateCostUsd(10, 0, 100, "gpt-5.5")).toBeCloseTo(0.000005);
  });
});

describe("aggregateDashboard", () => {
  const now = Date.parse("2026-06-21T12:00:00.000Z");
  const day = 86_400_000;
  const stats: ConvStat[] = [
    { name: "a", project: "ebay", lastModified: now, startMs: now, tokensIn: 100, cachedIn: 60, tokensOut: 20, model: "gpt-5.5", sizeBytes: 10 },
    { name: "b", project: "ebay", lastModified: now - day, startMs: now - day, tokensIn: 50, tokensOut: 5, sizeBytes: 10 },
    { name: "c", lastModified: now - 2 * day, startMs: now - 2 * day, tokensIn: 0, tokensOut: 0, sizeBytes: 10 },
  ];
  it("groups by project, sums tokens, buckets activity, sorts projects", () => {
    const d = aggregateDashboard(stats, now);
    expect(d.conversationCount).toBe(3);
    expect(d.totalTokensIn).toBe(150);
    expect(d.totalCachedIn).toBe(60);
    expect(d.totalTokensOut).toBe(25);
    expect(d.estCostUsd).toBeGreaterThan(0);
    expect(d.projects.map((p) => p.project)).toEqual(["ebay", "(unknown)"]); // ebay most recent
    expect(d.projects[0]).toMatchObject({ project: "ebay", count: 2, tokens: 175 });
    expect(d.activity).toHaveLength(14);
    expect(d.activity[d.activity.length - 1].count).toBe(1); // today
    expect(d.activity.reduce((n, b) => n + b.count, 0)).toBe(3);
  });
  it("buckets activity by local calendar day", () => {
    const localStart = new Date(2026, 5, 21, 0, 30, 0, 0).getTime();
    const d = aggregateDashboard(
      [{ name: "local", lastModified: localStart, startMs: localStart, sizeBytes: 1 }],
      localStart,
    );
    const localDay = [
      new Date(localStart).getFullYear(),
      String(new Date(localStart).getMonth() + 1).padStart(2, "0"),
      String(new Date(localStart).getDate()).padStart(2, "0"),
    ].join("-");
    expect(d.activity[d.activity.length - 1]).toEqual({ day: localDay, count: 1 });
  });
});
