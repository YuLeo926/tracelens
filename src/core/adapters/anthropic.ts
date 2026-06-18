import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

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

function looksAnthropic(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const e = el as LogEntry;
  if (e.type === "message") return true;
  if (e.response && typeof e.response === "object") return true;
  if (e.usage && typeof e.role === "string") return true;
  return false;
}

function contentText(content: unknown): string | undefined {
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

export const anthropicAdapter: TraceAdapter = {
  id: "anthropic",
  label: "Anthropic (Claude) log",
  detect(json) {
    return Array.isArray(json) && json.some(looksAnthropic);
  },
  toLooseSpans(json) {
    const entries = (Array.isArray(json) ? json : []) as LogEntry[];
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
        : contentText(response.content);
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
  },
};
