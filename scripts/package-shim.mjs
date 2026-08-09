import assert from "node:assert/strict";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function trustedEnvironment() {
  const nodeDirectory = path.dirname(process.execPath);
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === "path") delete environment[key];
  }
  environment[process.platform === "win32" ? "Path" : "PATH"] = nodeDirectory;
  environment.npm_config_offline = "true";
  return Object.fromEntries(Object.entries(environment).filter((entry) => typeof entry[1] === "string"));
}

function powerShellInvocationTargets(shimText) {
  const invocationLines = shimText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#") && line.includes("&") && line.includes("$args"));
  assert(invocationLines.length > 0, "The local npm bin shim must invoke the installed tracelens entry.");
  return invocationLines.map((line) => {
    const match = line.match(/&\s+(?:"[^"]+"|'[^']+')\s+(?:"([^"]+)"|'([^']+)')\s+\$args(?:\s|$)/i);
    assert(match, "Every PowerShell shim command must pass arguments directly to one quoted entry path.");
    const target = match[1] ?? match[2];
    assert(/^\$basedir[\\/]/i.test(target), "The PowerShell shim entry must be relative to its own local bin directory.");
    return target.replace(/^\$basedir[\\/]/i, "");
  });
}

export async function resolveInstalledBinShim(installDirectory) {
  const binDirectory = path.join(installDirectory, "node_modules", ".bin");
  const installedEntry = path.join(installDirectory, "node_modules", "tracelens", "dist-cli", "index.js");
  let resolvedEntry;
  try {
    resolvedEntry = await realpath(installedEntry);
  } catch (error) {
    throw new Error(`Installed tracelens entry is missing: ${installedEntry}`, { cause: error });
  }
  const resolvedPackage = await realpath(path.join(installDirectory, "node_modules", "tracelens"));
  assert(isWithin(resolvedPackage, resolvedEntry), "The installed tracelens entry must remain inside the installed package.");

  if (process.platform === "win32") {
    const shimPath = path.join(binDirectory, "tracelens.ps1");
    let shimText;
    try {
      const stats = await lstat(shimPath);
      assert(stats.isFile(), "The local npm bin shim must be a regular PowerShell file.");
      shimText = await readFile(shimPath, "utf8");
    } catch (error) {
      throw new Error(`Local npm bin shim is missing or unreadable: ${shimPath}`, { cause: error });
    }
    for (const target of powerShellInvocationTargets(shimText)) {
      let resolvedTarget;
      try {
        resolvedTarget = await realpath(path.resolve(binDirectory, target));
      } catch (error) {
        throw new Error("The local npm bin shim must target the installed tracelens entry.", { cause: error });
      }
      assert.equal(path.normalize(resolvedTarget), path.normalize(resolvedEntry), "The local npm bin shim must target the installed tracelens entry.");
    }
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    await access(powershell);
    return {
      command: powershell,
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", shimPath],
      environment: trustedEnvironment(),
      installedEntry: resolvedEntry,
      shimPath,
    };
  }

  const shimPath = path.join(binDirectory, "tracelens");
  let resolvedShim;
  try {
    const stats = await lstat(shimPath);
    assert(stats.isSymbolicLink(), "The local npm bin shim must be a symlink on POSIX.");
    resolvedShim = await realpath(shimPath);
    await access(shimPath, 1);
  } catch (error) {
    throw new Error(`Local npm bin shim is missing, broken, or not executable: ${shimPath}`, { cause: error });
  }
  assert.equal(path.normalize(resolvedShim), path.normalize(resolvedEntry), "The local npm bin shim must target the installed tracelens entry.");
  return {
    command: shimPath,
    args: [],
    environment: trustedEnvironment(),
    installedEntry: resolvedEntry,
    shimPath,
  };
}
