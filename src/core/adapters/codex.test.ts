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
