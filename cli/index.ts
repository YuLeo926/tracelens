import { realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import packageMetadata from "../package.json";
import { clipText } from "../src/core/session/sanitize";
import type { SessionSummary } from "../src/core/session/types";
import { parseArgs } from "./args";
import { openBrowser } from "./openBrowser";
import { resolveWebRoot } from "./paths";
import { createSessionRepository, type SessionRepository } from "./repository";
import { selectRun } from "./selectRun";
import { createViewerService, type StartViewerOptions, type ViewerService } from "./server";
import { setupCodex, type CommandResult, type CommandRunner } from "./setupCodex";

const USAGE = [
  "Usage: tracelens [open [session-file] | list | mcp | setup codex [--force]]",
  "",
  "Open the newest local session for this project, or select a session with list.",
].join("\n");
const MAX_DISPLAY_LENGTH = 160;
const PACKAGE_VERSION = packageMetadata.version;

type CreateRepository = typeof createSessionRepository;
type CreateViewer = (options: StartViewerOptions) => ViewerService;
type ServeMcp = typeof import("../mcp/server").serveMcp;
type ResolveServeMcp = () => Promise<ServeMcp>;
type RegisterSignal = (signal: NodeJS.Signals, listener: () => void) => () => void;
type ShutdownResult<T> = { kind: "value"; value: T } | { kind: "error"; error: unknown } | { kind: "shutdown" };

export interface CliDependencies {
  homeDir: string;
  cwd: string;
  webRoot: string;
  input: NodeJS.ReadableStream;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  openBrowser(url: string): Promise<boolean>;
  createRepository?: CreateRepository;
  createViewer?: CreateViewer;
  serveMcp?: ServeMcp;
  resolveServeMcp?: ResolveServeMcp;
  registerSignal?: RegisterSignal;
  runCommand?: CommandRunner;
}

function safeText(value: string | undefined, fallback = ""): string {
  return clipText(value ?? fallback, MAX_DISPLAY_LENGTH).text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

function write(output: Pick<NodeJS.WriteStream, "write">, line: string): void {
  output.write(`${line}\n`);
}

function registerProcessSignal(signal: NodeJS.Signals, listener: () => void): () => void {
  process.once(signal, listener);
  return () => process.off(signal, listener);
}

async function resolveServeMcp(): Promise<ServeMcp> {
  return (await import("../mcp/server")).serveMcp;
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      finish({ exitCode: 1, stdout: "", stderr: "" });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.once("error", () => finish({ exitCode: 1, stdout, stderr }));
    child.once("close", (exitCode) => finish({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
}

function raceWithShutdown<T>(operation: Promise<T>, shutdown: Promise<void>): Promise<ShutdownResult<T>> {
  return Promise.race([
    operation.then(
      (value): ShutdownResult<T> => ({ kind: "value", value }),
      (error): ShutdownResult<T> => ({ kind: "error", error }),
    ),
    shutdown.then((): ShutdownResult<T> => ({ kind: "shutdown" })),
  ]);
}

function reportNoSessions(explicitFile: string | undefined, stderr: Pick<NodeJS.WriteStream, "write">): void {
  if (explicitFile === undefined) {
    write(stderr, 'No supported sessions found. Run "tracelens open <file>" to select a local session file.');
  } else {
    write(stderr, "Unable to open the selected session file.");
  }
}

async function openSession(session: SessionSummary, repository: SessionRepository, deps: CliDependencies): Promise<number> {
  const viewer = (deps.createViewer ?? createViewerService)({ repository, webRoot: deps.webRoot });
  const registerSignal = deps.registerSignal ?? registerProcessSignal;
  const cleanups: Array<() => void> = [];
  let resolveShutdown!: () => void;
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  let closePromise: Promise<void> | undefined;
  let shutdownRequested = false;
  const requestShutdown = (): Promise<void> => {
    shutdownRequested = true;
    resolveShutdown();
    closePromise ??= viewer.close();
    return closePromise;
  };
  void viewer.closed.then(resolveShutdown, resolveShutdown);

  try {
    const onSignal = () => {
      void requestShutdown().catch(() => undefined);
    };
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const cleanup = registerSignal(signal, onSignal);
      if (shutdownRequested) cleanup();
      else cleanups.push(cleanup);
    }
    if (shutdownRequested) {
      await closePromise?.catch(() => undefined);
      return 0;
    }

    const reason = safeText(session.selectionReason);
    if (reason) write(deps.stdout, reason);
    const link = await raceWithShutdown(viewer.getLink(session.id), shutdown);
    if (link.kind === "shutdown") {
      await closePromise?.catch(() => undefined);
      return 0;
    }
    if (link.kind === "error") throw link.error;

    const browser = await raceWithShutdown(deps.openBrowser(link.value), shutdown);
    if (browser.kind === "shutdown") {
      await closePromise?.catch(() => undefined);
      return 0;
    }
    if (browser.kind === "error") throw browser.error;
    if (!browser.value) {
      write(deps.stdout, "Unable to open a browser automatically. Open this URL:");
      write(deps.stdout, link.value);
    }
    await Promise.race([viewer.closed, shutdown]);
    await closePromise?.catch(() => undefined);
    return 0;
  } catch {
    await requestShutdown().catch(() => undefined);
    write(deps.stderr, "Unable to start the TraceLens viewer.");
    return 1;
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
}

export async function runCli(argv: string[], deps: CliDependencies): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error && error.message === "Only one session file can be opened."
      ? error.message
      : "Invalid command arguments.";
    write(deps.stderr, message);
    write(deps.stderr, USAGE);
    return 1;
  }

  if (args.command === "help") {
    write(deps.stdout, USAGE);
    return 0;
  }
  if (args.command === "unknown") {
    write(deps.stderr, "Unknown command.");
    write(deps.stderr, USAGE);
    return 1;
  }
  if (args.command === "setup-codex") {
    const result = await setupCodex({
      force: args.force,
      packageVersion: PACKAGE_VERSION,
      run: deps.runCommand ?? runCommand,
    });
    write(result.ok ? deps.stdout : deps.stderr, result.message);
    return result.ok ? 0 : 1;
  }

  let repository: SessionRepository;
  try {
    repository = await (deps.createRepository ?? createSessionRepository)({
      homeDir: deps.homeDir,
      cwd: deps.cwd,
      ...(args.command === "open" ? { explicitFile: args.file } : {}),
    });
  } catch {
    write(deps.stderr, "Unable to read local sessions.");
    return 1;
  }

  if (args.command === "mcp") {
    let startMcp: ServeMcp;
    try {
      startMcp = deps.serveMcp ?? await (deps.resolveServeMcp ?? resolveServeMcp)();
    } catch {
      write(deps.stderr, "Unable to start the TraceLens MCP server.");
      return 1;
    }
    const viewer = (deps.createViewer ?? createViewerService)({ repository, webRoot: deps.webRoot });
    try {
      await startMcp(repository, viewer, PACKAGE_VERSION);
      return 0;
    } catch {
      write(deps.stderr, "Unable to start the TraceLens MCP server.");
      return 1;
    }
  }

  let sessions: SessionSummary[];
  try {
    sessions = await repository.list();
  } catch {
    write(deps.stderr, "Unable to list local sessions.");
    return 1;
  }
  if (sessions.length === 0) {
    reportNoSessions(args.command === "open" ? args.file : undefined, deps.stderr);
    return 1;
  }

  if (args.command === "list") {
    try {
      return await openSession(await selectRun(sessions, deps.input, deps.stdout), repository, deps);
    } catch (error) {
      if (error instanceof Error && error.message === "Session selection was cancelled.") {
        write(deps.stderr, error.message);
      } else {
        write(deps.stderr, "Unable to select a session.");
      }
      return 1;
    }
  }

  return openSession(sessions[0], repository, deps);
}

function canonicalFileUrl(filePath: string): string {
  try {
    const realpath = realpathSync.native ?? realpathSync;
    return pathToFileURL(realpath(filePath)).href;
  } catch {
    return pathToFileURL(path.resolve(filePath)).href;
  }
}

export function isExecutedDirectly(commandPath = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (commandPath === undefined) return false;
  try {
    return canonicalFileUrl(commandPath) === canonicalFileUrl(fileURLToPath(moduleUrl));
  } catch {
    return pathToFileURL(commandPath).href === moduleUrl;
  }
}

if (isExecutedDirectly()) {
  void runCli(process.argv.slice(2), {
    homeDir: homedir(),
    cwd: process.cwd(),
    webRoot: resolveWebRoot(import.meta.url),
    input: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    openBrowser,
  }).then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stderr.write("TraceLens could not start.\n");
    process.exitCode = 1;
  });
}
