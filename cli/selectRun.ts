import type { Writable } from "node:stream";
import { clipText } from "../src/core/session/sanitize";
import type { SessionSummary } from "../src/core/session/types";

const MAX_METADATA_LENGTH = 120;

function displayText(value: string | undefined, fallback: string): string {
  return clipText(value ?? fallback, MAX_METADATA_LENGTH).text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || fallback;
}

export function sessionListLine(session: SessionSummary, index: number): string {
  const title = displayText(session.title, "Untitled session");
  const project = displayText(session.project, "Unknown project");
  const provider = displayText(session.provider, "unknown");
  const lifecycle = displayText(session.lifecycle, "unknown");
  return `${index + 1}. ${title} (${provider}, ${project}, ${lifecycle})`;
}

export async function selectRun(
  sessions: SessionSummary[],
  input: NodeJS.ReadableStream,
  output: Pick<Writable, "write">,
): Promise<SessionSummary> {
  sessions.forEach((session, index) => output.write(`${sessionListLine(session, index)}\n`));
  output.write(`Select a session [1-${sessions.length}]: `);

  let remainder = "";
  const select = (value: string): SessionSummary | undefined => {
    if (!value.trim()) return undefined;
    const selected = Number(value.trim());
    if (Number.isInteger(selected) && selected >= 1 && selected <= sessions.length) {
      return sessions[selected - 1];
    }
    output.write(`Enter a number between 1 and ${sessions.length}.\n`);
    output.write(`Select a session [1-${sessions.length}]: `);
    return undefined;
  };

  for await (const chunk of input) {
    const values = (remainder + String(chunk)).split(/\r?\n/);
    remainder = values.pop() ?? "";
    for (const value of values) {
      const session = select(value);
      if (session) return session;
    }
  }

  const session = select(remainder);
  if (session) return session;

  throw new Error("Session selection was cancelled.");
}
