import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json";
import type { SessionSummary } from "../src/core/session/types";
import type { SessionRepository } from "./repository";
import type { ViewerService } from "./server";
import { commandInvocation, isExecutedDirectly, runCli, type CliDependencies } from "./index";

describe("commandInvocation", () => {
  it("uses cmd.exe for npm command shims on Windows", () => {
    expect(commandInvocation(
      "codex",
      ["mcp", "add", "tracelens", "--", "npx", "-y", "@yuleo/tracelens@0.2.1", "mcp"],
      "win32",
      { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    )).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "codex mcp add tracelens -- npx -y @yuleo/tracelens@0.2.1 mcp"],
    });
  });

  it("keeps direct execution on POSIX", () => {
    expect(commandInvocation("codex", ["mcp", "get", "tracelens", "--json"], "linux", {})).toEqual({
      command: "codex",
      args: ["mcp", "get", "tracelens", "--json"],
    });
  });

  it("rejects shell metacharacters before invoking cmd.exe", () => {
    expect(() => commandInvocation("codex", ["mcp", "&", "whoami"], "win32", {})).toThrow("Unsafe Windows command token.");
  });
});

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function session(id: string, selectionReason = "Matches current project."): SessionSummary {
  return {
    id,
    provider: "codex",
    title: `Run ${id}`,
    project: "tracelens",
    modifiedAt: 1,
    sizeBytes: 1,
    lifecycle: "complete",
    match: "exact",
    selectionReason,
    facts: { lifecycle: "complete", totals: { durationMs: 1, tokensIn: 2, tokensOut: 3, toolCalls: 0, errors: 0 }, errorEvents: [], slowestEvents: [], highestTokenEvents: [], repeatedOperations: [] },
  };
}

function output(): { stream: Writable; text(): string } {
  const chunks: string[] = [];
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } }),
    text: () => chunks.join(""),
  };
}

