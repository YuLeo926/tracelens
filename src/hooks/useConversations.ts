import { useEffect, useState } from "react";
import { scanTraceFiles, readHead, readTail } from "../lib/folderWatch";
import { extractConversationMeta } from "../core/conversationMeta";
import { startMsOf, modelOf, extractTokens } from "../core/folderStats";

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
      setConversations(
        files.map((f) => ({ name: f.name, lastModified: f.lastModified, sizeBytes: f.sizeBytes })),
      );
      for (const f of files) {
        if (cancelled) return;
        let extra: Partial<Conversation> = {};
        try {
          const head = await readHead(f.handle);
          const tail = await readTail(f.handle);
          const tokens = extractTokens(tail);
          extra = {
            ...extractConversationMeta(head),
            startMs: startMsOf(head),
            model: modelOf(head),
            tokensIn: tokens?.tokensIn,
            cachedIn: tokens?.cachedIn,
            tokensOut: tokens?.tokensOut,
          };
        } catch {
          /* leave fields undefined for this row */
        }
        if (cancelled) return;
        setConversations((prev) => prev.map((c) => (c.name === f.name ? { ...c, ...extra } : c)));
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [dir]);

  return { conversations, loading, error };
}
