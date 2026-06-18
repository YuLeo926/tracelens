# Shareable Export (URL link + JSON download) — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Sub-project:** 3 of N in the v1 effort. Builds on the redesigned shell + search. Plugs real behavior into the already-present `Export` button stub.

## 1. Goal

Let a user hand a teammate a failing run with one click: copy a self-loading share **link** (the trace lives in the URL), and download the trace as **JSON**. Opening a share link auto-loads the trace through the same path as a dropped file.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Mechanisms | Copy share link (URL-hash) **and** Download JSON |
| Encoding | `CompressionStream("gzip")` + base64url; payload in the URL **hash** (`#t=…`) |
| What is encoded | The **original raw trace text** (not the normalized model) so the opened view is identical |
| Browser support | Modern only (CompressionStream: Chrome/Edge 80+, FF 113+, Safari 16.4+) — consistent with the project's existing `color-mix` usage |
| Self-contained HTML | Out of scope (heavier; a possible later sub-project) |

## 3. Scope

### In scope
- **Copy share link:** encode the loaded trace into `#t=<gzip+base64url>`, build `${origin}${pathname}#t=…`, copy to clipboard, show a transient "Copied!" confirmation.
- **Download JSON:** save the loaded trace's original text as a `.json` file named from its label.
- **Auto-load from URL:** on startup, if `location.hash` carries `#t=…`, decode → parse → load (same `onLoad` path as a file). Decode/parse failure shows the friendly error on the loader screen.
- **Export menu:** the top-bar `Export` button opens a small popover with the two actions.
- Retain the **original raw trace text** in `App` so it can be re-exported faithfully.

### Non-goals (explicitly out)
- Self-contained HTML export (bundling the viewer).
- Encryption, password protection, or any server/short-link service.
- QR codes; importing from a `?query=` parameter (hash only).
- Re-serializing from the normalized model (we keep and ship the original text verbatim).

## 4. Pure-ish core module — `src/core/share.ts`

Framework-agnostic (no React); uses the browser/Node-18+ globals `CompressionStream`, `Response`, `TextEncoder`/`TextDecoder`, `btoa`/`atob`. Unit-tested via round-trip.

