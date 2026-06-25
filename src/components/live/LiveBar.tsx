import type { LiveState } from "../../hooks/useLiveWatch";

interface Props {
  state: LiveState;
  folderName: string;
  currentFile: string;
  onStop: () => void;
}

const MESSAGE: Record<LiveState, string> = {
  idle: "",
  scanning: "Scanning…",
  live: "Live",
  empty: "No session files in this folder",
  "no-trace": "No readable trace yet",
  stalled: "Waiting for a complete write…",
  error: "Couldn't read that folder",
};

export function LiveBar({ state, folderName, currentFile, onStop }: Props) {
  const live = state === "live";
  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-1.5 text-[12px]">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background: live ? "var(--kind-agent)" : "var(--faint)",
          animation: live ? "live-pulse 1.4s ease-in-out infinite" : "none",
        }}
      />
      <span className="text-text">{MESSAGE[state] || "Live"}</span>
      {folderName && (
        <span className="text-muted">
          · watching <span className="mono text-faint">{folderName}</span>
          {currentFile && (
            <>
              {" · "}
              <span className="mono text-faint">{currentFile}</span>
            </>
          )}
        </span>
      )}
      <button
        type="button"
        onClick={onStop}
        className="ml-auto rounded border border-border px-2 py-0.5 text-text hover:border-accent"
      >
        Stop
      </button>
    </div>
  );
}
