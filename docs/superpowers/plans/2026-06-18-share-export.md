# Shareable Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user copy a self-loading share link (gzip+base64url trace in the URL hash) and download the trace as JSON; opening a share link auto-loads the trace.

**Architecture:** A pure `core/share.ts` does gzip/base64url encode/decode + URL helpers. `App` retains the original raw trace text (`rawSource`), exposes copy-link / download handlers, and on mount auto-loads from `#t=…`. An `ExportMenu` popover replaces the stub Export button. Built green: core → full export UI (create links + download) → URL auto-load.

**Tech Stack:** React 18, TypeScript (strict), Vite 6, Tailwind v4, Vitest. `src/core/` gains one new file. Uses `CompressionStream` (modern browsers / Node 18+).

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/core/share.ts` | 1 | **create** — gzip+base64url encode/decode, `readShareHash`, `shareUrl` |
| `src/core/share.test.ts` | 1 | **create** — round-trip + helper tests |
| `src/components/shell/exportActions.ts` | 2 | **create** — `ExportActions` interface |
| `src/components/shell/ExportMenu.tsx` | 2 | **create** — Export button + popover (copy link / download) |
| `src/components/Loader.tsx` | 2 | **modify** — `onLoad` carries the raw `source` |
| `src/App.tsx` | 2, 3 | **modify** — `rawSource`, copy/download handlers (2); URL auto-load + hash clear (3) |
| `src/components/shell/AppShell.tsx` | 2 | **modify** — thread `exportActions` to TopBar |
| `src/components/shell/TopBar.tsx` | 2 | **modify** — render `ExportMenu` in place of the stub |

---

## Task 1: Pure share encode/decode (TDD)

**Files:**
- Create: `src/core/share.ts`
- Test: `src/core/share.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/share.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { encodeShare, decodeShare, readShareHash, shareUrl } from "./share";

describe("share encode/decode", () => {
  it("round-trips a payload including unicode and quotes/newlines", async () => {
    const p = { name: "trace.json", source: '{"q":"东京\\nhi \\"x\\""}' };
    const enc = await encodeShare(p);
    expect(await decodeShare(enc)).toEqual(p);
  });

  it("produces base64url with no +, / or =", async () => {
    const enc = await encodeShare({ name: "n", source: "{}" });
    expect(enc).not.toMatch(/[+/=]/);
  });

  it("rejects garbage input", async () => {
    await expect(decodeShare("@@@")).rejects.toThrow();
  });
});

describe("readShareHash", () => {
  it("extracts the t token", () => {
    expect(readShareHash("#t=abc")).toBe("abc");
    expect(readShareHash("#t=abc&x=1")).toBe("abc");
  });
  it("returns null when absent", () => {
    expect(readShareHash("#x=1")).toBeNull();
    expect(readShareHash("")).toBeNull();
  });
});

