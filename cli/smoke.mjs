import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const cliPath = path.resolve("dist-cli/index.js");

async function verify(commandPath) {
  const { stdout } = await run(process.execPath, [commandPath, "--help"]);
  if (!stdout.includes("Usage: tracelens")) throw new Error(`CLI help did not run for ${commandPath}.`);
}

await verify(cliPath);
console.log("Verified direct dist-cli execution.");

const directory = await mkdtemp(path.join(tmpdir(), "tracelens-cli-smoke-"));
const linkPath = path.join(directory, "tracelens");
try {
  try {
    await symlink(cliPath, linkPath);
    await verify(linkPath);
    console.log("Verified symlinked CLI execution.");
  } catch (error) {
    if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error) || error.code !== "EPERM") throw error;
    console.log("Skipped symlinked CLI execution: Windows denied symlink creation (EPERM).");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
