import { useState } from "react";
import type { ParsedTrace } from "./core/types";
import { Loader } from "./components/Loader";
import { Summary } from "./components/Summary";
import { TraceTree } from "./components/TraceTree";
import { SpanDetail } from "./components/SpanDetail";
import { Legend } from "./components/Legend";

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="3" fill="var(--accent)" />
      <line x1="22" y1="22" x2="27" y2="27" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const [trace, setTrace] = useState<ParsedTrace | null>(null);
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onLoad = (t: ParsedTrace, lbl: string) => {
    setTrace(t);
    setLabel(lbl);
    setSelectedId(t.roots[0]?.spanId ?? null);
    setError(null);
  };

  const reset = () => {
    setTrace(null);
    setSelectedId(null);
    setError(null);
    setLabel("");
  };

  const selected = selectedId ? (trace?.byId.get(selectedId) ?? null) : null;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between gap-4 border-b px-5 py-3"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          <span className="wordmark text-lg" style={{ color: "var(--text)" }}>
            tracelens
          </span>
          {label && (
            <span className="mono truncate text-[12px]" style={{ color: "var(--muted-2)" }}>
              · {label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Legend />
          {trace && (
            <button
              onClick={reset}
              className="rounded-md border px-3 py-1.5 text-[12px] hover:brightness-110"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              New trace
            </button>
          )}
        </div>
      </header>

      {error && (
        <div
          className="border-b px-5 py-2 text-sm"
          style={{
            borderColor: "var(--border)",
            background: "rgba(240,85,107,0.08)",
            color: "var(--error)",
          }}
        >
          {error}
        </div>
      )}

      {!trace ? (
        <div className="flex-1 overflow-auto">
          <Loader onLoad={onLoad} onError={setError} />
        </div>
      ) : (
        <>
          <div
            className="border-b"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <Summary summary={trace.summary} />
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section
              className="min-h-0 overflow-auto border-r"
              style={{ borderColor: "var(--border)" }}
            >
              <TraceTree trace={trace} selectedId={selectedId} onSelect={setSelectedId} />
            </section>
            <aside
              className="min-h-0 overflow-auto"
              style={{ background: "var(--panel-2)" }}
            >
              {selected ? (
                <SpanDetail node={selected} />
              ) : (
                <div className="p-6 text-sm" style={{ color: "var(--muted)" }}>
                  Select a span to inspect it.
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
