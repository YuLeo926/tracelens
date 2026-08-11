import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json";
import { FIRST_RUN_FEEDBACK_URL, FIRST_RUN_PROMPT } from "../src/core/firstRun";
import { runCli, type CliDependencies } from "./index";
import { setupCodex, type CommandRunner } from "./setupCodex";

const VERSION = packageMetadata.version;
const PACKAGE_NAME = packageMetadata.name;
const expectedAddArgs = ["mcp", "add", "tracelens", "--", "npx", "-y", `${PACKAGE_NAME}@${VERSION}`, "mcp"];
const missing = { exitCode: 1, stdout: "", stderr: "MCP server 'tracelens' not found" };
const exact = {
  exitCode: 0,
  stdout: JSON.stringify({
    name: "tracelens",
    transport: { type: "stdio", command: "npx", args: ["-y", `${PACKAGE_NAME}@${VERSION}`, "mcp"] },
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
const expectedConnectionMessage = [
  "TraceLens is connected to Codex.",
  "Start a new Codex task in the project you want to inspect.",
  `Ask Codex: "${FIRST_RUN_PROMPT}"`,
  "Evidence requested through TraceLens tools becomes part of the Codex conversation.",
  `First-run feedback (optional): ${FIRST_RUN_FEEDBACK_URL}`,
].join("\n");

function runner(...results: Array<{ exitCode: number; stdout: string; stderr: string }>): CommandRunner {
  return vi.fn(async () => results.shift() ?? { exitCode: 1, stdout: "", stderr: "unexpected command" });
}

function throwingRunner(error: Error): CommandRunner {
  return vi.fn(async () => { throw error; });
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
    expect(result.message).toBe(expectedConnectionMessage);
    expect(run).toHaveBeenNthCalledWith(1, "codex", ["mcp", "get", "tracelens", "--json"]);
    expect(run).toHaveBeenNthCalledWith(2, "codex", expectedAddArgs);
  });

  it("adds when Codex reports the official missing-registration error", async () => {
    const run = runner(
      { exitCode: 1, stdout: "", stderr: "Error: No MCP server named 'tracelens' found." },
      { exitCode: 0, stdout: "", stderr: "" },
    );

    await expect(setupCodex({ force: false, packageVersion: VERSION, run })).resolves.toMatchObject({
      ok: true,
      changed: true,
    });
    expect(run).toHaveBeenNthCalledWith(1, "codex", ["mcp", "get", "tracelens", "--json"]);
    expect(run).toHaveBeenNthCalledWith(2, "codex", expectedAddArgs);
  });

  it("leaves an exact stdio registration unchanged", async () => {
    const run = runner(exact);

    await expect(setupCodex({ force: false, packageVersion: VERSION, run })).resolves.toMatchObject({
      ok: true,
      changed: false,
      message: expectedConnectionMessage,
    });
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
      message: expect.stringContaining(`codex mcp add tracelens -- npx -y ${PACKAGE_NAME}@${VERSION} mcp`),
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    "config file not found: C:\\private\\codex\\config.toml",
    "codex: command not found",
    "Resource not found",
    "MCP server 'tracelens' not found at C:\\private\\codex\\config.toml",
    "error: unexpected argument '--json'",
    "error: unrecognized subcommand 'mcp'",
  ])("does not add when the failure is unrelated to a missing TraceLens registration: %s", async (stderr) => {
    const run = runner({ exitCode: 1, stdout: "", stderr });

    const result = await setupCodex({ force: false, packageVersion: VERSION, run });

    expect(result).toMatchObject({ ok: false, changed: false });
    expect(result.message).toContain(expectedAddArgs.slice(4).join(" "));
    expect(result.message).not.toContain("C:\\private");
    expect(run).toHaveBeenCalledOnce();
  });

  it("requires exit code 1 for a missing registration", async () => {
    const run = runner({ exitCode: 2, stdout: "", stderr: "MCP server 'tracelens' not found" });

    await expect(setupCodex({ force: false, packageVersion: VERSION, run })).resolves.toMatchObject({
      ok: false,
      changed: false,
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("returns a safe unavailable result when the runner throws during inspection", async () => {
    const run = throwingRunner(new Error("private failure at C:\\private\\config.toml"));

    await expect(setupCodex({ force: false, packageVersion: VERSION, run })).resolves.toEqual({
      ok: false,
      changed: false,
      message: `Codex could not be reached. Register TraceLens manually: codex ${expectedAddArgs.join(" ")}`,
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

  it.each([
    {},
    { name: "tracelens" },
    { name: "tracelens", transport: {} },
    { name: "tracelens", transport: { type: "stdio" } },
    { name: "tracelens", transport: { type: "stdio", command: "npx" } },
    { transport: { type: "stdio", command: "npx", args: ["-y", `${PACKAGE_NAME}@${VERSION}`, "mcp"] } },
  ])("returns a safe error for registration JSON with missing fields", async (registration) => {
    const run = runner({ exitCode: 0, stdout: JSON.stringify(registration), stderr: "" });

    await expect(setupCodex({ force: false, packageVersion: VERSION, run })).resolves.toEqual({
      ok: false,
      changed: false,
      message: "Unable to inspect the TraceLens Codex connection.",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("treats a valid non-stdio registration as a conflict", async () => {
    const run = runner({
      exitCode: 0,
      stdout: JSON.stringify({
        name: "tracelens",
        transport: { type: "streamable_http", url: "https://example.invalid/mcp" },
      }),
      stderr: "",
    });

    await expect(setupCodex({ force: false, packageVersion: VERSION, run })).resolves.toEqual({
      ok: false,
      changed: false,
      message: "TraceLens already has a different Codex connection. Use \"tracelens setup codex --force\" to replace it.",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not add when forced removal fails", async () => {
    const run = runner(conflict, { exitCode: 1, stdout: "", stderr: "private removal failure" });

    await expect(setupCodex({ force: true, packageVersion: VERSION, run })).resolves.toEqual({
      ok: false,
      changed: false,
      message: "Unable to update the TraceLens Codex connection.",
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(2, "codex", ["mcp", "remove", "tracelens"]);
  });

  it("reports a changed configuration when removal succeeds but replacement exits nonzero", async () => {
    const run = runner(
      conflict,
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "private add failure at C:\\private\\config.toml" },
    );

    await expect(setupCodex({ force: true, packageVersion: VERSION, run })).resolves.toEqual({
      ok: false,
      changed: true,
      message: `TraceLens Codex connection replacement failed. Register TraceLens manually: codex ${expectedAddArgs.join(" ")}`,
    });
    expect(run).toHaveBeenNthCalledWith(2, "codex", ["mcp", "remove", "tracelens"]);
    expect(run).toHaveBeenNthCalledWith(3, "codex", expectedAddArgs);
  });

  it("reports a changed configuration when removal succeeds but replacement throws", async () => {
    const run = vi.fn<CommandRunner>()
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockRejectedValueOnce(new Error("private add failure at C:\\private\\config.toml"));

    await expect(setupCodex({ force: true, packageVersion: VERSION, run })).resolves.toEqual({
      ok: false,
      changed: true,
      message: `TraceLens Codex connection replacement failed. Register TraceLens manually: codex ${expectedAddArgs.join(" ")}`,
    });
    expect(run).toHaveBeenNthCalledWith(2, "codex", ["mcp", "remove", "tracelens"]);
    expect(run).toHaveBeenNthCalledWith(3, "codex", expectedAddArgs);
  });
});

describe("runCli setup codex", () => {
  it("uses the injected runner, prints the success message, and skips repository creation", async () => {
    const run = runner(missing, { exitCode: 0, stdout: "", stderr: "" });
    const cli = cliDependencies(run);
    cli.deps.createRepository = vi.fn();

    await expect(runCli(["setup", "codex"], cli.deps)).resolves.toBe(0);

    expect(run).toHaveBeenNthCalledWith(2, "codex", expectedAddArgs);
    expect(cli.stdout.write).toHaveBeenCalledWith(`${expectedConnectionMessage}\n`);
    expect(cli.stderr.write).not.toHaveBeenCalled();
    expect(cli.deps.createRepository).not.toHaveBeenCalled();
  });

  it("derives the registered package version from package metadata", async () => {
    vi.resetModules();
    vi.doMock("../package.json", () => ({ default: { name: "@example/tracelens", version: "9.8.7" } }));
    try {
      const { runCli: runCliWithMockedMetadata } = await import("./index");
      const run = runner(missing, { exitCode: 0, stdout: "", stderr: "" });
      const cli = cliDependencies(run);

      await expect(runCliWithMockedMetadata(["setup", "codex"], cli.deps)).resolves.toBe(0);
      expect(run).toHaveBeenNthCalledWith(2, "codex", [
        "mcp", "add", "tracelens", "--", "npx", "-y", "@example/tracelens@9.8.7", "mcp",
      ]);
    } finally {
      vi.doUnmock("../package.json");
      vi.resetModules();
    }
  });
});
