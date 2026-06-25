# Span Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rate any span 👍/👎 with a tag + note in the detail panel, persist it in localStorage, mark annotated spans in the tree, and export annotations as JSONL/CSV (this conversation / all).

**Architecture:** Pure build/serialize logic in `core/annotations.ts`. A thin, testable `localStorage` wrapper (`lib/annotationStore.ts`). A `useAnnotations(label)` hook. UI: an annotation control in `SpanDetail`, a marker in `SpanRow`, and a new `Annotations` view with export.

**Tech Stack:** React 18 + TypeScript (strict, `noUnusedParameters`), Vite 6, Vitest. `localStorage`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/annotations.ts` (new) | Pure: types + `isAnnotated`, `toStored`, `buildRows`, `toJSONL`, `toCSV` |
| `src/core/annotations.test.ts` (new) | Unit tests |
| `src/lib/annotationStore.ts` (new) | localStorage wrapper (accepts a `Storage`) |
| `src/lib/annotationStore.test.ts` (new) | Unit tests (in-memory Storage) |
| `src/hooks/useAnnotations.ts` (new) | Current-label annotations + `setAnnotation` + `annotatedIds` |
| `src/components/detail/SpanDetail.tsx` (modify) | Annotation control (👍/👎 + tag + note) |
| `src/components/views/TreeView/SpanRow.tsx` (modify) | `mark?` marker |
| `src/components/views/TreeView/TreeView.tsx` (modify) | Pass `annotations` down |
| `src/lib/views.ts` (modify) | Register the `annotations` view |
| `src/lib/views.test.ts` (modify) | Update the ready-views assertion |
| `src/components/views/AnnotationsView.tsx` (new) | List + export |
| `src/App.tsx` (modify) | Wire the hook through |

---

## Task 1: Pure annotations core

**Files:**
- Create: `src/core/annotations.ts`
- Test: `src/core/annotations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/annotations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAnnotated, toStored, buildRows, toJSONL, toCSV, SNAPSHOT_CAP, type StoredAnnotation } from "./annotations";
import type { RunNode } from "./types";

const node = (over: Partial<RunNode> = {}): RunNode => ({
  spanId: "s1", parentSpanId: null, traceId: "", name: "step", kind: "tool",
  startMs: 0, endMs: 1, status: "ok", attributes: {}, children: [], depth: 0, durationMs: 1,
  ...over,
});

describe("isAnnotated", () => {
  it("is false when empty/whitespace, true when any field set", () => {
    expect(isAnnotated({})).toBe(false);
    expect(isAnnotated({ note: "  " })).toBe(false);
    expect(isAnnotated({ verdict: "good" })).toBe(true);
    expect(isAnnotated({ tag: "x" })).toBe(true);
    expect(isAnnotated({ note: "hi" })).toBe(true);
  });
});

describe("toStored", () => {
  it("captures the span snapshot and truncates input/output", () => {
    const s = toStored(
      { verdict: "bad", tag: " bug ", note: "" },
      node({ name: "n", kind: "llm", model: "m", input: "x".repeat(9000), output: "y" }),
    );
    expect(s).toMatchObject({ verdict: "bad", tag: " bug ", name: "n", kind: "llm", model: "m", output: "y" });
    expect(s.note).toBeUndefined(); // "" -> not stored
    expect(s.input!.length).toBe(SNAPSHOT_CAP);
  });
});

