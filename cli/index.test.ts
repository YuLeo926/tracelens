import { Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../src/core/session/types";
import type { SessionRepository } from "./repository";
import type { ViewerService } from "./server";
import { runCli, type CliDependencies } from "./index";

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
  const viewer: ViewerService = { getLink: vi.fn().mockResolvedValue("http://127.0.0.1:4444/tracelens/?mode=session&session=first#token=secret"), close: vi.fn().mockResolvedValue(undefined) };
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
  return { deps, out, err, repository, viewer, listeners, registerSignal };
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

    await expect(runCli(["--help"], test.deps)).resolves.toBe(0);
    expect(test.out.text()).toContain("Usage: tracelens");
    expect(test.deps.createViewer).not.toHaveBeenCalled();
  });
});
