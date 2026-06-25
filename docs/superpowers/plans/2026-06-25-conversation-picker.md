# Conversation Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Picking a local agent-log folder shows a browsable list of its conversations (first user message + project + relative time), and clicking one watches that specific file (live if active, static if past).

**Architecture:** A pure `extractConversationMeta(head)` pulls a title + project from just the head of each file (no full parse). `folderWatch` gains `scanTraceFiles` + `readHead`; a `useConversations` hook lists them progressively. The live engine gains a `lockTo` mode (follow one file, never auto-switch). `App` adds a list ↔ trace navigation.

**Tech Stack:** React 18 + TypeScript (strict, `noUnusedParameters`), Vite 6, Vitest. File System Access API (Chromium).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/conversationMeta.ts` (new) | Pure: `extractConversationMeta(head) → { title?, project? }` |
| `src/core/conversationMeta.test.ts` (new) | Unit tests for the extractor |
| `src/core/format.ts` (modify) | Add `formatRelativeTime(then, now?)` |
| `src/core/format.test.ts` (modify or new) | Unit test for relative time |
| `src/lib/liveEngine.ts` (modify) | Add `{ lockTo }` mode |
| `src/lib/liveEngine.test.ts` (modify) | Test locked mode |
| `src/lib/folderWatch.ts` (modify) | Add `readHead`, `scanTraceFiles`, `TraceFileRef` |
| `src/hooks/useConversations.ts` (new) | Progressive list of conversations with titles |
| `src/hooks/useLiveWatch.ts` (modify) | `followNewest` + `watchFile` (locked) |
| `src/components/live/ConversationList.tsx` (new) | Browse screen |
| `src/components/live/LiveBar.tsx` (modify) | Relabel the back button "← Conversations" (keep `onStop`) |
| `src/components/live/LiveStandby.tsx` (modify) | Relabel the back button "← Conversations" (keep `onStop`) |
| `src/App.tsx` (modify) | Folder list ↔ trace navigation |

---

## Task 1: Pure title/project extractor

**Files:**
- Create: `src/core/conversationMeta.ts`
- Test: `src/core/conversationMeta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/conversationMeta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractConversationMeta } from "./conversationMeta";

// One JSON object per line, like a real rollout head.
const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n");

