import { describe, expect, it, vi } from "vitest";
import { runCli, type CliDependencies } from "./index";
import { setupCodex, type CommandRunner } from "./setupCodex";

const VERSION = "0.2.0";
const expectedAddArgs = ["mcp", "add", "tracelens", "--", "npx", "-y", `tracelens@${VERSION}`, "mcp"];
const missing = { exitCode: 1, stdout: "", stderr: "MCP server 'tracelens' not found" };
const exact = {
  exitCode: 0,
  stdout: JSON.stringify({
    name: "tracelens",
    transport: { type: "stdio", command: "npx", args: ["-y", `tracelens@${VERSION}`, "mcp"] },
  }),
  stderr: "",
};
const conflict = {
  exitCode: 0,
  stdout: JSON.stringify({
    name: "tracelens",
    transport: { type: "stdio", command: "node", args: ["old-server.mjs"] },
  }),
  stderr: "",
};

function runner(...results: Array<{ exitCode: number; stdout: string; stderr: string }>): CommandRunner {
  return vi.fn(async () => results.shift() ?? { exitCode: 1, stdout: "", stderr: "unexpected command" });
}

function cliDependencies(runCommand: CommandRunner) {
  const stdout = { write: vi.fn() } as unknown as Pick<NodeJS.WriteStream, "write">;
  const stderr = { write: vi.fn() } as unknown as Pick<NodeJS.WriteStream, "write">;
  const deps: CliDependencies = {
    homeDir: "unused",
    cwd: "unused",
    webRoot: "unused",
    input: process.stdin,
    stdout,
    stderr,
    openBrowser: vi.fn(),
    runCommand,
  };
  return { deps, stdout, stderr };
}

describe("setupCodex", () => {
  it("adds a missing TraceLens registration", async () => {
    const run = runner(missing, { exitCode: 0, stdout: "", stderr: "" });

    const result = await setupCodex({ force: false, packageVersion: VERSION, run });
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      message: expect.stringContaining("TraceLens is connected to Codex. Start a new Codex task, then ask it to use TraceLens to inspect a run."),
    });
    expect(result.message).toContain("Evidence requested through TraceLens tools becomes part of the Codex conversation.");
    expect(run).toHaveBeenNthCalledWith(1, "codex", ["mcp", "get", "tracelens", "--json"]);
    expect(run).toHaveBeenNthCalledWith(2, "codex", expectedAddArgs);
  });

  it("leaves an exact stdio registration unchanged", async () => {
    const run = runner(exact);

    await expect(setupCodex({ force: false, packageVersion: VERSION, run })).resolves.toMatchObject({ ok: true, changed: false });
    expect(run).toHaveBeenCalledOnce();
  });

  it("preserves a conflicting registration unless force is supplied", async () => {
    const run = runner(conflict);

    const cli = cliDependencies(run);
    await expect(runCli(["setup", "codex"], cli.deps)).resolves.toBe(1);
    expect(run).toHaveBeenCalledOnce();
  });

  it("removes then adds a conflicting registration when forced", async () => {
    const run = runner(conflict, { exitCode: 0, stdout: "", stderr: "" }, { exitCode: 0, stdout: "", stderr: "" });

    await expect(setupCodex({ force: true, packageVersion: VERSION, run })).resolves.toMatchObject({ ok: true, changed: true });
    expect(run).toHaveBeenNthCalledWith(2, "codex", ["mcp", "remove", "tracelens"]);
    expect(run).toHaveBeenNthCalledWith(3, "codex", expectedAddArgs);
  });

  it("prints the manual registration command when Codex is unavailable", async () => {
    const run = runner({ exitCode: 1, stdout: "", stderr: "codex: command not found" });

    await expect(setupCodex({ force: false, packageVersion: VERSION, run })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining(`codex mcp add tracelens -- npx -y tracelens@${VERSION} mcp`),
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("returns a safe error for malformed registration output", async () => {
    const run = runner({ exitCode: 0, stdout: "not json", stderr: "" });

    await expect(setupCodex({ force: false, packageVersion: VERSION, run })).resolves.toEqual({
      ok: false,
      changed: false,
      message: "Unable to inspect the TraceLens Codex connection.",
    });
  });
});
