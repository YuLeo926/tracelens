import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../src/core/session/types";
import { selectRun } from "./selectRun";

function run(id: string, title: string): SessionSummary {
  return {
    id,
    provider: "codex",
    title,
    project: "tracelens",
    modifiedAt: 1,
    sizeBytes: 1,
    lifecycle: "complete",
    match: "exact",
    selectionReason: "Matches current project.",
    facts: { lifecycle: "complete", totals: { durationMs: 1, tokensIn: 1, tokensOut: 1, toolCalls: 0, errors: 0 }, errorEvents: [], slowestEvents: [], highestTokenEvents: [], repeatedOperations: [] },
  };
}

function capture(): { output: Writable; text(): string } {
  const chunks: string[] = [];
  return {
    output: new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } }),
    text: () => chunks.join(""),
  };
}

describe("selectRun", () => {
  it("returns the numbered selection and re-prompts after invalid input", async () => {
    const result = capture();

    await expect(selectRun([run("one", "First"), run("two", "Second")], Readable.from(["nope\n0\n2\n"]), result.output)).resolves.toMatchObject({ id: "two" });
    expect(result.text()).toContain("1. First");
    expect(result.text()).toContain("2. Second");
    expect(result.text()).toContain("Enter a number between 1 and 2.");
  });

  it("rejects end of input", async () => {
    await expect(selectRun([run("one", "First")], Readable.from([]), capture().output)).rejects.toThrow("Session selection was cancelled.");
  });
});
