import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
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
const exitedLeaderFixture = fileURLToPath(new URL("./posix-exited-leader-fixture.mjs", import.meta.url));

async function assertPortReleased(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

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

    if (process.platform === "win32") {
      console.log("Skipped exited-leader process-group regression: Windows has no detached POSIX process groups.");
    } else {
      const exitedLeaderRegistry = new OwnedProcessRegistry();
      registries.push(exitedLeaderRegistry);
      const exitedLeaderMarker = path.join(temporaryRoot, "exited-leader.json");
      const descendantReady = path.join(temporaryRoot, "exited-leader-descendant.ready");
      let exitedLeaderError;
      const exitedLeaderStartedAt = Date.now();
      try {
        await runCommand(process.execPath, [exitedLeaderFixture, "leader", exitedLeaderMarker, descendantReady], {
          cwd: temporaryRoot,
          registry: exitedLeaderRegistry,
          timeoutMs: 800,
          graceMs: 250,
          forceWaitMs: 1_500,
        });
      } catch (error) {
        exitedLeaderError = error;
      }
      const exitedLeaderElapsedMs = Date.now() - exitedLeaderStartedAt;
      assert(exitedLeaderError instanceof CommandTimeoutError, "Inherited descendant stdio must keep the command pending until bounded cleanup.");
      assert.equal(exitedLeaderError.ownedProcess.exited, true, "The detached group leader must exit before timeout cleanup starts.");
      assert.equal(exitedLeaderError.ownedProcess.child.exitCode, 0, "The detached group leader must exit normally before cleanup signals its group.");
      assert.equal(exitedLeaderError.forced, true, "The stubborn exited-leader group must require forced cleanup.");
      assert(exitedLeaderElapsedMs < 6_000, `Exited-leader cleanup exceeded its hard test bound: ${exitedLeaderElapsedMs}ms.`);
      const exitedLeaderIds = JSON.parse(await readFile(exitedLeaderMarker, "utf8"));
      const descendantState = JSON.parse(await readFile(descendantReady, "utf8"));
      assert.deepEqual(descendantState, { descendant: exitedLeaderIds.descendant, port: exitedLeaderIds.port }, "The inherited-stdio descendant must start and hold the TCP resource.");
      assert.equal(isProcessAlive(exitedLeaderIds.leader), false, "The detached command leader must exit before cleanup.");
      assert.equal(isProcessAlive(exitedLeaderIds.descendant), false, "Cleanup left the exited leader's process-group descendant alive.");
      await assertPortReleased(exitedLeaderIds.port);
      assert.equal(exitedLeaderRegistry.snapshot().length, 0, "Exited-leader group ownership must be released only after close.");
    }

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
    staleRegistry.register(staleChild, { group: true, label: "stale PID fixture", terminateTree: true });
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
