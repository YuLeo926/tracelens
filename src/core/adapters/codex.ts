import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

/* ── Codex exec --json (live event stream) ───────────────────────────── */

interface CodexItem {
  id?: string;
  type?: string;
  status?: string;
  command?: string;
  text?: string;
  query?: string;
  aggregated_output?: string;
  output?: string;
  [k: string]: unknown;
}
interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const KIND_BY_ITEM: Record<string, string> = {
  command_execution: "TOOL",
  file_change: "TOOL",
  mcp_tool_call: "TOOL",
  web_search: "TOOL",
  agent_message: "LLM",
  reasoning: "LLM",
  plan: "CHAIN",
  todo_list: "CHAIN",
};

function isExecEvent(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const t = (el as CodexEvent).type;
  return (
    typeof t === "string" &&
    (t.startsWith("item.") || t.startsWith("turn.") || t.startsWith("thread."))
  );
}

function execToLooseSpans(events: CodexEvent[]): LooseSpan[] {
  let threadId: string | undefined;
  let usage: { input_tokens?: number; output_tokens?: number } | undefined;
  let turnFailed = false;
  const items = new Map<string, CodexItem>();
  const order: string[] = [];

  for (const ev of events) {
    if (ev.type === "thread.started") threadId = ev.thread_id ?? threadId;
    else if (ev.type === "turn.completed") usage = ev.usage ?? usage;
    else if (ev.type === "turn.failed") turnFailed = true;
    else if ((ev.type === "item.started" || ev.type === "item.completed") && ev.item) {
      const id = ev.item.id ?? `item-${order.length}`;
      if (!items.has(id)) order.push(id);
      items.set(id, { ...items.get(id), ...ev.item, id });
    }
  }

  const rootId = threadId ?? "codex-session";
  const out: LooseSpan[] = [
    {
      span_id: rootId,
      parent_span_id: null,
      name: "codex.session",
      status_code: turnFailed ? "ERROR" : "OK",
      start_time: 0,
      end_time: order.length,
      attributes: {
        "openinference.span.kind": "AGENT",
        "gen_ai.usage.input_tokens": usage?.input_tokens,
        "gen_ai.usage.output_tokens": usage?.output_tokens,
      },
    },
  ];

  order.forEach((id, j) => {
    const item = items.get(id)!;
    const kind = item.type ? KIND_BY_ITEM[item.type] : undefined;
    const input = item.command ?? item.query;
    const output = item.text ?? item.aggregated_output ?? item.output;
    const isError = item.status === "failed" || item.status === "error";
    out.push({
      span_id: id,
      parent_span_id: rootId,
      name: item.type ?? "item",
      status_code: isError ? "ERROR" : "OK",
      start_time: j,
      end_time: j,
      attributes: {
        ...(kind ? { "openinference.span.kind": kind } : {}),
        ...(input !== undefined ? { "input.value": input } : {}),
        ...(output !== undefined ? { "output.value": output } : {}),
        "codex.item": item,
      },
    });
  });

  return out;
}

/* ── Codex session rollout (saved ~/.codex/sessions/.../rollout-*.jsonl) ── */

interface RolloutEvent {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

function isRolloutEvent(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const t = (el as RolloutEvent).type;
  return (
    t === "session_meta" || t === "turn_context" || t === "response_item" || t === "event_msg"
  );
}

function tsToMs(ts: unknown, fallback: number): number {
  if (typeof ts === "string") {
    const p = Date.parse(ts);
    if (!Number.isNaN(p)) return p;
  }
  return fallback;
}

function outputText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content
      .map((b) => (b && typeof b === "object" ? (b as { text?: unknown }).text : undefined))
      .filter((x): x is string => typeof x === "string");
    return t.length ? t.join("\n") : undefined;
  }
  return undefined;
}

