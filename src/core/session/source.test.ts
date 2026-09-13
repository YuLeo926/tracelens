import { describe, expect, it } from "vitest";
import { inspectSessionSource } from "./source";

const lines = (...records: unknown[]) => records.map((record) => JSON.stringify(record)).join("\n");

const codexHead = lines(
  { type: "thread.started", thread_id: "thread-1", timestamp: "2026-07-31T10:00:00.000Z" },
  { type: "turn.started", timestamp: "2026-07-31T10:00:01.000Z" },
);

const rolloutHead = lines(
  { type: "session_meta", timestamp: "2026-07-31T10:00:00.000Z", payload: { cwd: "E:/work/tracelens" } },
  { type: "response_item", timestamp: "2026-07-31T10:00:01.000Z", payload: { type: "message", role: "user", content: "Inspect the session" } },
);

const claudeHead = lines(
  { type: "user", timestamp: "2026-07-31T10:00:00.000Z", cwd: "/work/claude-project", message: { role: "user", content: "Fix the build" } },
  { type: "assistant", timestamp: "2026-07-31T10:00:01.000Z", message: { role: "assistant", content: "On it" } },
);

describe("inspectSessionSource", () => {
  it("does not treat Claude tool handoff or a new user turn as complete", () => {
    const assistant = (stop_reason: string) => ({ type: "assistant", message: { role: "assistant", stop_reason } });
    expect(inspectSessionSource("run.jsonl", claudeHead, lines(assistant("tool_use")))?.lifecycle).toBe("active");
    expect(inspectSessionSource("run.jsonl", claudeHead, lines(assistant("end_turn")))?.lifecycle).toBe("complete");
    expect(inspectSessionSource("run.jsonl", claudeHead, lines(assistant("end_turn"), { type: "user", message: { role: "user", content: "Continue" } }))?.lifecycle).toBe("active");
  });
  it.each([
    ["task_started", "active"],
    ["task_complete", "complete"],
    ["turn_aborted", "failed"],
  ])("recognizes rollout lifecycle %s", (type, lifecycle) => {
    expect(inspectSessionSource("rollout.jsonl", rolloutHead, lines({ type: "event_msg", payload: { type } }))?.lifecycle).toBe(lifecycle);
  });

  it("uses the latest rollout lifecycle across multiple turns", () => {
    const tail = lines(...["task_started", "turn_aborted", "task_started", "task_complete", "task_started"]
      .map((type) => ({ type: "event_msg", payload: { type } })));
    expect(inspectSessionSource("rollout.jsonl", rolloutHead, tail)?.lifecycle).toBe("active");
  });

  it("identifies Codex exec sessions and their latest lifecycle event", () => {
    expect(inspectSessionSource("run.jsonl", codexHead, '{"type":"turn.completed"}\n')).toMatchObject({
      provider: "codex",
      lifecycle: "complete",
      startMs: Date.parse("2026-07-31T10:00:00.000Z"),
    });
    expect(inspectSessionSource("run.jsonl", codexHead, '{"type":"turn.failed"}\n')?.lifecycle).toBe("failed");
    expect(inspectSessionSource("run.jsonl", codexHead, '{"type":"turn.started"}\n')?.lifecycle).toBe("active");
  });

  it("identifies Codex rollouts without inferring a lifecycle", () => {
    expect(inspectSessionSource("rollout.jsonl", rolloutHead, "")).toEqual({
      provider: "codex",
      lifecycle: "unknown",
      title: "Inspect the session",
      project: "tracelens",
      projectPath: "E:/work/tracelens",
      startMs: Date.parse("2026-07-31T10:00:00.000Z"),
    });
  });

  it("identifies Claude Code and completed assistant messages", () => {
    const claudeStoppedTail = '{"type":"assistant","message":{"role":"assistant","stop_reason":"end_turn"}}\n';
    expect(inspectSessionSource("claude.jsonl", claudeHead, claudeStoppedTail)).toMatchObject({
      provider: "claude",
      lifecycle: "complete",
      title: "Fix the build",
      project: "claude-project",
      projectPath: "/work/claude-project",
    });
    expect(inspectSessionSource("claude.jsonl", claudeHead, claudeStoppedTail)?.provider).toBe("claude");
  });

  it("marks explicit Claude errors as failed", () => {
    expect(inspectSessionSource("claude.jsonl", claudeHead, '{"type":"error","error":"request failed"}\n')?.lifecycle).toBe("failed");
  });

  it("identifies generic traces without inferring a lifecycle", () => {
    const head = JSON.stringify({ spans: [{ span_id: "span-1", start_time: 42, end_time: 43 }] });
    expect(inspectSessionSource("trace.json", head, "")).toEqual({
      provider: "generic",
      lifecycle: "unknown",
      startMs: 42,
    });
  });

  it("ignores incomplete JSONL boundaries in a tail slice", () => {
    const tail = 'partial line\n{"type":"turn.completed"}\n{"type":"turn.failed"';
    expect(inspectSessionSource("run.jsonl", codexHead, tail)?.lifecycle).toBe("complete");
  });

  it("rejects unsupported files", () => {
    expect(inspectSessionSource("notes.json", "{}", "{}")).toBeNull();
  });
});
