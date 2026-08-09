import { describe, it, expect, vi } from "vitest";
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

const CACHE_USAGE = {
  input_tokens: 100,
  cache_read_input_tokens: 50,
  cache_creation_input_tokens: 30,
  cache_creation: {
    ephemeral_5m_input_tokens: 10,
    ephemeral_1h_input_tokens: 20,
  },
  output_tokens: 10,
};

describe("Anthropic cache-aware usage", () => {
  it("counts Messages API cache categories exactly once and estimates known-model cost", () => {
    const trace = parseTrace([{
      timestamp: "2026-07-31T10:00:00.000Z",
      request: { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "Inspect it" }] },
      response: {
        id: "msg-cache",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Done" }],
        usage: CACHE_USAGE,
      },
    }]);
    const span = trace.byId.get("msg-cache")!;

    expect(span.tokensIn).toBe(180);
    expect(span.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(50);
    expect(span.attributes["gen_ai.usage.cache_creation_input_tokens"]).toBe(30);
    expect(span.attributes["gen_ai.usage.cache_creation_1h_input_tokens"]).toBe(20);
    expect(span.costUsd).toBeCloseTo(0.0006225);
    expect(trace.summary.totalTokensIn).toBe(180);
    expect(trace.summary.totalCostUsd).toBeCloseTo(0.0006225);
  });

  it("uses subtype cache writes only when the aggregate is absent", () => {
    const trace = parseTrace([{
      request: { model: "claude-sonnet-4-6", messages: [] },
      response: {
        id: "msg-cache-subtypes",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: "Done",
        usage: {
          input_tokens: 5,
          cache_read_input_tokens: 7,
          cache_creation: { ephemeral_5m_input_tokens: 11, ephemeral_1h_input_tokens: 13 },
          output_tokens: 3,
        },
      },
    }]);

    expect(trace.byId.get("msg-cache-subtypes")!.tokensIn).toBe(36);
  });

  it("does not estimate a price for an unknown model", () => {
    const trace = parseTrace([{
      request: { model: "claude-unknown-99", messages: [] },
      response: {
        id: "msg-unknown-model",
        type: "message",
        role: "assistant",
        model: "claude-unknown-99",
        content: "Done",
        usage: CACHE_USAGE,
      },
    }]);

    expect(trace.byId.get("msg-unknown-model")!.costUsd).toBeUndefined();
    expect(trace.summary.totalCostUsd).toBe(0);
  });

  it("uses the current pricing date when a Messages log has no timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
    try {
      const trace = parseTrace([{
        request: { model: "claude-sonnet-5", messages: [] },
        response: {
          id: "msg-current-price",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          content: "Done",
          usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
        },
      }]);

      expect(trace.byId.get("msg-current-price")!.costUsd).toBeCloseTo(18);
    } finally {
      vi.useRealTimers();
    }
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

const CCT = [
  { type: "user", timestamp: "2026-07-15T09:00:00.000Z", sessionId: "cc-t", message: { role: "user", content: "Why?" } },
  {
    type: "assistant",
    timestamp: "2026-07-15T09:00:01.000Z",
    message: {
      role: "assistant",
      model: "claude-sonnet-5",
      usage: { input_tokens: 10, output_tokens: 8 },
      content: [
        { type: "thinking", thinking: "The user wants X; I should check Y first.", signature: "sig-abc" },
        { type: "thinking", thinking: "", signature: "sig-empty" },
        { type: "text", text: "Checking Y." },
      ],
    },
  },
  {
    type: "assistant",
    timestamp: "2026-07-15T09:00:02.000Z",
    message: { role: "assistant", model: "claude-sonnet-5", content: [{ type: "redacted_thinking", data: "b64==" }] },
  },
];

describe("anthropicAdapter — Claude Code thinking blocks", () => {
  it("emits a thinking span (kind LLM, text in output) before the same message's text span", () => {
    const t = parseTrace(CCT);
    const nodes = flatten(t.roots);
    const names = nodes.map((n) => n.name);
    expect(names.indexOf("thinking")).toBeLessThan(names.indexOf("assistant"));
    const think = nodes.find((n) => n.name === "thinking")!;
    expect(think.kind).toBe("llm");
    expect(think.output).toBe("The user wants X; I should check Y first.");
    expect(think.model).toBe("claude-sonnet-5");
  });

  it("skips empty thinking; placeholders redacted_thinking", () => {
    const t = parseTrace(CCT);
    const thinks = flatten(t.roots).filter((n) => n.name === "thinking");
    expect(thinks).toHaveLength(2); // non-empty + redacted placeholder; the empty block is dropped
    expect(thinks[1].output).toContain("Encrypted thinking");
  });

  it("emits no thinking spans for a transcript without thinking", () => {
    const t = parseTrace(CC);
    expect(flatten(t.roots).some((n) => n.name === "thinking")).toBe(false);
  });

  it("counts assistant responses rather than thinking/text spans", () => {
    const t = parseTrace(CCT);
    expect(t.summary.llmCalls).toBe(2);
    const think = flatten(t.roots).find((n) => n.name === "thinking")!;
    expect(think.tokensIn).toBeUndefined();
    expect(think.tokensOut).toBeUndefined();
  });
});

const CC_USAGE_BLOCKS = [
  { type: "user", timestamp: "2026-07-15T10:00:00.000Z", sessionId: "cc-usage", message: { role: "user", content: "Inspect it." } },
  {
    type: "assistant",
    timestamp: "2026-07-15T10:00:01.000Z",
    message: {
      role: "assistant",
      model: "claude-sonnet-5",
      usage: { input_tokens: 10, output_tokens: 8 },
      content: [{ type: "text", text: "First." }, { type: "text", text: "Second." }],
    },
  },
  {
    type: "assistant",
    timestamp: "2026-07-15T10:00:02.000Z",
    message: {
      role: "assistant",
      model: "claude-sonnet-5",
      usage: { input_tokens: 40, output_tokens: 5 },
      content: [{ type: "tool_use", id: "toolu_usage", name: "Read", input: { file_path: "a.ts" } }],
    },
  },
  { type: "user", timestamp: "2026-07-15T10:00:03.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_usage", content: "ok" }] } },
];

