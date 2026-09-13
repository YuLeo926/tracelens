import type { ParsedTrace } from "../types";
import { buildRunFacts } from "./facts";
import { inspectSessionSource } from "./source";
import type { SessionSummary } from "./types";

/** Browser-only presentation metadata; never a repository ID or an annotation key. */
export function browserSessionSummary(trace: ParsedTrace, label: string, source: string): SessionSummary {
  const inspected = inspectSessionSource(label, source, "");
  const lifecycle = inspected?.lifecycle ?? "unknown";
  return {
    id: "browser-preview", title: inspected?.title ?? label, provider: inspected?.provider ?? "generic",
    project: inspected?.project, lifecycle, startMs: trace.summary.startMs,
    modifiedAt: trace.summary.endMs, sizeBytes: new TextEncoder().encode(source).byteLength,
    match: "exact", selectionReason: "Opened in this browser.", facts: buildRunFacts(trace, lifecycle),
  };
}
