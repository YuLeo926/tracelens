import { useCallback, useEffect, useRef, useState } from "react";
import { createLiveWatcher, type LiveUpdate } from "../lib/liveEngine";
import { createFolderSource, baseName } from "../lib/folderWatch";

const FAST_MS = 1500;
const SLOW_MS = 5000;

export type LiveState = "idle" | "watching" | "empty" | "trouble";

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
    setState("watching");

    const source = createFolderSource(dir);
    const watcher = createLiveWatcher(source, {
      onUpdate: (u) => {
        setCurrentFile(baseName(u.label));
        setState("watching");
        onUpdateRef.current(u);
      },
      onEmpty: () => setState("empty"),
      onTrouble: () => setState("trouble"),
      onRecovered: () => setState("watching"),
    });

    void watcher.init();
    timers.current.push(window.setInterval(() => void watcher.fastTick(), FAST_MS));
    timers.current.push(window.setInterval(() => void watcher.slowTick(), SLOW_MS));
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { state, folderName, currentFile, start, stop };
}
