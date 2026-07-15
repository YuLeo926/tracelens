import { describe, expect, it } from "vitest";
import { scanTraceFiles } from "./folderWatch";

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
