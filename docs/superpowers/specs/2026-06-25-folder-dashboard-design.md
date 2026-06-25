# Folder Overview Dashboard — Design

**Date:** 2026-06-25
**Status:** Approved (design), pending spec review
**Sub-project:** Fourth v2 feature. Opening a local agent-log folder shows an **Overview** dashboard (alongside the existing **Conversations** list) that aggregates the folder at a glance: conversations by project, token usage + estimated cost, an activity timeline, and which runs failed.

## 1. Goal

Open a folder → an **Overview** tab (default) summarizes everything: a row of stat cards (conversations, tokens, ≈cost, failed runs), conversations grouped **by project** (click a project to jump to the filtered Conversations list), an **activity** bar chart (runs/day over ~14 days), and a **failed-runs** list (click to open). The cheap metrics (project, tokens, activity) come from reading each file's **head + tail** only, so they render in seconds even across a 1 GB folder. The expensive "failed?" signal is computed by a **background full-parse, newest-first, cached** by file+mtime (files > 30 MB skipped). A **Conversations** tab holds the existing picker. 100 % client-side.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Metrics | Conversations by **project**, **token usage** + **≈ estimated cost**, **failed runs**, **activity over time** |
| Placement | Two tabs when a folder is open: **Overview** (default) / **Conversations** (the existing list) |
| Cheap data | project (head cwd), title (head), start time (head 1st ts), last-active (mtime), tokens (tail), model (head) — head + tail reads only |
| Tokens | Codex cumulative `token_count` read from the **tail**; accurate. Claude/other: best-effort (may be absent) |
| Cost | Estimated from tokens × a small built-in per-model price table (fallback rate); always labelled "≈ est." |
| Failed runs | Background full-parse (`summary.errors > 0`), **newest-first**, **cached** by `name:mtime` in `localStorage`, files **> 30 MB skipped** ("not analyzed"); progressive "analyzing N/M" |
| Project click | Switches to the Conversations tab pre-filtered to that project |
| Failed-item click | Opens that conversation (existing `watchFile`) |

## 3. Architecture & data flow

```
open folder
 ├─ head+tail scan per conversation (extend the existing head scan)
 │    head → project, title, startMs, model ; tail → tokensIn/Out ; file → mtime, size
 │    → aggregateDashboard(records)  (pure)  → dashboard model    ← renders in seconds
 └─ background failed-scan (newest-first, skip > 30 MB)
      → full parseTraceText → summary.errors > 0 ? "failed" : "ok"
      → cache by `name:mtime` in localStorage → instant next time
      → fills the failed count/list progressively
```

**New / changed units:**

| File | Responsibility | Tested |
|---|---|---|
| `src/core/folderStats.ts` (new) | **Pure.** `extractTokens(tail)`, `startMsOf(head)`, `estimateCostUsd(tIn,tOut,model)` (+ price table), `aggregateDashboard(records)` → `DashboardModel` | ✅ unit |
| `src/lib/folderWatch.ts` (modify) | Add `readTail(handle, maxBytes)` (read the last N bytes via `File.slice`) | browser glue |
| `src/hooks/useConversations.ts` (modify) | Read head **and** tail; each `Conversation` gains `startMs?`, `tokensIn?`, `tokensOut?`, `model?`, `sizeBytes` | runtime |
| `src/lib/failedScan.ts` (new) | Pure-ish cache helpers: `cacheKey(name,mtime)`, `loadFailedCache`/`saveFailedCache` (Storage-injectable), `shouldScan(entry, cache)` | ✅ unit (cache logic) |
| `src/hooks/useFailedScan.ts` (new) | Background scan loop (newest-first, throttled, cancellable) + cache; returns `Map<name, "ok"|"failed"|"skipped"|"pending">` + progress | runtime |
| `src/components/live/DashboardView.tsx` (new) | The dashboard UI (cards, by-project, activity chart, failed list) | runtime |
| `src/components/live/FolderBrowser.tsx` (new) | Tab header (Overview / Conversations + follow-newest + close) wrapping `DashboardView` / `ConversationList` | runtime |
| `src/components/live/ConversationList.tsx` (modify) | Drop its own header/close (moved to FolderBrowser); accept an initial `projectFilter` | runtime |
| `src/App.tsx` (modify) | Render `FolderBrowser` instead of `ConversationList`; hold dashboard data + failed scan | runtime |

### `src/core/folderStats.ts` (pure)

```ts
export interface ConvStat {
  name: string;
  project?: string;
  startMs?: number;     // when the run began
  lastModified: number;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
  sizeBytes: number;
}

export interface ProjectRow { project: string; count: number; tokens: number; lastActive: number; }
export interface DayBar { day: string; count: number; } // "YYYY-MM-DD"

export interface DashboardModel {
  conversationCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  estCostUsd: number;
  projects: ProjectRow[];       // sorted by lastActive desc
  activity: DayBar[];           // last 14 days, oldest→newest
}

/** Codex rollout cumulative tokens: the LAST event_msg token_count in the tail. */
export function extractTokens(tail: string): { tokensIn: number; tokensOut: number } | null;

/** First timestamp found in the head (epoch ms), or undefined. */
export function startMsOf(head: string): number | undefined;

/** Rough estimate; prices in a per-model table with a fallback. Labelled "≈". */
export function estimateCostUsd(tokensIn: number, tokensOut: number, model?: string): number;

/** Aggregate per-conversation stats into the dashboard model (pure). */
export function aggregateDashboard(stats: ConvStat[], now: number): DashboardModel;
```

