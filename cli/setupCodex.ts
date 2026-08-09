export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface SetupCodexOptions {
  force: boolean;
  packageVersion: string;
  run: CommandRunner;
}

export interface SetupCodexResult {
  ok: boolean;
  changed: boolean;
  message: string;
}

const CONNECTION_MESSAGE = [
  "TraceLens is connected to Codex. Start a new Codex task, then ask it to use TraceLens to inspect a run.",
  "Evidence requested through TraceLens tools becomes part of the Codex conversation.",
].join("\n");

function addArgs(packageVersion: string): string[] {
  return ["mcp", "add", "tracelens", "--", "npx", "-y", `tracelens@${packageVersion}`, "mcp"];
}

function manualCommand(packageVersion: string): string {
  return `codex mcp add tracelens -- npx -y tracelens@${packageVersion} mcp`;
}

function unavailable(packageVersion: string): SetupCodexResult {
  return {
    ok: false,
    changed: false,
    message: `Codex could not be reached. Register TraceLens manually: ${manualCommand(packageVersion)}`,
  };
}

function isMissing(result: CommandResult): boolean {
  if (result.exitCode !== 1) return false;
  const messages = [result.stdout, result.stderr].map((value) => value.trim()).filter(Boolean);
  if (messages.length !== 1) return false;
  const message = messages[0];
  return /^(?:error:\s*)?no\s+mcp\s+(?:server|registration)\s+named\s+['"]?tracelens['"]?\s+found[.!]?$/i.test(message)
    || /^(?:error:\s*)?mcp (?:server|registration)(?: named)? ['"]?tracelens['"]? (?:was )?not found[.!]?$/i.test(message);
}

function hasExpectedTransport(output: string, packageVersion: string): boolean | undefined {
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

  const expectedArgs = ["-y", `tracelens@${packageVersion}`, "mcp"];
  return command === "npx" && args.length === expectedArgs.length && args.every((arg, index) => arg === expectedArgs[index]);
}

export async function setupCodex(options: SetupCodexOptions): Promise<SetupCodexResult> {
  let removedExisting = false;
  let current: CommandResult;
  try {
    current = await options.run("codex", ["mcp", "get", "tracelens", "--json"]);
  } catch {
    return unavailable(options.packageVersion);
  }

  if (current.exitCode === 0) {
    const exact = hasExpectedTransport(current.stdout, options.packageVersion);
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
    return unavailable(options.packageVersion);
  }

  try {
    const added = await options.run("codex", addArgs(options.packageVersion));
    if (added.exitCode !== 0) {
      return {
        ok: false,
        changed: removedExisting,
        message: removedExisting
          ? `TraceLens Codex connection replacement failed. Register TraceLens manually: ${manualCommand(options.packageVersion)}`
          : `Unable to connect TraceLens to Codex. Register TraceLens manually: ${manualCommand(options.packageVersion)}`,
      };
    }
  } catch {
    return {
      ok: false,
      changed: removedExisting,
      message: removedExisting
        ? `TraceLens Codex connection replacement failed. Register TraceLens manually: ${manualCommand(options.packageVersion)}`
        : `Unable to connect TraceLens to Codex. Register TraceLens manually: ${manualCommand(options.packageVersion)}`,
    };
  }

  return { ok: true, changed: true, message: CONNECTION_MESSAGE };
}
