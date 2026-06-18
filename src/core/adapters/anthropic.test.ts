import { describe, it, expect } from "vitest";
import { anthropicAdapter } from "./anthropic";
import { parseTrace } from "../parse";
import log from "../../../public/samples/anthropic-log.json";

describe("anthropicAdapter.detect", () => {
  it("matches a Claude-log array only", () => {
    expect(anthropicAdapter.detect(log)).toBe(true);
    expect(anthropicAdapter.detect([{ span_id: "a" }])).toBe(false);
    expect(anthropicAdapter.detect([{ type: "item.completed" }])).toBe(false);
  });
});

describe("anthropicAdapter.toLooseSpans", () => {
  const loose = anthropicAdapter.toLooseSpans(log);
  it("maps each call to an LLM span with model + tokens", () => {
    expect(loose).toHaveLength(3);
    expect(loose[0].attributes!["gen_ai.request.model"]).toBe("claude-sonnet-4-6");
    expect(loose[0].attributes!["gen_ai.usage.input_tokens"]).toBe(14);
  });
  it("flags an error entry", () => {
    expect(loose[2].status_code).toBe("ERROR");
  });
});

describe("Anthropic end-to-end via parseTrace", () => {
  const t = parseTrace(log);
  it("builds N flat LLM spans with the right roll-up", () => {
    expect(t.roots).toHaveLength(3);
    expect(t.summary.llmCalls).toBe(3);
    expect(t.summary.errors).toBe(1);
    expect(t.summary.totalTokensIn).toBe(14 + 320);
  });
});
