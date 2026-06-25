# Span Annotations → Eval Dataset Export — Design

**Date:** 2026-06-25
**Status:** Approved (design), pending spec review
**Sub-project:** Third v2 feature. Annotate spans (👍/👎 + tag + note), persist them, and export the annotated spans as an evaluation dataset (JSONL + CSV). Serves both lightweight review and eval-set building.

## 1. Goal

While viewing a trace, rate any span 👍/👎, give it a tag (e.g. "hallucination"), and a free-text note — right in the detail panel. Annotated spans get a marker in the call tree. An **Annotations** view lists the current trace's annotations (click to jump) and exports them as **JSONL** or **CSV**, scoped to **this conversation** or **all conversations**. Annotations persist in the browser (`localStorage`) keyed by the trace's label, so re-opening the same conversation restores them. Each annotation captures a snapshot of its span's context at annotation time, so exports work even when other conversations aren't loaded. 100% client-side; the pure core gains one new module.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Annotation content | `{ verdict?: "good" \| "bad"; tag?: string; note?: string }` — all optional; a span is "annotated" if any field is non-empty |
| Verdict toggle | Clicking the active verdict clears it; an all-empty annotation is removed |
| Persistence | `localStorage`, one key `tracelens:annotations`, shape `{ [label]: { [spanId]: StoredAnnotation } }`; keyed by the trace **label**; auto-restore on reopen; saved on every change |
| Stored snapshot | Each record also captures `{ name, kind, model?, input?, output? }` from the span at annotation time; `input`/`output` truncated to 8000 chars to bound storage |
| Where to annotate | In `SpanDetail` (👍/👎 toggle + tag input + note textarea) |
| Tree marker | Annotated spans show a small verdict marker in `SpanRow` |
| Annotations view | A 4th view (rail tab) listing this trace's annotations (click to select the span) + export controls |
| Export formats | **JSONL** (one object per line, for evals) and **CSV** (escaped; input/output truncated to 300 chars for readability) |
| Export scope | This conversation (current label) / All conversations (every label) |
| Known trade-offs | Same-label different traces share annotations (rare); stored input/output truncated at 8000 chars |

## 3. Pure core — `src/core/annotations.ts`

```ts
export type Verdict = "good" | "bad";

export interface Annotation {        // the editable part
  verdict?: Verdict;
  tag?: string;
  note?: string;
}

export interface StoredAnnotation extends Annotation {  // + span snapshot
  name: string;
  kind: SpanKind;
  model?: string;
  input?: string;
  output?: string;
}

export interface AnnotationRow {     // one export row
  conversation: string;
  span_id: string;
  name: string;
  kind: SpanKind;
  model: string;
  input: string;
  output: string;
  verdict: string;   // "good" | "bad" | ""
  tag: string;
  note: string;
}

export const SNAPSHOT_CAP = 8000;

/** True if the annotation carries any content (else it should be removed). */
export function isAnnotated(a: Annotation): boolean;

/** Build a span's StoredAnnotation: editable fields + a capped span snapshot. */
export function toStored(a: Annotation, node: RunNode): StoredAnnotation;

/** Flatten a store ({label: {spanId: StoredAnnotation}}) to export rows. */
export function buildRows(store: Record<string, Record<string, StoredAnnotation>>, labels: string[]): AnnotationRow[];

export function toJSONL(rows: AnnotationRow[]): string;
export function toCSV(rows: AnnotationRow[]): string;  // RFC4180 escaping; input/output truncated to 300
```

- `isAnnotated`: any of verdict/tag(trimmed)/note(trimmed) non-empty.
- `toStored`: copies verdict/tag/note + `node.name`, `node.kind`, `node.model`, `node.input?.slice(0, SNAPSHOT_CAP)`, `node.output?.slice(0, SNAPSHOT_CAP)`.
- `buildRows`: for each label in `labels`, for each spanId, emit a row (missing fields → "").
- `toCSV`: header row `conversation,span_id,name,kind,model,input,output,verdict,tag,note`; each field wrapped in quotes if it contains `,"\n`, internal `"` doubled; input/output truncated to 300 chars.

Pure, dependency-free, fully tested. The canonical model is untouched.

## 4. Persistence — `src/lib/annotationStore.ts`

Thin, testable (accepts a `Storage`, defaults to `localStorage`):

```ts
const KEY = "tracelens:annotations";
type Store = Record<string, Record<string, StoredAnnotation>>;

export function loadStore(storage?: Storage): Store;          // parse KEY; {} on missing/corrupt
export function loadForLabel(label: string, storage?: Storage): Record<string, StoredAnnotation>;
export function saveForLabel(label: string, anns: Record<string, StoredAnnotation>, storage?: Storage): void;
```

- All wrapped in try/catch: a `QuotaExceededError` or unavailable storage is swallowed (annotations still work in memory for the session).
- Corrupt JSON → treat as empty.

