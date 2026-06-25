import { useCallback, useEffect, useRef, useState } from "react";
import { createLiveWatcher, type LiveUpdate, type LiveStatus } from "../lib/liveEngine";
import { createFolderSource, baseName } from "../lib/folderWatch";

const FAST_MS = 1500;
const SLOW_MS = 5000;

export type LiveState = "idle" | LiveStatus;

interface Options {
  onUpdate: (update: LiveUpdate) => void;
}

export function useLiveWatch({ onUpdate }: Options) {
  const [state, setState] = useState<LiveState>("idle");
  const [folderName, setFolderName] = useState("");
  const [currentFile, setCurrentFile] = useState("");
  const timers = useRef<number[]>([]);
  // Keep the latest onUpdate without restarting the watcher.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const stop = useCallback(() => {
    timers.current.forEach((t) => clearInterval(t));
    timers.current = [];
    setState("idle");
    setFolderName("");
    setCurrentFile("");
  }, []);

  const start = useCallback((dir: FileSystemDirectoryHandle) => {
    timers.current.forEach((t) => clearInterval(t));
    timers.current = [];
    setFolderName(dir.name);
    setCurrentFile("");
    setState("scanning");

    const source = createFolderSource(dir);
    const watcher = createLiveWatcher(source, {
      onUpdate: (u) => {
        setCurrentFile(baseName(u.label));
        onUpdateRef.current(u);
      },
      onStatus: (s) => setState(s),
    });

    // init can reject if the folder can't be enumerated at all — surface it.
    watcher.init().catch(() => setState("error"));
    timers.current.push(window.setInterval(() => void watcher.fastTick(), FAST_MS));
    timers.current.push(window.setInterval(() => void watcher.slowTick(), SLOW_MS));
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { state, folderName, currentFile, start, stop };
}
