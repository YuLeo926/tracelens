import { useState } from "react";
import type { ParsedTrace } from "./core/types";
import { ThemeProvider } from "./theme/ThemeProvider";
import { Loader } from "./components/Loader";
import { AppShell } from "./components/shell/AppShell";
import { TreeView } from "./components/views/TreeView/TreeView";
import { FlamegraphView } from "./components/views/FlamegraphView";
import { DiffView } from "./components/views/DiffView";
import { SpanDetail } from "./components/detail/SpanDetail";
import { DEFAULT_VIEW, type ViewId } from "./lib/views";

export default function App() {
  const [trace, setTrace] = useState<ParsedTrace | null>(null);
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW);
  const [error, setError] = useState<string | null>(null);

  const onLoad = (t: ParsedTrace, lbl: string) => {
    setTrace(t);
    setLabel(lbl);
    setSelectedId(t.roots[0]?.spanId ?? null);
    setActiveView(DEFAULT_VIEW);
    setError(null);
  };

  const reset = () => {
    setTrace(null);
    setSelectedId(null);
    setError(null);
    setLabel("");
    setActiveView(DEFAULT_VIEW);
  };

  const selected = selectedId ? (trace?.byId.get(selectedId) ?? null) : null;

  return (
    <ThemeProvider>
      {!trace ? (
        <Loader onLoad={onLoad} onError={setError} error={error} />
      ) : (
        <AppShell
          activeView={activeView}
          onSelectView={setActiveView}
          label={label}
          summary={trace.summary}
          onReset={reset}
        >
          <section className="min-h-0 overflow-hidden border-r border-border bg-panel">
            {activeView === "tree" && (
              <TreeView trace={trace} selectedId={selectedId} onSelect={setSelectedId} />
            )}
            {activeView === "flamegraph" && <FlamegraphView />}
            {activeView === "diff" && <DiffView />}
          </section>
          <aside className="min-h-0 overflow-auto bg-bg">
            {selected ? (
              <SpanDetail node={selected} />
            ) : (
              <div className="p-6 text-sm text-muted">Select a span to inspect it.</div>
            )}
          </aside>
        </AppShell>
      )}
    </ThemeProvider>
  );
}
