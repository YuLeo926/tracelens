# Search + Jump-to-Errors — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Sub-project:** 2 of N in the v1 effort (first feature on the redesigned shell). Builds on the foundation merged in sub-project 1. Plugs real behavior into the already-present `SearchBox` stub.

## 1. Goal

Make the call tree searchable and navigable: type to filter the tree live across the most useful fields, step through matches, and jump straight to the next error or the slowest span — the core of turning Tracelens from a viewer into a debugger.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Interaction model | Inline live filter of the tree + match stepping (not a ⌘K palette) |
| Searched fields | `name`, `model`, `input`, `output`, `statusMessage` (case-insensitive substring) |
| Quick-jumps | Next error, slowest span (loop detection is out — later) |
| Filter behavior | Hide non-matching/non-ancestor rows (collapse to matches + their ancestor chain), not dim |
| Where logic lives | Pure, tested `src/core/search.ts`; React renders over it |
| Where state lives | `App` (alongside `trace`/`selectedId`/`activeView`); no new context |

## 3. Scope

### In scope
- Live text filter of the tree: matches keep their full ancestor chain visible for structural context; everything else is hidden while a query is active.
- Matched rows are highlighted (background tint); when the match is in the span **name**, the matched substring is emphasized.
- Match navigation: previous / next, a `current / total` count (e.g. `3 / 12`), and clear. Stepping selects the match (detail panel follows) and scrolls it into view.
- Quick-jumps in the top bar: "next error" and "slowest span" — each selects + scrolls to the target. Independent of the text query.
- Keyboard: `⌘K` / `Ctrl+K` focuses the search box; `Esc` clears + blurs; `Enter` / `Shift+Enter` step next / previous while the box is focused.
- Applies to the **tree** view. Loading a new trace resets the query and match position.

### Non-goals (explicitly out)
- Loop detection (repeated tool-call pattern detection).
- Search inside the flamegraph / diff stub views.
- Regex or advanced query syntax (plain case-insensitive substring only).
- Cross-trace search, search history, or persistence.
- Highlighting matched substrings inside input/output bodies (only the tree-row name gets substring emphasis).

## 4. Pure core module — `src/core/search.ts`

Framework-agnostic, no React, unit-tested — consistent with the rest of `src/core/`.

```ts
export interface SearchResult {
  matchIds: Set<string>;       // spans that themselves match
  visibleIds: Set<string>;     // matches ∪ all ancestors of matches
  orderedMatchIds: string[];   // matchIds in display (pre-order DFS) order
}

// Case-insensitive substring of `query` in name/model/input/output/statusMessage.
export function spanMatchesQuery(node: RunNode, query: string): boolean;

// Empty/whitespace query → { matchIds:∅, visibleIds:∅, orderedMatchIds:[] }.
// Otherwise visibleIds = every node that matches OR has a matching descendant.
export function searchTrace(roots: RunNode[], query: string): SearchResult;

// Error spans in display order (for "next error" stepping).
export function errorSpanIds(roots: RunNode[]): string[];

// Id of the span with the greatest durationMs, or null if there are none.
export function slowestSpanId(roots: RunNode[]): string | null;
```

`searchTrace` uses a single pre-order DFS: a node is added to `visibleIds` if it matches or any descendant matches; matching nodes are pushed to `orderedMatchIds` in pre-order (which equals on-screen row order, since children are already start-sorted by `parse.ts`).

## 5. State & data flow (in `App`)

- New state: `query: string` and `matchIndex: number` (position within `orderedMatchIds`).
- Derived (memoized on `trace` + `query`): `search = searchTrace(trace.roots, query)`.
- `currentMatchId = search.orderedMatchIds[matchIndex] ?? null`.
- **To `TreeView`:** `query` (or a boolean `filtering`), `visibleIds`, `matchIds`, `currentMatchId`.
- **To `TopBar` → `SearchBox`:** `query`, `onQueryChange`, `matchCount = orderedMatchIds.length`, `matchPosition = matchIndex + 1`, `onPrevMatch`, `onNextMatch`, `onClear`; plus quick-jumps `onJumpNextError`, `onJumpSlowest`, and `errorCount` (to disable the error button at 0).
- Setting `query` resets `matchIndex` to 0 and, if there is a match, selects `orderedMatchIds[0]`.
- `onNextMatch` / `onPrevMatch`: advance `matchIndex` with wraparound over `orderedMatchIds`, set `selectedId` to the new current match.
- `onJumpNextError`: from `errorSpanIds`, select the first error after the current `selectedId` (wrapping); if none selected, the first error. Disabled when there are no errors.
- `onJumpSlowest`: select `slowestSpanId`.
- Any select (step or jump) updates `selectedId` so the detail panel follows; the tree scrolls the row into view (Section 6).
- Loading a new trace (`onLoad`) and `reset()` both clear `query` and `matchIndex`.

