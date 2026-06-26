import { useEffect, useState } from "react";
import { scanTraceFiles, readHead, readTail } from "../lib/folderWatch";
import { extractConversationMeta } from "../core/conversationMeta";
import { startMsOf, modelOf, extractTokens } from "../core/folderStats";
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
  tokensOut?: number;
}

interface Result {
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
}

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
    setLoading(true);
    setError(false);
    setConversations([]);

    (async () => {
      let files;
      try {
        files = await scanTraceFiles(dir);
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      for (const f of files) {
        if (cancelled) return;
        let row: Conversation | null = null;
        try {
          const head = await readHead(f.handle);
          if (!isTraceFileHead(f.name, head)) continue;
          row = {
            name: f.name,
            lastModified: f.lastModified,
            sizeBytes: f.sizeBytes,
            ...extractConversationMeta(head),
            startMs: startMsOf(head),
            model: modelOf(head),
          };
          try {
            const tail = await readTail(f.handle);
            const tokens = extractTokens(tail);
            row.tokensIn = tokens?.tokensIn;
            row.cachedIn = tokens?.cachedIn;
            row.cacheWriteIn = tokens?.cacheWriteIn;
            row.tokensOut = tokens?.tokensOut;
          } catch {
            /* keep metadata-only row */
          }
        } catch {
          continue;
        }
        if (cancelled) return;
        if (row) setConversations((prev) => [...prev, row]);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [dir]);

  return { conversations, loading, error };
}
