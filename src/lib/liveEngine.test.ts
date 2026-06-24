import { describe, expect, it, vi } from "vitest";
import { createLiveWatcher, type LiveSource } from "./liveEngine";

/** A valid single-trace JSON string with one span per id. */
const TRACE = (...ids: string[]) =>
  JSON.stringify(
    ids.map((id, i) => ({ span_id: id, name: id, start_time: i, end_time: i + 1, attributes: {} })),
  );

/** A scripted source: read() returns whatever readState[name] currently holds. */
function fakeSource(initial: {
  newest: { name: string; lastModified: number } | null;
  files: Record<string, { lastModified: number; text: string }>;
}) {
  const state = { ...initial };
  const source: LiveSource = {
    scanNewest: async () => state.newest,
    read: async (name) => state.files[name] ?? null,
  };
  return { source, state };
}

describe("createLiveWatcher", () => {
  it("emits a parsed trace on init and on content change", async () => {
    const { source, state } = fakeSource({
      newest: { name: "run.jsonl", lastModified: 1 },
      files: { "run.jsonl": { lastModified: 1, text: TRACE("a") } },
    });
    const onUpdate = vi.fn();
    const w = createLiveWatcher(source, { onUpdate, onEmpty: vi.fn(), onTrouble: vi.fn(), onRecovered: vi.fn() });

    await w.init();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].label).toBe("run.jsonl");
    expect(onUpdate.mock.calls[0][0].trace.roots[0].spanId).toBe("a");

    // No change -> no re-emit.
    await w.fastTick();
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // File grows -> re-emit.
    state.files["run.jsonl"] = { lastModified: 2, text: TRACE("a", "b") };
    await w.fastTick();
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("swallows parse failures, keeps the last good state, and flags trouble only when sustained", async () => {
    const { source, state } = fakeSource({
      newest: { name: "run.jsonl", lastModified: 1 },
      files: { "run.jsonl": { lastModified: 1, text: TRACE("a") } },
    });
    const onUpdate = vi.fn();
    const onTrouble = vi.fn();
    const w = createLiveWatcher(source, { onUpdate, onEmpty: vi.fn(), onTrouble, onRecovered: vi.fn() });
    await w.init();

    // One half-written read (newer mtime, malformed text): swallowed, last good
    // retained, and NOT yet flagged as trouble — normal mid-write jitter.
    state.files["run.jsonl"] = { lastModified: 2, text: "{ half-written" };
    await expect(w.fastTick()).resolves.toBeUndefined(); // does not throw
    expect(onUpdate).toHaveBeenCalledTimes(1); // still just the init emit
    expect(onTrouble).not.toHaveBeenCalled();

    // Two more consecutive failures (new mtimes) cross the threshold -> trouble.
    state.files["run.jsonl"] = { lastModified: 3, text: "{ still bad" };
    await w.fastTick();
    state.files["run.jsonl"] = { lastModified: 4, text: "{ still bad" };
    await w.fastTick();
    expect(onTrouble).toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(1); // never re-emitted on failure
  });

  it("switches to a newer run file on a slow tick", async () => {
    const { source, state } = fakeSource({
      newest: { name: "runA.jsonl", lastModified: 1 },
      files: { "runA.jsonl": { lastModified: 1, text: TRACE("a") } },
    });
    const onUpdate = vi.fn();
    const w = createLiveWatcher(source, { onUpdate, onEmpty: vi.fn(), onTrouble: vi.fn(), onRecovered: vi.fn() });
    await w.init();

    state.newest = { name: "runB.jsonl", lastModified: 9 };
    state.files["runB.jsonl"] = { lastModified: 9, text: TRACE("b") };
    await w.slowTick();
    expect(onUpdate).toHaveBeenCalledTimes(2);
    const last = onUpdate.mock.calls[1][0];
    expect(last.label).toBe("runB.jsonl");
    expect(w.currentFile()).toBe("runB.jsonl");
  });

  it("reports onEmpty when no trace file is found", async () => {
    const onEmpty = vi.fn();
    const w = createLiveWatcher(
      { scanNewest: async () => null, read: async () => null },
      { onUpdate: vi.fn(), onEmpty, onTrouble: vi.fn(), onRecovered: vi.fn() },
    );
    await w.init();
    expect(onEmpty).toHaveBeenCalled();
  });
});
