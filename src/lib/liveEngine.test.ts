import { describe, expect, it, vi } from "vitest";
import { createLiveWatcher, type LiveSource, type LiveStatus } from "./liveEngine";

/** A valid single-trace JSON string with one span per id. */
const TRACE = (...ids: string[]) =>
  JSON.stringify(
    ids.map((id, i) => ({ span_id: id, name: id, start_time: i, end_time: i + 1, attributes: {} })),
  );

/** Valid JSON that is NOT a trace (no spans) — parseTraceText throws on this. */
const NOT_TRACE = '{"models":["a","b"],"cached_at":123}';

/** A scripted source. listCandidates returns newest-first; read looks up by name. */
function fakeSource(opts: {
  candidates: Array<{ name: string; lastModified: number }>;
  files: Record<string, { lastModified: number; text: string }>;
}) {
  const state = { candidates: [...opts.candidates], files: { ...opts.files } };
  const source: LiveSource = {
    listCandidates: async () =>
      [...state.candidates].sort(
        (a, b) => b.lastModified - a.lastModified || (a.name > b.name ? -1 : 1),
      ),
    read: async (name) => state.files[name] ?? null,
  };
  return { source, state };
}

function harness(opts: Parameters<typeof fakeSource>[0]) {
  const { source, state } = fakeSource(opts);
  const onUpdate = vi.fn();
  const statuses: LiveStatus[] = [];
  const w = createLiveWatcher(source, { onUpdate, onStatus: (s) => statuses.push(s) });
  return { w, state, onUpdate, statuses, lastStatus: () => statuses[statuses.length - 1] };
}

describe("createLiveWatcher", () => {
  it("adopts the newest PARSEABLE file, skipping a newer non-trace file", async () => {
    const { w, onUpdate, lastStatus } = harness({
      candidates: [
        { name: "models_cache.json", lastModified: 10 },
        { name: "rollout.jsonl", lastModified: 5 },
      ],
      files: {
        "models_cache.json": { lastModified: 10, text: NOT_TRACE },
        "rollout.jsonl": { lastModified: 5, text: TRACE("a") },
      },
    });
    await w.init();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].label).toBe("rollout.jsonl");
    expect(onUpdate.mock.calls[0][0].trace.roots[0].spanId).toBe("a");
    expect(w.currentFile()).toBe("rollout.jsonl");
    expect(lastStatus()).toBe("live");
  });

  it("reports 'empty' when the folder has no candidate files", async () => {
    const { w, onUpdate, lastStatus } = harness({ candidates: [], files: {} });
    await w.init();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(lastStatus()).toBe("empty");
  });

  it("reports 'no-trace' when candidates exist but none parse", async () => {
    const { w, onUpdate, lastStatus } = harness({
      candidates: [{ name: "models_cache.json", lastModified: 10 }],
      files: { "models_cache.json": { lastModified: 10, text: NOT_TRACE } },
    });
    await w.init();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(lastStatus()).toBe("no-trace");
  });

  it("re-emits when the current file grows, and skips an unchanged read", async () => {
    const { w, state, onUpdate } = harness({
      candidates: [{ name: "run.jsonl", lastModified: 1 }],
      files: { "run.jsonl": { lastModified: 1, text: TRACE("a") } },
    });
    await w.init();
    expect(onUpdate).toHaveBeenCalledTimes(1);

    await w.fastTick(); // no change
    expect(onUpdate).toHaveBeenCalledTimes(1);

    state.files["run.jsonl"] = { lastModified: 2, text: TRACE("a", "b") };
    await w.fastTick();
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good trace on a failed read and stalls only when sustained", async () => {
    const { w, state, onUpdate, statuses } = harness({
      candidates: [{ name: "run.jsonl", lastModified: 1 }],
      files: { "run.jsonl": { lastModified: 1, text: TRACE("a") } },
    });
    await w.init();
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // One half-written read: swallowed, last good kept, NOT yet stalled.
    state.files["run.jsonl"] = { lastModified: 2, text: "{ half-written" };
    await expect(w.fastTick()).resolves.toBeUndefined();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(statuses).not.toContain("stalled");

    // Two more consecutive failures cross the threshold -> stalled.
    state.files["run.jsonl"] = { lastModified: 3, text: "{ still bad" };
    await w.fastTick();
    state.files["run.jsonl"] = { lastModified: 4, text: "{ still bad" };
    await w.fastTick();
    expect(statuses).toContain("stalled");
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("switches to a newer parseable run on a slow tick", async () => {
    const { w, state, onUpdate } = harness({
      candidates: [{ name: "runA.jsonl", lastModified: 1 }],
      files: { "runA.jsonl": { lastModified: 1, text: TRACE("a") } },
    });
    await w.init();

    state.candidates.push({ name: "runB.jsonl", lastModified: 9 });
    state.files["runB.jsonl"] = { lastModified: 9, text: TRACE("b") };
    await w.slowTick();
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls[1][0].label).toBe("runB.jsonl");
    expect(w.currentFile()).toBe("runB.jsonl");
  });

  it("discovers a first trace on a later tick if the folder was empty at first", async () => {
    const { w, state, onUpdate, lastStatus } = harness({ candidates: [], files: {} });
    await w.init();
    expect(lastStatus()).toBe("empty");

    state.candidates.push({ name: "run.jsonl", lastModified: 1 });
    state.files["run.jsonl"] = { lastModified: 1, text: TRACE("a") };
    await w.slowTick();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(lastStatus()).toBe("live");
  });
});
