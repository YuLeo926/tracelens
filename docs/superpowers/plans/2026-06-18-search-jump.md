# Search + Jump-to-Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the call tree searchable (live inline filter across name/model/input/output/status) with match stepping and quick-jumps to the next error / slowest span.

**Architecture:** A pure, tested `core/search.ts` computes matches, the visible (matches + ancestors) set, ordered matches, error ids, and the slowest id. `App` owns `query`/`matchIndex`, derives results, and drives selection + the controls. The top-bar `SearchBox` becomes a controlled input; `TreeView`/`SpanRow` filter and highlight. Built in two green stages: selection-based search first, then tree filter/highlight.

**Tech Stack:** React 18, TypeScript (strict), Vite 6, Tailwind v4, Vitest. `src/core/` gains one new file; nothing else in `core/` changes.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/core/search.ts` | 1 | **create** — pure match/visible/ordered/error/slowest logic |
| `src/core/search.test.ts` | 1 | **create** — Vitest suite over the bundled samples |
| `src/components/shell/searchControls.ts` | 2 | **create** — `SearchControls` interface (shared, avoids import cycle) |
| `src/components/shell/SearchBox.tsx` | 2 | **rewrite** — controlled input + count/nav/clear + ⌘K/Esc/Enter keys |
| `src/components/shell/TopBar.tsx` | 2 | **modify** — pass `search` to SearchBox; add Error/Slowest quick-jumps |
| `src/components/shell/AppShell.tsx` | 2 | **modify** — forward a `search` prop to TopBar |
| `src/App.tsx` | 2, 3 | **modify** — search state/handlers/⌘K + provide controls (2); pass filter props to TreeView (3) |
| `src/components/views/TreeView/TreeView.tsx` | 3 | **modify** — filtered rendering + scroll current match into view |
| `src/components/views/TreeView/SpanRow.tsx` | 3 | **modify** — match tint + name substring emphasis + `data-span-id` |

---

## Task 1: Pure search core (TDD)

**Files:**
- Create: `src/core/search.ts`
- Test: `src/core/search.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/search.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseTrace } from "./parse";
import { spanMatchesQuery, searchTrace, errorSpanIds, slowestSpanId } from "./search";
import research from "../../public/samples/research-agent.json";
import toolError from "../../public/samples/tool-error.json";

const t = parseTrace(research);
const te = parseTrace(toolError);
const names = (ids: string[] | Set<string>) =>
  [...ids].map((id) => t.byId.get(id)!.name);

describe("spanMatchesQuery", () => {
  const root = t.roots[0];
  it("matches the span name, case-insensitively", () => {
    expect(spanMatchesQuery(root, "research")).toBe(true);
    expect(spanMatchesQuery(root, "RESEARCH")).toBe(true);
  });
  it("matches input text", () => {
    expect(spanMatchesQuery(root, "population")).toBe(true);
  });
  it("returns false for a non-match and for an empty query", () => {
    expect(spanMatchesQuery(root, "zzz-not-here")).toBe(false);
    expect(spanMatchesQuery(root, "")).toBe(false);
    expect(spanMatchesQuery(root, "   ")).toBe(false);
  });
});

describe("searchTrace", () => {
  it("returns all-empty for a blank query", () => {
    const r = searchTrace(t.roots, "  ");
    expect(r.matchIds.size).toBe(0);
    expect(r.visibleIds.size).toBe(0);
    expect(r.orderedMatchIds).toEqual([]);
  });

  it("keeps the ancestor chain of a match visible", () => {
    const r = searchTrace(t.roots, "retriever");
    expect(names(r.orderedMatchIds)).toEqual(["retriever.vector_search"]);
    expect(names(r.visibleIds).sort()).toEqual(
      ["research_agent.run", "retriever.vector_search", "tool.web_search"].sort(),
    );
  });

  it("orders matches in display (pre-order) order and excludes pure ancestors", () => {
    const r = searchTrace(t.roots, "llm.");
    expect(names(r.orderedMatchIds)).toEqual(["llm.plan", "llm.extract", "llm.answer"]);
    expect(r.matchIds.has(t.roots[0].spanId)).toBe(false);
    expect(r.visibleIds.has(t.roots[0].spanId)).toBe(true);
  });
});

