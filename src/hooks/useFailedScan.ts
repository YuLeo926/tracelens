import { useEffect, useMemo, useState } from "react";
import { parseTraceText } from "../core/parse";
import { readFileText } from "../lib/folderWatch";
import { cacheKey, loadFailedCache, saveFailedCache, MAX_SCAN_BYTES } from "../lib/failedScan";
import type { Conversation } from "./useConversations";

// A run's error-span count once scanned, or a transient UI state.
export type RunErrors = number | "pending" | "skipped" | "unknown";

export interface ErrorScanResult {
  errors: Map<string, RunErrors>;
  done: number;
  total: number;
}

export function useFailedScan(
  dir: FileSystemDirectoryHandle | null,
  conversations: Conversation[],
): ErrorScanResult {
  const [errors, setErrors] = useState<Map<string, RunErrors>>(new Map());
  const [done, setDone] = useState(0);

  // Re-run only when the file set (name+mtime+size) changes, not when titles fill in.
  const signature = useMemo(
    () => conversations.map((c) => `${c.name}:${c.lastModified}:${c.sizeBytes}`).join("|"),
    [conversations],
  );

  useEffect(() => {
    if (!dir || conversations.length === 0) {
      setErrors(new Map());
      setDone(0);
      return;
    }
    let cancelled = false;
    const cache = loadFailedCache();
    const next = new Map<string, RunErrors>();
    const toScan: Conversation[] = [];

    for (const c of conversations) {
      const key = cacheKey(c.name, c.lastModified);
      if (typeof cache[key] === "number") next.set(c.name, cache[key]);
      else if (c.sizeBytes > MAX_SCAN_BYTES) next.set(c.name, "skipped");
      else {
        next.set(c.name, "pending");
        toScan.push(c);
      }
    }
    setErrors(new Map(next));
    setDone(conversations.length - toScan.length);

    (async () => {
      for (const c of toScan) {
        if (cancelled) return;
        let result: RunErrors;
        try {
          const text = await readFileText(dir, c.name);
          result = text === null ? "unknown" : parseTraceText(text).summary.errors;
        } catch {
          result = "unknown";
        }
        if (cancelled) return;
        next.set(c.name, result);
        setErrors(new Map(next));
        setDone((d) => d + 1);
        if (typeof result === "number") {
          cache[cacheKey(c.name, c.lastModified)] = result;
          saveFailedCache(cache);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, signature]);

  return { errors, done, total: conversations.length };
}
