import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import {
  OwnedProcessRegistry,
  removeVerifiedSystemTempRoot,
  runCommand,
  withHardTimeout,
} from "./process-control.mjs";
import { OwnedStdioClientTransport } from "./owned-stdio-transport.mjs";
import { installedShimInvocation, resolveInstalledBinShim } from "./package-shim.mjs";
import { runProcessControlSelfTest } from "./process-control-self-test.mjs";
import { runPackageSmokeSelfTest } from "./package-smoke-self-test.mjs";

const REQUIRED_PACKAGE_FILES = ["dist/index.html", "dist-cli/index.js", "README.md", "LICENSE"];
const REQUIRED_TOOLS = [
  "list_sessions",
  "get_session_overview",
  "get_session_timeline",
  "search_session",
  "get_event_detail",
  "get_viewer_link",
];
const EVIDENCE_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const VIEWER_LINK_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
const TEMP_PREFIX = "tracelens-package-smoke-";
const ownedProcesses = new OwnedProcessRegistry();

assert(npmCli, "npm_execpath is required; run this check through npm run pack:check.");

function run(command, args, options = {}) {
  return runCommand(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs,
    registry: ownedProcesses,
  });
}

function runNpm(args, options = {}) {
  return run(process.execPath, [npmCli, ...args], options);
}

function parsePackOutput(stdout) {
  const output = JSON.parse(stdout);
  assert(Array.isArray(output) && output.length === 1, "npm pack must describe exactly one package.");
  return output[0];
}

function stringValues(value, values = []) {
  if (typeof value === "string") values.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringValues(item, values));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringValues(item, values));
  return values;
}

function comparable(value) {
  return value.replaceAll("\\", "/").toLowerCase();
}

function assertNoTemporaryPath(value, temporaryPaths) {
  for (const text of stringValues(value)) {
    const normalizedText = comparable(text);
    for (const temporaryPath of temporaryPaths) {
      assert(!normalizedText.includes(comparable(temporaryPath)), `MCP result leaked temporary path: ${text}`);
    }
  }
}

function assertCompleteToolResult(toolResult, temporaryPaths) {
  assert.equal(toolResult.isError, undefined, "list_sessions unexpectedly returned an MCP error result.");
  assert(Array.isArray(toolResult.content), "list_sessions must return content blocks.");
  assert.equal(toolResult.content.length, 1, "list_sessions must return exactly one text block.");
  const [textBlock] = toolResult.content;
  assert.equal(textBlock.type, "text", "list_sessions content must be a text block.");
  assert.equal(typeof textBlock.text, "string", "list_sessions text content must be a string.");
  const parsedText = JSON.parse(textBlock.text);
  assert.equal(textBlock.text, JSON.stringify(parsedText), "list_sessions text must be compact JSON.");
  assert(toolResult.structuredContent && typeof toolResult.structuredContent === "object", "list_sessions must return structuredContent.");
  assert.deepEqual(parsedText, toolResult.structuredContent, "Text and structured MCP results must be semantically identical.");
  assertNoTemporaryPath(toolResult, temporaryPaths);
  return toolResult.structuredContent;
}

function assertInstalledToolAnnotations(tools) {
  for (const tool of tools) {
    const expected = tool.name === "get_viewer_link" ? VIEWER_LINK_ANNOTATIONS : EVIDENCE_TOOL_ANNOTATIONS;
    assert.deepEqual(tool.annotations, expected, `Installed ${tool.name} annotations do not match the declared tool effects.`);
  }
}

function sampleSession(projectDirectory) {
  return [
    { timestamp: "2026-07-31T10:00:00.000Z", type: "session_meta", payload: { id: "package-smoke", cwd: projectDirectory } },
    { timestamp: "2026-07-31T10:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Inspect the package smoke session." }] } },
    { timestamp: "2026-07-31T10:00:02.000Z", type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: '{"command":"npm test"}', call_id: "call-smoke" } },
    { timestamp: "2026-07-31T10:00:03.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "call-smoke", output: "Exit code: 0\nTests passed." } },
  ].map((record) => JSON.stringify(record)).join("\n");
}