## 5. Hook — `src/hooks/useAnnotations.ts`

```ts
export function useAnnotations(label: string): {
  annotations: Record<string, StoredAnnotation>;
  setAnnotation: (node: RunNode, a: Annotation) => void;  // toStored; removes if !isAnnotated; persists
  annotatedIds: Set<string>;
};
```

- On `label` change, load that label's bucket from the store.
- `setAnnotation(node, a)`: if `isAnnotated(a)` → store `toStored(a, node)`; else delete the entry. Update state + `saveForLabel`.
- `annotatedIds` derived from the keys.

## 6. UI

- **`SpanDetail.tsx`** — add an "Annotation" block: two toggle buttons 👍 / 👎 (active one highlighted; re-click clears), a tag `<input>` with a `<datalist>` of tags already used in this trace, and a note `<textarea>`. Props: `annotation?: StoredAnnotation`, `onAnnotate: (a: Annotation) => void`. Each change calls `onAnnotate` with the merged annotation.
- **`SpanRow`** — when the span is in `annotatedIds`, render a small marker (👍/👎 or a colored dot) next to the name. Pass `annotatedIds` / a per-row verdict down from `TreeView`.
- **`AnnotationsView.tsx`** (new view) — props `{ annotations: Record<string, StoredAnnotation>; label: string; onSelect: (spanId: string) => void }`. The **list** renders the passed `annotations` (the hook's live current-label map, so it updates as you annotate): span name + verdict + tag + note (truncated), each row clickable → `onSelect(spanId)`. Empty state when none. A header export bar: a scope toggle (This conversation / All) + buttons **Export JSONL** / **Export CSV**. Export runs **on click** (not on render): for "This conversation" build rows from `{ [label]: annotations }`; for "All" call `loadStore()` then `buildRows`; serialize via `toJSONL`/`toCSV`; download via a small blob helper. A button is disabled when its scope has no rows (for "All", that check can read `loadStore()` once on render).
- **`lib/views.ts`** — register an `annotations` view (`status: "ready"`).
- **`App.tsx`** — `const ann = useAnnotations(label)`; pass `ann.annotations[selectedId]` + `onAnnotate` to `SpanDetail` (where `onAnnotate(a)` → `ann.setAnnotation(selectedNode, a)`), `ann.annotatedIds` to `TreeView`, and render `<AnnotationsView annotations={ann.annotations} label={label} onSelect={setSelectedId} />` for the annotations view.

## 7. Error handling / edge cases

- localStorage unavailable or full → store ops are no-ops (caught); annotations still work in-memory this session; no crash, no error toast.
- Corrupt stored JSON → treated as empty store.
- Exporting an empty scope → the format buttons are disabled.
- No trace loaded → no annotation UI (the views require a trace, as today).
- A live/growing file: the snapshot is captured at annotation time (labeling what you saw); later growth doesn't rewrite it.
- Re-opening the same conversation (same label) restores annotations; the verdict marker and detail control reflect them.

## 8. Testing

- **`src/core/annotations.test.ts` (pure):** `isAnnotated` (empty vs each field); `toStored` (copies fields, truncates input/output to `SNAPSHOT_CAP`); `buildRows` (joins, missing → ""); `toJSONL` (one parseable object per line); `toCSV` (escapes a field with comma/quote/newline, doubles quotes, truncates input/output to 300, header present).
- **`src/lib/annotationStore.test.ts`:** with an in-memory fake `Storage` — save then load round-trips; `loadStore` returns `{}` for missing and for corrupt JSON; a throwing storage (quota) is swallowed.
- **Hook / UI:** runtime-verified (preview) + manual checklist.
- **Gate:** `typecheck && test && build` green; all existing tests stay green.

## 9. Execution order (incremental, green at every step)

1. `core/annotations.ts` + test (TDD, pure).
2. `lib/annotationStore.ts` + test (in-memory Storage).
3. `hooks/useAnnotations.ts`.
4. `SpanDetail` annotation control + App wiring of `onAnnotate`/`annotation`.
5. `SpanRow`/`TreeView` annotated marker.
6. `AnnotationsView` + `views.ts` registration + App render + export download.
7. Verification gate, then the manual checklist.

## 10. Risks & mitigations

- **Storage growth** — input/output capped at 8000 chars per annotation; thousands fit in the ~5MB budget; if it ever fills, writes are swallowed (in-memory still works).
- **Label collisions** — different traces sharing a label share annotations; rare (timestamped filenames); a content-hash key is a later refinement.
- **CSV with big cells** — input/output truncated to 300 chars in CSV (human view); JSONL keeps the (8000-capped) text for evals.
- **Scope creep** — rating scales, multi-tag, cross-trace dedup, and eval-framework-specific formats are explicit later enhancements.
