import { describe, expect, it } from "vitest";
import { extractConversationMeta } from "./conversationMeta";

// One JSON object per line, like a real rollout head.
const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n");

describe("extractConversationMeta", () => {
  it("reads a Codex rollout: cwd project + first USER message, skipping developer", () => {
    const head = lines(
      { type: "session_meta", payload: { id: "s1", cwd: "E:/work/native_edge_bridge" } },
      { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "SYSTEM INSTRUCTIONS, ignore me" }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Add a dark mode toggle" }] } },
    );
    expect(extractConversationMeta(head)).toEqual({
      title: "Add a dark mode toggle",
      project: "native_edge_bridge",
    });
  });

  it("reads a Claude transcript: cwd + first user message", () => {
    const head = lines(
      { type: "user", cwd: "/home/me/proj-x", message: { role: "user", content: "Fix the build" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Sure" }] } },
    );
    expect(extractConversationMeta(head)).toEqual({ title: "Fix the build", project: "proj-x" });
  });

  it("strips a leading injected tag block from the title", () => {
    const head = lines({
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\ncwd=/x\n</environment_context>\nWhat does foo() do?" }] },
    });
    expect(extractConversationMeta(head).title).toBe("What does foo() do?");
  });

  it("returns empty for a generic / truncated head (no user message)", () => {
    expect(extractConversationMeta('{"spans": [ {"span_id": "a", "nam')).toEqual({});
  });

  it("omits project when there is no cwd", () => {
    const head = lines({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } });
    expect(extractConversationMeta(head)).toEqual({ title: "hi" });
  });
});
