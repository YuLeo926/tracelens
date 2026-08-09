import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CommandTimeoutError,
  isProcessAlive,
  OwnedProcessRegistry,
  removeVerifiedSystemTempRoot,
  runCommand,
  terminateOwnedProcess,
} from "./process-control.mjs";

const TEMP_PREFIX = "tracelens-process-control-test-";

export async function runProcessControlSelfTest() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
  const markerPath = path.join(temporaryRoot, "processes.json");
  const grandchildSource = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);";
  const parentSource = [
    "const fs=require('node:fs');",
    "const {spawn}=require('node:child_process');",
    `const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildSource)}],{stdio:'ignore'});`,
    "fs.writeFileSync(process.argv[1],JSON.stringify({parent:process.pid,grandchild:child.pid}));",
    "process.on('SIGTERM',()=>{});",
    "setInterval(()=>{},1000);",
  ].join("");
  let processIds;
  const registry = new OwnedProcessRegistry();
  const registries = [registry];
  const cleanupErrors = [];

  try {
    const startedAt = Date.now();
    let timeoutError;
    try {
      await runCommand(process.execPath, ["-e", parentSource, markerPath], {
        cwd: temporaryRoot,
        registry,
        timeoutMs: 600,
        graceMs: 250,
        forceWaitMs: 1_500,
        utilityTimeoutMs: 1_500,
      });
    } catch (error) {
      timeoutError = error;
    }
    const elapsedMs = Date.now() - startedAt;
    assert(timeoutError instanceof CommandTimeoutError, "The stubborn process tree must reject with CommandTimeoutError.");
    assert.equal(timeoutError.forced, true, "The child must outlive graceful termination and require escalation.");
    assert(elapsedMs < 7_000, `Timeout rejection exceeded the hard test bound: ${elapsedMs}ms.`);

    processIds = JSON.parse(await readFile(markerPath, "utf8"));
    assert.equal(isProcessAlive(processIds.parent), false, "Timed-out parent process survived termination.");
    assert.equal(isProcessAlive(processIds.grandchild), false, "Timed-out grandchild process survived tree termination.");

    const retryMarkerPath = path.join(temporaryRoot, "termination-retry.pid");
    let finalCleanupAttempts = 0;
    const retryRegistry = new OwnedProcessRegistry({
      terminate: async (...args) => {
        finalCleanupAttempts += 1;
        return terminateOwnedProcess(...args);
      },
    });
    registries.push(retryRegistry);
    let injectedAttempts = 0;
    let retryError;
    try {
      await runCommand(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)", retryMarkerPath], {
        cwd: temporaryRoot,
        registry: retryRegistry,
        timeoutMs: 200,
        terminate: async () => {
          injectedAttempts += 1;
          throw new Error("injected first termination failure");
        },
      });
    } catch (error) {
      retryError = error;
    }
    assert(retryError instanceof CommandTimeoutError, "The injected termination failure must reject with CommandTimeoutError.");
    assert.equal(injectedAttempts, 1, "The injected timeout termination must be attempted exactly once.");
    const [retryOwned] = retryRegistry.snapshot();
    assert(retryOwned?.isRunning, "A failed first termination must leave the exact child registered for outer cleanup.");
    assert.equal(retryError.ownedProcess, retryOwned, "The timeout error must preserve the exact owned child handle.");
    const retryPid = Number(await readFile(retryMarkerPath, "utf8"));
    await retryRegistry.cleanup();
    assert(finalCleanupAttempts > 0, "Outer cleanup must make a distinct final termination attempt.");
    assert.equal(retryOwned.isRunning, false, "Outer cleanup must retry and stop the registered child.");
    assert.equal(isProcessAlive(retryPid), false, "The injected-failure fixture survived final cleanup.");

    let stalePidTerminationCalls = 0;
    const staleRegistry = new OwnedProcessRegistry({
      terminate: async () => { stalePidTerminationCalls += 1; },
    });
    const staleChild = new (await import("node:events")).EventEmitter();
    staleChild.pid = process.pid;
    staleChild.exitCode = 0;
    staleChild.signalCode = null;
    staleChild.stdin = { destroy() {} };
    staleChild.stdout = { destroy() { queueMicrotask(() => staleChild.emit("close", 0, null)); } };
    staleChild.stderr = { destroy() {} };
    staleRegistry.register(staleChild, { label: "stale PID fixture" });
    await staleRegistry.cleanup();
    assert.equal(stalePidTerminationCalls, 0, "An exited owned handle must never authorize termination by a reused PID.");
  } finally {
    for (const ownedRegistry of registries) {
      try {
        await ownedRegistry.cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await removeVerifiedSystemTempRoot(temporaryRoot, TEMP_PREFIX);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Process-control self-test cleanup failed.");
  await assert.rejects(access(temporaryRoot), { code: "ENOENT" }, "The self-test marker root must be removed in finally.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runProcessControlSelfTest();
  console.log("Process-control self-test passed.");
}