describe("errorSpanIds", () => {
  it("finds error spans in display order", () => {
    const ids = errorSpanIds(te.roots);
    expect(ids).toHaveLength(1);
    expect(te.byId.get(ids[0])!.name).toBe("tool.web_search");
  });
  it("returns [] when there are no errors", () => {
    expect(errorSpanIds(t.roots)).toEqual([]);
  });
});

describe("slowestSpanId", () => {
  it("returns the id of the longest span", () => {
    expect(slowestSpanId(t.roots)).toBe(t.roots[0].spanId);
  });
  it("returns null for an empty forest", () => {
    expect(slowestSpanId([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/search.test.ts`
Expected: FAIL — cannot resolve `./search`.

- [ ] **Step 3: Create `src/core/search.ts`**

```ts
// Pure, dependency-free trace search/analysis over the parsed model.
// Used by the tree filter and the error/slowest quick-jumps.

import type { RunNode } from "./types";

export interface SearchResult {
  /** Spans that themselves match the query. */
  matchIds: Set<string>;
  /** Matches plus every ancestor of a match (so the tree keeps context). */
  visibleIds: Set<string>;
  /** Match ids in display (pre-order DFS) order, for stepping. */
  orderedMatchIds: string[];
}

function haystack(node: RunNode): string {
  return [node.name, node.model, node.input, node.output, node.statusMessage]
    .filter((s): s is string => typeof s === "string")
    .join("\n")
    .toLowerCase();
}

/** Case-insensitive substring across name/model/input/output/statusMessage. */
export function spanMatchesQuery(node: RunNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return haystack(node).includes(q);
}

export function searchTrace(roots: RunNode[], query: string): SearchResult {
  const matchIds = new Set<string>();
  const visibleIds = new Set<string>();
  const orderedMatchIds: string[] = [];
  if (!query.trim()) return { matchIds, visibleIds, orderedMatchIds };

  const visit = (node: RunNode): boolean => {
    const selfMatch = spanMatchesQuery(node, query);
    if (selfMatch) {
      matchIds.add(node.spanId);
      orderedMatchIds.push(node.spanId);
    }
    let descendantMatch = false;
    for (const child of node.children) {
      if (visit(child)) descendantMatch = true;
    }
    const visible = selfMatch || descendantMatch;
    if (visible) visibleIds.add(node.spanId);
    return visible;
  };
  for (const root of roots) visit(root);
  return { matchIds, visibleIds, orderedMatchIds };
}

/** Error spans in display (pre-order) order. */
export function errorSpanIds(roots: RunNode[]): string[] {
  const out: string[] = [];
  const walk = (node: RunNode) => {
    if (node.status === "error") out.push(node.spanId);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** Id of the span with the greatest durationMs, or null if there are none. */
export function slowestSpanId(roots: RunNode[]): string | null {
  let bestId: string | null = null;
  let bestDur = -Infinity;
  const walk = (node: RunNode) => {
    if (node.durationMs > bestDur) {
      bestDur = node.durationMs;
      bestId = node.spanId;
    }
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return bestId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/search.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/search.ts src/core/search.test.ts
git commit -m "feat(core): pure trace search + error/slowest helpers"
```

---

## Task 2: Search controls wired into App (selection-based)

This makes the search box live and the quick-jumps work by moving the **selection** (the detail panel follows). Tree filtering/highlight comes in Task 3. Everything compiles and the app stays usable at each step.

**Files:**
- Create: `src/components/shell/searchControls.ts`
- Rewrite: `src/components/shell/SearchBox.tsx`
- Modify: `src/components/shell/TopBar.tsx`
- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create `src/components/shell/searchControls.ts`**

```ts
import type { RefObject } from "react";

/** Everything the top-bar search UI needs, provided by App. */
export interface SearchControls {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  matchPosition: number; // 1-based; 0 when there are no matches
  onPrev: () => void;
  onNext: () => void;
  onClear: () => void;
  inputRef: RefObject<HTMLInputElement>;
  onJumpNextError: () => void;
  onJumpSlowest: () => void;
  errorCount: number;
  active: boolean; // controls are enabled only on the tree view
}
```

- [ ] **Step 2: Rewrite `src/components/shell/SearchBox.tsx`**

```tsx
import type { SearchControls } from "./searchControls";

export function SearchBox({ search }: { search: SearchControls }) {
  const {
    query, onQueryChange, matchCount, matchPosition,
    onPrev, onNext, onClear, inputRef, active,
  } = search;
  const has = query.trim().length > 0;

  return (
    <div
      className={`flex min-w-0 max-w-[360px] flex-1 items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-1 text-[12px] ${active ? "" : "opacity-50"}`}
    >
      <span aria-hidden className="shrink-0 text-faint">🔍</span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={!active}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClear();
            e.currentTarget.blur();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
        placeholder="Search spans, jump to errors…"
        aria-label="Search spans"
        className="min-w-0 flex-1 bg-transparent text-text placeholder:text-faint focus:outline-none"
      />
      {has ? (
        <>
          <span className="mono shrink-0 text-[11px] text-faint">
            {matchPosition} / {matchCount}
          </span>
          <button type="button" onClick={onPrev} disabled={matchCount === 0} aria-label="Previous match" className="shrink-0 px-0.5 text-muted hover:text-text disabled:opacity-40">⌃</button>
          <button type="button" onClick={onNext} disabled={matchCount === 0} aria-label="Next match" className="shrink-0 px-0.5 text-muted hover:text-text disabled:opacity-40">⌄</button>
          <button type="button" onClick={onClear} aria-label="Clear search" className="shrink-0 px-0.5 text-muted hover:text-text">×</button>
        </>
      ) : (
        <span className="mono ml-auto shrink-0 rounded border border-border px-1 text-[10px] text-faint">⌘K</span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Modify `src/components/shell/TopBar.tsx`** (replace the whole file)

```tsx
import { SearchBox } from "./SearchBox";
import type { SearchControls } from "./searchControls";

interface Props {
  label: string;
  onReset: () => void;
  search: SearchControls;
}

export function TopBar({ label, onReset, search }: Props) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2.5">
      <span className="truncate text-[13px] font-semibold text-text">
        {label || "Untitled trace"}
      </span>
      <div className="ml-1 flex min-w-0 flex-1 justify-start">
        <SearchBox search={search} />
      </div>
      <button
        type="button"
        onClick={search.onJumpNextError}
        disabled={!search.active || search.errorCount === 0}
        title={search.errorCount === 0 ? "No errors" : "Jump to next error"}
        className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-muted hover:text-text disabled:opacity-40"
      >
        ⚠ Error
      </button>
      <button
        type="button"
        onClick={search.onJumpSlowest}
        disabled={!search.active}
        title="Jump to slowest span"
        className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-muted hover:text-text disabled:opacity-40"
      >
        ⏱ Slowest
      </button>
      <button
        type="button"
        title="Export — coming in v1"
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-text"
      >
        ⇪ Export
      </button>
      <button
        onClick={onReset}
        className="shrink-0 rounded-lg border border-accent-strong bg-accent-strong px-3 py-1.5 text-[12px] text-on-accent hover:brightness-110"
      >
        New trace
      </button>
    </header>
  );
}
```

- [ ] **Step 4: Modify `src/components/shell/AppShell.tsx`** (replace the whole file)

```tsx
import type { ReactNode } from "react";
import type { TraceSummary } from "../../core/types";
import type { ViewId } from "../../lib/views";
import type { SearchControls } from "./searchControls";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { SummaryStrip } from "./SummaryStrip";

interface Props {
  activeView: ViewId;
  onSelectView: (id: ViewId) => void;
  label: string;
  summary: TraceSummary;
  onReset: () => void;
  search: SearchControls;
  children: ReactNode; // the view | detail split
}

export function AppShell({ activeView, onSelectView, label, summary, onReset, search, children }: Props) {
  return (
    <div className="flex h-full bg-bg">
      <Rail activeView={activeView} onSelectView={onSelectView} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar label={label} onReset={onReset} search={search} />
        <SummaryStrip summary={summary} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {children}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Modify `src/App.tsx`** (replace the whole file). The `<TreeView>` call is unchanged here — Task 3 adds the filter props.

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedTrace } from "./core/types";
import { searchTrace, errorSpanIds, slowestSpanId } from "./core/search";
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
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const onLoad = (t: ParsedTrace, lbl: string) => {
    setTrace(t);
    setLabel(lbl);
    setSelectedId(t.roots[0]?.spanId ?? null);
    setActiveView(DEFAULT_VIEW);
    setError(null);
    setQuery("");
    setMatchIndex(0);
  };

  const reset = () => {
    setTrace(null);
    setSelectedId(null);
    setError(null);
    setLabel("");
    setActiveView(DEFAULT_VIEW);
    setQuery("");
    setMatchIndex(0);
  };

  const search = useMemo(
    () => (trace ? searchTrace(trace.roots, query) : null),
    [trace, query],
  );
  const errors = useMemo(() => (trace ? errorSpanIds(trace.roots) : []), [trace]);
  const matchCount = search?.orderedMatchIds.length ?? 0;

  const onQueryChange = useCallback(
    (q: string) => {
      setQuery(q);
      setMatchIndex(0);
      if (trace) {
        const res = searchTrace(trace.roots, q);
        if (res.orderedMatchIds.length > 0) setSelectedId(res.orderedMatchIds[0]);
      }
    },
    [trace],
  );

  const stepMatch = useCallback(
    (delta: number) => {
      const ids = search?.orderedMatchIds ?? [];
      if (ids.length === 0) return;
      setMatchIndex((prev) => {
        const next = (prev + delta + ids.length) % ids.length;
        setSelectedId(ids[next]);
        return next;
      });
    },
    [search],
  );

  const clearSearch = useCallback(() => {
    setQuery("");
    setMatchIndex(0);
  }, []);

  const jumpNextError = useCallback(() => {
    if (errors.length === 0) return;
    const cur = errors.indexOf(selectedId ?? "");
    setSelectedId(errors[(cur + 1) % errors.length]);
  }, [errors, selectedId]);

  const jumpSlowest = useCallback(() => {
    if (!trace) return;
    const id = slowestSpanId(trace.roots);
    if (id) setSelectedId(id);
  }, [trace]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          search={{
            query,
            onQueryChange,
            matchCount,
            matchPosition: matchCount > 0 ? matchIndex + 1 : 0,
            onPrev: () => stepMatch(-1),
            onNext: () => stepMatch(1),
            onClear: clearSearch,
            inputRef: searchInputRef,
            onJumpNextError: jumpNextError,
            onJumpSlowest: jumpSlowest,
            errorCount: errors.length,
            active: activeView === "tree",
          }}
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
```

- [ ] **Step 6: Typecheck + build + tests**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; tests still **29 passed** (20 prior + 9 search); build PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): live search box + error/slowest quick-jumps (selection)"
```

---

## Task 3: Tree filter + match highlight

Now make the tree visually filter to matches (+ ancestors), highlight matched rows, emphasize the matched name substring, and scroll the current match into view.

**Files:**
- Modify: `src/components/views/TreeView/SpanRow.tsx`
- Modify: `src/components/views/TreeView/TreeView.tsx`
- Modify: `src/App.tsx` (only the `<TreeView>` call + two derived values)

- [ ] **Step 1: Rewrite `src/components/views/TreeView/SpanRow.tsx`**

```tsx
import type { RunNode } from "../../../core/types";
import { kindColor } from "../../../lib/kinds";
import { formatDuration } from "../../../core/format";

interface Props {
  node: RunNode;
  traceStart: number;
  traceDuration: number;
  selected: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  isMatch: boolean;
  query: string;
  showToggle: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{name}</>;
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{name}</>;
  return (
    <>
      {name.slice(0, idx)}
      <mark
        className="rounded-sm"
        style={{ background: "color-mix(in srgb, var(--accent) 32%, transparent)", color: "var(--text)" }}
      >
        {name.slice(idx, idx + q.length)}
      </mark>
      {name.slice(idx + q.length)}
    </>
  );
}

export function SpanRow({
  node, traceStart, traceDuration, selected, hasChildren, collapsed,
  isMatch, query, showToggle, onSelect, onToggle,
}: Props) {
  const isError = node.status === "error";
  const color = isError ? "var(--error)" : kindColor(node.kind);
  const leftPct = traceDuration > 0 ? ((node.startMs - traceStart) / traceDuration) * 100 : 0;
  const widthPct = traceDuration > 0 ? Math.max(0.8, (node.durationMs / traceDuration) * 100) : 100;

  const rowStyle: React.CSSProperties = { borderLeftColor: selected ? color : "transparent" };
  if (isMatch && !selected) {
    rowStyle.background = "color-mix(in srgb, var(--accent) 12%, transparent)";
  }

  return (
    <div
      data-span-id={node.spanId}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_150px_56px] items-center gap-2.5 border-l-2 py-1.5 pr-3 text-[12px] ${selected ? "bg-elev" : "hover:bg-panel-2"}`}
      style={rowStyle}
    >
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: 6 + node.depth * 18 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mono flex h-4 w-3 shrink-0 items-center justify-center text-[9px] text-faint"
          style={{ visibility: showToggle && hasChildren ? "visible" : "hidden" }}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▶" : "▾"}
        </button>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate" style={isError ? { color: "var(--error)" } : undefined}>
          <HighlightedName name={node.name} query={isMatch ? query : ""} />
        </span>
        {node.model && (
          <span className="mono shrink-0 rounded border border-border bg-bg px-1 text-[10px] text-muted">
            {node.model}
          </span>
        )}
      </div>

      <div className="relative h-1.5 rounded-full bg-track">
        <div
          className="absolute top-0 h-1.5 rounded-full"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color, opacity: 0.9 }}
        />
      </div>

      <span className="mono text-right text-[11px] text-muted">{formatDuration(node.durationMs)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `src/components/views/TreeView/TreeView.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { ParsedTrace } from "../../../core/types";
import { flatten } from "../../../core/parse";
import { SpanRow } from "./SpanRow";
import { TimeAxis } from "./TimeAxis";

interface Props {
  trace: ParsedTrace;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filtering: boolean;
  visibleIds: Set<string> | null;
  matchIds: Set<string> | null;
  currentMatchId: string | null;
  query: string;
}

export function TreeView({
  trace, selectedId, onSelect, filtering, visibleIds, matchIds, currentMatchId, query,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { startMs, durationMs } = trace.summary;
  const containerRef = useRef<HTMLDivElement>(null);

  // When filtering, ignore the collapse set and show matches + ancestors only.
  const allRows = flatten(trace.roots, filtering ? undefined : collapsed);
  const rows = filtering && visibleIds ? allRows.filter((n) => visibleIds.has(n.spanId)) : allRows;

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!currentMatchId) return;
    const el = containerRef.current?.querySelector(`[data-span-id="${currentMatchId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [currentMatchId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TimeAxis durationMs={durationMs} />
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto py-1">
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-muted">No spans match “{query}”.</div>
        ) : (
          rows.map((node) => (
            <SpanRow
              key={node.spanId}
              node={node}
              traceStart={startMs}
              traceDuration={durationMs}
              selected={node.spanId === selectedId}
              hasChildren={node.children.length > 0}
              collapsed={collapsed.has(node.spanId)}
              isMatch={matchIds?.has(node.spanId) ?? false}
              query={query}
              showToggle={!filtering}
              onSelect={() => onSelect(node.spanId)}
              onToggle={() => toggle(node.spanId)}
            />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Modify `src/App.tsx`** — add two derived values and pass the filter props. Change ONLY these two spots.

First, add right after the `const selected = ...` line:

```tsx
  const filtering = query.trim().length > 0;
  const currentMatchId =
    matchCount > 0 ? (search?.orderedMatchIds[matchIndex] ?? null) : null;
```

Then replace the `<TreeView ... />` element with:

```tsx
            {activeView === "tree" && (
              <TreeView
                trace={trace}
                selectedId={selectedId}
                onSelect={setSelectedId}
                filtering={filtering}
                visibleIds={search?.visibleIds ?? null}
                matchIds={search?.matchIds ?? null}
                currentMatchId={currentMatchId}
                query={query}
              />
            )}
```

- [ ] **Step 4: Typecheck + build + tests**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; **29 tests** pass; build PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): filter + highlight the call tree on search"
```

---

## Task 4: Runtime verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server** (preview tooling or `npm run dev`) and load the **research-agent** sample.

- [ ] **Step 2: Type a query** (e.g. `llm`) in the top-bar search box. Confirm: the tree collapses to matching spans plus their ancestors; matched names are highlighted; the count shows e.g. `1 / 3`; the first match is selected (detail panel follows). Console must be error-free.

- [ ] **Step 3: Step matches** — press Enter / Shift+Enter (and the ⌃/⌄ buttons). Selection advances through matches and the current match scrolls into view. Press `Esc` to clear; the full tree returns.

- [ ] **Step 4: ⌘K / Ctrl+K** focuses the search box from elsewhere on the page.

- [ ] **Step 5: Quick-jumps** — load the **tool-error** sample. Click `⚠ Error`: the failed `tool.web_search` span is selected and scrolled to. Click `⏱ Slowest`: the longest span is selected. On a trace with 0 errors, the `⚠ Error` button is disabled.

- [ ] **Step 6: Both themes** — repeat a search in dark theme; confirm the match tint and highlight are legible.

- [ ] **Step 7: Final commit (only if verification fixes were needed)**

```bash
git add -A
git commit -m "chore(ui): search verification fixes"
```

---

## Self-review notes (author)

- **Spec coverage:** inline filter + ancestors (T1 `searchTrace`, T3 TreeView); searched fields name/model/input/output/status (T1 `spanMatchesQuery`); match nav + count (T2 App/SearchBox); next-error + slowest (T1 helpers, T2 App/TopBar); ⌘K/Esc/Enter (T2); hide-not-dim filtering (T3); name substring emphasis (T3 `HighlightedName`); reset on load (T2); zero-match + zero-error states (T3 empty row, T2 disabled buttons). ✓
- **Type consistency:** `SearchControls` (searchControls.ts) consumed by App/AppShell/TopBar/SearchBox; `searchTrace`/`errorSpanIds`/`slowestSpanId` signatures match call sites; `SearchResult.{matchIds,visibleIds,orderedMatchIds}` used consistently; TreeView/SpanRow new props (`filtering`,`visibleIds`,`matchIds`,`currentMatchId`,`query`,`isMatch`,`showToggle`) match between App→TreeView→SpanRow. ✓
- **Green at every step:** Task 2 keeps the `<TreeView>` call unchanged (search works via selection); Task 3 adds the filter props once TreeView/SpanRow accept them. `src/core/` only gains `search.ts`. ✓
- **Tailwind risk:** match tints use inline `color-mix(...)` (already used in KindBadge/SpanDetail) rather than opacity-modifier utilities, so no dependency on `bg-accent/10` resolving.
