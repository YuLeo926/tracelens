import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  it("uses open by default and accepts the supported commands", () => {
    expect(parseArgs([])).toEqual({ command: "open", file: undefined });
    expect(parseArgs(["open", "run.jsonl"])).toEqual({ command: "open", file: "run.jsonl" });
    expect(parseArgs(["list"])).toEqual({ command: "list" });
    expect(parseArgs(["mcp"])).toEqual({ command: "mcp" });
    expect(parseArgs(["setup", "codex"])).toEqual({ command: "setup-codex", force: false });
    expect(parseArgs(["setup", "codex", "--force"])).toEqual({ command: "setup-codex", force: true });
  });

  it("rejects extra file arguments", () => {
    expect(() => parseArgs(["open", "a", "b"])).toThrow("Only one session file can be opened.");
  });

  it("rejects unsupported setup targets and flags", () => {
    expect(() => parseArgs(["setup", "claude"])).toThrow("Unsupported setup target.");
    expect(() => parseArgs(["setup", "codex", "--invalid"])).toThrow("Unsupported setup option.");
  });
});
