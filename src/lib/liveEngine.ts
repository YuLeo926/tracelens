import type { ParsedTrace } from "../core/types";
import { parseTraceText } from "../core/parse";

/** Where live bytes come from. Implemented by folderWatch; faked in tests. */
export interface LiveSource {
  /** Candidate trace files in the folder, NEWEST first. */
  listCandidates(): Promise<Array<{ name: string; lastModified: number }>>;
  /** Read one file's current text + mtime, or null if it is gone. */
  read(name: string): Promise<{ lastModified: number; text: string } | null>;
}

export interface LiveUpdate {
  trace: ParsedTrace;
  label: string; // the file name (relative path)
  source: string; // raw text, for share/export
}

/**
 * What the watcher is doing right now, so the UI always has something to show:
 * - scanning: looking for a readable trace
 * - live: following a parseable file
 * - empty: the folder has no .json/.jsonl files at all
 * - no-trace: files exist but none parse as a trace (e.g. only config JSON)
 * - stalled: was live, but the current file keeps failing to read (mid-write)
 * - error: the folder itself could not be read (permission, removed)
 */
export type LiveStatus = "scanning" | "live" | "empty" | "no-trace" | "stalled" | "error";

export interface LiveCallbacks {
  onUpdate(update: LiveUpdate): void;
  onStatus(status: LiveStatus): void;
}

export interface LiveWatcher {
  init(): Promise<void>;
  fastTick(): Promise<void>;
  slowTick(): Promise<void>;
  currentFile(): string | null;
}

const TROUBLE_THRESHOLD = 3;

export function createLiveWatcher(
  source: LiveSource,
  cb: LiveCallbacks,
  opts: { lockTo?: string } = {},
): LiveWatcher {
  const locked = opts.lockTo ?? null;
  let current: string | null = locked;
  let lastMtime = -1;
  let failures = 0;

  const parse = (text: string): ParsedTrace | null => {
    try {
      return parseTraceText(text);
    } catch {
      return null; // not a trace, or a half-written read
    }
  };

  const emit = (name: string, mtime: number, text: string, trace: ParsedTrace) => {
    current = name;
    lastMtime = mtime;
    failures = 0;
    cb.onStatus("live");
    cb.onUpdate({ trace, label: name, source: text });
  };

  // Adopt the newest candidate that actually parses. When onlyNewer is true we
  // stop once we reach the file we're already following (nothing newer to switch
  // to), which keeps the common "still the newest run" case cheap.
  const adoptNewestParseable = async (onlyNewer: boolean): Promise<void> => {
    let candidates: Array<{ name: string; lastModified: number }>;
    try {
      candidates = await source.listCandidates();
    } catch {
      cb.onStatus("error");
      return;
    }
    if (candidates.length === 0) {
      if (!current) cb.onStatus("empty");
      return;
    }
    for (const c of candidates) {
      if (onlyNewer && current && c.name === current) return; // current is newest parseable
      const file = await source.read(c.name);
      if (!file) continue;
      const trace = parse(file.text);
      if (trace) {
        emit(c.name, file.lastModified, file.text, trace);
        return;
      }
    }
    if (!current) cb.onStatus("no-trace"); // files exist, none parse yet
  };

  const noteFailure = () => {
    failures += 1;
    if (failures >= TROUBLE_THRESHOLD) cb.onStatus("stalled");
  };

  // Reading + parsing a large rollout can take longer than the tick interval.
  // Skip a tick if the previous one is still running so reads never pile up.
  let busy = false;
  const guard = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  };

  const pollCurrent = async (): Promise<void> => {
    if (!current) return;
    const file = await source.read(current);
    if (!file) {
      noteFailure();
      return;
    }
    if (file.lastModified === lastMtime) return; // no change
    const trace = parse(file.text);
    if (trace) emit(current, file.lastModified, file.text, trace);
    else noteFailure();
  };

  return {
    init() {
      return guard(async () => {
        cb.onStatus("scanning");
        if (locked) await pollCurrent();
        else await adoptNewestParseable(false);
      });
    },

    fastTick() {
      return guard(pollCurrent);
    },

    slowTick() {
      if (locked) return Promise.resolve(); // locked: never switch away
      return guard(() => adoptNewestParseable(current !== null));
    },

    currentFile() {
      return current;
    },
  };
}
