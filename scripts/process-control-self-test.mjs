import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CommandTimeoutError,
  isProcessAlive,
  removeVerifiedSystemTempRoot,
  runCommand,
  terminateProcessTree,
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

  try {
    const startedAt = Date.now();
    let timeoutError;
    try {
      await runCommand(process.execPath, ["-e", parentSource, markerPath], {
        cwd: temporaryRoot,
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
  } finally {
    if (processIds?.parent && isProcessAlive(processIds.parent)) {
      await terminateProcessTree(processIds.parent, { group: process.platform !== "win32" }).catch(() => undefined);
    }
    if (processIds?.grandchild && isProcessAlive(processIds.grandchild)) {
      await terminateProcessTree(processIds.grandchild, { group: false }).catch(() => undefined);
    }
    await removeVerifiedSystemTempRoot(temporaryRoot, TEMP_PREFIX);
  }
  await assert.rejects(access(temporaryRoot), { code: "ENOENT" }, "The self-test marker root must be removed in finally.");
}
