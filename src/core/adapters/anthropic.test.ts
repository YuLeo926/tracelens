import { describe, it, expect } from "vitest";
import { anthropicAdapter } from "./anthropic";
import { parseTrace, flatten } from "../parse";
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

const CC = [
  { type: "user", timestamp: "2026-06-18T10:00:00.000Z", sessionId: "cc-1", message: { role: "user", content: "Fix the bug." } },
  { type: "assistant", timestamp: "2026-06-18T10:00:01.000Z", message: { role: "assistant", model: "claude-haiku-4-5-20251001", usage: { input_tokens: 30, output_tokens: 12 }, content: [{ type: "text", text: "I'll read the file." }] } },
  { type: "assistant", timestamp: "2026-06-18T10:00:02.000Z", message: { role: "assistant", model: "claude-haiku-4-5-20251001", usage: { input_tokens: 40, output_tokens: 5 }, content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "a.ts" } }] } },
  { type: "user", timestamp: "2026-06-18T10:00:03.500Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "EISDIR: illegal operation", is_error: true }] } },
];

describe("anthropicAdapter — Claude Code transcript", () => {
  it("detects the Claude Code shape", () => {
    expect(anthropicAdapter.detect(CC)).toBe(true);
  });

  it("maps an assistant text to an LLM span with model + tokens", () => {
    const t = parseTrace(CC);
    expect(t.roots[0].name).toBe("claude-code.session");
    const msg = flatten(t.roots).find((n) => n.name === "assistant")!;
    expect(msg.kind).toBe("llm");
    expect(msg.model).toBe("claude-haiku-4-5-20251001");
    expect(msg.tokensIn).toBe(30);
  });

  it("pairs a tool_use with its tool_result, real duration + error flag", () => {
    const t = parseTrace(CC);
    const tool = t.byId.get("toolu_1")!;
    expect(tool.kind).toBe("tool");
    expect(tool.name).toBe("Read");
    expect(tool.output).toContain("EISDIR");
    expect(tool.status).toBe("error");
    expect(tool.durationMs).toBeGreaterThan(0);
    expect(t.summary.errors).toBe(1);
  });
});
