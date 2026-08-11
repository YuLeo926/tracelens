import packageMetadata from "../package.json";
import { FIRST_RUN_FEEDBACK_URL, FIRST_RUN_PROMPT } from "../src/core/firstRun";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface SetupCodexOptions {
  force: boolean;
  packageName?: string;
  packageVersion: string;
  run: CommandRunner;
}

export interface SetupCodexResult {
  ok: boolean;
  changed: boolean;
  message: string;
}

const CONNECTION_MESSAGE = [
  "TraceLens is connected to Codex.",
  "Start a new Codex task in the project you want to inspect.",
  `Ask Codex: "${FIRST_RUN_PROMPT}"`,
  "Evidence requested through TraceLens tools becomes part of the Codex conversation.",
  `First-run feedback (optional): ${FIRST_RUN_FEEDBACK_URL}`,
].join("\n");

function packageSpec(packageName: string, packageVersion: string): string {
  return `${packageName}@${packageVersion}`;
}

function addArgs(packageName: string, packageVersion: string): string[] {
  return ["mcp", "add", "tracelens", "--", "npx", "-y", packageSpec(packageName, packageVersion), "mcp"];
}

function manualCommand(packageName: string, packageVersion: string): string {
  return `codex mcp add tracelens -- npx -y ${packageSpec(packageName, packageVersion)} mcp`;
}

function unavailable(packageName: string, packageVersion: string): SetupCodexResult {
  return {
    ok: false,
    changed: false,
    message: `Codex could not be reached. Register TraceLens manually: ${manualCommand(packageName, packageVersion)}`,
  };
}

function isMissing(result: CommandResult): boolean {
  if (result.exitCode !== 1) return false;
  const lines = [result.stdout, result.stderr]
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const missingRegistration = (line: string) => (
    /^(?:error:\s*)?no\s+mcp\s+(?:server|registration)\s+named\s+['"]?tracelens['"]?\s+found[.!]?$/i.test(line)
    || /^(?:error:\s*)?mcp (?:server|registration)(?: named)? ['"]?tracelens['"]? (?:was )?not found[.!]?$/i.test(line)
  );

  return lines.some(missingRegistration)
    && lines.every((line) => missingRegistration(line) || /^warning\s*:/i.test(line));
}

function hasExpectedTransport(output: string, packageName: string, packageVersion: string): boolean | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  if ((parsed as { name?: unknown }).name !== "tracelens") return undefined;

  const transport = (parsed as { transport?: unknown }).transport;
  if (typeof transport !== "object" || transport === null || Array.isArray(transport)) return undefined;
  const { type, command, args } = transport as { type?: unknown; command?: unknown; args?: unknown };
  if (typeof type !== "string") return undefined;
  if (type !== "stdio") return false;
  if (typeof command !== "string" || !Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    return undefined;
  }

  const expectedArgs = ["-y", packageSpec(packageName, packageVersion), "mcp"];
  return command === "npx" && args.length === expectedArgs.length && args.every((arg, index) => arg === expectedArgs[index]);
}

export async function setupCodex(options: SetupCodexOptions): Promise<SetupCodexResult> {
  const packageName = options.packageName ?? packageMetadata.name;
  let removedExisting = false;
  let current: CommandResult;
  try {
    current = await options.run("codex", ["mcp", "get", "tracelens", "--json"]);
  } catch {
    return unavailable(packageName, options.packageVersion);
  }

  if (current.exitCode === 0) {
    const exact = hasExpectedTransport(current.stdout, packageName, options.packageVersion);
    if (exact === undefined) {
      return { ok: false, changed: false, message: "Unable to inspect the TraceLens Codex connection." };
    }
    if (exact) {
      return { ok: true, changed: false, message: CONNECTION_MESSAGE };
    }
    if (!options.force) {
      return {
        ok: false,
        changed: false,
        message: "TraceLens already has a different Codex connection. Use \"tracelens setup codex --force\" to replace it.",
      };
    }
    try {
      const removed = await options.run("codex", ["mcp", "remove", "tracelens"]);
      if (removed.exitCode !== 0) {
        return { ok: false, changed: false, message: "Unable to update the TraceLens Codex connection." };
      }
      removedExisting = true;
    } catch {
      return { ok: false, changed: false, message: "Unable to update the TraceLens Codex connection." };
    }
  } else if (!isMissing(current)) {
    return unavailable(packageName, options.packageVersion);
  }

  try {
    const added = await options.run("codex", addArgs(packageName, options.packageVersion));
    if (added.exitCode !== 0) {
      return {
        ok: false,
        changed: removedExisting,
        message: removedExisting
          ? `TraceLens Codex connection replacement failed. Register TraceLens manually: ${manualCommand(packageName, options.packageVersion)}`
          : `Unable to connect TraceLens to Codex. Register TraceLens manually: ${manualCommand(packageName, options.packageVersion)}`,
      };
    }
  } catch {
    return {
      ok: false,
      changed: removedExisting,
      message: removedExisting
        ? `TraceLens Codex connection replacement failed. Register TraceLens manually: ${manualCommand(packageName, options.packageVersion)}`
        : `Unable to connect TraceLens to Codex. Register TraceLens manually: ${manualCommand(packageName, options.packageVersion)}`,
    };
  }

  return { ok: true, changed: true, message: CONNECTION_MESSAGE };
}
