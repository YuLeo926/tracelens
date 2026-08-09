import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const REQUIRED_PACKAGE_FILES = ["dist/index.html", "dist-cli/index.js", "README.md", "LICENSE"];
const REQUIRED_TOOLS = [
  "list_sessions",
  "get_session_overview",
  "get_session_timeline",
  "search_session",
  "get_event_detail",
  "get_viewer_link",
];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;

assert(npmCli, "npm_execpath is required; run this check through npm run pack:check.");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutError;
    const timer = setTimeout(() => {
      timeoutError = new Error(`Timed out running ${command}.`);
      child.kill();
    }, options.timeoutMs ?? 120_000);

    function finish(error, code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else if (code !== 0) {
        reject(new Error(`${command} exited with ${code}.\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    }

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(timeoutError, code));
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

  try {
    const dryRun = parsePackOutput((await runNpm(["pack", "--dry-run", "--json"])).stdout);
    const packagedFiles = new Set(dryRun.files.map((file) => file.path.replaceAll("\\", "/")));
    for (const requiredFile of REQUIRED_PACKAGE_FILES) {
      assert(packagedFiles.has(requiredFile), `Packed package is missing ${requiredFile}.`);
    }
    console.log("Verified npm pack contents.");

    temporaryRoot = await mkdtemp(path.join(tmpdir(), "tracelens-package-smoke-"));
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

    const binDirectory = path.join(installDirectory, "node_modules", ".bin");
    const binShim = path.join(binDirectory, process.platform === "win32" ? "tracelens.cmd" : "tracelens");
    const help = await run(binShim, ["--help"], { cwd: projectDirectory, shell: process.platform === "win32" });
    for (const command of ["open", "list", "mcp", "setup codex"]) {
      assert(help.stdout.includes(command), `Installed CLI help is missing ${command}.`);
    }
    console.log("Verified the installed npm bin shim and CLI help.");

    const environment = Object.fromEntries(
      Object.entries({
        ...process.env,
        HOME: homeDirectory,
        USERPROFILE: homeDirectory,
        CODEX_HOME: codexHome,
      }).filter((entry) => typeof entry[1] === "string"),
    );
    transport = new StdioClientTransport({
      command: binShim,
      args: ["mcp"],
      cwd: projectDirectory,
      env: environment,
      stderr: "pipe",
    });
    let mcpStderr = "";
    transport.stderr?.on("data", (chunk) => { mcpStderr += chunk.toString(); });
    client = new Client({ name: "tracelens-package-smoke", version: "1.0.0" });
    await client.connect(transport);

    const listedTools = await client.listTools();
    assert.deepEqual(listedTools.tools.map((tool) => tool.name).sort(), [...REQUIRED_TOOLS].sort());

    const listedSessions = await client.callTool({
      name: "list_sessions",
      arguments: { scope: "current_project", limit: 5 },
    });
    const result = listedSessions.structuredContent;
    assert(result && result.dataClassification === "untrusted-local-log", "list_sessions must classify returned evidence.");
    assert(Array.isArray(result.data) && result.data.length === 1, "Current-project discovery must find the injected sample.");
    assert.equal(result.data[0].match, "exact", "The injected sample must match the temporary project exactly.");
    assertNoTemporaryPath(result, [temporaryRoot, homeDirectory, codexHome, projectDirectory]);
    assert.equal(mcpStderr, "", `MCP server wrote unexpected stderr: ${mcpStderr}`);
    console.log("Verified the installed package through a real MCP stdio handshake.");
  } finally {
    if (client) await client.close().catch(() => undefined);
    if (transport) await transport.close().catch(() => undefined);
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
console.log("Package smoke test passed and temporary resources were removed.");
