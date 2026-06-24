import type { ParsedTrace } from "../core/types";
import { parseTraceText } from "../core/parse";

/** Where live bytes come from. Implemented by folderWatch; faked in tests. */
export interface LiveSource {
  /** Newest trace file in the folder (name = relative path), or null if none. */
  scanNewest(): Promise<{ name: string; lastModified: number } | null>;
  /** Read one file's current text + mtime, or null if it is gone. */
  read(name: string): Promise<{ lastModified: number; text: string } | null>;
}

export interface LiveUpdate {
  trace: ParsedTrace;
  label: string; // the file name (relative path)
  source: string; // raw text, for share/export
}

export interface LiveCallbacks {
  onUpdate(update: LiveUpdate): void;
  onEmpty(): void;
  onTrouble(consecutiveFailures: number): void;
  onRecovered(): void;
}

export interface LiveWatcher {
  init(): Promise<void>;
  fastTick(): Promise<void>;
  slowTick(): Promise<void>;
  currentFile(): string | null;
}

const TROUBLE_THRESHOLD = 3;

export function createLiveWatcher(source: LiveSource, cb: LiveCallbacks): LiveWatcher {
  let current: string | null = null;
  let lastMtime = -1;
  let failures = 0;
  let troubled = false;

  // Parse `text` best-effort and emit. Returns true on success.
  const tryEmit = (name: string, mtime: number, text: string): boolean => {
    try {
      const trace = parseTraceText(text);
      lastMtime = mtime;
      failures = 0;
      if (troubled) {
        troubled = false;
        cb.onRecovered();
      }
      cb.onUpdate({ trace, label: name, source: text });
      return true;
    } catch {
      failures += 1;
      if (failures >= TROUBLE_THRESHOLD && !troubled) {
        troubled = true;
      }
      cb.onTrouble(failures);
      return false;
    }
  };

  const adopt = async (name: string) => {
    current = name;
    lastMtime = -1;
    const file = await source.read(name);
    if (file) tryEmit(name, file.lastModified, file.text);
  };

  return {
    async init() {
      const newest = await source.scanNewest();
      if (!newest) {
        cb.onEmpty();
        return;
      }
      await adopt(newest.name);
    },

    async fastTick() {
      if (!current) return;
      const file = await source.read(current);
      if (!file) {
        // File vanished; let the next slow tick re-scan.
        failures += 1;
        if (failures >= TROUBLE_THRESHOLD) {
          troubled = true;
          cb.onTrouble(failures);
        }
        return;
      }
      if (file.lastModified === lastMtime) return; // no change
      tryEmit(current, file.lastModified, file.text);
    },

    async slowTick() {
      const newest = await source.scanNewest();
      if (!newest) {
        cb.onEmpty();
        return;
      }
      if (newest.name !== current) {
        await adopt(newest.name);
      }
    },

    currentFile() {
      return current;
    },
  };
}
