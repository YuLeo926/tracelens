import type { LiveState } from "../../hooks/useLiveWatch";
import { ThemeToggle } from "../shell/ThemeToggle";

interface Props {
  state: LiveState;
  folderName: string;
  onStop: () => void;
}

// Shown while live mode is active but no trace has been parsed yet, so picking a
// folder always gives feedback instead of looking like nothing happened.
const TITLE: Record<LiveState, string> = {
  idle: "",
  scanning: "Scanning for the latest run…",
  live: "Loading…",
  empty: "No session files found",
  "no-trace": "No readable trace found",
  stalled: "Waiting for the run to start…",
  error: "Couldn't read that folder",
};

const HINT: Record<LiveState, string> = {
  idle: "",
  scanning: "Looking through the folder for the most recent trace file.",
  live: "",
  empty: "This folder has no .json or .jsonl files. Pick the folder that holds your session files.",
  "no-trace":
    "Files were found, but none look like a supported trace. Point at the folder with your session logs — e.g. …/.codex/sessions or …/.claude/projects — or start a run.",
  stalled: "Waiting for a trace file to appear. As soon as a run writes one, it shows up here.",
  error:
    "The browser couldn't read that folder (it may be a protected system location). Try choosing a different folder.",
};

export function LiveStandby({ state, folderName, onStop }: Props) {
  const scanning = state === "scanning";
  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-panel px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background: "var(--kind-agent)",
              animation: scanning ? "live-pulse 1.4s ease-in-out infinite" : "none",
            }}
          />
          <span className="wordmark text-lg text-text">tracelens · live</span>
        </div>
        <ThemeToggle />
      </header>

      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl text-text">📡 {TITLE[state]}</h1>
        {folderName && (
          <p className="text-[12px] text-muted">
            watching <span className="mono text-faint">{folderName}</span>
          </p>
        )}
        <p className="text-sm leading-relaxed text-muted">{HINT[state]}</p>
        <button
          type="button"
          onClick={onStop}
          className="mt-2 rounded-lg border border-border bg-panel px-4 py-2 text-sm text-text hover:border-accent"
        >
          {state === "scanning" ? "Cancel" : "Choose another folder"}
        </button>
      </div>
    </div>
  );
}