function dependencies(sessions = [session("first")], input: Readable = Readable.from([])) {
  const out = output();
  const err = output();
  const repository: SessionRepository = { list: vi.fn().mockResolvedValue(sessions), load: vi.fn(), refresh: vi.fn() };
  const viewerClosed = deferred();
  const viewer: ViewerService = {
    getLink: vi.fn().mockResolvedValue("http://127.0.0.1:4444/tracelens/?mode=session&session=first#token=secret"),
    close: vi.fn().mockImplementation(async () => viewerClosed.resolve()),
    closed: viewerClosed.promise,
  };
  const listeners = new Map<string, () => void>();
  const registerSignal = vi.fn((signal: NodeJS.Signals, listener: () => void) => {
    listeners.set(signal, listener);
    return () => listeners.delete(signal);
  });
  const deps: CliDependencies = {
    homeDir: "/private/home",
    cwd: "/private/work",
    webRoot: "/installed/dist",
    input,
    stdout: out.stream,
    stderr: err.stream,
    openBrowser: vi.fn().mockResolvedValue(true),
    createRepository: vi.fn().mockResolvedValue(repository),
    createViewer: vi.fn().mockReturnValue(viewer),
    registerSignal,
  };
  return { deps, out, err, repository, viewer, viewerClosed, listeners, registerSignal };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("runCli", () => {
  it("opens the first ranked session and closes the viewer on shutdown", async () => {
    const test = dependencies();
    const running = runCli([], test.deps);
    await settle();

    expect(test.deps.createRepository).toHaveBeenCalledWith({ homeDir: "/private/home", cwd: "/private/work", explicitFile: undefined });
    expect(test.viewer.getLink).toHaveBeenCalledWith("first");
    test.listeners.get("SIGINT")?.();
    await expect(running).resolves.toBe(0);
    expect(test.viewer.close).toHaveBeenCalledOnce();
    expect(test.listeners.size).toBe(0);
  });

  it("keeps an explicit file isolated from normal discovery", async () => {
    const test = dependencies([]);
    const running = runCli(["open", "only-this.jsonl"], test.deps);
    await settle();

    expect(test.deps.createRepository).toHaveBeenCalledWith({ homeDir: "/private/home", cwd: "/private/work", explicitFile: "only-this.jsonl" });
    await expect(running).resolves.toBe(1);
    expect(test.viewer.getLink).not.toHaveBeenCalled();
  });

  it("lists path-free metadata and opens the chosen run", async () => {
    const test = dependencies([session("first"), session("second")], Readable.from(["2\n"]));
    const running = runCli(["list"], test.deps);
    await settle();

    expect(test.out.text()).toContain("1. Run first");
    expect(test.out.text()).not.toContain("/private");
    expect(test.viewer.getLink).toHaveBeenCalledWith("second");
    test.listeners.get("SIGTERM")?.();
    await expect(running).resolves.toBe(0);
  });

  it("prints a fallback reason and the full URL when browser launch fails", async () => {
    const url = "http://127.0.0.1:4444/tracelens/?mode=session&session=first#token=secret";
    const test = dependencies([session("first", "No current-project sessions found; showing newest available session.")]);
    test.deps.openBrowser = vi.fn().mockResolvedValue(false);
    const running = runCli([], test.deps);
    await settle();

    expect(test.out.text()).toContain("No current-project sessions found; showing newest available session.");
    expect(test.out.text()).toContain(url);
    test.listeners.get("SIGINT")?.();
    await expect(running).resolves.toBe(0);
  });

  it("prints help without starting a viewer", async () => {
    const test = dependencies();
    test.deps.resolveServeMcp = vi.fn();

    await expect(runCli(["--help"], test.deps)).resolves.toBe(0);
    expect(test.out.text()).toContain("Usage: tracelens");
    expect(test.deps.createViewer).not.toHaveBeenCalled();
    expect(test.deps.resolveServeMcp).not.toHaveBeenCalled();
  });

  it("dispatches mcp without writing protocol-breaking output", async () => {
    const test = dependencies();
    test.deps.serveMcp = vi.fn().mockResolvedValue(undefined);

    await expect(runCli(["mcp"], test.deps)).resolves.toBe(0);

    expect(test.deps.serveMcp).toHaveBeenCalledWith(test.repository, test.viewer, packageMetadata.version);
    expect(test.out.text()).toBe("");
    expect(test.deps.openBrowser).not.toHaveBeenCalled();
    expect(test.viewer.close).not.toHaveBeenCalled();
  });

  it("resolves the MCP implementation dynamically only in MCP mode", async () => {
    const test = dependencies();
    const serve = vi.fn().mockResolvedValue(undefined);
    test.deps.resolveServeMcp = vi.fn().mockResolvedValue(serve);

    await expect(runCli(["mcp"], test.deps)).resolves.toBe(0);

    expect(test.deps.resolveServeMcp).toHaveBeenCalledOnce();
    expect(serve).toHaveBeenCalledWith(test.repository, test.viewer, packageMetadata.version);
    expect(test.out.text()).toBe("");
  });

  it("returns after idle closure and removes signal listeners", async () => {
    const test = dependencies();
    const running = runCli([], test.deps);
    await settle();

    test.viewerClosed.resolve();
    await expect(running).resolves.toBe(0);
    expect(test.viewer.close).not.toHaveBeenCalled();
    expect(test.listeners.size).toBe(0);
  });

  it("registers shutdown before getLink and settles when interrupted during startup", async () => {
    const test = dependencies();
    const link = deferred<string>();
    test.viewer.getLink = vi.fn().mockImplementation(() => {
      expect(test.listeners.size).toBe(2);
      return link.promise;
    });

    const running = runCli([], test.deps);
    await settle();
    test.listeners.get("SIGINT")?.();

    await expect(running).resolves.toBe(0);
    expect(test.viewer.close).toHaveBeenCalledOnce();
    expect(test.listeners.size).toBe(0);
  });

  it("closes once when interrupted while opening the browser", async () => {
    const test = dependencies();
    const browser = deferred<boolean>();
    test.deps.openBrowser = vi.fn().mockReturnValue(browser.promise);

    const running = runCli([], test.deps);
    await settle();
    expect(test.deps.openBrowser).toHaveBeenCalledOnce();
    test.listeners.get("SIGTERM")?.();

    await expect(running).resolves.toBe(0);
    expect(test.viewer.close).toHaveBeenCalledOnce();
    expect(test.listeners.size).toBe(0);
  });

  it("closes and removes listeners when startup or browser launch fails", async () => {
    const startup = dependencies();
    startup.viewer.getLink = vi.fn().mockRejectedValue(new Error("cannot start"));

    await expect(runCli([], startup.deps)).resolves.toBe(1);
    expect(startup.viewer.close).toHaveBeenCalledOnce();
    expect(startup.listeners.size).toBe(0);

    const browser = dependencies();
    browser.deps.openBrowser = vi.fn().mockRejectedValue(new Error("cannot open"));

    await expect(runCli([], browser.deps)).resolves.toBe(1);
    expect(browser.viewer.close).toHaveBeenCalledOnce();
    expect(browser.listeners.size).toBe(0);
  });
});

describe("isExecutedDirectly", () => {
  it.skipIf(process.platform === "win32")("matches a symlinked executable to its canonical module path", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tracelens-cli-link-"));
    const target = fileURLToPath(import.meta.url);
    const link = path.join(directory, "tracelens");
    try {
      await symlink(target, link);
      expect(isExecutedDirectly(link, pathToFileURL(target).href)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
