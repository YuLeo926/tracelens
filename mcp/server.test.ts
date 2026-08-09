import { EventEmitter } from "node:events";
import type { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { describe, expect, it, vi } from "vitest";
import type { SessionRepository } from "../cli/repository";
import type { ViewerService } from "../cli/server";
import type { TraceLensHandlers } from "./handlers";
import { registerMcpTools, serveMcpWithRuntime, type McpStdioRuntime } from "./server";

type ToolResponse = { content: [{ type: "text"; text: string }]; structuredContent: Record<string, unknown> };
type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (args: Record<string, unknown>) => Promise<ToolResponse>;
};

function registration(handlers: TraceLensHandlers): RegisteredTool[] {
  const registered: RegisteredTool[] = [];
  registerMcpTools({
    registerTool(name, config, handler) {
      registered.push({ name, ...config, handler });
    },
  }, handlers);
  return registered;
}

function tool(tools: RegisteredTool[], name: string): RegisteredTool {
  return tools.find((item) => item.name === name)!;
}

function lifecycle() {
  const input = new EventEmitter();
  const stderr: string[] = [];
  const transport = {
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
    close: vi.fn(async () => transport.onclose?.()),
  } as unknown as StdioServerTransport;
  const server = {
    connect: vi.fn(async (connectedTransport: StdioServerTransport) => {
      connectedTransport.onclose = vi.fn();
      connectedTransport.onerror = vi.fn();
    }),
    close: vi.fn(async () => transport.close()),
  };
  const viewer: ViewerService = { getLink: vi.fn(), close: vi.fn().mockResolvedValue(undefined), closed: Promise.resolve() };
  const repository = { list: vi.fn(), load: vi.fn(), refresh: vi.fn() } as SessionRepository;
  const runtime: McpStdioRuntime = {
    buildServer: vi.fn().mockReturnValue(server),
    createTransport: vi.fn().mockReturnValue(transport),
    input: input as unknown as McpStdioRuntime["input"],
    stderr: { write(chunk) { stderr.push(String(chunk)); return true; } },
  };
  return { input, stderr, transport, server, viewer, repository, runtime };
}