describe("shareUrl", () => {
  it("appends the hash token", () => {
    expect(shareUrl("https://x/app", "abc")).toBe("https://x/app#t=abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/share.test.ts`
Expected: FAIL — cannot resolve `./share`.

- [ ] **Step 3: Create `src/core/share.ts`**

```ts
// Pure trace sharing: gzip + base64url encode/decode of a small payload, plus
// URL-hash helpers. Uses CompressionStream/Response (browsers + Node 18+).

export interface SharePayload {
  name: string; // the trace's label / filename
  source: string; // the original raw trace JSON text
}

export function shareSupported(): boolean {
  return (
    typeof CompressionStream !== "undefined" &&
    typeof DecompressionStream !== "undefined"
  );
}

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipeThrough(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const buf = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodeShare(payload: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const gz = await pipeThrough(bytes, new CompressionStream("gzip"));
  return bytesToBase64url(gz);
}

export async function decodeShare(encoded: string): Promise<SharePayload> {
  const gz = base64urlToBytes(encoded);
  const bytes = await pipeThrough(gz, new DecompressionStream("gzip"));
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof obj?.name !== "string" || typeof obj?.source !== "string") {
    throw new Error("Invalid share payload");
  }
  return { name: obj.name, source: obj.source };
}

/** "#t=abc" | "#t=abc&x=1" -> "abc"; null when absent. */
export function readShareHash(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(h).get("t");
}

/** Build the shareable URL: `${base}#t=${encoded}` (base = origin + pathname). */
export function shareUrl(base: string, encoded: string): string {
  return `${base}#t=${encoded}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/share.test.ts`
Expected: PASS (6 tests). If `CompressionStream` is undefined in this Node version, report BLOCKED with the Node version — do not stub the test.

- [ ] **Step 5: Commit**

```bash
git add src/core/share.ts src/core/share.test.ts
git commit -m "feat(core): gzip+base64url trace share encode/decode"
```

---

## Task 2: Export UI + handlers (copy link + download JSON)

Delivers the full Export menu. Auto-loading a pasted link comes in Task 3, so in this task copying a link works but opening one does not yet.

**Files:**
- Create: `src/components/shell/exportActions.ts`
- Create: `src/components/shell/ExportMenu.tsx`
- Modify: `src/components/Loader.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/components/shell/TopBar.tsx`

- [ ] **Step 1: Create `src/components/shell/exportActions.ts`**

```ts
/** The export actions the top-bar menu needs, provided by App. */
export interface ExportActions {
  onCopyLink: () => void | Promise<void>;
  onDownloadJson: () => void;
  canShare: boolean; // false on browsers without CompressionStream
}
```

- [ ] **Step 2: Create `src/components/shell/ExportMenu.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { ExportActions } from "./exportActions";

export function ExportMenu({ actions }: { actions: ExportActions }) {
  const { onCopyLink, onDownloadJson, canShare } = actions;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleCopy = async () => {
    await onCopyLink();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-text"
      >
        ⇪ Export
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1.5 w-48 overflow-hidden rounded-lg border border-border bg-panel py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleCopy}
            disabled={!canShare}
            title={canShare ? "" : "Sharing needs a newer browser"}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text hover:bg-panel-2 disabled:opacity-40"
          >
            🔗 {copied ? "Copied!" : "Copy share link"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDownloadJson();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text hover:bg-panel-2"
          >
            ⬇ Download JSON
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Modify `src/components/Loader.tsx`** — two edits.

Edit A — replace the `Props` interface:
```tsx
interface Props {
  onLoad: (trace: ParsedTrace, label: string) => void;
  onError: (message: string) => void;
  error?: string | null; // optional so the v0 App still compiles until Task 13
}
```
with:
```tsx
interface Props {
  onLoad: (trace: ParsedTrace, label: string, source: string) => void;
  onError: (message: string) => void;
  error?: string | null;
}
```

Edit B — in `ingest`, replace:
```tsx
        onLoad(parseTrace(JSON.parse(text)), label);
```
with:
```tsx
        onLoad(parseTrace(JSON.parse(text)), label, text);
```

- [ ] **Step 4: Modify `src/App.tsx`** — six edits.

Edit A — after the line `import { searchTrace, errorSpanIds, slowestSpanId } from "./core/search";` add:
```tsx
import { encodeShare, shareUrl, shareSupported } from "./core/share";
```

Edit B — after `const [matchIndex, setMatchIndex] = useState(0);` add:
```tsx
  const [rawSource, setRawSource] = useState("");
```

Edit C — replace the whole `onLoad`:
```tsx
  const onLoad = (t: ParsedTrace, lbl: string) => {
    setTrace(t);
    setLabel(lbl);
    setSelectedId(t.roots[0]?.spanId ?? null);
    setActiveView(DEFAULT_VIEW);
    setError(null);
    setQuery("");
    setMatchIndex(0);
  };
```
with:
```tsx
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
```

Edit D — replace the whole `reset`:
```tsx
  const reset = () => {
    setTrace(null);
    setSelectedId(null);
    setError(null);
    setLabel("");
    setActiveView(DEFAULT_VIEW);
    setQuery("");
    setMatchIndex(0);
  };
```
with:
```tsx
  const reset = () => {
    setTrace(null);
    setSelectedId(null);
    setError(null);
    setLabel("");
    setActiveView(DEFAULT_VIEW);
    setQuery("");
    setMatchIndex(0);
    setRawSource("");
  };
```

Edit E — immediately AFTER the `jumpSlowest` useCallback block (the one ending `}, [trace]);`), add:
```tsx

  const canShare = shareSupported();

  const copyShareLink = useCallback(async () => {
    if (!rawSource) return;
    try {
      const encoded = await encodeShare({ name: label, source: rawSource });
      const url = shareUrl(window.location.origin + window.location.pathname, encoded);
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard or compression unavailable — Copy is disabled when unsupported */
    }
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
```

Edit F — in the `<AppShell` element, replace:
```tsx
          onReset={reset}
```
with:
```tsx
          onReset={reset}
          exportActions={{ onCopyLink: copyShareLink, onDownloadJson: downloadJson, canShare }}
```

- [ ] **Step 5: Replace the ENTIRE contents of `src/components/shell/AppShell.tsx`**

```tsx
import type { ReactNode } from "react";
import type { TraceSummary } from "../../core/types";
import type { ViewId } from "../../lib/views";
import type { SearchControls } from "./searchControls";
import type { ExportActions } from "./exportActions";
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
  exportActions: ExportActions;
  children: ReactNode; // the view | detail split
}

export function AppShell({ activeView, onSelectView, label, summary, onReset, search, exportActions, children }: Props) {
  return (
    <div className="flex h-full bg-bg">
      <Rail activeView={activeView} onSelectView={onSelectView} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar label={label} onReset={onReset} search={search} exportActions={exportActions} />
        <SummaryStrip summary={summary} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {children}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Replace the ENTIRE contents of `src/components/shell/TopBar.tsx`**

```tsx
import { SearchBox } from "./SearchBox";
import { ExportMenu } from "./ExportMenu";
import type { SearchControls } from "./searchControls";
import type { ExportActions } from "./exportActions";

interface Props {
  label: string;
  onReset: () => void;
  search: SearchControls;
  exportActions: ExportActions;
}

export function TopBar({ label, onReset, search, exportActions }: Props) {
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
      <ExportMenu actions={exportActions} />
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

- [ ] **Step 7: Typecheck + tests + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; tests **36 passed** (30 prior + 6 share); build PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): export menu — copy share link + download JSON"
```

---

## Task 3: Auto-load from a share link

**Files:**
- Modify: `src/App.tsx` (three edits).

- [ ] **Step 1: Edit A — extend the share import.** Replace:
```tsx
import { encodeShare, shareUrl, shareSupported } from "./core/share";
```
with:
```tsx
import { encodeShare, decodeShare, readShareHash, shareUrl, shareSupported } from "./core/share";
```
and after the line `import type { ParsedTrace } from "./core/types";` add:
```tsx
import { parseTrace } from "./core/parse";
```

- [ ] **Step 2: Edit B — add the mount-time auto-load effect.** Immediately AFTER the `⌘K` `useEffect` block (the one whose body adds/removes the `keydown` listener and ends with `}, []);`), add:
```tsx
  // On first load, open a trace embedded in the URL hash (#t=...).
  useEffect(() => {
    const token = readShareHash(window.location.hash);
    if (!token) return;
    let cancelled = false;
    decodeShare(token)
      .then((payload) => {
        if (cancelled) return;
        onLoad(parseTrace(JSON.parse(payload.source)), payload.name, payload.source);
      })
      .catch(() => {
        if (!cancelled) setError("This share link could not be opened.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: Edit C — clear a stale hash on reset.** In `reset`, after `setRawSource("");`, add:
```tsx
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
```

- [ ] **Step 4: Typecheck + tests + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; 36 tests pass; build PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): auto-load a trace from a share link"
```

---

## Task 4: Runtime verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server** and load the **research-agent** sample.

- [ ] **Step 2: Copy share link** — click `⇪ Export` → `Copy share link`; the label flips to "Copied!". Read the clipboard value (or call `copyShareLink` and inspect) — it should be `http://localhost:5173/#t=<token>` with a token containing only `[A-Za-z0-9_-]`.

- [ ] **Step 3: Open the link** — navigate the preview to that URL (set `location.href`). The app auto-loads the same trace (7 spans, `research_agent.run`), no loader screen, console error-free.

- [ ] **Step 4: Download JSON** — click `⇪ Export` → `Download JSON`. Confirm a download is triggered (e.g. the temporary `<a download>` fires) named `Research agent.json`.

- [ ] **Step 5: Menu behavior** — popover closes on outside click and on `Esc`; in dark theme the popover is legible.

- [ ] **Step 6: Bad link** — navigate to `http://localhost:5173/#t=@@@bad`; the loader shows "This share link could not be opened." and does not crash.

- [ ] **Step 7: Final commit (only if verification fixes were needed)**

```bash
git add -A
git commit -m "chore(ui): export verification fixes"
```

---

## Self-review notes (author)

- **Spec coverage:** copy link / download (T2 handlers + ExportMenu); gzip+base64url hash (T1 `core/share.ts`); encode original raw text (T2 `rawSource`); auto-load from hash + friendly error (T3); export popover (T2 ExportMenu); browser-support gate (`canShare`/`shareSupported`); clear stale hash on reset (T3). ✓
- **Type consistency:** `ExportActions` (exportActions.ts) consumed by App/AppShell/TopBar/ExportMenu; `SharePayload`/`encodeShare`/`decodeShare`/`readShareHash`/`shareUrl`/`shareSupported` signatures match call sites; `Loader.onLoad` 3-arg signature matches App's `onLoad`. ✓
- **Green at every step:** T2 introduces `rawSource` and immediately reads it (copy + download), so no unused-local; the `<AppShell>` gains `exportActions` in the same task its consumers accept it. T3 only adds an effect + import + reset line. `src/core/` gains only `share.ts`. ✓
- **Compression risk:** the round-trip test (T1) requires Node 18+ `CompressionStream`; flagged as BLOCKED-if-missing rather than stubbed.
