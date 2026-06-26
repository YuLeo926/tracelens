import { describe, expect, it } from "vitest";
import { isTraceFileHead } from "./traceSniff";

const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n");

describe("isTraceFileHead", () => {
  it("accepts Codex session rollout JSONL", () => {
    expect(
      isTraceFileHead(
        "rollout.jsonl",
        lines(
          { timestamp: "2026-06-21T10:00:00.000Z", type: "session_meta", payload: { id: "s1" } },
          { timestamp: "2026-06-21T10:00:01.000Z", type: "turn_context", payload: { model: "gpt-5.5" } },
        ),
      ),
    ).toBe(true);
  });

  it("accepts Claude Code transcript JSONL", () => {
    expect(
      isTraceFileHead(
        "claude.jsonl",
        lines(
          { type: "user", message: { role: "user", content: "Fix it" } },
          { type: "assistant", message: { role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "text", text: "Done" }] } },
        ),
      ),
    ).toBe(true);
  });

  it("accepts span-shaped JSON and rejects generic config JSON", () => {
    expect(isTraceFileHead("trace.json", JSON.stringify({ spans: [{ span_id: "s1", start_time: 0, end_time: 1 }] }))).toBe(true);
    expect(isTraceFileHead("config.json", JSON.stringify({ apiBase: "https://example.test", models: ["gpt-5.5"] }))).toBe(false);
  });
});
