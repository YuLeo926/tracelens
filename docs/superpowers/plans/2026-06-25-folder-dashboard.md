# Folder Overview Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a folder shows an Overview dashboard (conversations by project, token usage + estimated cost, an activity chart, and failed runs) alongside the existing Conversations list.

**Architecture:** Cheap metrics (project/tokens/activity) come from each file's head+tail; pure aggregation in `core/folderStats.ts`. The "failed?" signal is a background, newest-first, cached full-parse (`lib/failedScan.ts` + `hooks/useFailedScan.ts`). A `FolderBrowser` adds Overview/Conversations tabs.

**Tech Stack:** React 18 + TypeScript (strict, `noUnusedParameters`), Vite 6, Vitest, File System Access API.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/folderStats.ts` (new) | Pure: `extractTokens`, `startMsOf`, `modelOf`, `estimateCostUsd`, `aggregateDashboard` |
| `src/core/folderStats.test.ts` (new) | Unit tests |
| `src/lib/failedScan.ts` (new) | `FailedState`, `MAX_SCAN_BYTES`, `cacheKey`, `load/saveFailedCache` |
| `src/lib/failedScan.test.ts` (new) | Cache round-trip tests |
| `src/lib/folderWatch.ts` (modify) | Add `readTail`, `readFileText`; `sizeBytes` on `scanTraceFiles` |
| `src/hooks/useConversations.ts` (modify) | Read head+tail; richer `Conversation` |
| `src/hooks/useFailedScan.ts` (new) | Background scan loop + cache; `ScanState` |
| `src/components/live/DashboardView.tsx` (new) | The dashboard UI |
| `src/components/live/FolderBrowser.tsx` (new) | Overview/Conversations tabs |
| `src/components/live/ConversationList.tsx` (modify) | Drop header; add `projectFilter` |
| `src/App.tsx` (modify) | Render `FolderBrowser`; dashboard + failed scan |

---

## Task 1: Pure folder stats

**Files:**
- Create: `src/core/folderStats.ts`
- Test: `src/core/folderStats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/folderStats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractTokens, startMsOf, modelOf, estimateCostUsd, aggregateDashboard, type ConvStat } from "./folderStats";

const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n");

describe("extractTokens", () => {
  it("sums the LAST token_count event in the tail", () => {
    const tail = lines(
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, output_tokens: 2 } } } },
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 20 } } } },
    );
    expect(extractTokens(tail)).toEqual({ tokensIn: 100, tokensOut: 20 });
  });
  it("returns null when there is no token_count (ignores a partial first line)", () => {
    expect(extractTokens('truncated...\n{"type":"event_msg","payload":{"type":"other"}}')).toBeNull();
  });
});

describe("startMsOf / modelOf", () => {
  it("reads the first timestamp and the model from the head", () => {
    const head = lines(
      { timestamp: "2026-06-21T10:00:00.000Z", type: "session_meta", payload: { cwd: "/x" } },
      { timestamp: "2026-06-21T10:00:01.000Z", type: "turn_context", payload: { model: "gpt-5.5" } },
    );
    expect(startMsOf(head)).toBe(Date.parse("2026-06-21T10:00:00.000Z"));
    expect(modelOf(head)).toBe("gpt-5.5");
  });
  it("returns undefined when absent", () => {
    expect(startMsOf("{}")).toBeUndefined();
    expect(modelOf("{}")).toBeUndefined();
  });
});

describe("estimateCostUsd", () => {
  it("uses a per-model rate and a fallback", () => {
    const gpt = estimateCostUsd(1_000_000, 1_000_000, "gpt-5.5");
    const fallback = estimateCostUsd(1_000_000, 1_000_000, "mystery-model");
    expect(gpt).toBeGreaterThan(0);
    expect(fallback).toBeGreaterThan(0);
    expect(estimateCostUsd(0, 0, "gpt-5.5")).toBe(0);
  });
});