describe("extractConversationMeta", () => {
  it("reads a Codex rollout: cwd project + first USER message, skipping developer", () => {
    const head = lines(
      { type: "session_meta", payload: { id: "s1", cwd: "E:/work/native_edge_bridge" } },
      { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "SYSTEM INSTRUCTIONS, ignore me" }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Add a dark mode toggle" }] } },
    );
    expect(extractConversationMeta(head)).toEqual({
      title: "Add a dark mode toggle",
      project: "native_edge_bridge",
    });
  });

  it("reads a Claude transcript: cwd + first user message", () => {
    const head = lines(
      { type: "user", cwd: "/home/me/proj-x", message: { role: "user", content: "Fix the build" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Sure" }] } },
    );
    expect(extractConversationMeta(head)).toEqual({ title: "Fix the build", project: "proj-x" });
  });

  it("strips a leading injected tag block from the title", () => {
    const head = lines({
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\ncwd=/x\n</environment_context>\nWhat does foo() do?" }] },
    });
    expect(extractConversationMeta(head).title).toBe("What does foo() do?");
  });

  it("returns empty for a generic / truncated head (no user message)", () => {
    expect(extractConversationMeta('{"spans": [ {"span_id": "a", "nam')).toEqual({});
  });

  it("omits project when there is no cwd", () => {
    const head = lines({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } });
    expect(extractConversationMeta(head)).toEqual({ title: "hi" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/conversationMeta.test.ts`
Expected: FAIL — `Failed to resolve import "./conversationMeta"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/conversationMeta.ts`:

```ts
// Pure: pull a human label (first user message + project) from the HEAD of a
// trace file, without a full parse. Knows Codex rollout and Claude transcript
// JSONL; returns {} for anything else (the UI falls back to the file name).

export interface ConversationMeta {
  title?: string;
  project?: string;
}

const MAX_TITLE = 120;

function blockText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((b) => (b && typeof b === "object" ? (b as { text?: unknown }).text : undefined))
      .filter((x): x is string => typeof x === "string");
    return parts.length ? parts.join("\n") : undefined;
  }
  return undefined;
}

function userText(rec: unknown): string | undefined {
  if (!rec || typeof rec !== "object") return undefined;
  const r = rec as { type?: unknown; payload?: { type?: unknown; role?: unknown; content?: unknown }; message?: { role?: unknown; content?: unknown } };
  // Codex rollout: { payload: { type: "message", role: "user", content } }
  if (r.payload && r.payload.type === "message" && r.payload.role === "user") {
    return blockText(r.payload.content);
  }
  // Claude transcript: { type: "user", message: { role: "user", content } }
  if (r.type === "user" && r.message && r.message.role === "user") {
    return blockText(r.message.content);
  }
  return undefined;
}

function cwdOf(rec: unknown): string | undefined {
  if (!rec || typeof rec !== "object") return undefined;
  const r = rec as { cwd?: unknown; payload?: { cwd?: unknown } };
  const cwd = (typeof r.payload?.cwd === "string" && r.payload.cwd) || (typeof r.cwd === "string" && r.cwd);
  return cwd || undefined;
}

function lastSegment(path: string): string | undefined {
  const segs = path.split(/[/\\]+/).filter(Boolean);
  return segs.length ? segs[segs.length - 1] : undefined;
}

function cleanTitle(raw: string): string {
  // Drop one or more leading XML-ish tag blocks (e.g. <environment_context>…</…>).
  let s = raw.replace(/^\s*(<([a-zA-Z_][\w-]*)\b[^>]*>[\s\S]*?<\/\2>\s*)+/, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) s = raw.replace(/\s+/g, " ").trim();
  return s.length > MAX_TITLE ? s.slice(0, MAX_TITLE - 1) + "…" : s;
}

/** Extract a title + project from the head text of a trace file. */
export function extractConversationMeta(head: string): ConversationMeta {
  const records: unknown[] = [];
  for (const line of head.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      // partial/truncated last line — skip
    }
  }

  const meta: ConversationMeta = {};
  for (const r of records) {
    const cwd = cwdOf(r);
    if (cwd) {
      const seg = lastSegment(cwd);
      if (seg) meta.project = seg;
      break;
    }
  }
  for (const r of records) {
    const text = userText(r);
    if (text && text.trim()) {
      meta.title = cleanTitle(text);
      break;
    }
  }
  return meta;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/conversationMeta.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/conversationMeta.ts src/core/conversationMeta.test.ts
git commit -m "feat(core): extract conversation title + project from a file head"
```

(Append a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` to every commit in this plan.)

---

## Task 2: Relative-time formatter

**Files:**
- Modify: `src/core/format.ts` (add an export)
- Test: `src/core/format.test.ts` (add cases; create the file if it does not exist)

- [ ] **Step 1: Write the failing test**

Add to `src/core/format.test.ts` (create it if missing, with this import line):

```ts
import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./format";

describe("formatRelativeTime", () => {
  const now = 1_000_000_000_000;
  it("formats recent times", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/format.test.ts`
Expected: FAIL — `formatRelativeTime` is not exported.

- [ ] **Step 3: Add the implementation**

Append to `src/core/format.ts`:

```ts
/** "just now" / "5m ago" / "3h ago" / "2d ago" / a date for older. */
export function formatRelativeTime(then: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/format.ts src/core/format.test.ts
git commit -m "feat(core): formatRelativeTime helper"
```

---

## Task 3: Live engine locked mode

**Files:**
- Modify: `src/lib/liveEngine.ts`
- Test: `src/lib/liveEngine.test.ts`

- [ ] **Step 1: Add the failing test**

Append this test inside the `describe("createLiveWatcher", …)` block in `src/lib/liveEngine.test.ts` (the helpers `harness`/`TRACE` already exist there):

```ts
  it("locked mode follows only the given file and never switches to a newer one", async () => {
    const { source } = fakeSource({
      candidates: [
        { name: "newer.jsonl", lastModified: 10 },
        { name: "picked.jsonl", lastModified: 5 },
      ],
      files: {
        "newer.jsonl": { lastModified: 10, text: TRACE("y") },
        "picked.jsonl": { lastModified: 5, text: TRACE("x") },
      },
    });
    const onUpdate = vi.fn();
    const w = createLiveWatcher(source, { onUpdate, onStatus: () => {} }, { lockTo: "picked.jsonl" });

    await w.init();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].label).toBe("picked.jsonl"); // not the newer one
    expect(w.currentFile()).toBe("picked.jsonl");

    await w.slowTick(); // must NOT switch to newer.jsonl
    expect(w.currentFile()).toBe("picked.jsonl");
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
```

> Note: `fakeSource` is defined at the top of this test file and returns `{ source, state }`; `harness` wraps it. Use `fakeSource` directly here as shown.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/liveEngine.test.ts`
Expected: FAIL — `createLiveWatcher` takes 2 args / lockTo ignored, so it adopts `newer.jsonl`.

- [ ] **Step 3: Implement locked mode**

In `src/lib/liveEngine.ts`, change the function signature and add the locked behavior. Replace the signature line:

```ts
export function createLiveWatcher(source: LiveSource, cb: LiveCallbacks): LiveWatcher {
  let current: string | null = null;
```

with:

```ts
export function createLiveWatcher(
  source: LiveSource,
  cb: LiveCallbacks,
  opts: { lockTo?: string } = {},
): LiveWatcher {
  const locked = opts.lockTo ?? null;
  let current: string | null = locked;
```

Then extract the fast-tick body into a `pollCurrent` helper and use it. Replace the entire `return { … }` block (from `return {` to the closing `};` of the function) with:

```ts
  const pollCurrent = async (): Promise<void> => {
    if (!current) return;
    const file = await source.read(current);
    if (!file) {
      noteFailure();
      return;
    }
    if (file.lastModified === lastMtime) return; // no change
    const trace = parse(file.text);
    if (trace) emit(current, file.lastModified, file.text, trace);
    else noteFailure();
  };

  return {
    init() {
      return guard(async () => {
        cb.onStatus("scanning");
        if (locked) await pollCurrent();
        else await adoptNewestParseable(false);
      });
    },

    fastTick() {
      return guard(pollCurrent);
    },

    slowTick() {
      if (locked) return Promise.resolve(); // locked: never switch away
      return guard(() => adoptNewestParseable(current !== null));
    },

    currentFile() {
      return current;
    },
  };
}
```

- [ ] **Step 4: Run the whole engine test**

Run: `npx vitest run src/lib/liveEngine.test.ts`
Expected: PASS (all prior tests + the new locked-mode test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/liveEngine.ts src/lib/liveEngine.test.ts
git commit -m "feat(live): locked mode — watch one file without auto-switching"
```

---

## Task 4: folderWatch — head reads + file scan

**Files:**
- Modify: `src/lib/folderWatch.ts`

- [ ] **Step 1: Add the exports**

In `src/lib/folderWatch.ts`, add after the `baseName` function:

```ts
/** Read just the first `maxBytes` of a file (cheap title peek for big logs). */
export async function readHead(handle: FileSystemFileHandle, maxBytes = 262144): Promise<string> {
  const file = await handle.getFile();
  return file.slice(0, maxBytes).text();
}

export interface TraceFileRef {
  name: string; // relative path
  lastModified: number;
  handle: FileSystemFileHandle;
}

/** Trace files in the folder, NEWEST first, capped at `limit`, with handles. */
export async function scanTraceFiles(
  dir: FileSystemDirectoryHandle,
  limit = 300,
): Promise<TraceFileRef[]> {
  const handles = new Map<string, FileSystemFileHandle>();
  const meta: Array<{ name: string; lastModified: number }> = [];
  await collect(dir, "", 0, handles, meta);
  meta.sort((a, b) => b.lastModified - a.lastModified || (a.name > b.name ? -1 : 1));
  return meta.slice(0, limit).map((m) => ({
    name: m.name,
    lastModified: m.lastModified,
    handle: handles.get(m.name)!,
  }));
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (new exports are unused so far; that's fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/folderWatch.ts
git commit -m "feat(live): folderWatch.readHead + scanTraceFiles"
```

---

## Task 5: useConversations hook

**Files:**
- Create: `src/hooks/useConversations.ts`

- [ ] **Step 1: Write the implementation**

Create `src/hooks/useConversations.ts`:

```ts
import { useEffect, useState } from "react";
import { scanTraceFiles, readHead } from "../lib/folderWatch";
import { extractConversationMeta } from "../core/conversationMeta";

export interface Conversation {
  name: string;
  lastModified: number;
  title?: string;
  project?: string;
}

interface Result {
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
}

/** List the folder's conversations, filling in titles progressively. */
export function useConversations(dir: FileSystemDirectoryHandle | null): Result {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!dir) {
      setConversations([]);
      setLoading(false);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    setConversations([]);

    (async () => {
      let files;
      try {
        files = await scanTraceFiles(dir);
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      // Show the list immediately (time is free); titles fill in below.
      setConversations(files.map((f) => ({ name: f.name, lastModified: f.lastModified })));
      for (const f of files) {
        if (cancelled) return;
        let meta = {};
        try {
          meta = extractConversationMeta(await readHead(f.handle));
        } catch {
          /* leave title/project undefined for this row */
        }
        if (cancelled) return;
        setConversations((prev) =>
          prev.map((c) => (c.name === f.name ? { ...c, ...meta } : c)),
        );
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [dir]);

  return { conversations, loading, error };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useConversations.ts
git commit -m "feat(live): useConversations — progressive titled list of a folder"
```

---

## Task 6: useLiveWatch — followNewest + watchFile

**Files:**
- Modify: `src/hooks/useLiveWatch.ts`
- Modify: `src/App.tsx` (one call site, to stay green)

- [ ] **Step 1: Refactor the hook**

In `src/hooks/useLiveWatch.ts`, replace the `start` callback with a shared `begin` plus two named entry points. Replace this block:

```ts
  const start = useCallback((dir: FileSystemDirectoryHandle) => {
    timers.current.forEach((t) => clearInterval(t));
    timers.current = [];
    setFolderName(dir.name);
    setCurrentFile("");
    setState("scanning");

    const source = createFolderSource(dir);
    const watcher = createLiveWatcher(source, {
      onUpdate: (u) => {
        setCurrentFile(baseName(u.label));
        onUpdateRef.current(u);
      },
      onStatus: (s) => setState(s),
    });

    // init can reject if the folder can't be enumerated at all — surface it.
    watcher.init().catch(() => setState("error"));
    timers.current.push(window.setInterval(() => void watcher.fastTick(), FAST_MS));
    timers.current.push(window.setInterval(() => void watcher.slowTick(), SLOW_MS));
  }, []);
```

with:

```ts
  const begin = useCallback((dir: FileSystemDirectoryHandle, lockTo?: string) => {
    timers.current.forEach((t) => clearInterval(t));
    timers.current = [];
    setFolderName(dir.name);
    setCurrentFile(lockTo ? baseName(lockTo) : "");
    setState("scanning");

    const source = createFolderSource(dir);
    const watcher = createLiveWatcher(
      source,
      {
        onUpdate: (u) => {
          setCurrentFile(baseName(u.label));
          onUpdateRef.current(u);
        },
        onStatus: (s) => setState(s),
      },
      lockTo ? { lockTo } : {},
    );

    watcher.init().catch(() => setState("error"));
    timers.current.push(window.setInterval(() => void watcher.fastTick(), FAST_MS));
    timers.current.push(window.setInterval(() => void watcher.slowTick(), SLOW_MS));
  }, []);

  const followNewest = useCallback((dir: FileSystemDirectoryHandle) => begin(dir), [begin]);
  const watchFile = useCallback(
    (dir: FileSystemDirectoryHandle, name: string) => begin(dir, name),
    [begin],
  );
```

Then change the returned object from:

```ts
  return { state, folderName, currentFile, start, stop };
```

to:

```ts
  return { state, folderName, currentFile, followNewest, watchFile, stop };
```

- [ ] **Step 2: Fix the one current call site in App**

In `src/App.tsx`, in the `startLive` callback, change `liveWatch.start(dir);` to `liveWatch.followNewest(dir);` so the app still compiles. (Task 8 rewrites this area fully.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS (engine tests green; app compiles).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useLiveWatch.ts src/App.tsx
git commit -m "feat(live): useLiveWatch exposes followNewest + watchFile"
```

---

## Task 7: ConversationList + back-button relabels

**Files:**
- Create: `src/components/live/ConversationList.tsx`
- Modify: `src/components/live/LiveBar.tsx`
- Modify: `src/components/live/LiveStandby.tsx`

- [ ] **Step 1: Create `ConversationList`**

Create `src/components/live/ConversationList.tsx`:

```tsx
import { useState } from "react";
import { ThemeToggle } from "../shell/ThemeToggle";
import { formatRelativeTime } from "../../core/format";
import type { Conversation } from "../../hooks/useConversations";

interface Props {
  folderName: string;
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
  onOpen: (name: string) => void;
  onFollowNewest: () => void;
  onClose: () => void;
}

export function ConversationList({
  folderName, conversations, loading, error, onOpen, onFollowNewest, onClose,
}: Props) {
  const [filter, setFilter] = useState("");
  const now = Date.now();
  const q = filter.trim().toLowerCase();
  const rows = q
    ? conversations.filter(
        (c) =>
          (c.title ?? c.name).toLowerCase().includes(q) ||
          (c.project ?? "").toLowerCase().includes(q),
      )
    : conversations;

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-panel px-5 py-3">
        <span className="wordmark text-lg text-text">tracelens</span>
        <ThemeToggle />
      </header>

      <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2 text-[12px]">
        <span className="text-text">📂 {folderName}</span>
        <span className="text-faint">· {conversations.length} conversations</span>
        <button
          type="button"
          onClick={onFollowNewest}
          className="ml-2 rounded border border-accent px-2 py-0.5 text-text hover:bg-elev"
        >
          📡 Follow newest (live)
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-border px-2 py-0.5 text-text hover:border-accent"
        >
          Close
        </button>
      </div>

      <div className="border-b border-border px-4 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title or project…"
          className="w-full rounded border border-border bg-bg px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="p-6 text-sm text-error">Couldn't read that folder.</div>
        ) : conversations.length === 0 && !loading ? (
          <div className="p-6 text-sm text-muted">No conversations found in this folder.</div>
        ) : (
          <ul>
            {rows.map((c) => {
              const active = now - c.lastModified < 120_000;
              return (
                <li key={c.name} className="border-b border-border">
                  <button
                    type="button"
                    onClick={() => onOpen(c.name)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-panel-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-text">{c.title ?? c.name}</div>
                      <div className="mono text-[11px] text-faint">
                        {c.project ?? "—"} · {formatRelativeTime(c.lastModified, now)}
                      </div>
                    </div>
                    {active && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: "var(--kind-agent)" }}
                        title="recently active"
                      />
                    )}
                  </button>
                </li>
              );
            })}
            {loading && (
              <li className="px-4 py-3 text-[12px] text-faint">Loading titles…</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
```

> If `hover:bg-panel-2` is not a defined token class, use `hover:bg-elev` instead (check `src/styles/`); both map to existing tokens used elsewhere in the app.

- [ ] **Step 2: Relabel `LiveBar` back button**

In `src/components/live/LiveBar.tsx`: **keep the `onStop` prop name** (no interface change); only change the button's label so it reads as a back action:

```tsx
      <button
        type="button"
        onClick={onStop}
        className="ml-auto rounded border border-border px-2 py-0.5 text-text hover:border-accent"
      >
        ← Conversations
      </button>
```

- [ ] **Step 3: Relabel `LiveStandby` back button**

In `src/components/live/LiveStandby.tsx`: **keep the `onStop` prop name**; replace the button's two-way label with a single label:

```tsx
        <button
          type="button"
          onClick={onStop}
          className="mt-2 rounded-lg border border-border bg-panel px-4 py-2 text-sm text-text hover:border-accent"
        >
          ← Conversations
        </button>
```

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS — props are unchanged, only labels changed, so `App.tsx` still compiles.

- [ ] **Step 5: Commit**

```bash
git add src/components/live/ConversationList.tsx src/components/live/LiveBar.tsx src/components/live/LiveStandby.tsx
git commit -m "feat(live): ConversationList + rename LiveBar/LiveStandby back action"
```

---

## Task 8: App — folder list ↔ trace navigation

**Files:**
- Modify: `src/App.tsx` (full replacement)

- [ ] **Step 1: Replace the entire contents of `src/App.tsx` with:**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedTrace } from "./core/types";
import { parseTraceText } from "./core/parse";
import { searchTrace, errorSpanIds, slowestSpanId } from "./core/search";
import { decodeShare, readShareHash, shareSupported } from "./core/share";
import { ThemeProvider } from "./theme/ThemeProvider";
import { Loader } from "./components/Loader";
import { AppShell } from "./components/shell/AppShell";
import { copyShareLinkToClipboard } from "./components/shell/exportActions";
import { TreeView } from "./components/views/TreeView/TreeView";
import { FlamegraphView } from "./components/views/FlamegraphView";
import { DiffView } from "./components/views/DiffView";
import { SpanDetail } from "./components/detail/SpanDetail";
import { DEFAULT_VIEW, type ViewId } from "./lib/views";
import { useLiveWatch } from "./hooks/useLiveWatch";
import { useConversations } from "./hooks/useConversations";
import { pickFolder } from "./lib/folderWatch";
import { latestSpanId } from "./core/live";
import { LiveBar } from "./components/live/LiveBar";
import { LiveStandby } from "./components/live/LiveStandby";
import { BackToLivePill } from "./components/live/BackToLivePill";
import { ConversationList } from "./components/live/ConversationList";
import type { LiveUpdate } from "./lib/liveEngine";

export default function App() {
  const [trace, setTrace] = useState<ParsedTrace | null>(null);
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [rawSource, setRawSource] = useState("");
  const [folderDir, setFolderDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderView, setFolderView] = useState<"list" | "trace">("list");
  const [following, setFollowing] = useState(true);
  const [displayedFile, setDisplayedFile] = useState("");
  const [pendingRun, setPendingRun] = useState<LiveUpdate | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const convo = useConversations(folderDir);
  const live = folderDir !== null && folderView === "trace";

  const onLoad = (t: ParsedTrace, lbl: string, source: string) => {
    setTrace(t);
    setLabel(lbl);
    setRawSource(source);
    setSelectedId(t.roots[0]?.spanId ?? null);
    setActiveView(DEFAULT_VIEW);
    setError(null);
    setQuery("");
    setMatchIndex(0);
  };

  const onLiveUpdate = useCallback(
    (u: LiveUpdate) => {
      setTrace(u.trace);
      setError(null);
      if (following) {
        setLabel(u.label);
        setRawSource(u.source);
        setDisplayedFile(u.label);
        setSelectedId(latestSpanId(u.trace.roots));
        setPendingRun(null);
      } else if (u.label === displayedFile) {
        setLabel(u.label);
        setRawSource(u.source);
      } else {
        setPendingRun(u);
      }
    },
    [following, displayedFile],
  );

  const liveWatch = useLiveWatch({ onUpdate: onLiveUpdate });

  // Clear trace-view state before opening a different conversation.
  const resetTraceState = useCallback(() => {
    setTrace(null);
    setSelectedId(null);
    setFollowing(true);
    setPendingRun(null);
    setDisplayedFile("");
    setQuery("");
    setMatchIndex(0);
    setActiveView("tree");
  }, []);

  const openFolder = useCallback(async () => {
    const dir = await pickFolder();
    if (!dir) return;
    setFolderDir(dir);
    setFolderView("list");
  }, []);

  const openConversation = useCallback(
    (name: string) => {
      if (!folderDir) return;
      resetTraceState();
      setFolderView("trace");
      liveWatch.watchFile(folderDir, name);
    },
    [folderDir, liveWatch, resetTraceState],
  );

  const followNewest = useCallback(() => {
    if (!folderDir) return;
    resetTraceState();
    setFolderView("trace");
    liveWatch.followNewest(folderDir);
  }, [folderDir, liveWatch, resetTraceState]);

  const backToList = useCallback(() => {
    liveWatch.stop();
    setFolderView("list");
  }, [liveWatch]);

  const reset = () => {
    liveWatch.stop();
    setFolderDir(null);
    setFolderView("list");
    setTrace(null);
    setSelectedId(null);
    setError(null);
    setLabel("");
    setActiveView(DEFAULT_VIEW);
    setQuery("");
    setMatchIndex(0);
    setRawSource("");
    setFollowing(true);
    setPendingRun(null);
    setDisplayedFile("");
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
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

  const canShare = shareSupported();

  const copyShareLink = useCallback(async () => {
    return copyShareLinkToClipboard({
      rawSource,
      label,
      baseUrl: window.location.origin + window.location.pathname,
      writeText: (text) => navigator.clipboard.writeText(text),
    });
  }, [rawSource, label]);

  const downloadJson = useCallback(() => {
    if (!rawSource) return;
    const blob = new Blob([rawSource], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${label || "trace"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [rawSource, label]);

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

  // On first load, open a trace embedded in the URL hash (#t=...).
  useEffect(() => {
    const token = readShareHash(window.location.hash);
    if (!token) return;
    let cancelled = false;
    decodeShare(token)
      .then((payload) => {
        if (cancelled) return;
        onLoad(parseTraceText(payload.source), payload.name, payload.source);
      })
      .catch(() => {
        if (!cancelled) setError("This share link could not be opened.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goLive = useCallback(() => {
    setFollowing(true);
    if (pendingRun) {
      const u = pendingRun;
      setTrace(u.trace);
      setLabel(u.label);
      setRawSource(u.source);
      setDisplayedFile(u.label);
      setSelectedId(latestSpanId(u.trace.roots));
      setPendingRun(null);
    } else if (trace) {
      setSelectedId(latestSpanId(trace.roots));
    }
  }, [pendingRun, trace]);

  const onSpanSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (live) setFollowing(false);
    },
    [live],
  );

  const onUserScroll = useCallback(() => {
    if (live && following) setFollowing(false);
  }, [live, following]);

  const selected = selectedId ? (trace?.byId.get(selectedId) ?? null) : null;
  const filtering = query.trim().length > 0;
  const currentMatchId =
    matchCount > 0 ? (search?.orderedMatchIds[matchIndex] ?? null) : null;

  return (
    <ThemeProvider>
      {folderDir && folderView === "list" ? (
        <ConversationList
          folderName={folderDir.name}
          conversations={convo.conversations}
          loading={convo.loading}
          error={convo.error}
          onOpen={openConversation}
          onFollowNewest={followNewest}
          onClose={reset}
        />
      ) : !trace ? (
        live ? (
          <LiveStandby
            state={liveWatch.state}
            folderName={liveWatch.folderName}
            onStop={backToList}
          />
        ) : (
          <Loader onLoad={onLoad} onError={setError} error={error} onStartLive={openFolder} />
        )
      ) : (
        <AppShell
          activeView={activeView}
          onSelectView={setActiveView}
          label={label}
          summary={trace.summary}
          onReset={reset}
          exportActions={{ onCopyLink: copyShareLink, onDownloadJson: downloadJson, canShare }}
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
          <section className="relative flex min-h-0 flex-col overflow-hidden border-r border-border bg-panel">
            {live && (
              <LiveBar
                state={liveWatch.state}
                folderName={liveWatch.folderName}
                currentFile={liveWatch.currentFile}
                onStop={backToList}
              />
            )}
            {activeView === "tree" && (
              <TreeView
                trace={trace}
                selectedId={selectedId}
                onSelect={onSpanSelect}
                filtering={filtering}
                visibleIds={search?.visibleIds ?? null}
                matchIds={search?.matchIds ?? null}
                currentMatchId={currentMatchId}
                query={query}
                followId={live && following ? selectedId : null}
                onUserScroll={onUserScroll}
              />
            )}
            {activeView === "flamegraph" && (
              <FlamegraphView trace={trace} selectedId={selectedId} onSelect={onSpanSelect} />
            )}
            {activeView === "diff" && <DiffView trace={trace} label={label} />}
            {live && !following && (
              <BackToLivePill newRun={pendingRun !== null} onClick={goLive} />
            )}
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

- [ ] **Step 2: Verify the gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; tests PASS; build PASS.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(live): folder opens a conversation list; pick one to watch"
```

---

## Task 9: Manual verification (user, in Edge)

- [ ] `npm run dev`, open in Edge. On the loader, click **📡 Watch a folder**, pick `~/.codex/sessions`.
- [ ] Confirm a **conversation list** appears: rows with a title (first user message), a project name, and a relative time; titles fill in progressively.
- [ ] Type in the **filter** — the list narrows by title/project.
- [ ] Click an **old** conversation → it opens and shows the tree. A recently-active one keeps updating; the LiveBar shows **← Conversations**.
- [ ] Click **← Conversations** → back to the list (instant, no re-scan).
- [ ] Click **📡 Follow newest (live)** → it follows the most recently active run (auto-switches), as before.
- [ ] A folder with no trace files shows "No conversations found in this folder."

---

## Self-Review notes

- **Spec coverage:** browse-first list (Task 8 render), row = title+project+time+active-dot (Task 7), head-only titles (Tasks 1/4/5), click = watch locked (Tasks 3/6/8), follow-newest button (Tasks 6/8), progressive load + filter (Tasks 5/7), App-level `useConversations` cache across nav (Task 8), back/close nav (Tasks 7/8), empty/error states (Tasks 5/7). All present.
- **Type consistency:** `extractConversationMeta(head)` (no fileName — `noUnusedParameters`); `Conversation` from `useConversations` is what `ConversationList` consumes; `createLiveWatcher(…, { lockTo })`; `useLiveWatch` returns `followNewest`/`watchFile`/`stop`; `LiveBar`/`LiveStandby` keep their `onStop` prop (only labels change). Consistent across tasks.
- **Green at every step:** Task 6 fixes the one `start`→`followNewest` call site so the app keeps compiling; Task 7 keeps the `onStop` props (label-only change) so App stays green; Task 8 swaps the call sites to the new names. Every task ends green.
- **No placeholders:** every code step is complete.
```