- `extractTokens`: split the tail into JSONL lines, scan for the last object with `payload.type === "token_count"`, read `payload.info.total_token_usage.input_tokens` / `output_tokens`.
- `aggregateDashboard`: group by `project ?? "(unknown)"`; sum tokens; activity = counts per day (using `startMs ?? lastModified`) for the last 14 days; `estCostUsd` = sum of `estimateCostUsd` per conversation.
- The price table lives here as a small `const`; one place to update.

### `src/lib/failedScan.ts`

```ts
export type FailedState = "ok" | "failed" | "skipped" | "unknown";
export const MAX_SCAN_BYTES = 30 * 1024 * 1024;
export function cacheKey(name: string, lastModified: number): string;       // `${name}:${lastModified}`
export function loadFailedCache(s?: Storage): Record<string, FailedState>;
export function saveFailedCache(c: Record<string, FailedState>, s?: Storage): void;
```

`useFailedScan(dir, conversations)`: newest-first, for each not in cache and `sizeBytes <= MAX_SCAN_BYTES`: read full text, `parseTraceText`, set `failed`/`ok` (parse throw → `unknown`, not cached); > 30 MB → `skipped`. One at a time (re-entrancy guard); cancel on `dir` change/unmount; persist to cache after each. Returns the merged `Map` + `{ done, total }` progress.

## 4. UI

- **`FolderBrowser`** — header: `📂 <folder>` · tabs **Overview** / **Conversations** · **📡 Follow newest** · **Close**. Body renders `DashboardView` or `ConversationList` by the active tab. Holds the `tab` + `projectFilter` state. A project click in the dashboard sets `projectFilter` + switches to Conversations.
- **`DashboardView`** props `{ model: DashboardModel; failed: { states: Map<string, FailedState>; done: number; total: number }; conversations: Conversation[]; onOpen: (name)=>void; onPickProject: (project)=>void }`. Renders: stat cards; by-project list (click → `onPickProject`); a 14-day SVG bar chart; the failed list (conversations whose state is `failed`, click → `onOpen`) with the "analyzing N/M" line and a "X too large, not analyzed" note.
- **`ConversationList`** — its folder/close header moves to `FolderBrowser`; keep the filter + list; accept `projectFilter?: string` to pre-filter rows by project (the filter box still works on top).
- **`App.tsx`** — when `folderDir && folderView === "list"` render `<FolderBrowser …>`; compute `const dashboard = useMemo(() => aggregateDashboard(convo.conversations, Date.now()), [convo.conversations])` (the richer `Conversation` carries every `ConvStat` field, so it's passed directly — structural typing, no mapper); `const failed = useFailedScan(folderDir, convo.conversations)`.

## 5. Error handling / edge cases

- localStorage unavailable/full → failed-cache no-ops; the scan still runs in-memory this session; no crash.
- Empty folder / no conversations → dashboard shows zeros + an empty state; failed list empty.
- A conversation that fails to parse mid-scan (e.g. a live half-write) → `unknown`, not cached, excluded from counts.
- Tokens absent (non-Codex or no token_count in tail) → that conversation contributes 0 tokens; total still valid.
- Unknown model in the price table → fallback rate; cost stays an estimate.
- Switching folder / closing during a scan → the scan is cancelled (no stale writes).
- Non-Chromium → the folder entry is already hidden (feature-detected).

## 6. Testing

- **`src/core/folderStats.test.ts` (pure):** `extractTokens` (finds the last token_count and sums; returns null when none); `startMsOf` (first timestamp; undefined when none); `estimateCostUsd` (a known model vs the fallback); `aggregateDashboard` (groups by project incl. "(unknown)", sums tokens, buckets activity per day over 14 days, sorts projects by last-active, computes est cost).
- **`src/lib/failedScan.test.ts`:** `cacheKey` shape; `loadFailedCache`/`saveFailedCache` round-trip with an in-memory `Storage`; corrupt/missing → `{}`.
- **Hooks / dashboard UI:** runtime-verified (preview) + the manual checklist.
- **Gate:** `typecheck && test && build` green; all existing tests stay green.

## 7. Execution order (incremental, green at every step)

1. `core/folderStats.ts` + test (TDD, pure).
2. `lib/failedScan.ts` (cache helpers) + test.
3. `folderWatch.ts` `readTail`; extend `useConversations` (head+tail, richer `Conversation`).
4. `hooks/useFailedScan.ts` (background scan).
5. `DashboardView.tsx`.
6. `FolderBrowser.tsx` + `ConversationList` header split + `App` wiring (tabs, project filter).
7. Verification gate, then the manual real-folder checklist.

## 8. Risks & mitigations

- **First failed-scan cost** on a 1 GB folder — bounded by skip-> 30 MB, newest-first (recent statuses appear first), throttled one-at-a-time, and cached so it's one-time per file. The cheap metrics never wait on it.
- **Cost accuracy** — explicitly an estimate from a small price table; labelled "≈"; tokens (the accurate number) are shown alongside.
- **Tail token extraction fragility** — if the format shifts, tokens degrade to 0 for that conversation (no crash); a later refinement can broaden the parser.
- **Scope creep** — per-step error breakdowns, cross-folder trends, configurable date ranges, and editable prices are explicit later enhancements.
```