function rolloutToLooseSpans(events: RolloutEvent[]): LooseSpan[] {
  let sessionId: string | undefined;
  let model: string | undefined;
  let usageIn: number | undefined;
  let usageOut: number | undefined;
  let firstTs: number | undefined;
  let lastTs = 0;

  const outputs = new Map<string, { output?: string; ts: number }>();
  const calls: Array<{ callId: string; name?: string; args?: string; ts: number }> = [];
  const messages: Array<{ text?: string; ts: number }> = [];

  events.forEach((ev, i) => {
    const ts = tsToMs(ev.timestamp, i);
    if (firstTs === undefined) firstTs = ts;
    lastTs = ts;
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    if (ev.type === "session_meta") {
      sessionId = (p.id as string) ?? sessionId;
    } else if (ev.type === "turn_context") {
      model = (p.model as string) ?? model;
    } else if (ev.type === "event_msg" && p.type === "token_count") {
      const total = ((p.info as Record<string, unknown>)?.total_token_usage ?? {}) as Record<string, unknown>;
      if (typeof total.input_tokens === "number") usageIn = total.input_tokens;
      if (typeof total.output_tokens === "number") usageOut = total.output_tokens;
    } else if (ev.type === "response_item") {
      if (p.type === "function_call") {
        calls.push({ callId: String(p.call_id ?? `call-${i}`), name: p.name as string, args: p.arguments as string, ts });
      } else if (p.type === "function_call_output") {
        outputs.set(String(p.call_id), { output: p.output as string, ts });
      } else if (p.type === "message" && p.role === "assistant") {
        messages.push({ text: outputText(p.content), ts });
      }
    }
  });

  const rootId = sessionId ?? "codex-session";
  const spans: Array<{ ts: number; span: LooseSpan }> = [];

  for (const c of calls) {
    const out = outputs.get(c.callId);
    let command: string | undefined = c.args;
    try {
      const a = JSON.parse(c.args ?? "") as { command?: unknown };
      if (typeof a.command === "string") command = a.command;
    } catch {
      /* keep raw arguments */
    }
    const m = out?.output?.match(/^Exit code:\s*(\d+)/m);
    const isError = !!m && m[1] !== "0";
    spans.push({
      ts: c.ts,
      span: {
        span_id: c.callId,
        parent_span_id: rootId,
        name: c.name ?? "function_call",
        status_code: isError ? "ERROR" : "OK",
        start_time: c.ts,
        end_time: out?.ts ?? c.ts,
        attributes: {
          "openinference.span.kind": "TOOL",
          ...(command !== undefined ? { "input.value": command } : {}),
          ...(out?.output !== undefined ? { "output.value": out.output } : {}),
          "codex.item": { name: c.name, arguments: c.args, output: out?.output },
        },
      },
    });
  }
  messages.forEach((msg, k) => {
    spans.push({
      ts: msg.ts,
      span: {
        span_id: `codex-msg-${k}`,
        parent_span_id: rootId,
        name: "assistant",
        status_code: "OK",
        start_time: msg.ts,
        end_time: msg.ts,
        attributes: {
          "openinference.span.kind": "LLM",
          ...(msg.text !== undefined ? { "output.value": msg.text } : {}),
        },
      },
    });
  });
  spans.sort((a, b) => a.ts - b.ts);

  const root: LooseSpan = {
    span_id: rootId,
    parent_span_id: null,
    name: "codex.session",
    status_code: "OK",
    start_time: firstTs ?? 0,
    end_time: lastTs,
    attributes: {
      "openinference.span.kind": "AGENT",
      ...(model !== undefined ? { "gen_ai.request.model": model } : {}),
      "gen_ai.usage.input_tokens": usageIn,
      "gen_ai.usage.output_tokens": usageOut,
    },
  };
  return [root, ...spans.map((s) => s.span)];
}

/* ── Adapter (handles both Codex formats) ────────────────────────────── */

export const codexAdapter: TraceAdapter = {
  id: "codex",
  label: "Codex (exec --json / session rollout)",
  detect(json) {
    return Array.isArray(json) && json.some((el) => isExecEvent(el) || isRolloutEvent(el));
  },
  toLooseSpans(json) {
    const arr = Array.isArray(json) ? json : [];
    if (arr.some(isRolloutEvent)) return rolloutToLooseSpans(arr as RolloutEvent[]);
    return execToLooseSpans(arr as CodexEvent[]);
  },
};
