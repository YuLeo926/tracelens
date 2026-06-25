import { useEffect, useState } from "react";
import { scanTraceFiles, readHead } from "../lib/folderWatch";
import { extractConversationMeta } from "../core/conversationMeta";

export interface Conversation {
  name: string;
  lastModified: number;
  title?: string;
  project?: string;
}

interface Result {
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
}

/** List the folder's conversations, filling in titles progressively. */
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
      // Show the list immediately (time is free); titles fill in below.
      setConversations(files.map((f) => ({ name: f.name, lastModified: f.lastModified })));
      for (const f of files) {
        if (cancelled) return;
        let meta = {};
        try {
          meta = extractConversationMeta(await readHead(f.handle));
        } catch {
          /* leave title/project undefined for this row */
        }
        if (cancelled) return;
        setConversations((prev) =>
          prev.map((c) => (c.name === f.name ? { ...c, ...meta } : c)),
        );
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [dir]);

  return { conversations, loading, error };
}
