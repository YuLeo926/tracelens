import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  it("uses open by default and accepts the supported commands", () => {
    expect(parseArgs([])).toEqual({ command: "open", file: undefined });
    expect(parseArgs(["open", "run.jsonl"])).toEqual({ command: "open", file: "run.jsonl" });
    expect(parseArgs(["list"])).toEqual({ command: "list" });
  });

  it("rejects extra file arguments", () => {
    expect(() => parseArgs(["open", "a", "b"])).toThrow("Only one session file can be opened.");
  });
});
