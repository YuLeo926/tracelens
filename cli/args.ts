export type ParsedArgs =
  | { command: "open"; file: string | undefined }
  | { command: "list" }
  | { command: "mcp" }
  | { command: "setup-codex"; force: boolean }
  | { command: "help" }
  | { command: "unknown" };

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { command: "open", file: undefined };

  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h") {
    if (rest.length > 0) throw new Error("Help does not accept additional arguments.");
    return { command: "help" };
  }
  if (command === "open") {
    if (rest.length > 1) throw new Error("Only one session file can be opened.");
    return { command: "open", file: rest[0] };
  }
  if (command === "list") {
    if (rest.length > 0) throw new Error("The list command does not accept additional arguments.");
    return { command: "list" };
  }
  if (command === "mcp") {
    if (rest.length > 0) throw new Error("The mcp command does not accept additional arguments.");
    return { command: "mcp" };
  }
  if (command === "setup") {
    const [target, option, ...extra] = rest;
    if (target !== "codex") throw new Error("Unsupported setup target.");
    if (option === undefined) return { command: "setup-codex", force: false };
    if (option === "--force" && extra.length === 0) return { command: "setup-codex", force: true };
    throw new Error("Unsupported setup option.");
  }
  return { command: "unknown" };
}
