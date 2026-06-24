# Live Tail — watch a local agent folder in real time

**Date:** 2026-06-24
**Status:** Approved (design), pending spec review
**Sub-project:** First v2 feature. Turns Tracelens from a post-mortem viewer into a live debugger: point it at a local agent-log folder and watch a run unfold as the agent writes it.

## 1. Goal

With one click ("📡 Watch a folder"), the user authorizes a local folder (e.g. `~/.codex/sessions` or `~/.claude/projects`). Tracelens finds the most-recently-modified session file in that folder, re-reads it on a short interval, and re-renders the tree / flamegraph / summary live as new spans appear — following the newest step like a live broadcast, while never stealing focus when the user is inspecting something. When a newer run starts, it switches to it automatically. 100% client-side; nothing is uploaded; the pure core is untouched.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| What to watch | A **folder**, auto-following the **newest** trace file in it (recursively) — not a single hand-picked file |
| Mechanism | **File System Access API** in the browser (Approach A) — `showDirectoryPicker` + polling. No backend, no helper process, no Tauri |
| Polling cadence | **Two cadences**: fast tick (~1.5s) re-reads the *current* file; slow tick (~5s) rescans the folder tree for a newer file and switches to it |
| Follow behavior | **Smart follow**: default follows the newest span (select + scroll); a manual click or scroll-up **pauses** following and shows a "↓ Back to live" pill; clicking it resumes |
| New-run handling | If following → auto-switch to the newer run seamlessly. If paused → don't steal; pill reads "↓ New run, go live" |
| Strict-parser interaction | Live parses are **best-effort**: a failed tick (usually a half-written last line) is silently skipped, keeping the last good render; only sustained failure shows a transient note. The strict parser is **not** weakened |
| Browser support | Chromium only (Chrome/Edge). Feature-detected: the entry point is hidden where unsupported; drag/drop is unaffected |
| Scope | Tree updates drive the live experience; flamegraph/summary reflect each fresh parse; search still applies. Diff stays a two-static-trace tool (not part of live) |

## 3. Architecture & data flow

The pure core (`src/core/`) is untouched except for one new pure module. Everything browser-specific lives in a thin glue layer + a React hook.

```
authorize folder → [slow ~5s] scan tree → pickNewestTraceFile() → current file path
                   [fast ~1.5s] re-read current file → parseTraceText() (existing)
                        → update trace state → tree / flamegraph / summary
```

**New files, each with one job:**

| File | Responsibility | Tested |
|---|---|---|
| `src/core/live.ts` | **Pure.** `pickNewestTraceFile(entries)` → newest `.json`/`.jsonl` by `lastModified` (tie-break: name desc); `latestSpanId(roots)` → span with max `startMs` | ✅ unit |
| `src/lib/folderWatch.ts` | Browser glue: `supportsFolderWatch()`, `pickFolder()`, `scanNewestTraceFile(dir)` (recurses subfolders, returns `{ name, lastModified, read() }`), `readText(handle)` | browser layer |
| `src/hooks/useLiveWatch.ts` | The two-cadence polling loop; emits `onUpdate({ trace, label, source, isNewFile })`, `onError`; exposes `{ state, folderName, currentFile, stop() }`. Accepts an injectable source for tests | ✅ via fake source |
| `src/components/live/LiveBar.tsx` | Top status strip: pulsing dot, "Live · watching `<folder>` · `<file>`", Stop button | runtime |
| `src/components/live/BackToLivePill.tsx` | Floating pill shown when paused; label varies (new spans vs new run) | runtime |

### `src/core/live.ts` (pure)

```ts
export interface TraceFileEntry { name: string; lastModified: number }

/** Newest .json/.jsonl by lastModified; ties broken by name (desc). null if none. */
export function pickNewestTraceFile(entries: TraceFileEntry[]): string | null;

/** Span with the greatest startMs (the most recently started step). null if empty. */
export function latestSpanId(roots: RunNode[]): string | null;
```

All decision logic ("which file is newest", "which span is newest") lives here, pure and tested. The browser layer only reads bytes.

### `src/lib/folderWatch.ts` (browser glue, thin)

- `supportsFolderWatch(): boolean` → `'showDirectoryPicker' in window`.
- `pickFolder(): Promise<FileSystemDirectoryHandle>` → wraps `showDirectoryPicker()`.
- `scanNewestTraceFile(dir): Promise<{ name; lastModified; read: () => Promise<string> } | null>` → recurse `dir` (depth-capped), collect file `{ name, lastModified }` via `getFile()`, delegate selection to `pickNewestTraceFile`, return a reader for the winner.
- TypeScript: if `showDirectoryPicker` / FSA handles are not in the project's DOM lib, add a minimal ambient declaration here (kept local to this file).

