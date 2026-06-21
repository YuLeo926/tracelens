import { describe, expect, it } from "vitest";
import { TRACE_FILE_ACCEPT } from "./traceFileAccept";

describe("TRACE_FILE_ACCEPT", () => {
  it("allows JSON and JSONL trace files", () => {
    const values = TRACE_FILE_ACCEPT.split(",");
    expect(values).toContain("application/json");
    expect(values).toContain(".json");
    expect(values).toContain(".jsonl");
  });
});
