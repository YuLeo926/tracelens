import { createHash } from "node:crypto";

const OPAQUE_EVENT_PREFIX = "evt_";

export function publicEventId(sessionId: string, rawEventId: string): string {
  const digest = createHash("sha256")
    .update("tracelens-mcp-event-v1\0")
    .update(sessionId)
    .update("\0")
    .update(rawEventId)
    .digest("hex");
  return `${OPAQUE_EVENT_PREFIX}${digest}`;
}
