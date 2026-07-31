import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { clipText } from "../src/core/session/sanitize";
import type { SessionSummary } from "../src/core/session/types";
import { parseArgs } from "./args";
import { openBrowser } from "./openBrowser";
import { resolveWebRoot } from "./paths";
import { createSessionRepository, type SessionRepository } from "./repository";
import { selectRun } from "./selectRun";
import { createViewerService, type StartViewerOptions, type ViewerService } from "./server";

const USAGE = [
  "Usage: tracelens [open [session-file] | list]",
  "",
  "Open the newest local session for this project, or select a session with list.",
].join("\n");
const MAX_DISPLAY_LENGTH = 160;

type CreateRepository = typeof createSessionRepository;
type CreateViewer = (options: StartViewerOptions) => ViewerService;
type RegisterSignal = (signal: NodeJS.Signals, listener: () => void) => () => void;

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
  registerSignal?: RegisterSignal;
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

async function waitForShutdown(viewer: ViewerService, registerSignal: RegisterSignal): Promise<void> {
  let cleanups: Array<() => void> = [];
  await new Promise<void>((resolve) => {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      for (const cleanup of cleanups) cleanup();
      resolve();
    };
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const cleanup = registerSignal(signal, close);
      if (closed) cleanup();
      else cleanups.push(cleanup);
    }
  });
  await viewer.close();
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
  try {
    const reason = safeText(session.selectionReason);
    if (reason) write(deps.stdout, reason);
    const url = await viewer.getLink(session.id);
    if (!(await deps.openBrowser(url))) {
      write(deps.stdout, "Unable to open a browser automatically. Open this URL:");
      write(deps.stdout, url);
    }
    await waitForShutdown(viewer, deps.registerSignal ?? registerProcessSignal);
    return 0;
  } catch {
    await viewer.close();
    write(deps.stderr, "Unable to start the TraceLens viewer.");
    return 1;
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

function isExecutedDirectly(): boolean {
  return process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
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
