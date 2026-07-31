export type ParsedArgs =
  | { command: "open"; file: string | undefined }
  | { command: "list" }
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
  return { command: "unknown" };
}