describe("Anthropic Claude Code cache-aware usage", () => {
  it("counts cache categories once and retains cache-aware cost", () => {
    const trace = parseTrace([
      { type: "user", timestamp: "2026-07-31T10:00:00.000Z", sessionId: "cc-cache", message: { role: "user", content: "Inspect it" } },
      {
        type: "assistant",
        timestamp: "2026-07-31T10:00:01.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          usage: CACHE_USAGE,
          content: [{ type: "text", text: "Done" }],
        },
      },
    ]);
    const message = flatten(trace.roots).find((node) => node.name === "assistant")!;

    expect(message.tokensIn).toBe(180);
    expect(message.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(50);
    expect(message.attributes["gen_ai.usage.cache_creation_input_tokens"]).toBe(30);
    expect(message.costUsd).toBeCloseTo(0.0006225);
    expect(trace.summary.totalTokensIn).toBe(180);
    expect(trace.summary.totalCostUsd).toBeCloseTo(0.0006225);
  });
});

describe("anthropicAdapter — Claude Code response usage", () => {
  it("charges usage once per assistant response, including tool-only responses", () => {
    const t = parseTrace(CC_USAGE_BLOCKS);
    expect(t.summary.totalTokensIn).toBe(50);
    expect(t.summary.totalTokensOut).toBe(13);
    expect(t.summary.llmCalls).toBe(2);

    const textSpans = flatten(t.roots).filter((n) => n.name === "assistant");
    expect(textSpans.map((n) => [n.tokensIn, n.tokensOut])).toEqual([
      [10, 8],
      [undefined, undefined],
    ]);
  });
});

describe("Anthropic Claude Code date-sensitive pricing", () => {
  it("uses the current rate without a timestamp and the historical rate with one for text usage", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
    try {
      const current = parseTrace([{
        type: "assistant",
        sessionId: "cc-text-current-price",
        message: {
          role: "assistant",
          model: "claude-sonnet-5",
          usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
          content: [{ type: "text", text: "Done" }],
        },
      }]);
      const historical = parseTrace([{
        type: "assistant",
        timestamp: "2026-08-31T23:59:59.999Z",
        sessionId: "cc-text-historical-price",
        message: {
          role: "assistant",
          model: "claude-sonnet-5",
          usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
          content: [{ type: "text", text: "Done" }],
        },
      }]);

      const currentMessage = flatten(current.roots).find((node) => node.name === "assistant")!;
      const historicalMessage = flatten(historical.roots).find((node) => node.name === "assistant")!;
      expect(currentMessage.costUsd).toBeCloseTo(18);
      expect(historicalMessage.costUsd).toBeCloseTo(12);
      expect([current.summary.totalTokensIn, current.summary.totalTokensOut]).toEqual([1_000_000, 1_000_000]);
      expect([historical.summary.totalTokensIn, historical.summary.totalTokensOut]).toEqual([1_000_000, 1_000_000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the current rate without a timestamp and the historical rate with one for root-aggregated usage", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
    try {
      const current = parseTrace([{
        type: "assistant",
        sessionId: "cc-root-current-price",
        message: {
          role: "assistant",
          model: "claude-sonnet-5",
          usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
          content: [{ type: "tool_use", id: "toolu-current-price", name: "Read", input: {} }],
        },
      }]);
      const historical = parseTrace([{
        type: "assistant",
        timestamp: "2026-08-31T23:59:59.999Z",
        sessionId: "cc-root-historical-price",
        message: {
          role: "assistant",
          model: "claude-sonnet-5",
          usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
          content: [{ type: "tool_use", id: "toolu-historical-price", name: "Read", input: {} }],
        },
      }]);

      expect(current.roots[0].costUsd).toBeCloseTo(18);
      expect(historical.roots[0].costUsd).toBeCloseTo(12);
      expect([current.summary.totalTokensIn, current.summary.totalTokensOut]).toEqual([1_000_000, 1_000_000]);
      expect([historical.summary.totalTokensIn, historical.summary.totalTokensOut]).toEqual([1_000_000, 1_000_000]);
    } finally {
      vi.useRealTimers();
    }
  });
});
