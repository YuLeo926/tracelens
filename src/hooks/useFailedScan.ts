import { useEffect, useMemo, useState } from "react";
import { parseTraceText } from "../core/parse";
import { readFileText } from "../lib/folderWatch";
import { cacheKey, loadFailedCache, saveFailedCache, MAX_SCAN_BYTES } from "../lib/failedScan";
import type { Conversation } from "./useConversations";
import { buildRunFacts } from "../core/session/facts";
import { inspectSessionSource } from "../core/session/source";
import type { SessionSignal } from "../core/session/types";

// A run's error-span count once scanned, or a transient UI state.
export type RunErrors = number | "pending" | "skipped" | "unknown";

export interface ErrorScanResult {
  errors: Map<string, RunErrors>;
  signals: Map<string, SessionSignal[]>;
  done: number;
  total: number;
}

export function useFailedScan(
  dir: FileSystemDirectoryHandle | null,
  conversations: Conversation[],
): ErrorScanResult {
  const [errors, setErrors] = useState<Map<string, RunErrors>>(new Map());
  const [done, setDone] = useState(0);
  const [signals, setSignals] = useState<Map<string, SessionSignal[]>>(new Map());

  // Re-run only when the file set (name+mtime+size) changes, not when titles fill in.
  const signature = useMemo(
    () => conversations.map((c) => `${c.name}:${c.lastModified}:${c.sizeBytes}`).join("|"),
    [conversations],
  );

  useEffect(() => {
    if (!dir || conversations.length === 0) {
      setErrors(new Map());
      setDone(0);
      setSignals(new Map());
      return;
    }
    let cancelled = false;
    const cache = loadFailedCache();
    const folderScope = dir.name || "(folder)";
    const next = new Map<string, RunErrors>();
    const nextSignals = new Map<string, SessionSignal[]>();
    const toScan: Conversation[] = [];

    for (const c of conversations) {
      const key = cacheKey(folderScope, c.name, c.lastModified, c.sizeBytes);
      if (cache[key]) {
        next.set(c.name, cache[key].errors);
        nextSignals.set(c.name, cache[key].signals);
      }
      else if (c.sizeBytes > MAX_SCAN_BYTES) next.set(c.name, "skipped");
      else {
        next.set(c.name, "pending");
        toScan.push(c);
      }
    }
    setErrors(new Map(next));
    setSignals(new Map(nextSignals));
    setDone(conversations.length - toScan.length);

    (async () => {
      for (const c of toScan) {
        if (cancelled) return;
        let result: RunErrors;
        try {
          const text = await readFileText(dir, c.name);
          if (text === null) result = "unknown";
          else {
            const trace = parseTraceText(text);
            const lifecycle = inspectSessionSource(c.name, text, "")?.lifecycle ?? "unknown";
            const facts = buildRunFacts(trace, lifecycle);
            result = facts.totals.errors;
            nextSignals.set(c.name, facts.signals ?? []);
          }
        } catch {
          result = "unknown";
        }
        if (cancelled) return;
        next.set(c.name, result);
        setErrors(new Map(next));
        setSignals(new Map(nextSignals));
        setDone((d) => d + 1);
        if (typeof result === "number") {
          cache[cacheKey(folderScope, c.name, c.lastModified, c.sizeBytes)] = { errors: result, signals: nextSignals.get(c.name) ?? [] };
          saveFailedCache(cache);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, signature]);

  return { errors, signals, done, total: conversations.length };
}
