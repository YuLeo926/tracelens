import { describe, expect, it } from "vitest";
import { parseTraceText } from "./parse";
import { prepareSharePreview } from "./sharePreview";
import { redactEvidenceSecrets, redactSecrets } from "./session/secrets";
import { runSignals } from "./session/signals";
import { aggregateDashboard, conversationCost } from "./folderStats";
import type { RunNode } from "./types";

describe("privacy and factual signals", () => {
  it("masks structured credentials without changing usage counters", () => {
    expect(JSON.parse(redactEvidenceSecrets(JSON.stringify({ password: "hidden", nested: { api_key: "hidden2" }, input_tokens: 123 })))).toEqual({ password: "[REDACTED]", nested: { api_key: "[REDACTED]" }, input_tokens: 123 });
    const masked = redactSecrets("Authorization: Bearer private-value\nCookie: session=abc; csrf=xyz\nhttps://example.com?token=secret123&ok=1\n-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----");
    for (const secret of ["private-value", "session=abc", "csrf=xyz", "secret123", "BEGIN PRIVATE"]) expect(masked).not.toContain(secret);
    expect(masked).toContain("&ok=1");
  });

  it("exports a valid normalized snapshot with stable unique IDs and no raw credentials", () => {
    const source = JSON.stringify({ spans: [
      { span_id: "/private/one", name: "parent", start_time: 1, end_time: 3, attributes: { password: "secret-value" } },
      { span_id: "/private/two", parent_span_id: "/private/one", name: "child", start_time: 2, end_time: 3, attributes: { "input.value": '{"api_key":"private-value","prompt":"Private prose remains"}' } },
    ] });
    const preview = prepareSharePreview(source);
    expect(preview.spanCount).toBe(2);
    const reparsed = parseTraceText(preview.source);
    expect(reparsed.byId.size).toBe(2);
    expect(reparsed.byId.get("span-2")?.parentSpanId).toBe("span-1");
    for (const secret of ["/private/", "secret-value", "private-value"]) expect(preview.source).not.toContain(secret);
    expect(preview.source).toContain("Private prose remains");
    expect(source).toContain("secret-value");
  });

  const nodes = (...statuses: RunNode["status"][]) => statuses.map((status) => ({ status }) as RunNode);
  it("requires failure followed by success in the same operation for recovery", () => {
    expect(runSignals("complete", [nodes("error"), nodes("ok")])).toEqual(["tool_errors"]);
    expect(runSignals("active", [nodes("error", "error", "ok")])).toEqual(["tool_errors", "repeated_failures", "recovered", "active"]);
    expect(runSignals("failed", [])).toEqual(["stopped"]);
    expect(runSignals("unknown", [])).toEqual(["unknown"]);
  });
});

describe("cost coverage", () => {
  it("distinguishes absent span costs from explicit zero", () => {
    const span = { span_id: "one", name: "one", start_time: 1, end_time: 2 };
    expect(parseTraceText(JSON.stringify([span])).summary.costedSpanCount).toBe(0);
    expect(parseTraceText(JSON.stringify([{ ...span, attributes: { "gen_ai.usage.cost": 0 } }])).summary).toMatchObject({ costedSpanCount: 1, totalCostUsd: 0 });
  });
  const base = { name: "run", lastModified: Date.parse("2026-09-01"), sizeBytes: 1 };
  it("keeps unavailable usage separate from genuine zero and fallback rates", () => {
    expect(conversationCost(base).kind).toBe("missing");
    expect(conversationCost({ ...base, tokensIn: NaN, tokensOut: 0 }).kind).toBe("missing");
    const known = { ...base, model: "gpt-5.4", tokensIn: 0, tokensOut: 0 };
    const fallback = { ...base, model: "unlisted-model", tokensIn: 100, tokensOut: 10 };
    expect(conversationCost(known)).toEqual({ kind: "model-rate", usd: 0 });
    expect(conversationCost(fallback).kind).toBe("fallback");
    const model = aggregateDashboard([base, known, fallback], base.lastModified);
    expect(model.costCoverage).toMatchObject({ modelRate: 1, fallback: 1, missing: 1, modelRateUsd: 0 });
    expect(model.estCostUsd).toBe(model.costCoverage.fallbackUsd);
  });
});