## 6. UI changes

- **`SearchBox`** (`components/shell/SearchBox.tsx`): becomes a controlled `<input>` (remove the `aria-disabled`/stub treatment). Layout: magnifier · text input · — when `query` non-empty — `matchPosition / matchCount`, up/down chevron buttons (prev/next, disabled at 0 matches), and a clear (×) button. Holds the `⌘K`-focus ref, and handles `Esc` (clear+blur) and `Enter`/`Shift+Enter` (next/prev).
- **`TopBar`**: gains two quick-jump buttons after the search area — `⚠ Error` (next error; disabled when `errorCount === 0`) and `⏱ Slowest`. Wired to `onJumpNextError` / `onJumpSlowest`.
- **`TreeView`**: when `query` is active, render rows from `visibleIds` (ignoring the collapse set — filtering takes over) in display order; otherwise unchanged. Scroll `currentMatchId` into view via a row `ref` + `scrollIntoView({ block: "nearest" })` when it changes.
- **`SpanRow`**: accepts `isMatch` and `query`. Matched rows get a subtle background tint (token-based). If `query` occurs in `node.name`, the matched substring is wrapped in an emphasis span (token-tinted background). Ancestor-only context rows render normally. Existing selected/error styling is preserved and composes with the match tint.
- **`⌘K` global listener**: a small effect in `App` (or a `useGlobalHotkey` helper) that focuses the search input on `⌘K`/`Ctrl+K` and prevents the browser default.

## 7. Edge cases / error handling

- Empty/whitespace query → no filtering, no matches, tree behaves exactly as today (collapse works); quick-jumps still work.
- Query with zero matches → tree shows an inline "No spans match" row; count shows `0`; prev/next disabled; `currentMatchId = null` (selection unchanged).
- Quick-jump with zero errors → "Error" button disabled.
- `slowestSpanId` on an empty trace → `null`; the "Slowest" button is a no-op (the loader guarantees ≥1 span, so this is defensive).
- Switching to a non-tree (stub) view while a query is set: the query is retained but only affects the tree; the search controls render in a disabled state off the tree view.
- Selecting a match/jump target that is inside a collapsed branch is moot while filtering (filtering ignores collapse); when not filtering, quick-jumps select the span and the tree need not expand for selection to show in the detail panel.

## 8. Testing

`src/core/search.test.ts` (Vitest, pure) using the bundled samples `research-agent.json` and `tool-error.json`:
- `spanMatchesQuery` matches on each field (name, model, input, output, statusMessage) and is case-insensitive; non-matches return false.
- `searchTrace`: `visibleIds` includes the ancestor chain of every match; `matchIds` excludes pure-ancestor nodes; `orderedMatchIds` is in display order; empty query yields all-empty sets.
- `errorSpanIds`: returns the one error span in `tool-error.json`; empty for `research-agent.json`.
- `slowestSpanId`: returns the longest span id for `research-agent.json`.

All existing tests stay green (core untouched except the new file). Final gate: `typecheck` + `test` + `build`; then dev-server verification — type a query and step matches, clear with Esc, and click "Error" on the `tool-error` sample to jump to the failed span (in both light and dark themes).

## 9. Execution order (incremental, green at every step)

1. `core/search.ts` + `core/search.test.ts` (TDD) — pure logic first.
2. `App` state: `query`/`matchIndex`, memoized `search`, the step/jump handlers, reset on load.
3. `SearchBox` controlled input + match count/nav/clear + `⌘K`/`Esc`/`Enter` keys.
4. `TopBar` quick-jump buttons wired through.
5. `TreeView` filtered rendering + scroll-into-view; `SpanRow` match tint + name substring emphasis.
6. Verification gate (Section 8).

## 10. Risks & mitigations

- **Keyboard focus / `⌘K` conflicts** — scope the global handler to `metaKey || ctrlKey` + `k`, `preventDefault`, and ignore when already typing in an input. Verified at runtime.
- **Scroll-into-view jitter** — only call `scrollIntoView` when `currentMatchId` actually changes (effect dependency), `block: "nearest"` to avoid large jumps.
- **Scope creep** — substring emphasis is limited to the tree-row name; input/output body highlighting and loop detection are explicit non-goals.
