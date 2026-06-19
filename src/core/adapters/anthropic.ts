import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

/* ── Anthropic Messages API log ──────────────────────────────────────── */

interface AnthropicMessage {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
}
interface LogEntry extends AnthropicMessage {
  request?: { model?: string; messages?: unknown; system?: unknown };
  response?: AnthropicMessage;
  error?: unknown;
  timestamp?: unknown;
  start_time?: unknown;
}

function looksMessagesLog(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const e = el as LogEntry;
  if (e.type === "message") return true;
  if (e.response && typeof e.response === "object") return true;
  if (e.usage && typeof e.role === "string") return true;
  return false;
}

function textBlocks(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b &&
          typeof b === "object" &&
          (b as { type?: string }).type === "text" &&
          typeof (b as { text?: unknown }).text === "string",
      )
      .map((b) => b.text);
    return texts.length ? texts.join("\n") : JSON.stringify(content, null, 2);
  }
  return undefined;
}

function messagesLogToLooseSpans(entries: LogEntry[]): LooseSpan[] {
  return entries.map((el, i): LooseSpan => {
    const response = (el.response ?? el) as AnthropicMessage;
    const request = el.request;
    const usage = response.usage ?? el.usage;
    const model = response.model ?? request?.model;
    const isError = response.type === "error" || !!el.error;
    const input = request
      ? JSON.stringify({ system: request.system, messages: request.messages }, null, 2)
      : undefined;
    const output = isError
      ? JSON.stringify(el.error ?? response, null, 2)
      : textBlocks(response.content);
    const time = el.timestamp ?? el.start_time ?? i;
    return {
      span_id: el.id ?? response.id ?? `claude-${i}`,
      parent_span_id: null,
      name: "claude.messages",
      status_code: isError ? "ERROR" : "OK",
      start_time: time,
      end_time: time,
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": model,
        "gen_ai.usage.input_tokens": usage?.input_tokens,
        "gen_ai.usage.output_tokens": usage?.output_tokens,
        "input.value": input,
        "output.value": output,
      },
    };
  });
}

/* ── Claude Code transcript (saved ~/.claude/projects/.../*.jsonl) ─────── */

interface ClaudeBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}
interface ClaudeLine {
  type?: string;
  timestamp?: string;
  uuid?: string;
  sessionId?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
}

function looksClaudeCode(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const e = el as ClaudeLine;
  return (
    (e.type === "user" || e.type === "assistant") &&
    !!e.message &&
    typeof e.message === "object" &&
    typeof e.message.role === "string"
  );
}

function ccTsToMs(ts: unknown, fallback: number): number {
  if (typeof ts === "string") {
    const p = Date.parse(ts);
    if (!Number.isNaN(p)) return p;
  }
  return fallback;
}

function blocksOf(content: unknown): ClaudeBlock[] {
  if (Array.isArray(content)) return content as ClaudeBlock[];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function claudeCodeToLooseSpans(lines: ClaudeLine[]): LooseSpan[] {
  const results = new Map<string, { output?: string; isError?: boolean; ts: number }>();
  let sessionId: string | undefined;
  let model: string | undefined;
  let firstPrompt: string | undefined;
  let firstTs: number | undefined;
  let lastTs = 0;

  lines.forEach((ln, i) => {
    const ts = ccTsToMs(ln.timestamp, i);
    if (firstTs === undefined) firstTs = ts;
    lastTs = ts;
    sessionId = ln.sessionId ?? sessionId;
    if (ln.message?.model) model = model ?? ln.message.model;
    for (const b of blocksOf(ln.message?.content)) {
      if (b.type === "tool_result" && b.tool_use_id) {
        results.set(b.tool_use_id, {
          output: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
          isError: b.is_error,
          ts,
        });
      }
      if (ln.message?.role === "user" && b.type === "text" && firstPrompt === undefined && typeof b.text === "string") {
        firstPrompt = b.text;
      }
    }
  });

  const rootId = sessionId ?? "claude-code-session";
  const spans: Array<{ ts: number; span: LooseSpan }> = [];

  lines.forEach((ln, i) => {
    if (ln.message?.role !== "assistant") return;
    const ts = ccTsToMs(ln.timestamp, i);
    const usage = ln.message?.usage;
    for (const b of blocksOf(ln.message?.content)) {
      if (b.type === "text" && typeof b.text === "string") {
        spans.push({
          ts,
          span: {
            span_id: `cc-msg-${spans.length}`,
            parent_span_id: rootId,
            name: "assistant",
            status_code: "OK",
            start_time: ts,
            end_time: ts,
            attributes: {
              "openinference.span.kind": "LLM",
              "gen_ai.request.model": ln.message?.model,
              "gen_ai.usage.input_tokens": usage?.input_tokens,
              "gen_ai.usage.output_tokens": usage?.output_tokens,
              "output.value": b.text,
            },
          },
        });
      } else if (b.type === "tool_use" && b.id) {
        const r = results.get(b.id);
        spans.push({
          ts,
          span: {
            span_id: b.id,
            parent_span_id: rootId,
            name: b.name ?? "tool_use",
            status_code: r?.isError ? "ERROR" : "OK",
            start_time: ts,
            end_time: r?.ts ?? ts,
            attributes: {
              "openinference.span.kind": "TOOL",
              "input.value": JSON.stringify(b.input, null, 2),
              ...(r?.output !== undefined ? { "output.value": r.output } : {}),
              "claude.item": b,
            },
          },
        });
      }
    }
  });
  spans.sort((a, b) => a.ts - b.ts);

  const root: LooseSpan = {
    span_id: rootId,
    parent_span_id: null,
    name: "claude-code.session",
    status_code: "OK",
    start_time: firstTs ?? 0,
    end_time: lastTs,
    attributes: {
      "openinference.span.kind": "AGENT",
      ...(model !== undefined ? { "gen_ai.request.model": model } : {}),
      ...(firstPrompt !== undefined ? { "input.value": firstPrompt } : {}),
    },
  };
  return [root, ...spans.map((s) => s.span)];
}

/* ── Adapter (handles both Anthropic/Claude formats) ─────────────────── */

export const anthropicAdapter: TraceAdapter = {
  id: "anthropic",
  label: "Anthropic / Claude (API log / Claude Code)",
  detect(json) {
    return Array.isArray(json) && json.some((el) => looksMessagesLog(el) || looksClaudeCode(el));
  },
  toLooseSpans(json) {
    const arr = Array.isArray(json) ? json : [];
    if (arr.some(looksClaudeCode)) return claudeCodeToLooseSpans(arr as ClaudeLine[]);
    return messagesLogToLooseSpans(arr as LogEntry[]);
  },
};
