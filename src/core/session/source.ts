import { extractConversationMeta, extractConversationProjectPath } from "../conversationMeta";
import { isTraceFileHead } from "../traceSniff";
import type { SessionLifecycle, SessionProvider } from "./types";

export interface SessionSourceInspection {
  provider: SessionProvider;
  lifecycle: SessionLifecycle;
  title?: string;
  project?: string;
  projectPath?: string;
  startMs?: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function recordList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function decodeRecords(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    return recordList(JSON.parse(trimmed));
  } catch {
    const records: unknown[] = [];
    for (const line of text.split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate) continue;
      try {
        records.push(JSON.parse(candidate));
      } catch {
        // A head or tail read can begin or end in a partial JSONL record.
      }
    }
    return records;
  }
}

function typeOf(record: unknown): string | undefined {
  return isRecord(record) && typeof record.type === "string" ? record.type : undefined;
}

function isCodexExec(record: unknown): boolean {
  const type = typeOf(record);
  return !!type && (type.startsWith("thread.") || type.startsWith("turn.") || type.startsWith("item."));
}

function isCodexRollout(record: unknown): boolean {
  const type = typeOf(record);
  return (
    !!type &&
    (type === "session_meta" || type === "turn_context" || type === "response_item" || type === "event_msg") &&
    isRecord((record as JsonRecord).payload)
  );
}

function isClaudeCode(record: unknown): record is JsonRecord & { type: "user" | "assistant"; message: JsonRecord } {
  if (!isRecord(record) || (record.type !== "user" && record.type !== "assistant")) return false;
  return isRecord(record.message) && typeof record.message.role === "string";
}

function providerOf(records: unknown[]): SessionProvider {
  if (records.some(isCodexExec) || records.some(isCodexRollout)) return "codex";
  if (records.some(isClaudeCode)) return "claude";
  return "generic";
}

function codexLifecycle(records: unknown[]): SessionLifecycle {
  let lifecycle: SessionLifecycle = "unknown";
  for (const record of records) {
    if (!isCodexExec(record)) continue;
    switch (typeOf(record)) {
      case "turn.started":
        lifecycle = "active";
        break;
      case "turn.completed":
        lifecycle = "complete";
        break;
      case "turn.failed":
        lifecycle = "failed";
        break;
    }
  }
  return lifecycle;
}

function isClaudeError(record: unknown): boolean {
  return isRecord(record) && (record.type === "error" || "error" in record);
}

function claudeLifecycle(records: unknown[]): SessionLifecycle {
  let lifecycle: SessionLifecycle = "unknown";
  for (const record of records) {
    if (isClaudeError(record)) {
      lifecycle = "failed";
      continue;
    }
    if (!isClaudeCode(record) || record.type !== "assistant") continue;
    const stopReason = record.message.stop_reason;
    if (typeof stopReason === "string" && stopReason.trim()) lifecycle = "complete";
  }
  return lifecycle;
}

function numberAt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return timestamp;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function startMsOf(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["timestamp", "start_time", "startTime"] as const) {
    const startMs = numberAt(value[key]);
    if (startMs !== undefined) return startMs;
  }
  for (const key of ["start_time_unix_nano", "startTimeUnixNano"] as const) {
    const nanos = numberAt(value[key]);
    if (nanos !== undefined) return nanos / 1_000_000;
  }
  for (const key of ["spans", "data"] as const) {
    if (!Array.isArray(value[key])) continue;
    for (const span of value[key]) {
      const startMs = startMsOf(span);
      if (startMs !== undefined) return startMs;
    }
  }
  return undefined;
}

function firstStartMs(records: unknown[]): number | undefined {
  for (const record of records) {
    const startMs = startMsOf(record);
    if (startMs !== undefined) return startMs;
  }
  return undefined;
}

export function inspectSessionSource(name: string, head: string, tail: string): SessionSourceInspection | null {
  if (!isTraceFileHead(name, head)) return null;

  const headRecords = decodeRecords(head);
  const records = [...headRecords, ...decodeRecords(tail)];
  const provider = providerOf(records);
  const meta = extractConversationMeta(head);
  const projectPath = extractConversationProjectPath(head);
  const lifecycle = provider === "codex" ? codexLifecycle(records) : provider === "claude" ? claudeLifecycle(records) : "unknown";
  const startMs = firstStartMs(headRecords);

  return {
    provider,
    lifecycle,
    ...meta,
    ...(projectPath !== undefined ? { projectPath } : {}),
    ...(startMs !== undefined ? { startMs } : {}),
  };
}