describe("buildRows / toJSONL / toCSV", () => {
  const store: Record<string, Record<string, StoredAnnotation>> = {
    "a.jsonl": { s1: { name: "run, step", kind: "tool", verdict: "good", note: 'has "quote"\nand newline' } },
    "b.jsonl": { s2: { name: "x", kind: "llm", input: "z".repeat(500) } },
  };

  it("builds rows across the given labels", () => {
    expect(buildRows(store, ["a.jsonl"])).toHaveLength(1);
    expect(buildRows(store, ["a.jsonl", "b.jsonl"])).toHaveLength(2);
    expect(buildRows(store, ["a.jsonl"])[0]).toMatchObject({
      conversation: "a.jsonl", span_id: "s1", verdict: "good", tag: "", model: "",
    });
  });

  it("toJSONL is one parseable object per line", () => {
    const lines = toJSONL(buildRows(store, ["a.jsonl", "b.jsonl"])).split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).conversation).toBe("a.jsonl");
  });

  it("toCSV escapes commas/quotes/newlines, truncates input/output, and has a header", () => {
    const csv = toCSV(buildRows(store, ["a.jsonl", "b.jsonl"]));
    expect(csv.startsWith("conversation,span_id,name,kind,model,input,output,verdict,tag,note")).toBe(true);
    expect(csv).toContain('"run, step"');        // comma -> quoted
    expect(csv).toContain('"has ""quote""');     // quote -> doubled inside quotes
    expect(csv).toContain("z".repeat(300));
    expect(csv).not.toContain("z".repeat(301));  // input truncated to 300 in CSV
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/annotations.test.ts`
Expected: FAIL — `Failed to resolve import "./annotations"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/annotations.ts`:

```ts
import type { RunNode, SpanKind } from "./types";

export type Verdict = "good" | "bad";

export interface Annotation {
  verdict?: Verdict;
  tag?: string;
  note?: string;
}

export interface StoredAnnotation extends Annotation {
  name: string;
  kind: SpanKind;
  model?: string;
  input?: string;
  output?: string;
}

export interface AnnotationRow {
  conversation: string;
  span_id: string;
  name: string;
  kind: SpanKind;
  model: string;
  input: string;
  output: string;
  verdict: string;
  tag: string;
  note: string;
}

export const SNAPSHOT_CAP = 8000;
const CSV_CELL_CAP = 300;

/** True if the annotation carries any real content. */
export function isAnnotated(a: Annotation): boolean {
  return Boolean(a.verdict || a.tag?.trim() || a.note?.trim());
}

/** Editable fields + a capped snapshot of the span, for storage/export. */
export function toStored(a: Annotation, node: RunNode): StoredAnnotation {
  // Store values raw (trimming the live value would break typing in the
  // controlled input — a trailing space would be eaten on every keystroke);
  // trim is only used to decide whether a field counts as "present".
  const s: StoredAnnotation = { name: node.name, kind: node.kind };
  if (a.verdict) s.verdict = a.verdict;
  if (a.tag?.trim()) s.tag = a.tag;
  if (a.note?.trim()) s.note = a.note;
  if (node.model) s.model = node.model;
  if (node.input) s.input = node.input.slice(0, SNAPSHOT_CAP);
  if (node.output) s.output = node.output.slice(0, SNAPSHOT_CAP);
  return s;
}

/** Flatten a store ({label: {spanId: StoredAnnotation}}) to export rows. */
export function buildRows(
  store: Record<string, Record<string, StoredAnnotation>>,
  labels: string[],
): AnnotationRow[] {
  const rows: AnnotationRow[] = [];
  for (const label of labels) {
    const bucket = store[label];
    if (!bucket) continue;
    for (const [spanId, s] of Object.entries(bucket)) {
      rows.push({
        conversation: label,
        span_id: spanId,
        name: s.name,
        kind: s.kind,
        model: s.model ?? "",
        input: s.input ?? "",
        output: s.output ?? "",
        verdict: s.verdict ?? "",
        tag: s.tag ?? "",
        note: s.note ?? "",
      });
    }
  }
  return rows;
}

export function toJSONL(rows: AnnotationRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

const CSV_COLUMNS: Array<keyof AnnotationRow> = [
  "conversation", "span_id", "name", "kind", "model", "input", "output", "verdict", "tag", "note",
];

function csvCell(value: string, cap?: number): string {
  let v = cap !== undefined ? value.slice(0, cap) : value;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCSV(rows: AnnotationRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = rows.map((r) =>
    CSV_COLUMNS.map((c) =>
      csvCell(String(r[c]), c === "input" || c === "output" ? CSV_CELL_CAP : undefined),
    ).join(","),
  );
  return [header, ...body].join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/annotations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/annotations.ts src/core/annotations.test.ts
git commit -m "feat(core): annotations model + JSONL/CSV serializers"
```

(Append a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` to every commit.)

---

## Task 2: localStorage store

**Files:**
- Create: `src/lib/annotationStore.ts`
- Test: `src/lib/annotationStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/annotationStore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadStore, loadForLabel, saveForLabel } from "./annotationStore";
import type { StoredAnnotation } from "../core/annotations";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

const ann: StoredAnnotation = { name: "n", kind: "tool", verdict: "good" };

describe("annotationStore", () => {
  it("round-trips save/load for a label", () => {
    const s = fakeStorage();
    saveForLabel("a.jsonl", { s1: ann }, s);
    expect(loadForLabel("a.jsonl", s)).toEqual({ s1: ann });
    expect(loadStore(s)).toEqual({ "a.jsonl": { s1: ann } });
  });

  it("deletes a label's bucket when saved empty", () => {
    const s = fakeStorage();
    saveForLabel("a.jsonl", { s1: ann }, s);
    saveForLabel("a.jsonl", {}, s);
    expect(loadStore(s)).toEqual({});
  });

  it("returns {} for missing or corrupt data", () => {
    expect(loadStore(fakeStorage())).toEqual({});
    expect(loadStore(fakeStorage({ "tracelens:annotations": "not json" }))).toEqual({});
  });

  it("swallows a throwing storage", () => {
    const throwing = {
      length: 0, clear() {}, key: () => null, removeItem() {},
      getItem: () => { throw new Error("x"); },
      setItem: () => { throw new Error("x"); },
    } as unknown as Storage;
    expect(() => saveForLabel("a", { s1: ann }, throwing)).not.toThrow();
    expect(loadStore(throwing)).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/annotationStore.test.ts`
Expected: FAIL — `Failed to resolve import "./annotationStore"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/annotationStore.ts`:

```ts
import type { StoredAnnotation } from "../core/annotations";

const KEY = "tracelens:annotations";
export type AnnotationStore = Record<string, Record<string, StoredAnnotation>>;

function storageOf(s?: Storage): Storage | null {
  if (s) return s;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadStore(s?: Storage): AnnotationStore {
  const storage = storageOf(s);
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as AnnotationStore) : {};
  } catch {
    return {};
  }
}

export function loadForLabel(label: string, s?: Storage): Record<string, StoredAnnotation> {
  return loadStore(s)[label] ?? {};
}

export function saveForLabel(
  label: string,
  anns: Record<string, StoredAnnotation>,
  s?: Storage,
): void {
  const storage = storageOf(s);
  if (!storage) return;
  try {
    const store = loadStore(storage);
    if (Object.keys(anns).length === 0) delete store[label];
    else store[label] = anns;
    storage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota or unavailable — in-memory annotations still work this session */
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/annotationStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/annotationStore.ts src/lib/annotationStore.test.ts
git commit -m "feat(annotations): localStorage store (testable, fault-tolerant)"
```

---

## Task 3: useAnnotations hook

**Files:**
- Create: `src/hooks/useAnnotations.ts`

- [ ] **Step 1: Write the implementation**

Create `src/hooks/useAnnotations.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunNode } from "../core/types";
import { toStored, isAnnotated, type Annotation, type StoredAnnotation } from "../core/annotations";
import { loadForLabel, saveForLabel } from "../lib/annotationStore";

export function useAnnotations(label: string) {
  const [annotations, setAnnotations] = useState<Record<string, StoredAnnotation>>({});

  useEffect(() => {
    setAnnotations(label ? loadForLabel(label) : {});
  }, [label]);

  const setAnnotation = useCallback(
    (node: RunNode, a: Annotation) => {
      setAnnotations((prev) => {
        const next = { ...prev };
        if (isAnnotated(a)) next[node.spanId] = toStored(a, node);
        else delete next[node.spanId];
        if (label) saveForLabel(label, next);
        return next;
      });
    },
    [label],
  );

  const annotatedIds = useMemo(() => new Set(Object.keys(annotations)), [annotations]);

  return { annotations, setAnnotation, annotatedIds };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAnnotations.ts
git commit -m "feat(annotations): useAnnotations hook (load/persist per label)"
```

---

## Task 4: SpanDetail annotation control

**Files:**
- Modify: `src/components/detail/SpanDetail.tsx`

- [ ] **Step 1: Add the control and props**

In `src/components/detail/SpanDetail.tsx`, change the imports at the top to add the annotation types:

```ts
import type { RunNode } from "../../core/types";
import type { Annotation, StoredAnnotation } from "../../core/annotations";
import { KindBadge } from "./KindBadge";
import { formatDuration, formatTokens, formatCost, formatClock } from "../../core/format";
```

Add this component above `export function SpanDetail`:

```tsx
function AnnotationControl({
  annotation, onAnnotate, knownTags,
}: {
  annotation?: StoredAnnotation;
  onAnnotate: (a: Annotation) => void;
  knownTags: string[];
}) {
  const verdict = annotation?.verdict;
  const tag = annotation?.tag ?? "";
  const note = annotation?.note ?? "";
  const update = (patch: Partial<Annotation>) => onAnnotate({ verdict, tag, note, ...patch });
  const btn = (active: boolean) =>
    `rounded border px-2 py-1 text-sm ${active ? "border-accent bg-elev" : "border-border hover:border-accent"}`;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3">
      <span className="text-[10px] uppercase tracking-wider text-faint">Annotation</span>
      <div className="flex gap-2">
        <button type="button" className={btn(verdict === "good")} onClick={() => update({ verdict: verdict === "good" ? undefined : "good" })}>👍</button>
        <button type="button" className={btn(verdict === "bad")} onClick={() => update({ verdict: verdict === "bad" ? undefined : "bad" })}>👎</button>
      </div>
      <input
        list="tracelens-ann-tags"
        value={tag}
        onChange={(e) => update({ tag: e.target.value })}
        placeholder="tag (e.g. hallucination)"
        className="rounded border border-border bg-bg px-2 py-1 text-[13px] text-text outline-none focus:border-accent"
      />
      <datalist id="tracelens-ann-tags">
        {knownTags.map((t) => <option key={t} value={t} />)}
      </datalist>
      <textarea
        value={note}
        onChange={(e) => update({ note: e.target.value })}
        placeholder="note…"
        rows={2}
        className="resize-y rounded border border-border bg-bg px-2 py-1 text-[13px] text-text outline-none focus:border-accent"
      />
    </div>
  );
}
```

Change the `SpanDetail` signature to accept the new (optional) props:

```tsx
export function SpanDetail({
  node, annotation, onAnnotate, knownTags = [],
}: {
  node: RunNode;
  annotation?: StoredAnnotation;
  onAnnotate?: (a: Annotation) => void;
  knownTags?: string[];
}) {
```

Then render the control immediately after the name/header block — i.e. right after the `</div>` that closes the first `<div className="flex flex-col gap-2">…</div>` (the one containing `KindBadge` and the `<h2>`), insert:

```tsx
      {onAnnotate && (
        <AnnotationControl annotation={annotation} onAnnotate={onAnnotate} knownTags={knownTags} />
      )}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (existing `<SpanDetail node=… />` call still valid; new props are optional).

- [ ] **Step 3: Commit**

```bash
git add src/components/detail/SpanDetail.tsx
git commit -m "feat(annotations): 👍/👎 + tag + note control in the detail panel"
```

---

## Task 5: Tree marker

**Files:**
- Modify: `src/components/views/TreeView/SpanRow.tsx`
- Modify: `src/components/views/TreeView/TreeView.tsx`

- [ ] **Step 1: Add `mark` to `SpanRow`**

In `src/components/views/TreeView/SpanRow.tsx`, add to the `Props` interface (after `onToggle: () => void;`):

```ts
  mark?: "good" | "bad" | "note";
```

Add `mark` to the destructured params:

```ts
export function SpanRow({
  node, traceStart, traceDuration, selected, hasChildren, collapsed,
  isMatch, query, showToggle, onSelect, onToggle, mark,
}: Props) {
```

Inside the name container, right after the model badge block (the `{node.model && (…)}` expression), add:

```tsx
        {mark && (
          <span className="shrink-0 text-[11px]" title="annotated">
            {mark === "good" ? "👍" : mark === "bad" ? "👎" : "📝"}
          </span>
        )}
```

- [ ] **Step 2: Pass `annotations` through `TreeView`**

In `src/components/views/TreeView/TreeView.tsx`, add the import:

```ts
import type { StoredAnnotation } from "../../../core/annotations";
```

Add to `Props` (after `onUserScroll?: () => void;`):

```ts
  annotations?: Record<string, StoredAnnotation> | null;
```

Destructure it (add `annotations` to the param list). Then in the `rows.map(...)`, add a `mark` prop to `<SpanRow>`:

```tsx
              mark={(() => {
                const a = annotations?.[node.spanId];
                return a ? (a.verdict ?? "note") : undefined;
              })()}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (both new props optional; App doesn't pass `annotations` yet).

- [ ] **Step 4: Commit**

```bash
git add src/components/views/TreeView/SpanRow.tsx src/components/views/TreeView/TreeView.tsx
git commit -m "feat(annotations): mark annotated spans in the call tree"
```

---

## Task 6: Annotations view + registration

**Files:**
- Modify: `src/lib/views.ts`
- Modify: `src/lib/views.test.ts`
- Create: `src/components/views/AnnotationsView.tsx`

- [ ] **Step 1: Register the view**

In `src/lib/views.ts`, change the `ViewId` type and the `VIEWS` array:

```ts
export type ViewId = "tree" | "flamegraph" | "diff" | "annotations";
```

```ts
export const VIEWS: ViewDef[] = [
  { id: "tree", label: "Call tree", icon: "▤", status: "ready" },
  { id: "flamegraph", label: "Flamegraph", icon: "▦", status: "ready" },
  { id: "diff", label: "Diff", icon: "⇄", status: "ready" },
  { id: "annotations", label: "Annotations", icon: "✎", status: "ready" },
];
```

- [ ] **Step 2: Update `views.test.ts`**

In `src/lib/views.test.ts`, change the ready assertion:

```ts
  it("has the tree, flamegraph, diff and annotations ready", () => {
    const ready = VIEWS.filter((v) => v.status === "ready").map((v) => v.id);
    expect(ready).toEqual(["tree", "flamegraph", "diff", "annotations"]);
  });
```

- [ ] **Step 3: Create `AnnotationsView`**

Create `src/components/views/AnnotationsView.tsx`:

```tsx
import { useState } from "react";
import type { StoredAnnotation } from "../../core/annotations";
import { buildRows, toJSONL, toCSV } from "../../core/annotations";
import { loadStore } from "../../lib/annotationStore";

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface Props {
  annotations: Record<string, StoredAnnotation>;
  label: string;
  onSelect: (spanId: string) => void;
}

export function AnnotationsView({ annotations, label, onSelect }: Props) {
  const [scope, setScope] = useState<"this" | "all">("this");
  const entries = Object.entries(annotations);

  const rowsFor = (which: "this" | "all") => {
    if (which === "this") return buildRows({ [label]: annotations }, [label]);
    const store = loadStore();
    return buildRows(store, Object.keys(store));
  };
  const canExport = rowsFor(scope).length > 0;

  const doExport = (fmt: "jsonl" | "csv") => {
    const rows = rowsFor(scope);
    if (rows.length === 0) return;
    if (fmt === "jsonl") download("annotations.jsonl", toJSONL(rows), "application/x-ndjson");
    else download("annotations.csv", toCSV(rows), "text/csv");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px]">
        <span className="text-faint">Export</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "this" | "all")}
          className="rounded border border-border bg-bg px-2 py-0.5 text-text"
        >
          <option value="this">This conversation</option>
          <option value="all">All conversations</option>
        </select>
        <button type="button" disabled={!canExport} onClick={() => doExport("jsonl")} className="rounded border border-border px-2 py-0.5 text-text hover:border-accent disabled:opacity-40">JSONL</button>
        <button type="button" disabled={!canExport} onClick={() => doExport("csv")} className="rounded border border-border px-2 py-0.5 text-text hover:border-accent disabled:opacity-40">CSV</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="p-6 text-sm text-muted">No annotations yet — open a span and rate it 👍/👎.</div>
        ) : (
          <ul>
            {entries.map(([spanId, a]) => (
              <li key={spanId} className="border-b border-border">
                <button
                  type="button"
                  onClick={() => onSelect(spanId)}
                  className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-panel-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px]">{a.verdict === "good" ? "👍" : a.verdict === "bad" ? "👎" : "📝"}</span>
                    <span className="truncate text-sm text-text">{a.name}</span>
                    {a.tag && <span className="mono rounded border border-border bg-bg px-1 text-[10px] text-muted">{a.tag}</span>}
                  </div>
                  {a.note && <div className="mono w-full truncate text-[11px] text-faint">{a.note}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the gate**

Run: `npm run typecheck && npm test`
Expected: typecheck PASS; tests PASS (the updated `views.test.ts` is green). Note: the rail will now show an "Annotations" button that renders nothing until Task 7 wires it — this is expected and resolved next.

- [ ] **Step 5: Commit**

```bash
git add src/lib/views.ts src/lib/views.test.ts src/components/views/AnnotationsView.tsx
git commit -m "feat(annotations): Annotations view (list + JSONL/CSV export) + registration"
```

---

## Task 7: Wire it into App

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

In `src/App.tsx`, after the existing imports add:

```ts
import { useAnnotations } from "./hooks/useAnnotations";
import { AnnotationsView } from "./components/views/AnnotationsView";
import type { Annotation } from "./core/annotations";
```

- [ ] **Step 2: Use the hook + derive known tags**

Right after `const live = folderDir !== null && folderView === "trace";` add:

```ts
  const ann = useAnnotations(label);
  const knownTags = useMemo(
    () =>
      [...new Set(Object.values(ann.annotations).map((a) => a.tag).filter((t): t is string => !!t))],
    [ann.annotations],
  );
```

- [ ] **Step 3: Add an annotation-select handler**

After the `onUserScroll` callback (around the `const selected = …` line), add:

```ts
  const onAnnotationSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setActiveView("tree");
      if (live) setFollowing(false);
    },
    [live],
  );
```

- [ ] **Step 4: Pass annotations to the tree**

In the `<TreeView … />` JSX, add a prop:

```tsx
                annotations={ann.annotations}
```

- [ ] **Step 5: Render the Annotations view**

Immediately after the `{activeView === "diff" && <DiffView trace={trace} label={label} />}` line, add:

```tsx
            {activeView === "annotations" && (
              <AnnotationsView annotations={ann.annotations} label={label} onSelect={onAnnotationSelect} />
            )}
```

- [ ] **Step 6: Wire the detail panel**

Replace the `<SpanDetail node={selected} />` in the `<aside>` with:

```tsx
              <SpanDetail
                node={selected}
                annotation={ann.annotations[selected.spanId]}
                onAnnotate={(a: Annotation) => ann.setAnnotation(selected, a)}
                knownTags={knownTags}
              />
```

- [ ] **Step 7: Verify the gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; tests PASS; build PASS.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(annotations): wire annotate + Annotations view into App"
```

---

## Task 8: Manual verification (user, in Edge)

- [ ] `npm run dev`, open in Edge, load any trace (a sample, or a folder conversation).
- [ ] Select a span → the detail panel shows the **Annotation** control. Click **👍**; add a **tag** and a **note**.
- [ ] Confirm the span gets a **👍 marker** in the call tree.
- [ ] Open the **Annotations** view (rail) → the annotation is listed; clicking it jumps to the span in the tree.
- [ ] **Reload the page**, reopen the same trace → the annotation is still there.
- [ ] In the Annotations view, **Export JSONL** and **Export CSV** (This conversation) → open the files and confirm input/output/verdict/tag/note are present. Try **All conversations** after annotating a second trace.
- [ ] Re-click **👍** to clear it → the marker and list entry disappear.

---

## Self-Review notes

- **Spec coverage:** model + isAnnotated/toStored/buildRows/toJSONL/toCSV (Task 1); localStorage keyed by label, fault-tolerant (Task 2); load/persist hook (Task 3); detail-panel control with tag datalist (Task 4); tree marker (Task 5); Annotations view + export scopes/formats + registration (Task 6); App wiring incl. known tags + jump-to-span (Task 7). All present.
- **Type consistency:** `Annotation`/`StoredAnnotation`/`AnnotationRow` from Task 1 are the exact types imported in Tasks 2–7; `useAnnotations` returns `{ annotations, setAnnotation, annotatedIds }`; `SpanDetail` gains optional `annotation`/`onAnnotate`/`knownTags`; `SpanRow` gains `mark?`; `TreeView` gains `annotations?`; `views.ts` `ViewId` includes `"annotations"`. Consistent.
- **Green at every step:** Tasks 4 & 5 add only optional props (App unchanged → compiles). Task 6 adds the view + updates its test (green), with a temporarily inert rail button that Task 7 activates. Every task ends green.
- **No placeholders:** every code step is complete.
```