describe("aggregateDashboard", () => {
  const now = Date.parse("2026-06-21T12:00:00.000Z");
  const day = 86_400_000;
  const stats: ConvStat[] = [
    { name: "a", project: "ebay", lastModified: now, startMs: now, tokensIn: 100, tokensOut: 20, model: "gpt-5.5", sizeBytes: 10 },
    { name: "b", project: "ebay", lastModified: now - day, startMs: now - day, tokensIn: 50, tokensOut: 5, sizeBytes: 10 },
    { name: "c", lastModified: now - 2 * day, startMs: now - 2 * day, tokensIn: 0, tokensOut: 0, sizeBytes: 10 },
  ];
  it("groups by project, sums tokens, buckets activity, sorts projects", () => {
    const d = aggregateDashboard(stats, now);
    expect(d.conversationCount).toBe(3);
    expect(d.totalTokensIn).toBe(150);
    expect(d.totalTokensOut).toBe(25);
    expect(d.estCostUsd).toBeGreaterThan(0);
    expect(d.projects.map((p) => p.project)).toEqual(["ebay", "(unknown)"]); // ebay most recent
    expect(d.projects[0]).toMatchObject({ project: "ebay", count: 2, tokens: 175 });
    expect(d.activity).toHaveLength(14);
    expect(d.activity[d.activity.length - 1].count).toBe(1); // today
    expect(d.activity.reduce((n, b) => n + b.count, 0)).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/folderStats.test.ts`
Expected: FAIL — `Failed to resolve import "./folderStats"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/folderStats.ts`:

```ts
export interface ConvStat {
  name: string;
  project?: string;
  startMs?: number;
  lastModified: number;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
  sizeBytes: number;
}

export interface ProjectRow { project: string; count: number; tokens: number; lastActive: number; }
export interface DayBar { day: string; count: number; }

export interface DashboardModel {
  conversationCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  estCostUsd: number;
  projects: ProjectRow[];
  activity: DayBar[];
}

function parseLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip partial/truncated lines */
    }
  }
  return out;
}

/** Codex cumulative tokens = the LAST token_count event in the tail. */
export function extractTokens(tail: string): { tokensIn: number; tokensOut: number } | null {
  let found: { tokensIn: number; tokensOut: number } | null = null;
  for (const r of parseLines(tail)) {
    const p = (r as { payload?: { type?: unknown; info?: { total_token_usage?: Record<string, unknown> } } }).payload;
    if (p?.type === "token_count") {
      const u = p.info?.total_token_usage ?? {};
      const tokensIn = typeof u.input_tokens === "number" ? u.input_tokens : 0;
      const tokensOut = typeof u.output_tokens === "number" ? u.output_tokens : 0;
      found = { tokensIn, tokensOut };
    }
  }
  return found;
}

/** First parseable top-level `timestamp` in the head, as epoch ms. */
export function startMsOf(head: string): number | undefined {
  for (const r of parseLines(head)) {
    const ts = (r as { timestamp?: unknown }).timestamp;
    if (typeof ts === "string") {
      const ms = Date.parse(ts);
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return undefined;
}

/** First `payload.model` in the head. */
export function modelOf(head: string): string | undefined {
  for (const r of parseLines(head)) {
    const m = (r as { payload?: { model?: unknown } }).payload?.model;
    if (typeof m === "string" && m) return m;
  }
  return undefined;
}

// Rough USD per 1M tokens. Estimates only — update here if prices change.
const PRICES: Array<{ match: RegExp; inUsd: number; outUsd: number }> = [
  { match: /gpt-5/i, inUsd: 1.25, outUsd: 10 },
  { match: /gpt-4|o4|o3/i, inUsd: 2.5, outUsd: 10 },
  { match: /claude/i, inUsd: 3, outUsd: 15 },
];
const FALLBACK = { inUsd: 2, outUsd: 10 };

export function estimateCostUsd(tokensIn: number, tokensOut: number, model?: string): number {
  const rate = (model && PRICES.find((p) => p.match.test(model))) || FALLBACK;
  return (tokensIn / 1e6) * rate.inUsd + (tokensOut / 1e6) * rate.outUsd;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function aggregateDashboard(stats: ConvStat[], now: number): DashboardModel {
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let estCostUsd = 0;
  const byProject = new Map<string, ProjectRow>();
  const byDay = new Map<string, number>();

  for (const s of stats) {
    const tIn = s.tokensIn ?? 0;
    const tOut = s.tokensOut ?? 0;
    totalTokensIn += tIn;
    totalTokensOut += tOut;
    estCostUsd += estimateCostUsd(tIn, tOut, s.model);

    const project = s.project ?? "(unknown)";
    const row = byProject.get(project) ?? { project, count: 0, tokens: 0, lastActive: 0 };
    row.count += 1;
    row.tokens += tIn + tOut;
    row.lastActive = Math.max(row.lastActive, s.lastModified);
    byProject.set(project, row);

    const day = ymd(s.startMs ?? s.lastModified);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const projects = [...byProject.values()].sort((a, b) => b.lastActive - a.lastActive);

  const activity: DayBar[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = ymd(now - i * 86_400_000);
    activity.push({ day, count: byDay.get(day) ?? 0 });
  }

  return {
    conversationCount: stats.length,
    totalTokensIn,
    totalTokensOut,
    estCostUsd,
    projects,
    activity,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/folderStats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/folderStats.ts src/core/folderStats.test.ts
git commit -m "feat(core): folder dashboard stats (tokens, cost, activity, by-project)"
```

(Append a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` to every commit.)

---

## Task 2: Failed-scan cache

**Files:**
- Create: `src/lib/failedScan.ts`
- Test: `src/lib/failedScan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/failedScan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cacheKey, loadFailedCache, saveFailedCache, MAX_SCAN_BYTES } from "./failedScan";

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

describe("failedScan cache", () => {
  it("keys by name + mtime", () => {
    expect(cacheKey("a/b.jsonl", 123)).toBe("a/b.jsonl:123");
  });
  it("round-trips and tolerates missing/corrupt", () => {
    const s = fakeStorage();
    saveFailedCache({ "a:1": "failed", "b:2": "ok" }, s);
    expect(loadFailedCache(s)).toEqual({ "a:1": "failed", "b:2": "ok" });
    expect(loadFailedCache(fakeStorage())).toEqual({});
    expect(loadFailedCache(fakeStorage({ "tracelens:failed": "nope" }))).toEqual({});
  });
  it("exposes a 30MB scan cap", () => {
    expect(MAX_SCAN_BYTES).toBe(30 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/failedScan.test.ts`
Expected: FAIL — `Failed to resolve import "./failedScan"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/failedScan.ts`:

```ts
export type FailedState = "ok" | "failed" | "skipped" | "unknown";
export const MAX_SCAN_BYTES = 30 * 1024 * 1024;

const KEY = "tracelens:failed";

export function cacheKey(name: string, lastModified: number): string {
  return `${name}:${lastModified}`;
}

function storageOf(s?: Storage): Storage | null {
  if (s) return s;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadFailedCache(s?: Storage): Record<string, FailedState> {
  const storage = storageOf(s);
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, FailedState>) : {};
  } catch {
    return {};
  }
}

export function saveFailedCache(cache: Record<string, FailedState>, s?: Storage): void {
  const storage = storageOf(s);
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota or unavailable — scan still works in memory this session */
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/failedScan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/failedScan.ts src/lib/failedScan.test.ts
git commit -m "feat(dashboard): failed-scan cache helpers"
```

---

## Task 3: Tail reads + richer conversations

**Files:**
- Modify: `src/lib/folderWatch.ts`
- Modify: `src/hooks/useConversations.ts`

- [ ] **Step 1: Add `readTail` + `readFileText` + `sizeBytes` to folderWatch**

In `src/lib/folderWatch.ts`, add after `readHead`:

```ts
/** Read just the LAST `maxBytes` of a file (cheap stats peek, e.g. token totals). */
export async function readTail(handle: FileSystemFileHandle, maxBytes = 65536): Promise<string> {
  const file = await handle.getFile();
  const start = Math.max(0, file.size - maxBytes);
  return file.slice(start).text();
}

/** Read a file's full text by relative path, or null if it can't be read. */
export async function readFileText(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  const handle = await resolveFileHandle(dir, name);
  if (!handle) return null;
  try {
    return await (await handle.getFile()).text();
  } catch {
    return null;
  }
}
```

Add `sizeBytes` to the `TraceFileRef` interface:

```ts
export interface TraceFileRef {
  name: string; // relative path
  lastModified: number;
  sizeBytes: number;
  handle: FileSystemFileHandle;
}
```

In `collect`, change the `meta` param type and the push to include size. Change the signature param:

```ts
  meta: Array<{ name: string; lastModified: number; sizeBytes: number }>,
```

and the file push:

```ts
      const file = await (entry as FileSystemFileHandle).getFile();
      out.set(path, entry as FileSystemFileHandle);
      meta.push({ name: path, lastModified: file.lastModified, sizeBytes: file.size });
```

In `scanTraceFiles`, update the local `meta` declaration and the returned map:

```ts
  const meta: Array<{ name: string; lastModified: number; sizeBytes: number }> = [];
  await collect(dir, "", 0, handles, meta);
  meta.sort((a, b) => b.lastModified - a.lastModified || (a.name > b.name ? -1 : 1));
  return meta.slice(0, limit).map((m) => ({
    name: m.name,
    lastModified: m.lastModified,
    sizeBytes: m.sizeBytes,
    handle: handles.get(m.name)!,
  }));
```

- [ ] **Step 2: Enrich `useConversations`**

Replace the entire contents of `src/hooks/useConversations.ts` with:

```ts
import { useEffect, useState } from "react";
import { scanTraceFiles, readHead, readTail } from "../lib/folderWatch";
import { extractConversationMeta } from "../core/conversationMeta";
import { startMsOf, modelOf, extractTokens } from "../core/folderStats";

export interface Conversation {
  name: string;
  lastModified: number;
  sizeBytes: number;
  title?: string;
  project?: string;
  startMs?: number;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
}

interface Result {
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
}

/** List the folder's conversations, filling in title/project/tokens progressively. */
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
      setConversations(
        files.map((f) => ({ name: f.name, lastModified: f.lastModified, sizeBytes: f.sizeBytes })),
      );
      for (const f of files) {
        if (cancelled) return;
        let extra: Partial<Conversation> = {};
        try {
          const head = await readHead(f.handle);
          const tail = await readTail(f.handle);
          const tokens = extractTokens(tail);
          extra = {
            ...extractConversationMeta(head),
            startMs: startMsOf(head),
            model: modelOf(head),
            tokensIn: tokens?.tokensIn,
            tokensOut: tokens?.tokensOut,
          };
        } catch {
          /* leave fields undefined for this row */
        }
        if (cancelled) return;
        setConversations((prev) => prev.map((c) => (c.name === f.name ? { ...c, ...extra } : c)));
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

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (`ConversationList` reads only `title`/`project`/`name`/`lastModified`, which still exist).

- [ ] **Step 4: Commit**

```bash
git add src/lib/folderWatch.ts src/hooks/useConversations.ts
git commit -m "feat(dashboard): tail reads + per-conversation tokens/model/start/size"
```

---

## Task 4: Background failed-scan hook

**Files:**
- Create: `src/hooks/useFailedScan.ts`

- [ ] **Step 1: Write the implementation**

Create `src/hooks/useFailedScan.ts`:

```ts
import { useEffect, useMemo, useState } from "react";
import { parseTraceText } from "../core/parse";
import { readFileText } from "../lib/folderWatch";
import {
  cacheKey, loadFailedCache, saveFailedCache, MAX_SCAN_BYTES, type FailedState,
} from "../lib/failedScan";
import type { Conversation } from "./useConversations";

export type ScanState = FailedState | "pending";

export interface FailedScanResult {
  states: Map<string, ScanState>;
  done: number;
  total: number;
}

export function useFailedScan(
  dir: FileSystemDirectoryHandle | null,
  conversations: Conversation[],
): FailedScanResult {
  const [states, setStates] = useState<Map<string, ScanState>>(new Map());
  const [done, setDone] = useState(0);

  // Re-run only when the file set (name+mtime+size) changes, not when titles fill in.
  const signature = useMemo(
    () => conversations.map((c) => `${c.name}:${c.lastModified}:${c.sizeBytes}`).join("|"),
    [conversations],
  );

  useEffect(() => {
    if (!dir || conversations.length === 0) {
      setStates(new Map());
      setDone(0);
      return;
    }
    let cancelled = false;
    const cache = loadFailedCache();
    const next = new Map<string, ScanState>();
    const toScan: Conversation[] = [];

    for (const c of conversations) {
      const key = cacheKey(c.name, c.lastModified);
      if (cache[key]) next.set(c.name, cache[key]);
      else if (c.sizeBytes > MAX_SCAN_BYTES) {
        next.set(c.name, "skipped");
        cache[key] = "skipped";
      } else {
        next.set(c.name, "pending");
        toScan.push(c);
      }
    }
    setStates(new Map(next));
    setDone(conversations.length - toScan.length);
    saveFailedCache(cache);

    (async () => {
      for (const c of toScan) {
        if (cancelled) return;
        let state: ScanState;
        try {
          const text = await readFileText(dir, c.name);
          if (text === null) {
            state = "unknown";
          } else {
            state = parseTraceText(text).summary.errors > 0 ? "failed" : "ok";
          }
        } catch {
          state = "unknown";
        }
        if (cancelled) return;
        next.set(c.name, state);
        setStates(new Map(next));
        setDone((d) => d + 1);
        if (state === "ok" || state === "failed") {
          cache[cacheKey(c.name, c.lastModified)] = state;
          saveFailedCache(cache);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, signature]);

  return { states, done, total: conversations.length };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useFailedScan.ts
git commit -m "feat(dashboard): background newest-first failed scan with caching"
```

---

## Task 5: DashboardView

**Files:**
- Create: `src/components/live/DashboardView.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/live/DashboardView.tsx`:

```tsx
import type { DashboardModel } from "../../core/folderStats";
import type { Conversation } from "../../hooks/useConversations";
import type { ScanState } from "../../hooks/useFailedScan";
import { formatTokens, formatCost, formatRelativeTime } from "../../core/format";

interface Props {
  model: DashboardModel;
  failed: { states: Map<string, ScanState>; done: number; total: number };
  conversations: Conversation[];
  onOpen: (name: string) => void;
  onPickProject: (project: string) => void;
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-panel px-4 py-3">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className="text-lg text-text">{value}</span>
    </div>
  );
}

export function DashboardView({ model, failed, conversations, onOpen, onPickProject }: Props) {
  const now = Date.now();
  const failedCount = [...failed.states.values()].filter((s) => s === "failed").length;
  const skipped = [...failed.states.values()].filter((s) => s === "skipped").length;
  const scanning = failed.done < failed.total;
  const maxDay = Math.max(1, ...model.activity.map((d) => d.count));
  const failedConvos = conversations.filter((c) => failed.states.get(c.name) === "failed");

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Conversations" value={String(model.conversationCount)} />
        <Card label="Tokens (in / out)" value={`${formatTokens(model.totalTokensIn)} / ${formatTokens(model.totalTokensOut)}`} />
        <Card label="Est. cost" value={`≈ ${formatCost(model.estCostUsd)}`} />
        <Card label="Failed runs" value={`${failedCount}${scanning ? ` · ${failed.done}/${failed.total}` : ""}`} />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-[11px] uppercase tracking-wider text-faint">Activity (last 14 days)</h3>
        <div className="flex h-24 items-end gap-1">
          {model.activity.map((d) => (
            <div
              key={d.day}
              className="flex-1 rounded-t bg-track"
              style={{ height: `${Math.max(2, (d.count / maxDay) * 100)}%`, background: d.count ? "var(--kind-agent)" : "var(--track)" }}
              title={`${d.day}: ${d.count}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-[11px] uppercase tracking-wider text-faint">By project</h3>
        <ul className="rounded-lg border border-border">
          {model.projects.map((p) => (
            <li key={p.project} className="border-b border-border last:border-0">
              <button
                type="button"
                onClick={() => onPickProject(p.project)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-panel-2"
              >
                <span className="min-w-0 flex-1 truncate text-text">{p.project}</span>
                <span className="text-faint">{p.count} runs</span>
                <span className="mono text-faint">{formatTokens(p.tokens)} tok</span>
                <span className="text-faint">{formatRelativeTime(p.lastActive, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-[11px] uppercase tracking-wider text-faint">
          Failed runs{scanning ? ` · analyzing ${failed.done}/${failed.total}` : ""}
          {skipped > 0 ? ` · ${skipped} too large, not analyzed` : ""}
        </h3>
        {failedConvos.length === 0 ? (
          <div className="rounded-lg border border-border p-4 text-sm text-muted">
            {scanning ? "Analyzing…" : "No failed runs found."}
          </div>
        ) : (
          <ul className="rounded-lg border border-border">
            {failedConvos.map((c) => (
              <li key={c.name} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => onOpen(c.name)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-panel-2"
                >
                  <span className="truncate text-[13px] text-text">{c.title ?? c.name}</span>
                  <span className="mono text-[11px] text-faint">{c.project ?? "—"} · {formatRelativeTime(c.lastModified, now)}</span>
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

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/live/DashboardView.tsx
git commit -m "feat(dashboard): overview UI — cards, by-project, activity, failed list"
```

---

## Task 6: FolderBrowser tabs + wire into App

**Files:**
- Modify: `src/components/live/ConversationList.tsx`
- Create: `src/components/live/FolderBrowser.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Slim down `ConversationList`** (drop its header/folder-bar; add `projectFilter`)

Replace the entire contents of `src/components/live/ConversationList.tsx` with:

```tsx
import { useState } from "react";
import { formatRelativeTime } from "../../core/format";
import type { Conversation } from "../../hooks/useConversations";

interface Props {
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
  onOpen: (name: string) => void;
  projectFilter?: string;
}

export function ConversationList({ conversations, loading, error, onOpen, projectFilter }: Props) {
  const [filter, setFilter] = useState("");
  const now = Date.now();
  const q = filter.trim().toLowerCase();
  const rows = conversations.filter((c) => {
    if (projectFilter && (c.project ?? "(unknown)") !== projectFilter) return false;
    if (!q) return true;
    return (c.title ?? c.name).toLowerCase().includes(q) || (c.project ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={projectFilter ? `Filter in ${projectFilter}…` : "Filter by title or project…"}
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
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--kind-agent)" }} title="recently active" />
                    )}
                  </button>
                </li>
              );
            })}
            {loading && <li className="px-4 py-3 text-[12px] text-faint">Loading titles…</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `FolderBrowser`**

Create `src/components/live/FolderBrowser.tsx`:

```tsx
import { useState } from "react";
import { ThemeToggle } from "../shell/ThemeToggle";
import { ConversationList } from "./ConversationList";
import { DashboardView } from "./DashboardView";
import type { Conversation } from "../../hooks/useConversations";
import type { DashboardModel } from "../../core/folderStats";
import type { ScanState } from "../../hooks/useFailedScan";

interface Props {
  folderName: string;
  conversations: Conversation[];
  loading: boolean;
  error: boolean;
  dashboard: DashboardModel;
  failed: { states: Map<string, ScanState>; done: number; total: number };
  onOpen: (name: string) => void;
  onFollowNewest: () => void;
  onClose: () => void;
}

export function FolderBrowser({
  folderName, conversations, loading, error, dashboard, failed, onOpen, onFollowNewest, onClose,
}: Props) {
  const [tab, setTab] = useState<"overview" | "conversations">("overview");
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);

  const pickProject = (project: string) => {
    setProjectFilter(project);
    setTab("conversations");
  };
  const tabBtn = (active: boolean) =>
    `rounded px-2 py-0.5 ${active ? "bg-elev text-text" : "text-muted hover:text-text"}`;

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-panel px-5 py-3">
        <span className="wordmark text-lg text-text">tracelens</span>
        <ThemeToggle />
      </header>

      <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2 text-[12px]">
        <span className="text-text">📂 {folderName}</span>
        <span className="text-faint">· {conversations.length} conversations</span>
        <div className="ml-2 flex gap-1">
          <button type="button" className={tabBtn(tab === "overview")} onClick={() => setTab("overview")}>Overview</button>
          <button type="button" className={tabBtn(tab === "conversations")} onClick={() => { setProjectFilter(undefined); setTab("conversations"); }}>Conversations</button>
        </div>
        <button type="button" onClick={onFollowNewest} className="ml-2 rounded border border-accent px-2 py-0.5 text-text hover:bg-elev">📡 Follow newest (live)</button>
        <button type="button" onClick={onClose} className="ml-auto rounded border border-border px-2 py-0.5 text-text hover:border-accent">Close</button>
      </div>

      {tab === "overview" ? (
        <DashboardView model={dashboard} failed={failed} conversations={conversations} onOpen={onOpen} onPickProject={pickProject} />
      ) : (
        <ConversationList conversations={conversations} loading={loading} error={error} onOpen={onOpen} projectFilter={projectFilter} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire `App`**

In `src/App.tsx`:

Add imports after the existing ones:

```ts
import { FolderBrowser } from "./components/live/FolderBrowser";
import { useFailedScan } from "./hooks/useFailedScan";
import { aggregateDashboard } from "./core/folderStats";
```

After `const convo = useConversations(folderDir);` add:

```ts
  const dashboard = useMemo(() => aggregateDashboard(convo.conversations, Date.now()), [convo.conversations]);
  const failedScan = useFailedScan(folderDir, convo.conversations);
```

Replace the whole `<ConversationList … />` block (the `folderDir && folderView === "list"` branch) with:

```tsx
        <FolderBrowser
          folderName={folderDir.name}
          conversations={convo.conversations}
          loading={convo.loading}
          error={convo.error}
          dashboard={dashboard}
          failed={failedScan}
          onOpen={openConversation}
          onFollowNewest={followNewest}
          onClose={reset}
        />
```

Remove the now-unused `import { ConversationList } from "./components/live/ConversationList";` line.

- [ ] **Step 4: Verify the gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; tests PASS; build PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/live/ConversationList.tsx src/components/live/FolderBrowser.tsx src/App.tsx
git commit -m "feat(dashboard): folder opens an Overview tab alongside Conversations"
```

---

## Task 7: Manual verification (user, in Edge)

- [ ] `npm run dev`, open in Edge, **📡 Watch a folder** → `~/.codex/sessions`.
- [ ] The **Overview** tab shows immediately: conversation count, token total, ≈ cost, and the activity chart + by-project list fill in within a couple seconds.
- [ ] The **Failed runs** count climbs ("analyzing N/M") and lists failed conversations; very large ones are noted as "not analyzed".
- [ ] Click a **project** → switches to **Conversations**, filtered to that project.
- [ ] Click a **failed run** → opens that conversation.
- [ ] **Reload** and reopen the folder → the failed counts come back instantly (cached); the activity/tokens recompute fast.
- [ ] Switch to **Conversations** tab (clears the project filter) → the full list with its own filter box.

---

## Self-Review notes

- **Spec coverage:** by-project + tokens + cost + activity (Task 1 `aggregateDashboard`); failed scan cache (Task 2) + background scan (Task 4); head+tail reads (Task 3); dashboard UI incl. project-click + failed-click (Task 5); two-tab placement + project filter (Task 6). All present.
- **Type consistency:** `ConvStat`/`DashboardModel` (Task 1) are consumed by Tasks 5/6; `Conversation` gains the fields ConvStat needs (Task 3) so it's passed directly; `FailedState` (Task 2) / `ScanState` (Task 4) flow into the UI; `useFailedScan` returns `{ states, done, total }` as consumed in Tasks 5/6.
- **Green at every step:** Tasks 1–5 are new files / additive; Task 3 keeps `ConversationList` working (it only reads still-present fields); Task 6 swaps `ConversationList`'s API and `App` together in one commit.
- **No placeholders:** every code step is complete.
```
