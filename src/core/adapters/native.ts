import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

/** The default format: a bare array of spans, or { spans: [...] }, or { data: [...] }. */
export const nativeAdapter: TraceAdapter = {
  id: "native",
  label: "Span array / OpenInference",
  detect(json) {
    if (Array.isArray(json)) return true;
    if (json && typeof json === "object") {
      const obj = json as Record<string, unknown>;
      return Array.isArray(obj.spans) || Array.isArray(obj.data);
    }
    return false;
  },
  toLooseSpans(json) {
    if (Array.isArray(json)) return json as LooseSpan[];
    if (json && typeof json === "object") {
      const obj = json as Record<string, unknown>;
      if (Array.isArray(obj.spans)) return obj.spans as LooseSpan[];
      if (Array.isArray(obj.data)) return obj.data as LooseSpan[];
    }
    return [];
  },
};
