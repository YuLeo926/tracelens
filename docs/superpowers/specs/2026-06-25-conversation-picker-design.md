# Conversation Picker — browse a folder's conversations by title

**Date:** 2026-06-25
**Status:** Approved (design), pending spec review
**Sub-project:** Second v2 feature. Builds on live-tail. Solves the user's real pain: agent-log filenames are timestamp+UUID, so you can't tell which file is which conversation. Picking a folder now shows a browsable list of conversations labeled by their first user message + project, and you click the one you want.

## 1. Goal

Open a local agent-log folder (e.g. `~/.codex/sessions`) and immediately see a **browsable list of its conversations**, each row showing the **first user message** (title), the **project** it ran in (cwd), and a **relative time**. Click a conversation to view it — watching it live if it's still being written, static if it's past. A "📡 Follow newest" button gives the existing auto-follow-newest live mode. Titles come from reading only each file's **head** (no full parse), so it stays fast even with 76MB files. 100% client-side; the pure core is untouched except for one new pure module.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Entry flow | Pick a folder → **conversation list** (browse-first), not auto-follow |
| Row content | First user message (title) · project = cwd's last segment · relative time · a green dot if recently modified (active) |
| Title source | Cheap: read only each file's **head (~256KB)** and extract; never full-parse for the list |
| Click behavior | Watch that specific file, **locked** (live if active, static if past — no auto-switch) |
| Follow newest | A top button → the existing auto-follow-newest live mode (engine's default) |
| Loading | Times render immediately; titles fill in progressively as heads are read |
| Filter | A client-side search box over title/project (no file reads) |
| Scope | Show the newest **300** conversations, newest-first; note if capped |
| Browser | Chromium only (already feature-detected via the folder entry) |

## 3. Architecture & data flow

```
open folder → listCandidates (have: name + mtime, newest-first)
            → per file: read head ~256KB → extractConversationMeta (pure) → { title?, project? }
            → render ConversationList (time first, titles progressive)
click a row → useLiveWatch.watchFile(dir, name)  [engine locked to that file]
"Follow newest" → useLiveWatch.followNewest(dir) [engine auto-switch — existing]
```

**New / changed units:**

| File | Responsibility | Tested |
|---|---|---|
| `src/core/conversationMeta.ts` (new) | **Pure.** `extractConversationMeta(head, fileName) → { title?, project? }`; knows Codex rollout / Claude transcript / generic | ✅ unit |
| `src/lib/folderWatch.ts` (modify) | Add `readHead(handle, maxBytes)` (via `File.slice`) and `listConversations(dir, limit) → ConversationEntry[]` (walk + head-read + extract, newest-first) | browser glue |
| `src/lib/liveEngine.ts` (modify) | Add a **locked** mode (`lockTo`): follow exactly one file, slow tick never switches away | ✅ unit |
| `src/hooks/useConversations.ts` (new) | React wrapper around `listConversations`: loading / progressive results / empty / error | runtime |
| `src/hooks/useLiveWatch.ts` (modify) | Add `watchFile(dir, name)` (locked) alongside `followNewest(dir)` | runtime |
| `src/components/live/ConversationList.tsx` (new) | The browse screen: header + filter + rows + "Follow newest" | runtime |
| `src/App.tsx` (modify) | Folder mode gains a list ↔ trace navigation; LiveBar gets a "← Conversations" action | runtime |

### `src/core/conversationMeta.ts` (pure)

```ts
export interface ConversationMeta {
  title?: string;   // first user message, whitespace-collapsed, truncated
  project?: string; // cwd's last path segment
}

/** Extract a human label from the HEAD of a trace file (JSON or JSONL). */
export function extractConversationMeta(head: string, fileName: string): ConversationMeta;
```

Logic (head split into JSONL lines, each `JSON.parse`d, malformed/truncated lines skipped):

- **project:** first object with `payload.cwd` (Codex `session_meta`) or top-level `cwd` (Claude) → last path segment (split on `/` and `\`).
- **title (Codex):** first object where `payload.type === "message" && payload.role === "user"` → join the `text` of its `content[]` blocks. **Skip `role` of `developer`/`system`/`tool`.**
- **title (Claude):** first object where `type === "user"` and `message.role === "user"` → text of `message.content` (string, or `text` blocks joined).
- **fallback:** if no user message is found (or the head is a truncated single JSON document), leave `title` undefined — the UI shows `fileName`.
- **cleanup:** collapse whitespace; if the text opens with an injected tag block (e.g. `<environment_context …>…</…>`), drop that leading block and take what follows; truncate to ~120 chars.

Pure, dependency-free, fully tested. The canonical model is untouched.

### `src/lib/folderWatch.ts` (modify)

- `readHead(handle: FileSystemFileHandle, maxBytes = 262144): Promise<string>` → `(await handle.getFile()).slice(0, maxBytes).text()`.
- `listConversations(dir, limit = 300): Promise<ConversationEntry[]>` where `ConversationEntry = { name: string; lastModified: number; title?: string; project?: string }`. Walks the tree (reusing the existing recursion), sorts newest-first, keeps the newest `limit`, reads each head, calls `extractConversationMeta`. A per-file try/catch means one unreadable file just yields `{ name, lastModified }` with no title.

### `src/lib/liveEngine.ts` (modify — locked mode)

`createLiveWatcher(source, cb, opts?: { lockTo?: string })`:
- If `opts.lockTo` is set: `init` adopts exactly that file (read + parse + emit, or status `no-trace`/`stalled` on failure); `slowTick` is a **no-op** (never scans for a newer file); `fastTick` re-reads the locked file as today (live updates; unchanged mtime is skipped → a past file is effectively static).
- If not set: today's auto-follow-newest behavior, unchanged.

### `src/hooks/useLiveWatch.ts` (modify)

- `followNewest(dir)` — today's `start(dir)` (auto-follow newest).
- `watchFile(dir, name)` — creates the source + a watcher with `{ lockTo: name }`.
- Both share the interval/teardown machinery and the `onUpdate`-ref pattern. `stop()` unchanged.

## 4. UI & wiring

- **`Loader.tsx`:** the existing "📡 Watch a folder" button now leads to the conversation list (label/wording may say "Watch a folder" still). Feature-detect unchanged.
- **`ConversationList.tsx`:** header `📂 <folder> · N conversations` + a **📡 Follow newest (live)** button + a close (→ loader); a filter `<input>` (client-side, matches title/project); a scrollable list. Each row: title (or filename), project (muted), relative time, and a green dot when `Date.now() - lastModified` is small (e.g. < 2 min). Click a row → `onOpen(name)`. Times show immediately; titles appear as `useConversations` resolves them.
- **`App.tsx`:** folder mode state — `dir: FileSystemDirectoryHandle | null`, and a view of `"list" | "trace"`. `useConversations(dir)` is called **at the App level** (not inside `ConversationList`), so the scanned list persists across list ↔ trace navigation — returning via "← Conversations" is instant, with no re-read.
  - Open folder → `dir` set, view `"list"`, `useConversations(dir)` runs.
  - Row click → `liveWatch.watchFile(dir, name)`, view `"trace"`.
  - "Follow newest" → `liveWatch.followNewest(dir)`, view `"trace"`.
  - In the trace view, **LiveBar** gains a `← Conversations` button → `liveWatch.stop()`, view `"list"`.
  - Close → exit folder mode → loader.
- The trace view (tree/flamegraph/diff/detail, LiveBar, BackToLivePill) is otherwise unchanged; locked vs follow-newest only differ inside the engine.

## 5. Error handling / edge cases

- Empty folder / no trace files → list shows "No conversations found in this folder."
- A file's head can't be read or has no user message → that row shows `fileName` + time (no title); the list still renders.
- Folder with > 300 files → show the newest 300, with a "showing the most recent 300" note.
- Opening a conversation that fails to parse / is mid-write / is 76MB → handled by the existing live engine (best-effort parse, status, re-entrancy guard).
- Locked on a past (unchanging) file → fast tick skips on unchanged mtime → effectively static, no churn.
- Non-Chromium browser → folder entry already hidden; nothing new.

## 6. Testing

- **`src/core/conversationMeta.test.ts` (pure):** built-from-scratch heads — a Codex head yields `title` = the first **user** text and `project` = cwd's last segment, and **skips** a leading `developer` message; a Claude head yields the first user `title`; a generic/truncated head yields `{}` (UI falls back to filename); missing cwd → no `project`; injected `<environment_context>` lead is stripped. No real conversation content in tests.
- **`src/lib/liveEngine.test.ts` (extend):** with `{ lockTo: "X" }`, `init` adopts `X` even when a newer parseable `Y` exists, and `slowTick` does **not** switch to `Y`; `fastTick` still re-emits when `X` grows.
- **Runtime (preview + real folder):** open `~/.codex/sessions` → list shows titles + projects + times; click an old conversation opens it; "Follow newest" goes live; the filter narrows the list; "← Conversations" returns.
- **Gate:** `typecheck && test && build` green; all existing tests stay green.

## 7. Execution order (incremental, green at every step)

1. `core/conversationMeta.ts` + test (TDD, pure).
2. `liveEngine.ts` locked mode + test (TDD extension).
3. `folderWatch.ts`: `readHead` + `listConversations`.
4. `hooks/useConversations.ts` + `useLiveWatch.watchFile`.
5. `ConversationList.tsx`.
6. `App.tsx` list ↔ trace navigation + LiveBar back button.
7. Verification gate, then the manual real-folder checklist.

## 8. Risks & mitigations

- **First user message past 256KB** (huge injected developer context) → title falls back to filename; 256KB is generous and covers the observed structure (user message at record ~3). Could raise the cap later if needed.
- **Noisy titles** (prompt opens with injected tags) → the cleanup step strips a leading tag block; good-enough labels, refine later.
- **Many head reads** (300 × 256KB ≈ 75MB of reads) → bounded and one-time per folder open; progressive rendering keeps it responsive. Caching heads/titles (e.g. IndexedDB) is a later enhancement.
- **Scope creep** — rich per-row stats (span/error/token counts) need a full parse and are explicitly out; only head-cheap fields are shown.