describe("MCP tool registration", () => {
  it("registers the required tools and returns compact structured content", async () => {
    const handlers = {
      listSessions: vi.fn().mockResolvedValue({ dataClassification: "untrusted-local-log", data: [] }),
    } as unknown as TraceLensHandlers;
    const registered = registration(handlers);

    expect(registered.map(({ name }) => name)).toEqual([
      "list_sessions",
      "get_session_overview",
      "get_session_timeline",
      "search_session",
      "get_event_detail",
      "get_viewer_link",
    ]);
    for (const registeredTool of registered) {
      expect(registeredTool.description).toContain("untrusted");
      expect(registeredTool.description).toContain("observations");
      expect(registeredTool.description).toContain("inferences");
      expect(registeredTool.description).toContain("list_sessions");
    }
    await expect(registered[0].handler({})).resolves.toEqual({
      content: [{ type: "text", text: "{\"dataClassification\":\"untrusted-local-log\",\"data\":[]}" }],
      structuredContent: { dataClassification: "untrusted-local-log", data: [] },
    });
  });

  it("accepts exact Zod boundaries and rejects out-of-range or raw event IDs", () => {
    const tools = registration({} as TraceLensHandlers);
    const validEventId = `evt_${"a".repeat(64)}`;

    expect(tool(tools, "list_sessions").inputSchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(tool(tools, "list_sessions").inputSchema.safeParse({ limit: 20 }).success).toBe(true);
    for (const limit of [0, 21, 1.5]) expect(tool(tools, "list_sessions").inputSchema.safeParse({ limit }).success).toBe(false);

    expect(tool(tools, "get_session_timeline").inputSchema.safeParse({ sessionId: "s", cursor: "0", limit: 50 }).success).toBe(true);
    for (const value of [{ sessionId: "s", limit: 51 }, { sessionId: "s", cursor: "-1" }, { sessionId: "s", cursor: "1.5" }]) {
      expect(tool(tools, "get_session_timeline").inputSchema.safeParse(value).success).toBe(false);
    }

    expect(tool(tools, "search_session").inputSchema.safeParse({ sessionId: "s", query: "q", limit: 20 }).success).toBe(true);
    expect(tool(tools, "search_session").inputSchema.safeParse({ sessionId: "s", query: "q", limit: 21 }).success).toBe(false);
    expect(tool(tools, "get_event_detail").inputSchema.safeParse({ sessionId: "s", eventId: validEventId }).success).toBe(true);
    expect(tool(tools, "get_event_detail").inputSchema.safeParse({ sessionId: "s", eventId: windowsEventPath() }).success).toBe(false);
    expect(tool(tools, "get_viewer_link").inputSchema.safeParse({ sessionId: "s", eventId: validEventId }).success).toBe(true);
    expect(tool(tools, "get_viewer_link").inputSchema.safeParse({ sessionId: "s", eventId: "/var/private/event" }).success).toBe(false);
  });

  it("sanitizes unexpected handler errors at the protocol boundary", async () => {
    const handlers = {
      listSessions: vi.fn().mockRejectedValue(new Error("repository failed at C:\\private\\sessions")),
    } as unknown as TraceLensHandlers;
    const [list] = registration(handlers);

    await expect(list.handler({})).rejects.toThrow("TraceLens evidence request failed.");
  });
});

describe("serveMcpWithRuntime", () => {
  it("stays alive until stdio closes and then closes the viewer exactly once", async () => {
    const test = lifecycle();
    let settled = false;
    const serving = serveMcpWithRuntime(test.repository, test.viewer, "0.2.0", test.runtime).finally(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    expect(test.viewer.close).not.toHaveBeenCalled();
    test.transport.onclose?.();
    await serving;

    expect(test.server.connect).toHaveBeenCalledOnce();
    expect(test.viewer.close).toHaveBeenCalledOnce();
  });

  it("closes transport and viewer on EOF without writing stdout", async () => {
    const test = lifecycle();
    const serving = serveMcpWithRuntime(test.repository, test.viewer, "0.2.0", test.runtime);
    await new Promise((resolve) => setImmediate(resolve));

    test.input.emit("end");
    await serving;

    expect(test.transport.close).toHaveBeenCalled();
    expect(test.viewer.close).toHaveBeenCalledOnce();
    expect(test.stderr.join("")).toBe("");
  });

  it("sanitizes connection and transport failures and still closes the viewer", async () => {
    const construction = lifecycle();
    construction.runtime.buildServer = vi.fn(() => { throw new Error("build failed at /var/private/server"); });
    await expect(serveMcpWithRuntime(construction.repository, construction.viewer, "0.2.0", construction.runtime))
      .rejects.toThrow("TraceLens MCP startup failed.");
    expect(construction.stderr.join("")).toBe("TraceLens MCP startup failed.\n");
    expect(construction.viewer.close).toHaveBeenCalledOnce();

    const connection = lifecycle();
    connection.server.connect.mockRejectedValue(new Error("connect failed at C:\\private\\stdio"));

    await expect(serveMcpWithRuntime(connection.repository, connection.viewer, "0.2.0", connection.runtime))
      .rejects.toThrow("TraceLens MCP startup failed.");
    expect(connection.stderr.join("")).toBe("TraceLens MCP startup failed.\n");
    expect(connection.stderr.join("")).not.toContain("C:\\private");
    expect(connection.viewer.close).toHaveBeenCalledOnce();

    const transportFailure = lifecycle();
    const serving = serveMcpWithRuntime(transportFailure.repository, transportFailure.viewer, "0.2.0", transportFailure.runtime);
    await new Promise((resolve) => setImmediate(resolve));
    transportFailure.transport.onerror?.(new Error("read failed at /var/private/stdio"));
    await serving;

    expect(transportFailure.stderr.join("")).toBe("TraceLens MCP transport error.\n");
    expect(transportFailure.stderr.join("")).not.toContain("/var/private");
    expect(transportFailure.viewer.close).toHaveBeenCalledOnce();

    const cleanupFailure = lifecycle();
    cleanupFailure.viewer.close = vi.fn().mockRejectedValue(new Error("close failed at C:\\private\\viewer"));
    const cleanupServing = serveMcpWithRuntime(cleanupFailure.repository, cleanupFailure.viewer, "0.2.0", cleanupFailure.runtime);
    await new Promise((resolve) => setImmediate(resolve));
    cleanupFailure.transport.onclose?.();
    await cleanupServing;
    expect(cleanupFailure.stderr.join("")).toBe("TraceLens viewer cleanup failed.\n");
    expect(cleanupFailure.stderr.join("")).not.toContain("C:\\private");
  });
});

function windowsEventPath(): string {
  return "C:\\private\\event";
}
