import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

interface OtlpKV {
  key?: string;
  value?: Record<string, unknown>;
}
interface OtlpSpan {
  spanId?: string;
  parentSpanId?: string;
  traceId?: string;
  name?: string;
  startTimeUnixNano?: unknown;
  endTimeUnixNano?: unknown;
  status?: { code?: unknown; message?: string };
  attributes?: OtlpKV[];
}

function resourceSpansOf(json: unknown): unknown[] | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const rs = obj.resourceSpans ?? obj.resource_spans;
  return Array.isArray(rs) ? rs : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Unwrap an OTLP typed attribute value to a scalar (stringified for nested types). */
function unwrapValue(value: Record<string, unknown> | undefined): unknown {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("intValue" in value) return value.intValue; // often a numeric string
  if ("doubleValue" in value) return value.doubleValue;
  if ("boolValue" in value) return value.boolValue;
  return JSON.stringify(value); // arrayValue / kvlistValue / bytesValue
}

function attrsToMap(attrs: OtlpKV[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of attrs ?? []) {
    if (a && typeof a.key === "string") out[a.key] = unwrapValue(a.value);
  }
  return out;
}

/** OTLP status.code is 0/1/2 or "STATUS_CODE_*"; map to the string pickStatus reads. */
function mapStatus(code: unknown): string {
  const s = String(code ?? "").toUpperCase();
  if (code === 2 || s.includes("ERROR")) return "ERROR";
  if (code === 1 || s.includes("OK")) return "OK";
  return "UNSET";
}

export const otlpAdapter: TraceAdapter = {
  id: "otlp",
  label: "OpenTelemetry (OTLP)",
  detect(json) {
    return resourceSpansOf(json) !== null;
  },
  toLooseSpans(json) {
    const out: LooseSpan[] = [];
    for (const rs of resourceSpansOf(json) ?? []) {
      const rsObj = (rs ?? {}) as Record<string, unknown>;
      for (const ss of arr(rsObj.scopeSpans ?? rsObj.scope_spans)) {
        const ssObj = (ss ?? {}) as Record<string, unknown>;
        for (const s of arr(ssObj.spans)) {
          const span = (s ?? {}) as OtlpSpan;
          out.push({
            span_id: span.spanId,
            parent_span_id: span.parentSpanId ? span.parentSpanId : null,
            trace_id: span.traceId,
            name: span.name,
            start_time_unix_nano: span.startTimeUnixNano,
            end_time_unix_nano: span.endTimeUnixNano,
            status_code: mapStatus(span.status?.code),
            status_message: span.status?.message,
            attributes: attrsToMap(span.attributes),
          });
        }
      }
    }
    return out;
  },
};
