import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { OwnedProcessRegistry, removeVerifiedSystemTempRoot, runCommand, withHardTimeout } from "./process-control.mjs";
import { resolveInstalledBinShim } from "./package-shim.mjs";
import { OwnedStdioClientTransport } from "./owned-stdio-transport.mjs";

const TEMP_PREFIX = "tracelens-package-smoke-self-test-";

async function writeFixtureInstallation(temporaryRoot) {
  const installDirectory = path.join(temporaryRoot, process.platform === "win32" ? "install-%PATH%" : "install");
  const binDirectory = path.join(installDirectory, "node_modules", ".bin");
  const packageDirectory = path.join(installDirectory, "node_modules", "tracelens");
  const entry = path.join(packageDirectory, "dist-cli", "index.js");
  await Promise.all([
    mkdir(binDirectory, { recursive: true }),
    mkdir(path.dirname(entry), { recursive: true }),
  ]);
  await writeFile(entry, "#!/usr/bin/env node\nconsole.log('fixture help');\n", "utf8");
  await chmod(entry, 0o755);

  if (process.platform === "win32") {
    const shim = path.join(binDirectory, "tracelens.ps1");
    await writeFile(shim, [
      "#!/usr/bin/env pwsh",
      "$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent",
      "& \"node.exe\" \"$basedir/../tracelens/dist-cli/index.js\" $args",
      "exit $LASTEXITCODE",
      "",
    ].join("\n"), "utf8");
  } else {
    await symlink("../tracelens/dist-cli/index.js", path.join(binDirectory, "tracelens"));
  }
  return { installDirectory, entry };
}

async function assertLocalShimOnly(temporaryRoot) {
  const { installDirectory } = await writeFixtureInstallation(temporaryRoot);
  const binDirectory = path.join(installDirectory, "node_modules", ".bin");
  const shimName = process.platform === "win32" ? "tracelens.ps1" : "tracelens";
  const shimPath = path.join(binDirectory, shimName);

  const missingDirectory = path.join(temporaryRoot, "missing");
  await mkdir(path.join(missingDirectory, "node_modules", "tracelens", "dist-cli"), { recursive: true });
  await writeFile(path.join(missingDirectory, "node_modules", "tracelens", "dist-cli", "index.js"), "", "utf8");
  await assert.rejects(
    resolveInstalledBinShim(missingDirectory),
    /local npm bin shim/i,
    "A missing local shim must fail before any registry fallback is possible.",
  );

  if (process.platform === "win32") {
    await writeFile(shimPath, [
      "# $basedir/../tracelens/dist-cli/index.js",
      "& \"node.exe\" \"$basedir/../other/cli.js\" $args",
      "",
    ].join("\n"), "utf8");
  } else {
    await writeFile(path.join(temporaryRoot, "wrong-entry.js"), "", "utf8");
    await symlink(path.join(temporaryRoot, "wrong-entry.js"), `${shimPath}.broken`);
    await (await import("node:fs/promises")).rename(`${shimPath}.broken`, shimPath);
  }
  await assert.rejects(
    resolveInstalledBinShim(installDirectory),
    /installed tracelens entry/i,
    "A local shim that targets another entry must fail.",
  );

  await (await import("node:fs/promises")).rm(installDirectory, { recursive: true, force: true });
  const fixture = await writeFixtureInstallation(temporaryRoot);
  const invocation = await resolveInstalledBinShim(fixture.installDirectory);
  assert.equal(invocation.environment.npm_config_offline, "true", "Installed shim execution must explicitly disable registry access.");
  if (process.platform === "win32") {
    assert.equal(invocation.args.at(-1), invocation.shimPath, "PowerShell must receive the exact local shim path as a literal argument.");
  } else {
    assert.equal(invocation.command, invocation.shimPath, "POSIX must execute the exact local shim path.");
  }
  assert(!invocation.args.includes("exec"), "Installed shim execution must not delegate to npm exec.");
  const registry = new OwnedProcessRegistry();
  try {
    const result = await runCommand(invocation.command, [...invocation.args, "--help"], {
      cwd: temporaryRoot,
      env: invocation.environment,
      registry,
      timeoutMs: 3_000,
    });
    assert.match(result.stdout, /fixture help/, "The exact local shim must execute the installed entry.");
  } finally {
    await registry.cleanup();
  }
}

async function assertConnectFailureCleanup(temporaryRoot) {
  const registry = new OwnedProcessRegistry();
  const markerPath = path.join(temporaryRoot, "mcp-connect-failure.pid");
  const source = [
    "const fs=require('node:fs');",
    "fs.writeFileSync(process.argv[1],String(process.pid));",
    "let input='';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data',chunk=>{",
    " input+=chunk; const newline=input.indexOf('\\n'); if(newline<0)return;",
    " const request=JSON.parse(input.slice(0,newline));",
    " process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32000,message:'reject initialize'}})+'\\n');",
    "});",
    "setInterval(()=>{},1000);",
  ].join("");
  const transport = new OwnedStdioClientTransport({
    command: process.execPath,
    args: ["-e", source, markerPath],
    cwd: temporaryRoot,
    stderr: "pipe",
  }, registry, { label: "connect-failure fixture" });
  const client = new Client({ name: "package-smoke-self-test", version: "1.0.0" });
  let owned;
  try {
    const connection = client.connect(transport);
    connection.catch(() => undefined);
    owned = transport.ownedProcess;
    assert(owned, "The transport must retain the exact child handle as soon as start spawns it.");
    await assert.rejects(
      withHardTimeout(connection, 2_000, "connect-failure fixture"),
      /reject initialize/,
      "The fixture must reject MCP initialization after its child starts.",
    );
    assert.equal(owned.isRunning, true, "The rejected MCP child must still be alive before cleanup.");
  } finally {
    const cleanupErrors = [];
    try {
      await registry.cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await withHardTimeout(transport.close(), 1_000, "connect-failure transport close");
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Connect-failure fixture cleanup failed.");
  }
  assert.equal(owned?.isRunning, false, "Registry cleanup must stop the child retained during connect failure.");
}

export async function runPackageSmokeSelfTest() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
  try {
    await assertLocalShimOnly(temporaryRoot);
    await assertConnectFailureCleanup(temporaryRoot);
  } finally {
    await removeVerifiedSystemTempRoot(temporaryRoot, TEMP_PREFIX);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPackageSmokeSelfTest();
  console.log("Package-smoke self-test passed.");
}
