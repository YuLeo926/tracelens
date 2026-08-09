import { spawn } from "node:child_process";
import { access, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export class CommandTimeoutError extends Error {
  constructor(command, ownedProcess, forced, cause) {
    super(`Timed out running ${command}; owned process ${ownedProcess?.pid ?? "without a PID"} was ${forced ? "forcefully terminated" : "not confirmed terminated"}.`, { cause });
    this.name = "CommandTimeoutError";
    this.pid = ownedProcess?.pid;
    this.ownedProcess = ownedProcess;
    this.forced = forced;
  }
}

export function isProcessAlive(pid, { group = false } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const target = group && process.platform !== "win32" ? -pid : pid;
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export async function withHardTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not finish within ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function settlesWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class OwnedProcess {
  constructor(registry, child, { group = false, label = "child process", terminateTree = true } = {}) {
    this.registry = registry;
    this.child = child;
    this.group = group;
    this.label = label;
    this.terminateTree = terminateTree;
    this.closed = false;
    this.exited = child.exitCode !== null || child.signalCode !== null;
    this.posixGroupOwned = process.platform !== "win32" && group && terminateTree && !this.exited;
    this.exitPromise = this.exited
      ? Promise.resolve()
      : new Promise((resolve) => child.once("exit", () => {
          this.exited = true;
          resolve();
        }));
    this.closePromise = new Promise((resolve) => child.once("close", () => {
      this.closed = true;
      this.posixGroupOwned = false;
      registry.release(this);
      resolve();
    }));
  }

  get pid() {
    return this.child.pid;
  }

  get isRunning() {
    return !this.exited && !this.closed && this.child.exitCode === null && this.child.signalCode === null;
  }

  get needsTermination() {
    return this.isRunning || this.posixGroupOwned;
  }

  releasePosixGroup() {
    this.posixGroupOwned = false;
  }

  async waitForExit(timeoutMs) {
    if (!this.isRunning) return true;
    return settlesWithin(this.exitPromise, timeoutMs);
  }

  async waitForClose(timeoutMs) {
    if (this.closed) return true;
    return settlesWithin(this.closePromise, timeoutMs);
  }

  async waitForTermination(timeoutMs) {
    if (this.posixGroupOwned) return this.waitForClose(timeoutMs);
    return this.waitForExit(timeoutMs);
  }

  destroyStreams() {
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      if (stream && !stream.destroyed) stream.destroy();
    }
  }
}

export class OwnedProcessRegistry {
  constructor({ terminate = terminateOwnedProcess } = {}) {
    this.processes = new Set();
    this.defaultTerminate = terminate;
  }

  register(child, options = {}) {
    const existing = [...this.processes].find((owned) => owned.child === child);
    if (existing) return existing;
    const owned = new OwnedProcess(this, child, options);
    this.processes.add(owned);
    return owned;
  }

  release(owned) {
    this.processes.delete(owned);
  }

  snapshot() {
    return [...this.processes];
  }

  async cleanup({
    graceMs = 350,
    forceWaitMs = 1_500,
    utilityTimeoutMs = 1_500,
    closeWaitMs = 1_000,
  } = {}) {
    const errors = [];
    const handled = new Set();
    while (true) {
      const owned = this.snapshot().find((candidate) => !handled.has(candidate));
      if (!owned) break;
      handled.add(owned);
      let terminationError;
      for (let attempt = 0; owned.needsTermination && attempt < 2; attempt += 1) {
        try {
          await withHardTimeout(
            this.defaultTerminate(owned, {
              graceMs: attempt === 0 ? graceMs : 0,
              forceWaitMs,
              utilityTimeoutMs,
              forceImmediately: attempt > 0,
            }),
            graceMs + forceWaitMs + (utilityTimeoutMs * 2) + 500,
            `${owned.label} termination`,
          );
          terminationError = undefined;
        } catch (error) {
          terminationError = error;
        }
      }
      if (owned.needsTermination) {
        errors.push(new Error(`${owned.label} ${owned.pid ?? "without a PID"} survived final cleanup.`, { cause: terminationError }));
        continue;
      }
      owned.destroyStreams();
      const closed = await owned.waitForClose(closeWaitMs);
      if (!closed) {
        errors.push(new Error(`${owned.label} ${owned.pid ?? "without a PID"} exited but did not close within ${closeWaitMs}ms.`, { cause: terminationError }));
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Owned process cleanup failed.");
  }
}

async function runTerminationUtility(parentOwned, command, args, timeoutMs) {
  const child = spawn(command, args, {
    shell: false,
    windowsHide: true,
    stdio: "ignore",
  });
  const owned = parentOwned.registry.register(child, {
    group: false,
    label: `${path.basename(command)} termination utility`,
    terminateTree: false,
  });
  const completed = await owned.waitForClose(timeoutMs);
  if (!completed && owned.isRunning) {
    try { child.kill("SIGKILL"); } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  if (!await owned.waitForClose(500)) {
    throw new Error(`${path.basename(command)} did not close within its hard bound.`);
  }
}

function signalOwnedPosixProcess(owned, signal) {
  if (!owned.needsTermination) return;
  const pid = owned.pid;
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${owned.label} has no valid PID while its owned handle is running.`);
  try {
    if (owned.posixGroupOwned) process.kill(-pid, signal);
    else owned.child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    if (owned.posixGroupOwned) owned.releasePosixGroup();
  }
}

async function signalOwnedWindowsProcess(owned, force, utilityTimeoutMs) {
  if (!owned.isRunning) return;
  if (!owned.terminateTree) {
    try { owned.child.kill(force ? "SIGKILL" : "SIGTERM"); } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
    return;
  }
  const pid = owned.pid;
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${owned.label} has no valid PID while its owned handle is running.`);
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
  const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
  await runTerminationUtility(owned, taskkill, args, utilityTimeoutMs);
}

export async function terminateOwnedProcess(owned, {
  graceMs = 350,
  forceWaitMs = 1_500,
  utilityTimeoutMs = 1_500,
  forceImmediately = false,
} = {}) {
  if (!owned.needsTermination) return { forced: false };

  if (!forceImmediately) {
    if (process.platform === "win32") await signalOwnedWindowsProcess(owned, false, utilityTimeoutMs);
    else signalOwnedPosixProcess(owned, "SIGTERM");
    if (await owned.waitForTermination(graceMs)) return { forced: false };
  }

  if (owned.needsTermination) {
    if (process.platform === "win32") await signalOwnedWindowsProcess(owned, true, utilityTimeoutMs);
    else signalOwnedPosixProcess(owned, "SIGKILL");
  }
  if (!await owned.waitForTermination(forceWaitMs)) {
    throw new Error(`${owned.label} ${owned.pid ?? "without a PID"} survived forced termination.`);
  }
  return { forced: true };
}

export async function runCommand(command, args, {
  cwd,
  env,
  timeoutMs = 120_000,
  graceMs = 350,
  forceWaitMs = 1_500,
  utilityTimeoutMs = 1_500,
  registry: suppliedRegistry,
  terminate = terminateOwnedProcess,
} = {}) {
  const registry = suppliedRegistry ?? new OwnedProcessRegistry();
  const group = process.platform !== "win32";
  const child = spawn(command, args, {
    cwd,
    env,
    shell: false,
    detached: group,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const owned = registry.register(child, { group, label: command, terminateTree: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const completion = new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => finish({ error }));
    child.once("close", (code, signal) => finish({ code, signal }));
  });
  let timeoutTimer;
  const outcome = await Promise.race([
    completion,
    new Promise((resolve) => {
      timeoutTimer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    }),
  ]);
  clearTimeout(timeoutTimer);

  if (outcome.timedOut) {
    let termination;
    let terminationError;
    try {
      termination = await withHardTimeout(
        terminate(owned, { graceMs, forceWaitMs, utilityTimeoutMs }),
        graceMs + forceWaitMs + (utilityTimeoutMs * 2) + 500,
        `${command} timeout termination`,
      );
    } catch (error) {
      terminationError = error;
    }
    if (!owned.needsTermination) {
      owned.destroyStreams();
      await owned.waitForClose(250);
    }
    if (!suppliedRegistry && owned.needsTermination) {
      try { await registry.cleanup({ graceMs, forceWaitMs, utilityTimeoutMs }); } catch (error) {
        terminationError = new AggregateError([...(terminationError ? [terminationError] : []), error], `${command} local cleanup failed.`);
      }
    }
    throw new CommandTimeoutError(command, owned, termination?.forced ?? false, terminationError);
  }

  if (outcome.error) {
    if (!suppliedRegistry) await registry.cleanup().catch(() => undefined);
    throw outcome.error;
  }
  if (outcome.code !== 0) {
    throw new Error(`${command} exited with ${outcome.code ?? outcome.signal}.\n${stderr}`);
  }
  return { stdout, stderr, pid: owned.pid };
}

export async function removeVerifiedSystemTempRoot(temporaryRoot, requiredPrefix) {
  try {
    await access(temporaryRoot);
  } catch {
    return;
  }
  const [systemTemp, resolvedRoot] = await Promise.all([realpath(tmpdir()), realpath(temporaryRoot)]);
  const relative = path.relative(systemTemp, resolvedRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(resolvedRoot).startsWith(requiredPrefix)) {
    throw new Error(`Refusing to remove unverified temporary root: ${resolvedRoot}`);
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}