```ts
export interface SharePayload {
  name: string;   // the trace's label / filename
  source: string; // the original raw trace JSON text
}

/** True when CompressionStream is available (older browsers cannot export links). */
export function shareSupported(): boolean;

/** JSON → gzip → base64url (no '+', '/', '='). */
export function encodeShare(payload: SharePayload): Promise<string>;

/** Inverse of encodeShare. Throws on malformed/garbage input. */
export function decodeShare(encoded: string): Promise<SharePayload>;

/** "#t=abc" | "#t=abc&x=1" → "abc"; returns null when absent. */
export function readShareHash(hash: string): string | null;

/** Build the shareable URL: `${base}#t=${encoded}` (base = origin+pathname). */
export function shareUrl(base: string, encoded: string): string;
```

Internals: `gzip`/`gunzip` pipe bytes through `CompressionStream`/`DecompressionStream` and collect with `new Response(stream).arrayBuffer()`; base64url conversion chunks the byte array for `btoa`/`atob` and swaps `+/`→`-_`, stripping `=`.

## 5. App / data-flow changes

- **`Loader`**: its `onLoad` gains a third argument — the original text. `ingest(text, label)` calls `onLoad(parseTrace(JSON.parse(text)), label, text)`. (`Loader`'s own props change: `onLoad: (trace, label, source) => void`.)
- **`App`**: new state `rawSource: string`. `onLoad(t, lbl, source)` stores it; `reset()` clears it and clears `location.hash`.
- **Auto-load effect (mount-only):** read `readShareHash(location.hash)`; if present, `decodeShare` → `parseTrace(JSON.parse(payload.source))` → `onLoad(trace, payload.name, payload.source)`. On failure, `setError("This share link could not be opened.")` and stay on the loader.
- **`copyShareLink()`**: `encodeShare({ name: label, source: rawSource })` → `shareUrl(origin+pathname, …)` → `navigator.clipboard.writeText(...)`; set a transient "copied" flag. If `!shareSupported()`, surface "Sharing needs a newer browser." If the URL is very long (> ~16k chars), still copy but note it may be truncated by some chat apps.
- **`downloadJson()`**: `Blob([rawSource], {type:"application/json"})` → object URL → click a temporary `<a download>` named `${label || "trace"}.json` → revoke the URL.

## 6. UI — `src/components/shell/ExportMenu.tsx`

A self-contained button + popover replacing the stub `Export` button in `TopBar`.

- Props: `{ onCopyLink: () => void | Promise<void>; onDownloadJson: () => void; canShare: boolean; }`.
- Button `⇪ Export` toggles a small popover (absolutely positioned under the button) with two rows: **Copy share link** (disabled with a hint when `!canShare`) and **Download JSON**.
- After Copy, the row label flips to "Copied!" for ~1.5s.
- Closes on outside click / `Esc`. Token-styled (`bg-panel`, `border-border`, `text-text`, `hover:bg-panel-2`), works in both themes.
- `TopBar` renders `<ExportMenu …/>` where the stub button was; `AppShell`/`App` thread the two callbacks + `canShare` (App owns them).

## 7. Error handling / edge cases

- Bad share hash (corrupt base64, bad gzip, non-JSON) → caught; loader shows the friendly error; no crash.
- `CompressionStream` missing → `shareSupported()` false → Copy-link disabled with a tooltip; Download JSON still works.
- Empty/over-long URL → still copied; a soft note about possible truncation.
- Loading a new trace or `reset()` clears any stale `#t=` from the address bar so the URL reflects the current state.
- `navigator.clipboard` unavailable (insecure context) → fall back to a hidden textarea `execCommand("copy")`, or surface "Copy failed — here is the link" (keep it simple: try clipboard, catch → show the link in the popover for manual copy).

## 8. Testing

`src/core/share.test.ts` (Vitest; requires Node 18+ for `CompressionStream`):
- Round-trip: `decodeShare(await encodeShare(p))` deep-equals `p`, including a payload with unicode (中文) and quotes/newlines in `source`.
- `encodeShare` output contains only base64url chars (no `+`, `/`, `=`).
- `decodeShare("not-valid-@@@")` rejects/throws.
- `readShareHash`: `"#t=abc"`→`"abc"`, `"#x=1"`→`null`, `""`→`null`.
- `shareUrl("https://x/app", "abc")` === `"https://x/app#t=abc"`.

All existing tests stay green (core gains only `share.ts`). Final gate: `typecheck` + `test` + `build`; then dev-server verification — Export → Copy share link, paste into a new tab and confirm it auto-loads the same trace; Export → Download JSON, re-drop the file and confirm it loads; popover looks right in light and dark.

## 9. Execution order (incremental, green at every step)

1. `core/share.ts` + `core/share.test.ts` (TDD) — pure encode/decode/url helpers.
2. `Loader` `onLoad` carries the raw `source`; `App` stores `rawSource` (no export UI yet — App passes `source` through). Green.
3. `App` export handlers (`copyShareLink`, `downloadJson`, `canShare`) + mount-time hash auto-load + hash clearing.
4. `ExportMenu` component; wire through `AppShell`/`TopBar`, replacing the stub button.
5. Verification gate (Section 8).

## 10. Risks & mitigations

- **`CompressionStream` in the Vitest (Node) env** — round-trip test assumes Node 18+. If unavailable, the implementer reports it and we gate the test on `typeof CompressionStream`.
- **Clipboard in non-secure contexts** — try/catch with a manual-copy fallback (Section 7).
- **URL length** — gzip keeps typical single traces well within browser limits; a soft truncation note covers the rare huge trace. Self-contained HTML (the size-unbounded option) remains a deliberate later sub-project.
