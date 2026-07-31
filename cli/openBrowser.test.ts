import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { openBrowser } from "./openBrowser";

function successfulSpawn() {
  return vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
}

describe("openBrowser", () => {
  it.each([
    ["win32", "cmd.exe", ["/d", "/s", "/c", 'start "" "http://127.0.0.1:4444/tracelens/?q=a%20b&mode=session#token=abc"']],
    ["darwin", "open", ["http://127.0.0.1:4444/tracelens/?q=a%20b&mode=session#token=abc"]],
    ["linux", "xdg-open", ["http://127.0.0.1:4444/tracelens/?q=a%20b&mode=session#token=abc"]],
  ] as const)("uses the %s launch contract without a shell", async (platform, command, args) => {
    const spawn = successfulSpawn();
    const url = "http://127.0.0.1:4444/tracelens/?q=a%20b&mode=session#token=abc";

    await expect(openBrowser(url, { platform, spawn })).resolves.toBe(true);
    expect(spawn).toHaveBeenCalledWith(command, args, expect.objectContaining({ shell: false, stdio: "ignore" }));
  });

  it("reports a launch error without retaining event listeners", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit("error", new Error("missing")));
      return child;
    });

    await expect(openBrowser("http://127.0.0.1:4444/tracelens/?x=%26#token=a", { platform: "linux", spawn })).resolves.toBe(false);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.listenerCount("spawn")).toBe(0);
  });
});