### `src/hooks/useLiveWatch.ts` (React)

Owns two `setInterval`s. Fast tick: re-fetch the current file's `File` (fresh `lastModified` + text); **if `lastModified` is unchanged since the last successful parse, skip** (no re-parse, no churn); otherwise `parseTraceText` → `onUpdate`. Slow tick: `scanNewestTraceFile(dir)` → if a different/newer file than the current one, adopt it (`isNewFile: true`). Per-tick `try/catch`: parse/read failures increment a failure counter and are swallowed (keep last good); a threshold surfaces a transient `onError`-style note without clearing state. `stop()` clears intervals and resets.

## 4. UI wiring

- **`src/components/Loader.tsx`** — add a third entry point button `📡 Watch a folder (live)`, rendered only when `supportsFolderWatch()`. Click → `pickFolder()` → start live mode.
- **`src/App.tsx`** — gains live state: the directory handle / hook, a `following: boolean` (default `true` in live mode), and `live: boolean`. On each `onUpdate`: set the trace; if `following`, `setSelectedId(latestSpanId(trace.roots))`. A manual `onSelect` (user click) or a scroll-up in the tree sets `following = false`. Renders `<LiveBar>` (when live) and `<BackToLivePill>` (when `live && !following`). The pill's click → `following = true` + jump to latest. Reset/Stop exits live mode and returns to the normal static view.
- **Smart scroll:** the tree must scroll the selected (newest) span into view while following. Reuse the existing selected-span scroll behavior; following just keeps `selectedId` pinned to `latestSpanId`.
- Other views are unchanged: flamegraph and summary re-render from the updated trace each tick; search applies to the latest parse.

## 5. Error handling / edge cases

- **Half-written file mid-tick** (the common case while tailing) → parse throws (strict parser) → tick swallows it, keeps last good render, retries next tick. The parser is **not** weakened.
- **Browser unsupported** → entry point hidden; drag/drop unaffected. (Defensive friendly message if reached programmatically.)
- **User cancels the picker** → no-op, stay on the loader.
- **Empty folder / no trace files** → LiveBar note "No session files found in this folder"; do not enter the live render.
- **Permission revoked / folder gone** → stop watching, friendly note, keep whatever is already on screen.
- **Non-trace `.json` is the newest file** → parse fails → treated as the half-written case (skipped); acceptable for MVP. (Later: prefer files an adapter `detect`s.)
- **Invariant:** live mode never blanks out what the user is already seeing.

## 6. Testing

- **`src/core/live.test.ts` (pure):** `pickNewestTraceFile` picks newest by `lastModified`, ignores non-`.json/.jsonl`, breaks ties by name, returns `null` on empty; `latestSpanId` returns the max-`startMs` span and `null` on empty.
- **`src/hooks/useLiveWatch.test.ts`:** drive the hook with an injected fake source emitting a sequence (new spans on the same file; a failing/half-written read; a newer file). Assert: `onUpdate` fires on real change only; a failing read is swallowed and the last good state is retained; a newer file triggers `isNewFile`.
- **Manual (user, in Edge):** a short checklist — pick `~/.codex/sessions`, run a real Codex command, watch spans grow live; click an old span (following pauses, pill appears); click the pill (jumps back to live); start a second run (auto-switches).
- **Gate:** `npm run typecheck && npm test && npm run build` all green; v1's pure-core tests stay green.

## 7. Execution order (incremental, green at every step)

1. `core/live.ts` + `core/live.test.ts` (TDD, pure).
2. `lib/folderWatch.ts` (glue + feature detection + ambient FSA types if needed).
3. `hooks/useLiveWatch.ts` + its test (injected fake source).
4. `components/live/LiveBar.tsx` + `BackToLivePill.tsx`.
5. Loader entry point + App wiring (`following`/`live` state, smart follow).
6. Verification gate, then the manual Edge checklist.

## 8. Risks & mitigations

- **Big/deep Codex folders** (`sessions/YYYY/MM/DD/…`, thousands of files) — the two-cadence split keeps in-run updates cheap; the recursive scan runs only every ~5s and is depth-capped. A later optimization can prune by dated subfolder name.
- **Tailing jitter** (reading mid-write) — best-effort per-tick parse with last-good retention absorbs it without weakening the parser.
- **FSA can't be automated** — pure logic is fully unit-tested; the hook is tested via an injected source; only the real picker + live render is verified manually by the user.
- **Scope creep** — handle persistence, incremental byte reads, `FileSystemObserver` push, and the Tauri desktop build are explicit later enhancements, out of this spec.
