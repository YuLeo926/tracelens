import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";
import { nativeAdapter } from "./native";

// More specific adapters go first; the native catch-all is last.
export const ADAPTERS: TraceAdapter[] = [nativeAdapter];

/** Detect the input format and flatten it to LooseSpan[]. */
export function extractSpansAuto(json: unknown): LooseSpan[] {
  for (const adapter of ADAPTERS) {
    if (adapter.detect(json)) return adapter.toLooseSpans(json);
  }
  return [];
}
