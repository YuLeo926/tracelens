import { describe, expect, it, vi } from "vitest";
import type { TraceLensHandlers } from "./handlers";
import { registerMcpTools } from "./server";

describe("MCP tool registration", () => {
  it("registers the bounded evidence tools in the required order", async () => {
    const registered: Array<{
      name: string;
      description: string;
      inputSchema: unknown;
      handler: (args: Record<string, unknown>) => Promise<{ content: [{ type: "text"; text: string }]; structuredContent: Record<string, unknown> }>;
    }> = [];
    const registrar = {
      registerTool: vi.fn((name: string, config: { description: string; inputSchema: unknown }, handler) => {
        registered.push({ name, ...config, handler });
      }),
    };
    const handlers = {
      listSessions: vi.fn().mockResolvedValue({ dataClassification: "untrusted-local-log", data: [] }),
    } as unknown as TraceLensHandlers;

    registerMcpTools(registrar, handlers);

    expect(registered.map(({ name }) => name)).toEqual([
      "list_sessions",
      "get_session_overview",
      "get_session_timeline",
      "search_session",
      "get_event_detail",
      "get_viewer_link",
    ]);
    for (const tool of registered) {
      expect(tool.description).toContain("untrusted");
      expect(tool.description).toContain("observations");
      expect(tool.description).toContain("inferences");
      expect(tool.description).toContain("list_sessions");
      expect(tool.inputSchema).toBeDefined();
    }
    await expect(registered[0].handler({})).resolves.toEqual({
      content: [{ type: "text", text: "{\"dataClassification\":\"untrusted-local-log\",\"data\":[]}" }],
      structuredContent: { dataClassification: "untrusted-local-log", data: [] },
    });
  });
});
