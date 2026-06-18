import { useCallback, useState } from "react";
import { parseTrace } from "../core/parse";
import type { ParsedTrace } from "../core/types";
import { ThemeToggle } from "./shell/ThemeToggle";

interface Props {
  onLoad: (trace: ParsedTrace, label: string, source: string) => void;
  onError: (message: string) => void;
  error?: string | null;
}

const SAMPLES = [
  { file: "research-agent.json", label: "Research agent", hint: "7 spans · 3 LLM · 2 tools" },
  { file: "tool-error.json", label: "Tool error + recovery", hint: "6 spans · 1 error" },
  { file: "otlp-trace.json", label: "OpenTelemetry (OTLP)", hint: "4 spans · OTLP format" },
];

export function Loader({ onLoad, onError, error }: Props) {
  const [dragging, setDragging] = useState(false);

  const ingest = useCallback(
    (text: string, label: string) => {
      try {
        onLoad(parseTrace(JSON.parse(text)), label, text);
      } catch (err) {
        onError(
          err instanceof Error
            ? err.message
            : "That file is not valid JSON. Export your trace as JSON and try again.",
        );
      }
    },
    [onLoad, onError],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      file
        .text()
        .then((t) => ingest(t, file.name))
        .catch(() => onError("Could not read that file."));
    },
    [ingest, onError],
  );

  const loadSample = useCallback(
    (file: string, label: string) => {
      fetch(`${import.meta.env.BASE_URL}samples/${file}`)
        .then((r) => r.text())
        .then((t) => ingest(t, label))
        .catch(() => onError("Could not load the sample."));
    },
    [ingest, onError],
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-panel px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: "linear-gradient(135deg,var(--kind-agent),var(--kind-retriever))" }}
          >
            <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="14" cy="14" r="8.5" fill="none" stroke="#fff" strokeWidth="2.6" />
              <line x1="20" y1="20" x2="26" y2="26" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
            </svg>
          </div>
          <span className="wordmark text-lg text-text">tracelens</span>
        </div>
        <ThemeToggle />
      </header>

      {error && (
        <div
          className="border-b border-border px-5 py-2 text-sm text-error"
          style={{ background: "color-mix(in srgb, var(--error) 8%, transparent)" }}
        >
          {error}
        </div>
      )}

      <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl text-text">See what your agent actually did.</h1>
          <p className="text-sm leading-relaxed text-muted">
            Drop in an OpenInference or OTel GenAI trace. Tracelens turns it into a readable
            call tree with timings, tokens, cost, and errors — all in your browser. Nothing is
            uploaded.
          </p>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10"
          style={{
            borderColor: dragging ? "var(--accent)" : "var(--border)",
            background: dragging ? "var(--elev)" : "var(--panel)",
          }}
        >
          <span className="text-sm text-text">Drop a trace file here</span>
          <span className="text-[12px] text-faint">or click to choose a .json file</span>
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>

        <div className="flex w-full flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-faint">or open a sample</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {SAMPLES.map((s) => (
              <button
                key={s.file}
                onClick={() => loadSample(s.file, s.label)}
                className="flex flex-col items-start gap-0.5 rounded-lg border border-border bg-panel px-4 py-3 text-left hover:border-accent"
              >
                <span className="text-sm text-text">{s.label}</span>
                <span className="mono text-[11px] text-faint">{s.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
