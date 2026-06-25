import type { LiveSource } from "./liveEngine";

// showDirectoryPicker is not in every TS DOM lib version; declare what we use.
declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

const TRACE_EXT = /\.(jsonl?|json)$/i;
const MAX_DEPTH = 6; // guard against pathological trees

export function supportsFolderWatch(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker();
  } catch {
    return null; // user cancelled
  }
}

/** Last path segment, for display. */
export function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Recurse the directory, collecting trace files keyed by relative path. */
async function collect(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  depth: number,
  out: Map<string, FileSystemFileHandle>,
  meta: Array<{ name: string; lastModified: number }>,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  // values() is an async iterator on the handle.
  for await (const entry of (dir as unknown as {
    values(): AsyncIterableIterator<FileSystemHandle>;
  }).values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await collect(entry as FileSystemDirectoryHandle, path, depth + 1, out, meta);
    } else if (TRACE_EXT.test(entry.name)) {
      const file = await (entry as FileSystemFileHandle).getFile();
      out.set(path, entry as FileSystemFileHandle);
      meta.push({ name: path, lastModified: file.lastModified });
    }
  }
}

/** Build a LiveSource backed by a picked directory handle. */
export function createFolderSource(dir: FileSystemDirectoryHandle): LiveSource {
  let handles = new Map<string, FileSystemFileHandle>();

  return {
    async listCandidates() {
      const next = new Map<string, FileSystemFileHandle>();
      const meta: Array<{ name: string; lastModified: number }> = [];
      await collect(dir, "", 0, next, meta);
      handles = next;
      // Newest first; ties broken by name (desc) for stable ordering.
      meta.sort((a, b) => b.lastModified - a.lastModified || (a.name > b.name ? -1 : 1));
      return meta;
    },

    async read(name) {
      const handle = handles.get(name);
      if (!handle) return null;
      try {
        const file = await handle.getFile();
        return { lastModified: file.lastModified, text: await file.text() };
      } catch {
        return null;
      }
    },
  };
}
