import type { LooseSpan } from "../openinference";
import { estimateKnownModelCostUsd } from "../folderStats";
import type { TraceAdapter } from "./types";

/* ── Anthropic Messages API log ──────────────────────────────────────── */

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

interface AnthropicMessage {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: unknown;
  usage?: AnthropicUsage;
}

interface UsageBreakdown {
  freshInput: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
  output: number;
  totalInput: number;
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function usageBreakdown(usage: AnthropicUsage | undefined): UsageBreakdown {
  const freshInput = tokenCount(usage?.input_tokens);
  const cacheRead = tokenCount(usage?.cache_read_input_tokens);
  const cacheWrite5m = tokenCount(usage?.cache_creation?.ephemeral_5m_input_tokens);
  const cacheWrite1hSubtype = tokenCount(usage?.cache_creation?.ephemeral_1h_input_tokens);
  const cacheWrite = typeof usage?.cache_creation_input_tokens === "number" && Number.isFinite(usage.cache_creation_input_tokens)
    ? tokenCount(usage.cache_creation_input_tokens)
    : cacheWrite5m + cacheWrite1hSubtype;
  const cacheWrite1h = Math.min(cacheWrite1hSubtype, cacheWrite);
  const output = tokenCount(usage?.output_tokens);
  return { freshInput, cacheRead, cacheWrite, cacheWrite1h, output, totalInput: freshInput + cacheRead + cacheWrite };
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function usageAttributes(
  usage: AnthropicUsage | undefined,
  model: string | undefined,
  atMs: number | undefined,
): Record<string, number> {
  if (usage === undefined) return {};
  const totals = usageBreakdown(usage);
  const cost = estimateKnownModelCostUsd(
    totals.totalInput,
    totals.output,
    totals.cacheRead,
    model,
    totals.cacheWrite,
    totals.cacheWrite1h,
    atMs,
  );
  return {
    "gen_ai.usage.input_tokens": totals.totalInput,
    "gen_ai.usage.output_tokens": totals.output,
    "gen_ai.usage.cache_read_input_tokens": totals.cacheRead,
    "gen_ai.usage.cache_creation_input_tokens": totals.cacheWrite,
    "gen_ai.usage.cache_creation_1h_input_tokens": totals.cacheWrite1h,
    ...(cost === undefined ? {} : { "gen_ai.usage.cost": cost }),
  };
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
    const recordedTime = el.timestamp ?? el.start_time;
    const time = recordedTime ?? i;
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
        ...usageAttributes(usage, model, timestampMs(recordedTime)),
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
  thinking?: string;
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
    usage?: AnthropicUsage;
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
  let assistantCalls = 0;
  let rootUsageIn = 0;
  let rootUsageOut = 0;
  let rootCacheRead = 0;
  let rootCacheWrite = 0;
  let rootCacheWrite1h = 0;
  let rootUsageCost = 0;
  let rootHasUsageCost = false;

  lines.forEach((ln, i) => {
    if (ln.message?.role !== "assistant") return;
    assistantCalls += 1;
    const ts = ccTsToMs(ln.timestamp, i);
    const pricingTs = timestampMs(ln.timestamp);
    const usage = ln.message?.usage;
    let usageAssigned = false;
    for (const b of blocksOf(ln.message?.content)) {
      if (b.type === "text" && typeof b.text === "string") {
        const usageAttrs = !usageAssigned
          ? usageAttributes(usage, ln.message?.model, pricingTs)
          : {};
        usageAssigned = true;
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
              ...usageAttrs,
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
      } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
        spans.push({
          ts,
          span: {
            span_id: `cc-think-${spans.length}`,
            parent_span_id: rootId,
            name: "thinking",
            status_code: "OK",
            start_time: ts,
            end_time: ts,
            attributes: {
              "openinference.span.kind": "LLM",
              "gen_ai.request.model": ln.message?.model,
              "output.value": b.thinking,
            },
          },
        });
      } else if (b.type === "redacted_thinking") {
        spans.push({
          ts,
          span: {
            span_id: `cc-think-${spans.length}`,
            parent_span_id: rootId,
            name: "thinking",
            status_code: "OK",
            start_time: ts,
            end_time: ts,
            attributes: {
              "openinference.span.kind": "LLM",
              "gen_ai.request.model": ln.message?.model,
              "output.value": "[Encrypted thinking — content not available]",
            },
          },
        });
      }
    }
    if (!usageAssigned) {
      const totals = usageBreakdown(usage);
      const attrs = usageAttributes(usage, ln.message?.model, pricingTs);
      rootUsageIn += totals.totalInput;
      rootUsageOut += totals.output;
      rootCacheRead += totals.cacheRead;
      rootCacheWrite += totals.cacheWrite;
      rootCacheWrite1h += totals.cacheWrite1h;
      const cost = attrs["gen_ai.usage.cost"];
      if (cost !== undefined) {
        rootUsageCost += cost;
        rootHasUsageCost = true;
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
      "tracelens.llm.calls": assistantCalls,
      ...(model !== undefined ? { "gen_ai.request.model": model } : {}),
      ...(firstPrompt !== undefined ? { "input.value": firstPrompt } : {}),
      ...(rootUsageIn > 0 ? { "gen_ai.usage.input_tokens": rootUsageIn } : {}),
      ...(rootUsageOut > 0 ? { "gen_ai.usage.output_tokens": rootUsageOut } : {}),
      ...(rootCacheRead > 0 ? { "gen_ai.usage.cache_read_input_tokens": rootCacheRead } : {}),
      ...(rootCacheWrite > 0 ? { "gen_ai.usage.cache_creation_input_tokens": rootCacheWrite } : {}),
      ...(rootCacheWrite1h > 0 ? { "gen_ai.usage.cache_creation_1h_input_tokens": rootCacheWrite1h } : {}),
      ...(rootHasUsageCost ? { "gen_ai.usage.cost": rootUsageCost } : {}),
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
