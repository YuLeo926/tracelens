import { useEffect, useState } from "react";
import { scanTraceFiles, readHead, readTokenTotals } from "../lib/folderWatch";
import { extractConversationMeta } from "../core/conversationMeta";
import { startMsOf, modelOf } from "../core/folderStats";
import { isTraceFileHead } from "../core/traceSniff";

export interface Conversation {
  name: string;
  lastModified: number;
  sizeBytes: number;
  title?: string;
  project?: string;
  startMs?: number;
  model?: string;
  tokensIn?: number;
  cachedIn?: number;
  cacheWriteIn?: number;
  cacheWrite1hIn?: number;
  tokensOut?: number;
}

interface Result {
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
}

const REFRESH_MS = 5_000;

/** List the folder's conversations, filling in title/project/tokens progressively. */
export function useConversations(dir: FileSystemDirectoryHandle | null): Result {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!dir) {
      setConversations([]);
      setLoading(false);
      setError(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let initial = true;
    const cache = new Map<string, { lastModified: number; sizeBytes: number; row: Conversation | null }>();
    setLoading(true);
    setError(false);
    setConversations([]);

    async function refresh() {
      try {
        const files = await scanTraceFiles(dir!);
        if (cancelled) return;
        const rows: Conversation[] = [];
        const names = new Set(files.map((file) => file.name));
        for (const name of cache.keys()) {
          if (!names.has(name)) cache.delete(name);
        }
        for (const f of files) {
          if (cancelled) return;
          const previous = cache.get(f.name);
          let row: Conversation | null = null;
          if (previous && previous.lastModified === f.lastModified && previous.sizeBytes === f.sizeBytes) {
            row = previous.row;
          } else {
            cache.delete(f.name);
            try {
              const head = await readHead(f.handle);
              if (cancelled) return;
              if (isTraceFileHead(f.name, head)) {
                row = {
                  name: f.name,
                  lastModified: f.lastModified,
                  sizeBytes: f.sizeBytes,
                  ...extractConversationMeta(head),
                  startMs: startMsOf(head),
                  model: modelOf(head),
                };
                const tokens = await readTokenTotals(f.handle);
                if (tokens) Object.assign(row, tokens);
              }
              cache.set(f.name, { lastModified: f.lastModified, sizeBytes: f.sizeBytes, row });
            } catch {
              // Keep available metadata, but retry failed reads on the next poll.
            }
          }
          if (cancelled) return;
          if (row) {
            rows.push(row);
            if (initial) setConversations([...rows]);
          }
        }
        setConversations(rows);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) {
          initial = false;
          setLoading(false);
          timer = setTimeout(() => { void refresh(); }, REFRESH_MS);
        }
      }
    }
    void refresh();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dir]);

  return { conversations, loading, error };
}
