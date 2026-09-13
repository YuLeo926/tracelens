import { parseTraceText } from "./parse";
import { clipText, safeAttributes } from "./session/sanitize";

export interface SharePreview { name: string; source: string; spanCount: number; }

/** Normalize first so redacted paths or IDs cannot merge distinct source events. */
export function prepareSharePreview(source: string): SharePreview {
  const trace = parseTraceText(source);
  const nodes = [...trace.byId.values()];
  const ids = new Map(nodes.map((node, index) => [node.spanId, `span-${index + 1}`]));
  const text = (value: string) => clipText(value, Number.MAX_SAFE_INTEGER).text;
  const spans = nodes.map((node) => ({
    span_id: ids.get(node.spanId),
    parent_span_id: node.parentSpanId ? ids.get(node.parentSpanId) ?? null : null,
    name: text(node.name), start_time: node.startMs, end_time: node.endMs,
    status_code: node.status.toUpperCase(),
    ...(node.statusMessage === undefined ? {} : { status_message: text(node.statusMessage) }),
    attributes: {
      ...safeAttributes(node.attributes),
      "openinference.span.kind": node.kind.toUpperCase(),
      ...(node.model === undefined ? {} : { "gen_ai.request.model": text(node.model) }),
      ...(node.input === undefined ? {} : { "input.value": text(node.input) }),
      ...(node.output === undefined ? {} : { "output.value": text(node.output) }),
      ...(node.tokensIn === undefined ? {} : { "gen_ai.usage.input_tokens": node.tokensIn }),
      ...(node.tokensOut === undefined ? {} : { "gen_ai.usage.output_tokens": node.tokensOut }),
      ...(node.costUsd === undefined ? {} : { "gen_ai.usage.cost": node.costUsd }),
    },
  }));
  return { name: "trace-redacted", source: JSON.stringify({ spans }, null, 2), spanCount: spans.length };
}
