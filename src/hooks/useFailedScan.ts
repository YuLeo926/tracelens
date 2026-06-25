import { useEffect, useMemo, useState } from "react";
import { parseTraceText } from "../core/parse";
import { readFileText } from "../lib/folderWatch";
import {
  cacheKey, loadFailedCache, saveFailedCache, MAX_SCAN_BYTES, type FailedState,
} from "../lib/failedScan";
import type { Conversation } from "./useConversations";

export type ScanState = FailedState | "pending";

export interface FailedScanResult {
  states: Map<string, ScanState>;
  done: number;
  total: number;
}

export function useFailedScan(
  dir: FileSystemDirectoryHandle | null,
  conversations: Conversation[],
): FailedScanResult {
  const [states, setStates] = useState<Map<string, ScanState>>(new Map());
  const [done, setDone] = useState(0);

  // Re-run only when the file set (name+mtime+size) changes, not when titles fill in.
  const signature = useMemo(
    () => conversations.map((c) => `${c.name}:${c.lastModified}:${c.sizeBytes}`).join("|"),
    [conversations],
  );

  useEffect(() => {
    if (!dir || conversations.length === 0) {
      setStates(new Map());
      setDone(0);
      return;
    }
    let cancelled = false;
    const cache = loadFailedCache();
    const next = new Map<string, ScanState>();
    const toScan: Conversation[] = [];

    for (const c of conversations) {
      const key = cacheKey(c.name, c.lastModified);
      if (cache[key]) next.set(c.name, cache[key]);
      else if (c.sizeBytes > MAX_SCAN_BYTES) {
        next.set(c.name, "skipped");
        cache[key] = "skipped";
      } else {
        next.set(c.name, "pending");
        toScan.push(c);
      }
    }
    setStates(new Map(next));
    setDone(conversations.length - toScan.length);
    saveFailedCache(cache);

    (async () => {
      for (const c of toScan) {
        if (cancelled) return;
        let state: ScanState;
        try {
          const text = await readFileText(dir, c.name);
          if (text === null) {
            state = "unknown";
          } else {
            state = parseTraceText(text).summary.errors > 0 ? "failed" : "ok";
          }
        } catch {
          state = "unknown";
        }
        if (cancelled) return;
        next.set(c.name, state);
        setStates(new Map(next));
        setDone((d) => d + 1);
        if (state === "ok" || state === "failed") {
          cache[cacheKey(c.name, c.lastModified)] = state;
          saveFailedCache(cache);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, signature]);

  return { states, done, total: conversations.length };
}
