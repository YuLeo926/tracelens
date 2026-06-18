import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

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

function isCodexEvent(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const t = (el as CodexEvent).type;
  return (
    typeof t === "string" &&
    (t.startsWith("item.") || t.startsWith("turn.") || t.startsWith("thread."))
  );
}

export const codexAdapter: TraceAdapter = {
  id: "codex",
  label: "Codex exec --json",
  detect(json) {
    return Array.isArray(json) && json.some(isCodexEvent);
  },
  toLooseSpans(json) {
    const events = (Array.isArray(json) ? json : []) as CodexEvent[];
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
  },
};
