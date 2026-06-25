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

/** Read just the first `maxBytes` of a file (cheap title peek for big logs). */
export async function readHead(handle: FileSystemFileHandle, maxBytes = 262144): Promise<string> {
  const file = await handle.getFile();
  return file.slice(0, maxBytes).text();
}

export interface TraceFileRef {
  name: string; // relative path
  lastModified: number;
  handle: FileSystemFileHandle;
}

/** Trace files in the folder, NEWEST first, capped at `limit`, with handles. */
export async function scanTraceFiles(
  dir: FileSystemDirectoryHandle,
  limit = 300,
): Promise<TraceFileRef[]> {
  const handles = new Map<string, FileSystemFileHandle>();
  const meta: Array<{ name: string; lastModified: number }> = [];
  await collect(dir, "", 0, handles, meta);
  meta.sort((a, b) => b.lastModified - a.lastModified || (a.name > b.name ? -1 : 1));
  return meta.slice(0, limit).map((m) => ({
    name: m.name,
    lastModified: m.lastModified,
    handle: handles.get(m.name)!,
  }));
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

/** Resolve a relative path ("2026/06/25/rollout-x.jsonl") to a file handle. */
async function resolveFileHandle(
  dir: FileSystemDirectoryHandle,
  relPath: string,
): Promise<FileSystemFileHandle | null> {
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let d = dir as unknown as {
    getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>;
    getFileHandle(name: string): Promise<FileSystemFileHandle>;
  };
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      d = (await d.getDirectoryHandle(parts[i])) as unknown as typeof d;
    }
    return await d.getFileHandle(parts[parts.length - 1]);
  } catch {
    return null;
  }
}

/** Build a LiveSource backed by a picked directory handle. */
export function createFolderSource(dir: FileSystemDirectoryHandle): LiveSource {
  const handles = new Map<string, FileSystemFileHandle>();

  return {
    async listCandidates() {
      const next = new Map<string, FileSystemFileHandle>();
      const meta: Array<{ name: string; lastModified: number }> = [];
      await collect(dir, "", 0, next, meta);
      handles.clear();
      for (const [k, v] of next) handles.set(k, v);
      // Newest first; ties broken by name (desc) for stable ordering.
      meta.sort((a, b) => b.lastModified - a.lastModified || (a.name > b.name ? -1 : 1));
      return meta;
    },

    // Resolve the handle directly so read works in locked mode too (where
    // listCandidates may never have run to populate the handle cache).
    async read(name) {
      let handle = handles.get(name);
      if (!handle) {
        const resolved = await resolveFileHandle(dir, name);
        if (resolved) {
          handle = resolved;
          handles.set(name, resolved);
        }
      }
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
