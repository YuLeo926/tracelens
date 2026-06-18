import { useCallback, useState } from "react";
import { parseTrace } from "../core/parse";
import type { ParsedTrace } from "../core/types";

interface Props {
  onLoad: (trace: ParsedTrace, label: string) => void;
  onError: (message: string) => void;
}

const SAMPLES = [
  {
    file: "research-agent.json",
    label: "Research agent",
    hint: "7 spans · 3 LLM · 2 tools",
  },
  {
    file: "tool-error.json",
    label: "Tool error + recovery",
    hint: "6 spans · 1 error",
  },
];

export function Loader({ onLoad, onError }: Props) {
  const [dragging, setDragging] = useState(false);

  const ingest = useCallback(
    (text: string, label: string) => {
      try {
        onLoad(parseTrace(JSON.parse(text)), label);
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
    <div className="mx-auto flex max-w-xl flex-col items-center gap-8 px-6 py-16 text-center">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl" style={{ color: "var(--text)" }}>
          See what your agent actually did.
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Drop in an OpenInference or OTel GenAI trace. Tracelens turns it into a
          readable call tree with timings, tokens, cost, and errors — all in your
          browser. Nothing is uploaded.
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
        <span className="text-sm" style={{ color: "var(--text)" }}>
          Drop a trace file here
        </span>
        <span className="text-[12px]" style={{ color: "var(--muted-2)" }}>
          or click to choose a .json file
        </span>
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>

      <div className="flex w-full flex-col gap-2">
        <span
          className="text-[11px] uppercase tracking-wider"
          style={{ color: "var(--muted-2)" }}
        >
          or open a sample
        </span>
        <div className="grid gap-2 sm:grid-cols-2">
          {SAMPLES.map((s) => (
            <button
              key={s.file}
              onClick={() => loadSample(s.file, s.label)}
              className="flex flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left hover:brightness-110"
              style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            >
              <span className="text-sm" style={{ color: "var(--text)" }}>
                {s.label}
              </span>
              <span className="mono text-[11px]" style={{ color: "var(--muted-2)" }}>
                {s.hint}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
