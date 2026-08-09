import { spawn } from "node:child_process";
import { access, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CommandTimeoutError extends Error {
  constructor(command, pid, forced, cause) {
    super(`Timed out running ${command}; process tree ${pid} was ${forced ? "forcefully terminated" : "terminated"}.`, { cause });
    this.name = "CommandTimeoutError";
    this.pid = pid;
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

export async function waitForProcessExit(pid, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid, options) && Date.now() < deadline) await delay(25);
  return !isProcessAlive(pid, options);
}

async function runTerminationUtility(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish({ timedOut: true });
    }, timeoutMs);
    child.once("error", (error) => finish({ error }));
    child.once("close", (code) => finish({ code }));
  });
}

function signalPosixTree(pid, signal, group) {
  const target = group ? -pid : pid;
  try {
    process.kill(target, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

export async function terminateProcessTree(pid, {
  group = process.platform !== "win32",
  graceMs = 350,
  forceWaitMs = 1_500,
  utilityTimeoutMs = 1_500,
} = {}) {
  if (!isProcessAlive(pid, { group })) return { forced: false };

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
    await runTerminationUtility(taskkill, ["/PID", String(pid), "/T"], utilityTimeoutMs);
  } else {
    signalPosixTree(pid, "SIGTERM", group);
  }

  if (await waitForProcessExit(pid, graceMs, { group })) return { forced: false };

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
    await runTerminationUtility(taskkill, ["/PID", String(pid), "/T", "/F"], utilityTimeoutMs);
  } else {
    signalPosixTree(pid, "SIGKILL", group);
  }

  if (!await waitForProcessExit(pid, forceWaitMs, { group })) {
    throw new Error(`Process tree ${pid} survived forced termination.`);
  }
  return { forced: true };
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

export async function runCommand(command, args, {
  cwd,
  env,
  timeoutMs = 120_000,
  graceMs = 350,
  forceWaitMs = 1_500,
  utilityTimeoutMs = 1_500,
} = {}) {
  const group = process.platform !== "win32";
  const child = spawn(command, args, {
    cwd,
    env,
    shell: false,
    detached: group,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
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
      termination = await terminateProcessTree(child.pid, { group, graceMs, forceWaitMs, utilityTimeoutMs });
    } catch (error) {
      terminationError = error;
    }
    child.stdout.destroy();
    child.stderr.destroy();
    await Promise.race([completion, delay(250)]);
    throw new CommandTimeoutError(command, child.pid, termination?.forced ?? false, terminationError);
  }

  if (outcome.error) throw outcome.error;
  if (outcome.code !== 0) {
    throw new Error(`${command} exited with ${outcome.code ?? outcome.signal}.\n${stderr}`);
  }
  return { stdout, stderr, pid: child.pid };
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
