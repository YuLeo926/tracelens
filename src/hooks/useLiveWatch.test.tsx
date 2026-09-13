// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useLiveWatch } from "./useLiveWatch";
import { createLiveWatcher, type LiveCallbacks, type LiveUpdate } from "../lib/liveEngine";

vi.mock("../lib/folderWatch", () => ({ createFolderSource: vi.fn(), baseName: (name: string) => name }));
vi.mock("../lib/liveEngine", () => ({ createLiveWatcher: vi.fn() }));

describe("live watcher lifecycle", () => {
  it("ignores callbacks from stopped or replaced watchers", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const callbacks: LiveCallbacks[] = [];
    vi.mocked(createLiveWatcher).mockImplementation((_source, cb) => {
      callbacks.push(cb);
      return { init: async () => {}, fastTick: async () => {}, slowTick: async () => {}, currentFile: () => null };
    });
    const onUpdate = vi.fn();
    let live!: ReturnType<typeof useLiveWatch>;
    function Harness() { live = useLiveWatch({ onUpdate }); return null; }
    const host = document.createElement("div"); const root = createRoot(host);
    try {
      await act(async () => root.render(<Harness />));
      const dir = { name: "synthetic" } as FileSystemDirectoryHandle;
      await act(async () => live.watchFile(dir, "one"));
      await act(async () => live.watchFile(dir, "two"));
      const update = { label: "old" } as LiveUpdate;
      await act(async () => { callbacks[0].onUpdate(update); callbacks[0].onStatus("error"); });
      expect(onUpdate).not.toHaveBeenCalled();
      expect(live.state).toBe("scanning");
      await act(async () => callbacks[1].onUpdate(update));
      expect(onUpdate).toHaveBeenCalledTimes(1);
      await act(async () => live.stop());
      await act(async () => { callbacks[1].onUpdate(update); callbacks[1].onStatus("live"); });
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(live.state).toBe("idle");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
