import { describe, expect, it } from "vitest";
import { Blob } from "node:buffer";
import { readTokenTotals, scanTraceFiles } from "./folderWatch";

describe("readTokenTotals", () => {
  const usage = (input: number) => JSON.stringify({ type: "assistant", message: { role: "assistant", usage: { input_tokens: input, output_tokens: 10 } } });
  const handle = (text: string, name = "run.jsonl") => ({
    name,
    getFile: async () => new Blob([text]),
  }) as unknown as FileSystemFileHandle;

  it("sums the entire Claude log even when older usage is outside the tail window", async () => {
    const text = [usage(1000), JSON.stringify({ type: "user", message: { role: "user", content: "x".repeat(300_000) } }), usage(100)].join("\n");
    expect(await readTokenTotals(handle(text))).toMatchObject({ tokensIn: 1100, tokensOut: 20 });
  });

  it("keeps Codex totals when the last valid count is followed by a large output and an empty notification", async () => {
    const text = [
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, output_tokens: 100 } } } }),
      JSON.stringify({ type: "response_item", payload: { output: "x".repeat(300_000) } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } }),
      '{"type":',
    ].join("\n");
    expect(await readTokenTotals(handle(text))).toMatchObject({ tokensIn: 1000, tokensOut: 100 });
  });

  it("handles pretty-printed JSON arrays", async () => {
    const text = JSON.stringify([JSON.parse(usage(1000)), JSON.parse(usage(100))], null, 2);
    expect(await readTokenTotals(handle(text, "run.json"))).toMatchObject({ tokensIn: 1100, tokensOut: 20 });
  });

  it("handles chunk boundaries, multibyte text, and an unterminated last valid record", async () => {
    const encoded = new TextEncoder().encode(`${usage(1000)}\r\n${JSON.stringify({ message: { content: "\u4e2d\u6587" } })}\n${usage(100)}`);
    const file = {
      stream: () => new ReadableStream({ start(controller) {
        for (let i = 0; i < encoded.length; i += 7) controller.enqueue(encoded.slice(i, i + 7));
        controller.close();
      } }),
    };
    const chunked = { name: "run.jsonl", getFile: async () => file } as unknown as FileSystemFileHandle;
    expect(await readTokenTotals(chunked)).toMatchObject({ tokensIn: 1100, tokensOut: 20 });
  });
});

describe("scanTraceFiles", () => {
  it("returns every matching file in newest-first order", async () => {
    const entries = Array.from({ length: 301 }, (_, i) => ({
      kind: "file" as const,
      name: `trace-${i}.jsonl`,
      getFile: async () => ({ lastModified: i, size: i + 1 }),
    }));
    const dir = {
      async *values() {
        for (const entry of entries) yield entry;
      },
    } as unknown as FileSystemDirectoryHandle;

    const files = await scanTraceFiles(dir);

    expect(files).toHaveLength(301);
    expect(files[0]).toMatchObject({ name: "trace-300.jsonl", lastModified: 300 });
    expect(files[300]).toMatchObject({ name: "trace-0.jsonl", lastModified: 0 });
  });
});
