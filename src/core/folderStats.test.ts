import { describe, expect, it } from "vitest";
import { extractTokens, startMsOf, modelOf, estimateCostUsd, aggregateDashboard, type ConvStat } from "./folderStats";

const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n");

describe("extractTokens", () => {
  it("sums the LAST token_count event in the tail", () => {
    const tail = lines(
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, output_tokens: 2 } } } },
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 20 } } } },
    );
    expect(extractTokens(tail)).toEqual({ tokensIn: 100, tokensOut: 20 });
  });
  it("returns null when there is no token_count (ignores a partial first line)", () => {
    expect(extractTokens('truncated...\n{"type":"event_msg","payload":{"type":"other"}}')).toBeNull();
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
  it("returns undefined when absent", () => {
    expect(startMsOf("{}")).toBeUndefined();
    expect(modelOf("{}")).toBeUndefined();
  });
});

describe("estimateCostUsd", () => {
  it("uses a per-model rate and a fallback", () => {
    const gpt = estimateCostUsd(1_000_000, 1_000_000, "gpt-5.5");
    const fallback = estimateCostUsd(1_000_000, 1_000_000, "mystery-model");
    expect(gpt).toBeGreaterThan(0);
    expect(fallback).toBeGreaterThan(0);
    expect(estimateCostUsd(0, 0, "gpt-5.5")).toBe(0);
  });
});

describe("aggregateDashboard", () => {
  const now = Date.parse("2026-06-21T12:00:00.000Z");
  const day = 86_400_000;
  const stats: ConvStat[] = [
    { name: "a", project: "ebay", lastModified: now, startMs: now, tokensIn: 100, tokensOut: 20, model: "gpt-5.5", sizeBytes: 10 },
    { name: "b", project: "ebay", lastModified: now - day, startMs: now - day, tokensIn: 50, tokensOut: 5, sizeBytes: 10 },
    { name: "c", lastModified: now - 2 * day, startMs: now - 2 * day, tokensIn: 0, tokensOut: 0, sizeBytes: 10 },
  ];
  it("groups by project, sums tokens, buckets activity, sorts projects", () => {
    const d = aggregateDashboard(stats, now);
    expect(d.conversationCount).toBe(3);
    expect(d.totalTokensIn).toBe(150);
    expect(d.totalTokensOut).toBe(25);
    expect(d.estCostUsd).toBeGreaterThan(0);
    expect(d.projects.map((p) => p.project)).toEqual(["ebay", "(unknown)"]); // ebay most recent
    expect(d.projects[0]).toMatchObject({ project: "ebay", count: 2, tokens: 175 });
    expect(d.activity).toHaveLength(14);
    expect(d.activity[d.activity.length - 1].count).toBe(1); // today
    expect(d.activity.reduce((n, b) => n + b.count, 0)).toBe(3);
  });
});
