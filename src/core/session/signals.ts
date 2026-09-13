import type { RunNode } from "../types";
import type { SessionLifecycle, SessionSignal } from "./types";

export const SIGNAL_LABELS: Record<SessionSignal, string> = {
  tool_errors: "Tool errors",
  repeated_failures: "Repeated failures",
  recovered: "Retry succeeded",
  stopped: "Stopped or failed",
  active: "Active",
  unknown: "Completion unknown",
};

export function runSignals(lifecycle: SessionLifecycle, groups: RunNode[][]): SessionSignal[] {
  const signals = new Set<SessionSignal>();
  for (const nodes of groups) {
    let streak = 0;
    for (const node of nodes) {
      if (node.status === "error") {
        signals.add("tool_errors");
        if (++streak >= 2) signals.add("repeated_failures");
      } else if (node.status === "ok") {
        if (streak > 0) signals.add("recovered");
        streak = 0;
      }
    }
  }
  if (lifecycle === "failed") signals.add("stopped");
  else if (lifecycle === "active") signals.add("active");
  else if (lifecycle === "unknown") signals.add("unknown");
  return [...signals];
}
