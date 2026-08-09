import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { SessionNotFoundError, type SessionRepository } from "./repository";

const API_PREFIX = "/api";
const VIEWER_BASE = "/tracelens/";
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export interface ViewerService {
  getLink(sessionId: string, eventId?: string): Promise<string>;
  close(): Promise<void>;
  closed: Promise<void>;
}

export interface StartViewerOptions {
  repository: SessionRepository;
  webRoot: string;
  idleMs?: number;
  token?: string;
}

interface RunningServer {
  server: Server;
  port: number;
  webRoot: string;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  stopPromise: Promise<void> | undefined;
}

type StaticResult = { kind: "found"; filePath: string } | { kind: "missing" } | { kind: "unsafe" };

function isWithin(root: string, target: string): boolean {
  const normalize = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  const normalizedRoot = normalize(path.resolve(root));
  const normalizedTarget = normalize(path.resolve(target));
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function sendNotFound(response: ServerResponse): void {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function tokenMatches(header: string | string[] | undefined, token: string): boolean {
  if (typeof header !== "string") return false;
  const received = Buffer.from(header, "latin1");
  const expected = Buffer.from(`Bearer ${token}`, "latin1");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

async function staticFile(root: string, filePath: string): Promise<StaticResult> {
  if (!isWithin(root, filePath)) return { kind: "unsafe" };
  try {
    if (!(await stat(filePath)).isFile()) return { kind: "missing" };
    const resolved = await realpath(filePath);
    return isWithin(root, resolved) ? { kind: "found", filePath: resolved } : { kind: "unsafe" };
  } catch {
    return { kind: "missing" };
  }
}

export function createViewerService(options: StartViewerOptions): ViewerService {
  const token = options.token ?? randomBytes(32).toString("hex");
  if (!TOKEN_PATTERN.test(token)) throw new Error("Viewer tokens must be 64-character lowercase hexadecimal strings.");
  const idleMs = Math.max(1, Math.floor(options.idleMs ?? DEFAULT_IDLE_MS));
  let running: RunningServer | undefined;
  let starting: Promise<RunningServer> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let hasClosed = false;

  function markClosed(): void {
    if (hasClosed) return;
    hasClosed = true;
    resolveClosed();
  }

  async function stop(instance: RunningServer): Promise<void> {
    if (!instance.stopPromise) {
      instance.stopPromise = (async () => {
        if (running === instance) running = undefined;
        if (instance.idleTimer !== undefined) clearTimeout(instance.idleTimer);
        await new Promise<void>((resolve) => instance.server.close(() => resolve()));
        markClosed();
      })();
    }
    await instance.stopPromise;
  }

  function resetIdle(instance: RunningServer): void {
    if (instance.idleTimer !== undefined) clearTimeout(instance.idleTimer);
    instance.idleTimer = setTimeout(() => {
      void stop(instance);
    }, idleMs);
  }

  async function serveStatic(_request: IncomingMessage, response: ServerResponse, root: string, pathname: string): Promise<void> {
    if (pathname !== "/tracelens" && !pathname.startsWith(VIEWER_BASE)) {
      sendNotFound(response);
      return;
    }

    const relativePath = pathname === "/tracelens" || pathname === VIEWER_BASE ? "" : pathname.slice(VIEWER_BASE.length);
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(relativePath);
    } catch {
      sendNotFound(response);
      return;
    }
    const requested = path.resolve(root, decodedPath || "index.html");
    const result = await staticFile(root, requested);
    if (result.kind === "unsafe") {
      sendNotFound(response);
      return;
    }

    const fallback = result.kind === "missing" ? await staticFile(root, path.join(root, "index.html")) : result;
    if (fallback.kind !== "found") {
      sendNotFound(response);
      return;
    }
    try {
      response.writeHead(200, { "content-type": contentType(fallback.filePath) });
      response.end(await readFile(fallback.filePath));
    } catch {
      sendNotFound(response);
    }
  }

  async function serveApi(request: IncomingMessage, response: ServerResponse, instance: RunningServer, pathname: string): Promise<void> {
    if (!tokenMatches(request.headers.authorization, token)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (request.method !== "GET") {
      sendNotFound(response);
      return;
    }

    if (pathname === "/api/sessions") {
      try {
        sendJson(response, 200, await options.repository.list());
        resetIdle(instance);
      } catch {
        sendJson(response, 500, { error: "Unable to list sessions" });
      }
      return;
    }

    if (pathname.startsWith("/api/sessions/")) {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(pathname.slice("/api/sessions/".length));
      } catch {
        sendNotFound(response);
        return;
      }
      if (!sessionId) {
        sendNotFound(response);
        return;
      }
      try {
        const loaded = await options.repository.load(sessionId);
        sendJson(response, 200, { session: loaded.summary, source: loaded.source });
        resetIdle(instance);
      } catch (error) {
        if (error instanceof SessionNotFoundError) sendJson(response, 404, { error: "Session not found" });
        else sendJson(response, 500, { error: "Unable to load session" });
      }
      return;
    }

    sendNotFound(response);
  }

  async function start(): Promise<RunningServer> {
    const webRoot = await realpath(options.webRoot);
    let instance: RunningServer;
    const server = createServer((request, response) => {
      void (async () => {
        try {
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
            await serveApi(request, response, instance, url.pathname);
          } else {
            await serveStatic(request, response, webRoot, url.pathname);
          }
        } catch {
          if (!response.headersSent) sendNotFound(response);
          else response.end();
        }
      })();
    });
    instance = { server, port: 0, webRoot, idleTimer: undefined, stopPromise: undefined };

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0 }, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error("TraceLens viewer did not receive a loopback port.");
    }
    instance.port = address.port;
    resetIdle(instance);
    return instance;
  }

  async function ensureServer(): Promise<RunningServer> {
    if (running) return running;
    if (!starting) {
      starting = start();
      try {
        running = await starting;
      } finally {
        starting = undefined;
      }
    }
    return starting ?? running!;
  }

  return {
    closed,
    async getLink(sessionId, eventId) {
      const instance = await ensureServer();
      const url = new URL(`http://127.0.0.1:${instance.port}${VIEWER_BASE}`);
      url.search = new URLSearchParams({
        mode: "session",
        session: sessionId,
        ...(eventId === undefined ? {} : { event: eventId }),
      }).toString();
      url.hash = new URLSearchParams({ token }).toString();
      return url.toString();
    },
    async close() {
      try {
        if (starting) await starting;
        if (running) await stop(running);
      } finally {
        markClosed();
      }
    },
  };
}
