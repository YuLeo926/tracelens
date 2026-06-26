function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function hasSpanShape(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    (isString(v.span_id) || isString(v.spanId)) &&
    ("start_time" in v || "startTime" in v || "start_time_unix_nano" in v || "end_time" in v || "endTime" in v)
  );
}

function isCodexRecord(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const type = v.type;
  if (!isString(type)) return false;
  if (type.startsWith("thread.") || type.startsWith("turn.") || type.startsWith("item.")) return true;
  return (
    (type === "session_meta" || type === "turn_context" || type === "response_item" || type === "event_msg") &&
    isRecord(v.payload)
  );
}

function isClaudeRecord(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const message = v.message;
  if (isRecord(message) && isString(message.role) && (v.type === "user" || v.type === "assistant")) return true;
  if (v.type === "message") return true;
  return isRecord(v.response) && isRecord((v.response as Record<string, unknown>).usage);
}

function isTraceJson(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((item) => hasSpanShape(item) || isCodexRecord(item) || isClaudeRecord(item));
  if (!isRecord(v)) return false;
  if (Array.isArray(v.resourceSpans) || Array.isArray(v.resource_spans)) return true;
  const spans = v.spans ?? v.data;
  if (Array.isArray(spans)) return spans.some(hasSpanShape);
  return hasSpanShape(v) || isCodexRecord(v) || isClaudeRecord(v);
}

function hasTraceMarker(text: string): boolean {
  return (
    /"resource(?:S|_s)pans"/.test(text) ||
    /"(span_id|spanId)"\s*:/.test(text) ||
    /"type"\s*:\s*"(session_meta|turn_context|response_item|event_msg)"/.test(text) ||
    /"type"\s*:\s*"(thread|turn|item)\./.test(text) ||
    /"type"\s*:\s*"(user|assistant)"[\s\S]{0,4096}"message"\s*:/.test(text)
  );
}

export function isTraceFileHead(name: string, head: string): boolean {
  if (!/\.jsonl?$/i.test(name)) return false;
  const text = head.trimStart();
  if (!text) return false;

  try {
    return isTraceJson(JSON.parse(text));
  } catch {
    // A large JSON trace may be truncated by readHead; JSONL can still be
    // recognized line-by-line, while partial JSON falls back to markers.
  }

  for (const line of text.split(/\r?\n/).slice(0, 80)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t);
      if (isTraceJson(parsed)) return true;
    } catch {
      // Ignore partial/truncated lines.
    }
  }

  return hasTraceMarker(text);
}
