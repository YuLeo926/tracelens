import { describe, it, expect } from "vitest";
import { codexAdapter } from "./codex";
import { parseTrace, flatten } from "../parse";

const EVENTS = [
  { type: "thread.started", thread_id: "thread-1" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item_1", type: "command_execution", command: "bash -lc ls", status: "completed", aggregated_output: "docs\nsdk" } },
  { type: "item.completed", item: { id: "item_2", type: "web_search", query: "openinference", status: "completed" } },
  { type: "item.completed", item: { id: "item_3", type: "command_execution", command: "cat missing", status: "failed", aggregated_output: "No such file" } },
  { type: "item.completed", item: { id: "item_4", type: "agent_message", text: "Done." } },
  { type: "turn.completed", usage: { input_tokens: 24763, output_tokens: 122 } },
];

describe("codexAdapter.detect", () => {
  it("matches a Codex event array only", () => {
    expect(codexAdapter.detect(EVENTS)).toBe(true);
    expect(codexAdapter.detect([{ span_id: "a" }])).toBe(false);
    expect(codexAdapter.detect([{ type: "message" }])).toBe(false);
  });
});

describe("codexAdapter.toLooseSpans", () => {
  const loose = codexAdapter.toLooseSpans(EVENTS);
  it("builds a root carrying turn tokens + one span per item", () => {
    expect(loose).toHaveLength(5);
    expect(loose[0].name).toBe("codex.session");
    expect(loose[0].attributes!["gen_ai.usage.input_tokens"]).toBe(24763);
    expect(loose[0].attributes!["openinference.span.kind"]).toBe("AGENT");
  });
  it("maps a command_execution to a tool with input + raw stash", () => {
    const cmd = loose.find((s) => s.span_id === "item_1")!;
    expect(cmd.attributes!["openinference.span.kind"]).toBe("TOOL");
    expect(cmd.attributes!["input.value"]).toBe("bash -lc ls");
    expect(cmd.attributes!["codex.item"]).toBeTruthy();
  });
});

describe("Codex end-to-end via parseTrace", () => {
  const t = parseTrace(EVENTS);
  it("builds root + items with kinds, tokens, and the failed item", () => {
    expect(t.roots).toHaveLength(1);
    expect(t.roots[0].name).toBe("codex.session");
    expect(t.summary.toolCalls).toBe(3);
    expect(t.summary.llmCalls).toBe(1);
    expect(t.summary.errors).toBe(1);
    const agent = flatten(t.roots).find((n) => n.name === "agent_message")!;
    expect(agent.kind).toBe("llm");
  });
});

const ROLLOUT = [
  { timestamp: "2026-06-15T12:59:51.565Z", type: "session_meta", payload: { id: "sess-1", cwd: "E:/proj" } },
  { timestamp: "2026-06-15T12:59:51.598Z", type: "turn_context", payload: { model: "gpt-5.5" } },
  { timestamp: "2026-06-15T12:59:59.386Z", type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: '{"command":"ls"}', call_id: "call_1" } },
  { timestamp: "2026-06-15T12:59:59.754Z", type: "response_item", payload: { type: "function_call_output", call_id: "call_1", output: "Exit code: 0\nOutput:\nsrc" } },
  { timestamp: "2026-06-15T13:00:02.000Z", type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: '{"command":"cat missing"}', call_id: "call_2" } },
  { timestamp: "2026-06-15T13:00:02.300Z", type: "response_item", payload: { type: "function_call_output", call_id: "call_2", output: "Exit code: 1\ncat: missing: not found" } },
  { timestamp: "2026-06-15T13:06:40.328Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] } },
  { timestamp: "2026-06-15T13:06:40.477Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 20707, output_tokens: 330 } } } },
];

describe("codexAdapter — session rollout", () => {
  it("detects the rollout shape", () => {
    expect(codexAdapter.detect(ROLLOUT)).toBe(true);
  });

  it("pairs a command with its output and gives it a real duration", () => {
    const t = parseTrace(ROLLOUT);
    const ls = t.byId.get("call_1")!;
    expect(ls.kind).toBe("tool");
    expect(ls.input).toBe("ls");
    expect(ls.output).toContain("src");
    expect(ls.durationMs).toBeGreaterThan(0);
    expect(ls.status).toBe("ok");
  });

  it("flags a non-zero exit code and maps model + tokens on the root", () => {
    const t = parseTrace(ROLLOUT);
    expect(t.byId.get("call_2")!.status).toBe("error");
    expect(t.summary.errors).toBe(1);
    expect(t.roots[0].name).toBe("codex.session");
    expect(t.roots[0].model).toBe("gpt-5.5");
    expect(t.roots[0].tokensIn).toBe(20707);
    const msg = flatten(t.roots).find((n) => n.name === "assistant")!;
    expect(msg.kind).toBe("llm");
  });
});
