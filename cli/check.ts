import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildMcpServer } from "../mcp/server";
import { createTraceLensHandlers } from "../mcp/handlers";
import { parseTraceText } from "../src/core/parse";
import { buildRunFacts } from "../src/core/session/facts";
import { createSessionQuery } from "../src/core/session/query";
import type { SessionSummary } from "../src/core/session/types";
import { createSessionRepository, SessionNotFoundError, type SessionRepository } from "./repository";
import { createViewerService, type ViewerService } from "./server";

interface CheckItem { id: string; status: "pass" | "warn" | "fail"; message: string; action?: string; }
export interface CheckReport { version: string; status: "pass" | "warn" | "fail"; scope: string; checks: CheckItem[]; }
export interface CheckOptions {
  homeDir: string;
  cwd: string;
  webRoot: string;
  version: string;
  createRepository?: typeof createSessionRepository;
}

function fixtureRepository(): SessionRepository {
  const source = [
    { type: "session_meta", timestamp: "2026-01-01T00:00:00Z", payload: { id: "self-check" } },
    { type: "response_item", timestamp: "2026-01-01T00:00:01Z", payload: { type: "custom_tool_call", call_id: "check-tool", name: "check_fixture", input: String.raw`synthetic evidence with \"escaped quotes\"` } },
    { type: "response_item", timestamp: "2026-01-01T00:00:02Z", payload: { type: "custom_tool_call_output", call_id: "check-tool", output: { content: "Synthetic failure", success: false } } },
  ].map((record) => JSON.stringify(record)).join("\n");
  const trace = parseTraceText(source);
  const facts = buildRunFacts(trace, "complete");
  const summary: SessionSummary = { id: "self-check", provider: "codex", modifiedAt: 0, sizeBytes: source.length, lifecycle: "complete", match: "exact", selectionReason: "Built-in synthetic fixture.", facts };
  const loaded = { summary, trace, facts, query: createSessionQuery(trace), source };
  return {
    async list() { return [summary]; },
    async load(id) { if (id !== summary.id) throw new SessionNotFoundError(); return loaded; },
    async refresh() {},
  };
}

/** Exercise the actual stdio codec and registered tool schemas, without a model or child process. */
async function probeMcp(repository: SessionRepository, viewer: ViewerService, version: string): Promise<string> {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new StdioServerTransport(input, output);
  const server = buildMcpServer(createTraceLensHandlers(repository, viewer), version);
  let sequence = 0;
  let buffer = "";
  const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let response: { id?: number; error?: unknown; result?: Record<string, unknown> };
      try { response = JSON.parse(line); }
      catch {
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Invalid MCP response.")); }
        pending.clear();
        continue;
      }
      const request = response.id === undefined ? undefined : pending.get(response.id);
      if (!request) continue;
      clearTimeout(request.timer);
      pending.delete(response.id!);
      if (response.error) request.reject(new Error("MCP check failed."));
      else request.resolve(response.result ?? {});
    }
  });
  const request = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("MCP check timed out.")); }, 5000);
    pending.set(id, { resolve, reject, timer });
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  try {
    await server.connect(transport);
    await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "tracelens-self-check", version } });
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = await request("tools/list");
    if (!Array.isArray(tools.tools) || tools.tools.length !== 6) throw new Error("Missing tools.");
    const listed = await request("tools/call", { name: "list_sessions", arguments: { limit: 1 } });
    const listedData = listed.structuredContent as { data?: Array<{ id: string }> } | undefined;
    if (listed.isError || listedData?.data?.[0]?.id !== "self-check") throw new Error("Listing failed.");
    const overview = await request("tools/call", { name: "get_session_overview", arguments: { sessionId: "self-check" } });
    const overviewData = overview.structuredContent as { data?: SessionSummary } | undefined;
    if (overview.isError || overviewData?.data?.facts.totals.errors !== 1) throw new Error("Evidence mismatch.");
    const linked = await request("tools/call", { name: "get_viewer_link", arguments: { sessionId: "self-check" } });
    const linkData = linked.structuredContent as { data?: { url?: string } } | undefined;
    if (linked.isError || !linkData?.data?.url) throw new Error("Viewer link failed.");
    return linkData.data.url;
  } finally {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Check closed.")); }
    await server.close();
    input.destroy();
    output.destroy();
  }
}

export async function runSelfCheck(options: CheckOptions): Promise<CheckReport> {
  const checks: CheckItem[] = [];
  try {
    const html = await readFile(path.join(options.webRoot, "index.html"), "utf8");
    if (!html.includes("<html")) throw new Error("Invalid viewer entry.");
    checks.push({ id: "viewer-assets", status: "pass", message: "Viewer entry is installed." });
  } catch {
    checks.push({ id: "viewer-assets", status: "fail", message: "Viewer assets are missing or unreadable.", action: "Reinstall TraceLens, or run npm run build in a source checkout." });
  }
  try {
    const repository = await (options.createRepository ?? createSessionRepository)({ homeDir: options.homeDir, cwd: options.cwd });
    const [session] = await repository.list({ limit: 1 });
    checks.push(session
      ? { id: "local-session", status: "pass", message: session.match === "fallback" ? "A supported local session is readable; none matched this project." : "A project session is readable." }
      : { id: "local-session", status: "warn", message: "No readable supported sessions were found.", action: "Run Codex in this project first, then rerun tracelens check." });
  } catch {
    checks.push({ id: "local-session", status: "fail", message: "Local session discovery failed.", action: "Check folder permissions and rerun from the intended project." });
  }
  let viewer: ViewerService | undefined;
  try {
    const repository = fixtureRepository();
    const fixture = await repository.load("self-check");
    if (fixture.facts.totals.errors !== 1 || fixture.facts.totals.toolCalls !== 1) throw new Error("Parser mismatch.");
    checks.push({ id: "parser", status: "pass", message: "Synthetic tool calls and failures are parsed correctly." });
    viewer = createViewerService({ repository, webRoot: options.webRoot, idleMs: 30_000 });
    const link = new URL(await probeMcp(repository, viewer, options.version));
    checks.push({ id: "mcp", status: "pass", message: "Bundled MCP stdio transport, tool listing, overview, and viewer link passed." });
    const token = new URLSearchParams(link.hash.slice(1)).get("token");
    const endpoint = `${link.origin}/api/sessions/self-check`;
    const denied = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    const allowed = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    const body = await allowed.json() as { session?: SessionSummary; source?: string };
    if (denied.ok || !allowed.ok || body.session?.id !== "self-check" || !body.source) throw new Error("Viewer authentication check failed.");
    if (parseTraceText(body.source).summary.errors !== 1) throw new Error("Viewer source round-trip failed.");
    checks.push({ id: "viewer-http", status: "pass", message: "Authenticated loopback evidence loads; unauthenticated access is rejected." });
  } catch {
    checks.push({ id: "local-pipeline", status: "fail", message: "The synthetic MCP/viewer check failed.", action: "Check the build and whether loopback connections are allowed. Reinstall if the issue persists." });
  } finally { await viewer?.close(); }
  return {
    version: options.version,
    status: checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "pass",
    scope: "Local package checks only. No model calls, uploads, or configuration changes. Codex's saved registration and ability to call tools are not tested; start a new Codex task to verify them.",
    checks,
  };
}