async function main() {
  let temporaryRoot;
  let client;
  let transport;
  let mcpOwnedProcess;
  let mcpStderr = "";
  let mcpStderrDone;
  let primaryError;
  const cleanupErrors = [];

  try {
    const dryRun = parsePackOutput((await runNpm(["pack", "--dry-run", "--json"])).stdout);
    const packagedFiles = new Set(dryRun.files.map((file) => file.path.replaceAll("\\", "/")));
    for (const requiredFile of REQUIRED_PACKAGE_FILES) {
      assert(packagedFiles.has(requiredFile), `Packed package is missing ${requiredFile}.`);
    }
    console.log("Verified npm pack contents.");

    temporaryRoot = await mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
    const installDirectory = path.join(temporaryRoot, "install");
    const homeDirectory = path.join(temporaryRoot, "home");
    const codexHome = path.join(temporaryRoot, "codex-home");
    const projectDirectory = path.join(temporaryRoot, "current-project");
    const sessionsDirectory = path.join(homeDirectory, ".codex", "sessions", "2026", "07", "31");
    await Promise.all([
      mkdir(installDirectory, { recursive: true }),
      mkdir(codexHome, { recursive: true }),
      mkdir(projectDirectory, { recursive: true }),
      mkdir(sessionsDirectory, { recursive: true }),
    ]);
    await writeFile(path.join(installDirectory, "package.json"), '{"private":true}\n', "utf8");
    await writeFile(path.join(sessionsDirectory, "rollout-package-smoke.jsonl"), sampleSession(projectDirectory), "utf8");

    const packed = parsePackOutput((await runNpm(["pack", "--json", "--pack-destination", temporaryRoot])).stdout);
    const tarballPath = path.join(temporaryRoot, packed.filename);
    await runNpm([
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarballPath,
    ], { cwd: installDirectory });
    console.log("Installed the generated tarball with lifecycle scripts disabled.");

    const shim = await resolveInstalledBinShim(installDirectory);
    const helpInvocation = installedShimInvocation(shim, "--help");
    const help = await run(helpInvocation.command, helpInvocation.args, {
      cwd: projectDirectory,
      env: helpInvocation.env,
    });
    for (const command of ["open", "list", "mcp", "setup codex"]) {
      assert(help.stdout.includes(command), `Installed CLI help is missing ${command}.`);
    }
    console.log("Verified the installed npm bin shim and CLI help.");

    const environmentOverrides = Object.fromEntries(
      Object.entries({
        HOME: homeDirectory,
        USERPROFILE: homeDirectory,
        CODEX_HOME: codexHome,
      }).filter((entry) => typeof entry[1] === "string"),
    );
    const mcpInvocation = installedShimInvocation(shim, "mcp", environmentOverrides);
    transport = new OwnedStdioClientTransport({
      ...mcpInvocation,
      cwd: projectDirectory,
      stderr: "pipe",
    }, ownedProcesses, { label: "installed MCP child" });
    const stderrStream = transport.stderr;
    assert(stderrStream, "MCP stderr must be piped for shutdown verification.");
    stderrStream.on("data", (chunk) => { mcpStderr += chunk.toString(); });
    mcpStderrDone = new Promise((resolve, reject) => {
      stderrStream.once("end", resolve);
      stderrStream.once("close", resolve);
      stderrStream.once("error", reject);
    });
    client = new Client({ name: "tracelens-package-smoke", version: "1.0.0" });
    await withHardTimeout(client.connect(transport), 10_000, "MCP client connect");
    mcpOwnedProcess = transport.ownedProcess;
    assert(mcpOwnedProcess, "MCP transport must retain the exact installed child process handle.");

    const listedTools = await withHardTimeout(client.listTools(), 5_000, "MCP listTools");
    assert.deepEqual(listedTools.tools.map((tool) => tool.name).sort(), [...REQUIRED_TOOLS].sort());
    assertInstalledToolAnnotations(listedTools.tools);

    const listedSessions = await withHardTimeout(
      client.callTool({
        name: "list_sessions",
        arguments: { scope: "current_project", limit: 5 },
      }),
      5_000,
      "MCP list_sessions",
    );
    const result = assertCompleteToolResult(listedSessions, [temporaryRoot, homeDirectory, codexHome, projectDirectory]);
    assert(result && result.dataClassification === "untrusted-local-log", "list_sessions must classify returned evidence.");
    assert(Array.isArray(result.data) && result.data.length === 1, "Current-project discovery must find the injected sample.");
    assert.equal(result.data[0].match, "exact", "The injected sample must match the temporary project exactly.");
  } catch (error) {
    primaryError = error;
  } finally {
    if (client) {
      try {
        await withHardTimeout(client.close(), 5_000, "MCP client close");
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (transport) {
      try {
        await withHardTimeout(transport.close(), 3_000, "MCP transport close");
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    mcpOwnedProcess ??= transport?.ownedProcess;
    try {
      await ownedProcesses.cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (mcpOwnedProcess?.isRunning) {
      cleanupErrors.push(new Error(`Installed MCP child ${mcpOwnedProcess.pid ?? "without a PID"} survived shutdown cleanup.`));
    }
    if (mcpStderrDone) {
      try {
        await withHardTimeout(mcpStderrDone, 2_000, "MCP stderr close");
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (mcpStderr !== "") cleanupErrors.push(new Error(`MCP server wrote unexpected stderr during startup or shutdown: ${mcpStderr}`));
    if (temporaryRoot) {
      try {
        await removeVerifiedSystemTempRoot(temporaryRoot, TEMP_PREFIX);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  if (primaryError || cleanupErrors.length > 0) {
    throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], "Package smoke test failed.");
  }
  console.log("Verified the installed package through a real MCP stdio handshake and bounded shutdown.");
}

await runProcessControlSelfTest();
console.log("Verified bounded process-tree timeout escalation and cleanup.");
await runPackageSmokeSelfTest();
console.log("Verified local-shim isolation, ownership semantics, and connect-failure cleanup.");
await main();
console.log("Package smoke test passed and temporary resources were removed.");
