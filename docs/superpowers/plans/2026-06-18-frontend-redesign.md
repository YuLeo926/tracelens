# Frontend Redesign (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Tracelens UI into a token-driven, multi-view app shell (light + dark, left icon rail) with the parsing core untouched, leaving stubbed entry points for the later v1 views/tools.

**Architecture:** A `ThemeProvider` flips `data-theme` on the root; `styles/tokens.css` defines every color per theme; Tailwind v4 `@theme inline` exposes the semantic tokens as utilities. The app is an `AppShell` (left `Rail` view-switcher + `TopBar` + `SummaryStrip` + a `view | detail` split). Only the `tree` view is real; `flamegraph`/`diff` views and the search/export controls are stubs.

**Tech Stack:** React 18, TypeScript (strict), Vite 6, Tailwind v4, Vitest. `src/core/` (parse/types/openinference/format) is **not modified**.

---

## File map

| File | Responsibility |
|---|---|
| `src/styles/tokens.css` | **create** — semantic + per-kind color tokens, light & dark |
| `src/styles/index.css` | **create** (moved from `src/index.css`) — Tailwind import, `@theme inline` mapping, base styles |
| `src/index.css` | **delete** (moved) |
| `src/main.tsx` | **modify** — import path → `./styles/index.css` |
| `src/theme/theme.ts` | **create** — pure `resolveTheme()` + constants (tested) |
| `src/theme/ThemeProvider.tsx` | **create** — context, persistence, applies `data-theme` |
| `src/theme/useTheme.ts` | **create** — context hook |
| `src/lib/kinds.ts` | **modify** — kind → `{ label, cssVar }`, `kindColor()` (tested) |
| `src/lib/views.ts` | **create** — view registry (tested) |
| `src/components/shell/ThemeToggle.tsx` | **create** |
| `src/components/shell/SummaryStrip.tsx` | **create** (replaces `Summary.tsx`) |
| `src/components/shell/Rail.tsx` | **create** |
| `src/components/shell/SearchBox.tsx` | **create** — stub |
| `src/components/shell/TopBar.tsx` | **create** |
| `src/components/shell/AppShell.tsx` | **create** |
| `src/components/views/ComingSoon.tsx` | **create** — shared stub panel |
| `src/components/views/FlamegraphView.tsx` | **create** — stub |
| `src/components/views/DiffView.tsx` | **create** — stub |
| `src/components/views/TreeView/TimeAxis.tsx` | **create** |
| `src/components/views/TreeView/SpanRow.tsx` | **create** (replaces `components/SpanRow.tsx`) |
| `src/components/views/TreeView/TreeView.tsx` | **create** (replaces `components/TraceTree.tsx`) |
| `src/components/detail/KindBadge.tsx` | **create** (replaces `components/KindBadge.tsx`) |
| `src/components/detail/SpanDetail.tsx` | **create** (replaces `components/SpanDetail.tsx`) |
| `src/components/Loader.tsx` | **modify** — restyle, accept `error` prop |
| `src/App.tsx` | **rewrite** — providers + shell + view routing |
| `src/components/{Summary,TraceTree,SpanRow,SpanDetail,KindBadge,Legend}.tsx` | **delete** — superseded |

---

## Task 1: Design tokens + theme-aware Tailwind

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/index.css`
- Delete: `src/index.css`
- Modify: `src/main.tsx:4`

- [ ] **Step 1: Create `src/styles/tokens.css`**

```css
/* Design tokens. Every color the UI uses is defined here, once per theme.
   Switching theme = setting data-theme on <html>; nothing else re-styles. */

:root,
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --panel-2: #f1f3f6;
  --rail: #f0f1f4;
  --elev: #f3f4ff;
  --text: #1c1f23;
  --muted: #6b7280;
  --faint: #9aa1ad;
  --border: #e6e8ec;
  --border-soft: #eef0f3;
  --track: #edeef1;
  --accent: #6366f1;
  --accent-strong: #4f46e5;
  --error: #dc2626;

  --kind-agent: #6366f1;
  --kind-llm: #d97706;
  --kind-tool: #0d9488;
  --kind-retriever: #7c3aed;
  --kind-chain: #64748b;
  --kind-embedding: #0ea5e9;
  --kind-reranker: #c026d3;
  --kind-guardrail: #ca8a04;
  --kind-evaluator: #16a34a;
  --kind-unknown: #6b7280;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f1115;
  --panel: #15181e;
  --panel-2: #10151f;
  --rail: #12141a;
  --elev: #1b1f27;
  --text: #e6e8ec;
  --muted: #8a93a6;
  --faint: #6b7486;
  --border: #232830;
  --border-soft: #1b1f27;
  --track: #232830;
  --accent: #8b7cf6;
  --accent-strong: #a78bfa;
  --error: #f0556b;

  --kind-agent: #8b7cf6;
  --kind-llm: #e8a23d;
  --kind-tool: #2dd4bf;
  --kind-retriever: #a78bfa;
  --kind-chain: #8a93a6;
  --kind-embedding: #5fb6e8;
  --kind-reranker: #c77dff;
  --kind-guardrail: #e8c84d;
  --kind-evaluator: #6fd08c;
  --kind-unknown: #6b7486;
}
```

- [ ] **Step 2: Create `src/styles/index.css`** (Tailwind entry + token→utility mapping + base styles)

```css
@import "tailwindcss";
@import "./tokens.css";

/* Expose semantic tokens as Tailwind color utilities (bg-panel, text-muted,
   border-border, …). `inline` keeps them as live var() refs so they follow
   data-theme at runtime. */
@theme inline {
  --color-bg: var(--bg);
  --color-panel: var(--panel);
  --color-panel-2: var(--panel-2);
  --color-rail: var(--rail);
  --color-elev: var(--elev);
  --color-text: var(--text);
  --color-muted: var(--muted);
  --color-faint: var(--faint);
  --color-border: var(--border);
  --color-border-soft: var(--border-soft);
  --color-track: var(--track);
  --color-accent: var(--accent);
  --color-accent-strong: var(--accent-strong);
  --color-error: var(--error);
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.mono {
  font-family: ui-monospace, "JetBrains Mono", "SFMono-Regular", "SF Mono", Menlo,
    Consolas, monospace;
}

.wordmark {
  letter-spacing: 0.16em;
  font-weight: 600;
}

* {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
*::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}
*::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 6px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
```

- [ ] **Step 3: Delete the old stylesheet**

Run: `git rm src/index.css`

- [ ] **Step 4: Point the entry at the new path** — `src/main.tsx`, change the import line:

```tsx
import "./styles/index.css";
```

- [ ] **Step 5: Verify the build resolves tokens + utilities**

Run: `npm run build`
Expected: build succeeds (tsc + vite), no "cannot resolve ./index.css" or unknown-utility errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): theme-aware design tokens + Tailwind token utilities"
```

---

## Task 2: Theme resolution logic (TDD)

**Files:**
- Create: `src/theme/theme.ts`
- Test: `src/theme/theme.test.ts`

- [ ] **Step 1: Write the failing test** — `src/theme/theme.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolveTheme, THEME_KEY } from "./theme";

describe("resolveTheme", () => {
  it("uses a valid stored value over system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("falls back to system preference when nothing is stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("ignores an invalid stored value and uses system preference", () => {
    expect(resolveTheme("purple", true)).toBe("dark");
    expect(resolveTheme("", false)).toBe("light");
  });

  it("exposes a stable storage key", () => {
    expect(THEME_KEY).toBe("tracelens.theme");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/theme/theme.test.ts`
Expected: FAIL — cannot resolve `./theme`.

- [ ] **Step 3: Write minimal implementation** — `src/theme/theme.ts`

```ts
export type Theme = "light" | "dark";

export const THEME_KEY = "tracelens.theme";

/** Pick the active theme from any stored value plus the system preference. */
export function resolveTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return systemPrefersDark ? "dark" : "light";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/theme/theme.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/theme/theme.ts src/theme/theme.test.ts
git commit -m "feat(theme): pure theme resolution logic"
```

---

## Task 3: ThemeProvider + useTheme + ThemeToggle

**Files:**
- Create: `src/theme/ThemeProvider.tsx`
- Create: `src/theme/useTheme.ts`
- Create: `src/components/shell/ThemeToggle.tsx`

- [ ] **Step 1: Create `src/theme/ThemeProvider.tsx`**

```tsx
import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { resolveTheme, THEME_KEY, type Theme } from "./theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function persist(t: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    resolveTheme(
      typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null,
      systemPrefersDark(),
    ),
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    persist(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      persist(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

- [ ] **Step 2: Create `src/theme/useTheme.ts`**

```ts
import { useContext } from "react";
import { ThemeContext } from "./ThemeProvider";

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

- [ ] **Step 3: Create `src/components/shell/ThemeToggle.tsx`**

```tsx
import { useTheme } from "../../theme/useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-[15px] text-muted hover:bg-panel hover:text-text"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      aria-label="Toggle light/dark theme"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). (Components are not yet wired into the tree; this only checks they compile.)

- [ ] **Step 5: Commit**

```bash
git add src/theme/ThemeProvider.tsx src/theme/useTheme.ts src/components/shell/ThemeToggle.tsx
git commit -m "feat(theme): provider, hook, and toggle"
```

---

## Task 4: Kind colors → CSS-variable references (TDD)

**Files:**
- Modify: `src/lib/kinds.ts`
- Test: `src/lib/kinds.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/kinds.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { KIND_STYLES, kindStyle, kindColor } from "./kinds";

const ALL_KINDS = [
  "agent", "llm", "tool", "retriever", "chain",
  "embedding", "reranker", "guardrail", "evaluator", "unknown",
] as const;

describe("kinds", () => {
  it("maps every SpanKind to a label and a var(--kind-*) color", () => {
    for (const k of ALL_KINDS) {
      const style = KIND_STYLES[k];
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.color).toMatch(/^var\(--kind-/);
    }
  });

  it("kindColor returns a var() reference", () => {
    expect(kindColor("llm")).toBe("var(--kind-llm)");
    expect(kindColor("tool")).toBe("var(--kind-tool)");
  });

  it("falls back to unknown for an unrecognized kind", () => {
    // @ts-expect-error testing the runtime fallback
    expect(kindStyle("bogus").color).toBe("var(--kind-unknown)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/kinds.test.ts`
Expected: FAIL — `kindColor` not exported / `cssVar` undefined.

- [ ] **Step 3: Rewrite `src/lib/kinds.ts`**

```ts
// The visual signature of Tracelens: span kind == color.
// Colors live in styles/tokens.css as --kind-* variables (one value per theme),
// so a kind looks correct in light and dark automatically. This module only
// says WHICH variable a kind maps to.

import type { SpanKind } from "../core/types";

export interface KindStyle {
  label: string;
  color: string; // CSS var reference, e.g. "var(--kind-llm)" — themeable
}

export const KIND_STYLES: Record<SpanKind, KindStyle> = {
  agent: { label: "Agent", color: "var(--kind-agent)" },
  llm: { label: "LLM", color: "var(--kind-llm)" },
  tool: { label: "Tool", color: "var(--kind-tool)" },
  retriever: { label: "Retriever", color: "var(--kind-retriever)" },
  chain: { label: "Chain", color: "var(--kind-chain)" },
  embedding: { label: "Embedding", color: "var(--kind-embedding)" },
  reranker: { label: "Reranker", color: "var(--kind-reranker)" },
  guardrail: { label: "Guardrail", color: "var(--kind-guardrail)" },
  evaluator: { label: "Evaluator", color: "var(--kind-evaluator)" },
  unknown: { label: "Span", color: "var(--kind-unknown)" },
};

// Retained for back-compat with v0 components still present until Task 13.
export const ERROR_COLOR = "var(--error)";

export function kindStyle(kind: SpanKind): KindStyle {
  return KIND_STYLES[kind] ?? KIND_STYLES.unknown;
}

/** CSS color reference for a kind, e.g. "var(--kind-llm)". */
export function kindColor(kind: SpanKind): string {
  return kindStyle(kind).color;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/kinds.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/kinds.ts src/lib/kinds.test.ts
git commit -m "refactor(kinds): map span kinds to themeable css variables"
```

---

## Task 5: View registry (TDD)

**Files:**
- Create: `src/lib/views.ts`
- Test: `src/lib/views.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/views.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { VIEWS, DEFAULT_VIEW } from "./views";

describe("views registry", () => {
  it("has unique ids", () => {
    const ids = VIEWS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has exactly one ready view initially", () => {
    expect(VIEWS.filter((v) => v.status === "ready")).toHaveLength(1);
  });

  it("defaults to a view that is ready", () => {
    const def = VIEWS.find((v) => v.id === DEFAULT_VIEW);
    expect(def?.status).toBe("ready");
  });

  it("every view has a label and an icon glyph", () => {
    for (const v of VIEWS) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.icon.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/views.test.ts`
Expected: FAIL — cannot resolve `./views`.

- [ ] **Step 3: Create `src/lib/views.ts`**

```ts
// The viewer's view registry. The Rail renders one button per entry; the App
// renders the matching view. New v1 views (flamegraph, diff) become real by
// swapping their stub component and flipping status to "ready".

export type ViewId = "tree" | "flamegraph" | "diff";
export type ViewStatus = "ready" | "soon";

export interface ViewDef {
  id: ViewId;
  label: string;
  icon: string; // single glyph shown in the rail
  status: ViewStatus;
}

export const VIEWS: ViewDef[] = [
  { id: "tree", label: "Call tree", icon: "▤", status: "ready" },
  { id: "flamegraph", label: "Flamegraph", icon: "▦", status: "soon" },
  { id: "diff", label: "Diff", icon: "⇄", status: "soon" },
];

export const DEFAULT_VIEW: ViewId = "tree";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/views.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/views.ts src/lib/views.test.ts
git commit -m "feat(views): view registry with ready/soon status"
```

---

## Task 6: SummaryStrip

**Files:**
- Create: `src/components/shell/SummaryStrip.tsx`

- [ ] **Step 1: Create `src/components/shell/SummaryStrip.tsx`**

```tsx
import type { TraceSummary } from "../../core/types";
import { formatDuration, formatTokens, formatCost } from "../../core/format";

interface Stat {
  label: string;
  value: string;
  color?: string; // inline color for data-driven tones (e.g. LLM, errors)
}

export function SummaryStrip({ summary }: { summary: TraceSummary }) {
  const stats: Stat[] = [
    { label: "Duration", value: formatDuration(summary.durationMs) },
    { label: "Spans", value: String(summary.spanCount) },
    { label: "LLM", value: String(summary.llmCalls), color: "var(--kind-llm)" },
    { label: "Tool", value: String(summary.toolCalls), color: "var(--kind-tool)" },
    {
      label: "Tokens",
      value: `${formatTokens(summary.totalTokensIn)} / ${formatTokens(summary.totalTokensOut)}`,
    },
    { label: "Cost", value: formatCost(summary.totalCostUsd) },
    {
      label: "Errors",
      value: String(summary.errors),
      color: summary.errors ? "var(--error)" : undefined,
    },
  ];

  return (
    <div className="flex flex-wrap border-b border-border bg-panel">
      {stats.map((s) => (
        <div key={s.label} className="border-r border-border-soft px-4 py-2">
          <div className="text-[9px] uppercase tracking-wider text-faint">{s.label}</div>
          <div className="mono text-sm text-text" style={s.color ? { color: s.color } : undefined}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/SummaryStrip.tsx
git commit -m "feat(ui): dense summary strip"
```

---

## Task 7: Rail (view switcher + theme toggle)

**Files:**
- Create: `src/components/shell/Rail.tsx`

- [ ] **Step 1: Create `src/components/shell/Rail.tsx`**

```tsx
import { VIEWS, type ViewId } from "../../lib/views";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  activeView: ViewId;
  onSelectView: (id: ViewId) => void;
}

export function Rail({ activeView, onSelectView }: Props) {
  return (
    <nav className="flex w-[50px] flex-col items-center gap-1 border-r border-border bg-rail py-3">
      <div
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: "linear-gradient(135deg,var(--kind-agent),var(--kind-retriever))" }}
      >
        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="14" cy="14" r="8.5" fill="none" stroke="#fff" strokeWidth="2.6" />
          <line x1="20" y1="20" x2="26" y2="26" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
      </div>

      {VIEWS.map((v) => {
        const active = v.id === activeView;
        return (
          <button
            key={v.id}
            onClick={() => onSelectView(v.id)}
            title={v.status === "soon" ? `${v.label} — coming in v1` : v.label}
            aria-label={v.label}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-[15px] ${
              active
                ? "bg-panel text-accent-strong shadow-sm"
                : "text-muted hover:bg-panel hover:text-text"
            }`}
          >
            {v.icon}
            {v.status === "soon" && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-faint" />
            )}
          </button>
        );
      })}

      <div className="flex-1" />
      <ThemeToggle />
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/Rail.tsx
git commit -m "feat(ui): left rail view switcher"
```

---

## Task 8: SearchBox (stub) + TopBar

**Files:**
- Create: `src/components/shell/SearchBox.tsx`
- Create: `src/components/shell/TopBar.tsx`

- [ ] **Step 1: Create `src/components/shell/SearchBox.tsx`** (inert stub for v1 search)

```tsx
export function SearchBox() {
  return (
    <button
      type="button"
      title="Search — coming in v1"
      className="flex min-w-0 max-w-[320px] flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 text-left text-[12px] text-faint"
    >
      <span aria-hidden>🔍</span>
      <span className="truncate">Search spans, jump to errors…</span>
      <span className="mono ml-auto rounded border border-border px-1 text-[10px]">⌘K</span>
    </button>
  );
}
```

- [ ] **Step 2: Create `src/components/shell/TopBar.tsx`**

```tsx
import { SearchBox } from "./SearchBox";

interface Props {
  label: string;
  onReset: () => void;
}

export function TopBar({ label, onReset }: Props) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2.5">
      <span className="truncate text-[13px] font-semibold text-text">
        {label || "Untitled trace"}
      </span>
      <div className="ml-1 flex min-w-0 flex-1 justify-start">
        <SearchBox />
      </div>
      <button
        type="button"
        title="Export — coming in v1"
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-text"
      >
        ⇪ Export
      </button>
      <button
        onClick={onReset}
        className="shrink-0 rounded-lg border border-accent-strong bg-accent-strong px-3 py-1.5 text-[12px] text-white hover:brightness-110"
      >
        New trace
      </button>
    </header>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/SearchBox.tsx src/components/shell/TopBar.tsx
git commit -m "feat(ui): top bar with search/export stubs"
```

---

## Task 9: TreeView (TimeAxis + SpanRow + TreeView)

**Files:**
- Create: `src/components/views/TreeView/TimeAxis.tsx`
- Create: `src/components/views/TreeView/SpanRow.tsx`
- Create: `src/components/views/TreeView/TreeView.tsx`

- [ ] **Step 1: Create `src/components/views/TreeView/TimeAxis.tsx`**

```tsx
import { formatDuration } from "../../../core/format";

export function TimeAxis({ durationMs }: { durationMs: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border-soft px-3.5 py-1.5 text-[9px] uppercase tracking-wider text-faint">
      <span>Call tree</span>
      <span className="mono">waterfall · {formatDuration(durationMs)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/views/TreeView/SpanRow.tsx`**

```tsx
import type { RunNode } from "../../../core/types";
import { kindColor } from "../../../lib/kinds";
import { formatDuration } from "../../../core/format";

interface Props {
  node: RunNode;
  traceStart: number;
  traceDuration: number;
  selected: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

export function SpanRow({
  node,
  traceStart,
  traceDuration,
  selected,
  hasChildren,
  collapsed,
  onSelect,
  onToggle,
}: Props) {
  const isError = node.status === "error";
  const color = isError ? "var(--error)" : kindColor(node.kind);
  const leftPct =
    traceDuration > 0 ? ((node.startMs - traceStart) / traceDuration) * 100 : 0;
  const widthPct =
    traceDuration > 0 ? Math.max(0.8, (node.durationMs / traceDuration) * 100) : 100;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_150px_56px] items-center gap-2.5 border-l-2 py-1.5 pr-3 text-[12px] ${
        selected ? "bg-elev" : "hover:bg-panel-2"
      }`}
      style={{ borderLeftColor: selected ? color : "transparent" }}
    >
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: 6 + node.depth * 18 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mono flex h-4 w-3 shrink-0 items-center justify-center text-[9px] text-faint"
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▶" : "▾"}
        </button>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate" style={isError ? { color: "var(--error)" } : undefined}>
          {node.name}
        </span>
        {node.model && (
          <span className="mono shrink-0 rounded border border-border bg-bg px-1 text-[10px] text-muted">
            {node.model}
          </span>
        )}
      </div>

      <div className="relative h-1.5 rounded-full bg-track">
        <div
          className="absolute top-0 h-1.5 rounded-full"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color, opacity: 0.9 }}
        />
      </div>

      <span className="mono text-right text-[11px] text-muted">
        {formatDuration(node.durationMs)}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/views/TreeView/TreeView.tsx`**

```tsx
import { useState } from "react";
import type { ParsedTrace } from "../../../core/types";
import { flatten } from "../../../core/parse";
import { SpanRow } from "./SpanRow";
import { TimeAxis } from "./TimeAxis";

interface Props {
  trace: ParsedTrace;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TreeView({ trace, selectedId, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = flatten(trace.roots, collapsed);
  const { startMs, durationMs } = trace.summary;

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TimeAxis durationMs={durationMs} />
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {rows.map((node) => (
          <SpanRow
            key={node.spanId}
            node={node}
            traceStart={startMs}
            traceDuration={durationMs}
            selected={node.spanId === selectedId}
            hasChildren={node.children.length > 0}
            collapsed={collapsed.has(node.spanId)}
            onSelect={() => onSelect(node.spanId)}
            onToggle={() => toggle(node.spanId)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/views/TreeView/
git commit -m "feat(ui): redesigned call tree + waterfall view"
```

---

## Task 10: KindBadge + SpanDetail

**Files:**
- Create: `src/components/detail/KindBadge.tsx`
- Create: `src/components/detail/SpanDetail.tsx`

- [ ] **Step 1: Create `src/components/detail/KindBadge.tsx`**

```tsx
import type { SpanKind } from "../../core/types";
import { kindStyle, kindColor } from "../../lib/kinds";

export function KindBadge({ kind }: { kind: SpanKind }) {
  const { label } = kindStyle(kind);
  const color = kindColor(kind);
  return (
    <span
      className="mono inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Create `src/components/detail/SpanDetail.tsx`**

```tsx
import type { RunNode } from "../../core/types";
import { KindBadge } from "./KindBadge";
import { formatDuration, formatTokens, formatCost, formatClock } from "../../core/format";

const HANDLED_KEYS = [
  "input.value",
  "output.value",
  "tool.parameters",
  "llm.input_messages",
  "llm.output_messages",
];

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <span className={`mono break-words text-[13px] ${accent ? "text-accent-strong" : "text-text"}`}>
        {value}
      </span>
    </div>
  );
}

function Block({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      <pre className="mono max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-panel p-3 text-[12.5px] leading-relaxed text-text">
        {body}
      </pre>
    </div>
  );
}

export function SpanDetail({ node }: { node: RunNode }) {
  const otherAttrs = Object.entries(node.attributes).filter(([k]) => !HANDLED_KEYS.includes(k));
  const isError = node.status === "error";

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <KindBadge kind={node.kind} />
          {isError && (
            <span
              className="mono rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wider text-error"
              style={{
                background: "color-mix(in srgb, var(--error) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)",
              }}
            >
              error
            </span>
          )}
        </div>
        <h2 className="text-base font-semibold text-text">{node.name}</h2>
      </div>

      {isError && node.statusMessage && (
        <div
          className="rounded-lg p-3 text-sm text-error"
          style={{
            background: "color-mix(in srgb, var(--error) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 35%, transparent)",
          }}
        >
          {node.statusMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Duration" value={formatDuration(node.durationMs)} />
        <Field label="Started" value={formatClock(node.startMs)} />
        {node.model && <Field label="Model" value={node.model} />}
        {node.tokensIn || node.tokensOut ? (
          <Field
            label="Tokens in / out"
            value={`${formatTokens(node.tokensIn)} / ${formatTokens(node.tokensOut)}`}
          />
        ) : null}
        {node.costUsd ? <Field label="Cost" value={formatCost(node.costUsd)} accent /> : null}
        <Field label="Span ID" value={node.spanId} />
      </div>

      <Block label="Input" body={node.input} />
      <Block label="Output" body={node.output} />

      {otherAttrs.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider text-faint">
            Raw attributes ({otherAttrs.length})
          </summary>
          <pre className="mono mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-panel p-3 text-[12px] text-muted">
            {JSON.stringify(Object.fromEntries(otherAttrs), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/detail/
git commit -m "feat(ui): redesigned span detail panel"
```

---

## Task 11: Stub views (ComingSoon + Flamegraph + Diff)

**Files:**
- Create: `src/components/views/ComingSoon.tsx`
- Create: `src/components/views/FlamegraphView.tsx`
- Create: `src/components/views/DiffView.tsx`

- [ ] **Step 1: Create `src/components/views/ComingSoon.tsx`**

```tsx
export function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] uppercase tracking-wider text-faint">
        Coming in v1
      </span>
      <h2 className="text-lg text-text">{title}</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted">{blurb}</p>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/views/FlamegraphView.tsx`**

```tsx
import { ComingSoon } from "./ComingSoon";

export function FlamegraphView() {
  return (
    <ComingSoon
      title="Token & cost flamegraph"
      blurb="See where the time and the money went across the run — a flamegraph weighted by duration, tokens, or cost."
    />
  );
}
```

- [ ] **Step 3: Create `src/components/views/DiffView.tsx`**

```tsx
import { ComingSoon } from "./ComingSoon";

export function DiffView() {
  return (
    <ComingSoon
      title="Diff two runs"
      blurb="Load two traces and compare them side by side to catch regressions in latency, cost, and structure."
    />
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/views/ComingSoon.tsx src/components/views/FlamegraphView.tsx src/components/views/DiffView.tsx
git commit -m "feat(ui): stub flamegraph and diff views"
```

---

## Task 12: Loader redesign (restyle + error prop)

**Files:**
- Modify: `src/components/Loader.tsx`

- [ ] **Step 1: Replace `src/components/Loader.tsx`** (logic unchanged; restyled with tokens; shows the error banner and a brand header + theme toggle)

```tsx
import { useCallback, useState } from "react";
import { parseTrace } from "../core/parse";
import type { ParsedTrace } from "../core/types";
import { ThemeToggle } from "./shell/ThemeToggle";

interface Props {
  onLoad: (trace: ParsedTrace, label: string) => void;
  onError: (message: string) => void;
  error?: string | null; // optional so the v0 App still compiles until Task 13
}

const SAMPLES = [
  { file: "research-agent.json", label: "Research agent", hint: "7 spans · 3 LLM · 2 tools" },
  { file: "tool-error.json", label: "Tool error + recovery", hint: "6 spans · 1 error" },
];

export function Loader({ onLoad, onError, error }: Props) {
  const [dragging, setDragging] = useState(false);

  const ingest = useCallback(
    (text: string, label: string) => {
      try {
        onLoad(parseTrace(JSON.parse(text)), label);
      } catch (err) {
        onError(
          err instanceof Error
            ? err.message
            : "That file is not valid JSON. Export your trace as JSON and try again.",
        );
      }
    },
    [onLoad, onError],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      file
        .text()
        .then((t) => ingest(t, file.name))
        .catch(() => onError("Could not read that file."));
    },
    [ingest, onError],
  );

  const loadSample = useCallback(
    (file: string, label: string) => {
      fetch(`${import.meta.env.BASE_URL}samples/${file}`)
        .then((r) => r.text())
        .then((t) => ingest(t, label))
        .catch(() => onError("Could not load the sample."));
    },
    [ingest, onError],
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-panel px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: "linear-gradient(135deg,var(--kind-agent),var(--kind-retriever))" }}
          >
            <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="14" cy="14" r="8.5" fill="none" stroke="#fff" strokeWidth="2.6" />
              <line x1="20" y1="20" x2="26" y2="26" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
            </svg>
          </div>
          <span className="wordmark text-lg text-text">tracelens</span>
        </div>
        <ThemeToggle />
      </header>

      {error && (
        <div
          className="border-b border-border px-5 py-2 text-sm text-error"
          style={{ background: "color-mix(in srgb, var(--error) 8%, transparent)" }}
        >
          {error}
        </div>
      )}

      <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl text-text">See what your agent actually did.</h1>
          <p className="text-sm leading-relaxed text-muted">
            Drop in an OpenInference or OTel GenAI trace. Tracelens turns it into a readable
            call tree with timings, tokens, cost, and errors — all in your browser. Nothing is
            uploaded.
          </p>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10"
          style={{
            borderColor: dragging ? "var(--accent)" : "var(--border)",
            background: dragging ? "var(--elev)" : "var(--panel)",
          }}
        >
          <span className="text-sm text-text">Drop a trace file here</span>
          <span className="text-[12px] text-faint">or click to choose a .json file</span>
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>

        <div className="flex w-full flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-faint">or open a sample</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {SAMPLES.map((s) => (
              <button
                key={s.file}
                onClick={() => loadSample(s.file, s.label)}
                className="flex flex-col items-start gap-0.5 rounded-lg border border-border bg-panel px-4 py-3 text-left hover:border-accent"
              >
                <span className="text-sm text-text">{s.label}</span>
                <span className="mono text-[11px] text-faint">{s.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Loader.tsx
git commit -m "feat(ui): redesigned loader screen with theme toggle + error banner"
```

---

## Task 13: AppShell + App rewrite + remove old components

**Files:**
- Create: `src/components/shell/AppShell.tsx`
- Rewrite: `src/App.tsx`
- Delete: `src/components/Summary.tsx`, `src/components/TraceTree.tsx`, `src/components/SpanRow.tsx`, `src/components/SpanDetail.tsx`, `src/components/KindBadge.tsx`, `src/components/Legend.tsx`

- [ ] **Step 1: Create `src/components/shell/AppShell.tsx`**

```tsx
import type { ReactNode } from "react";
import type { TraceSummary } from "../../core/types";
import type { ViewId } from "../../lib/views";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { SummaryStrip } from "./SummaryStrip";

interface Props {
  activeView: ViewId;
  onSelectView: (id: ViewId) => void;
  label: string;
  summary: TraceSummary;
  onReset: () => void;
  children: ReactNode; // the view | detail split
}

export function AppShell({ activeView, onSelectView, label, summary, onReset, children }: Props) {
  return (
    <div className="flex h-full bg-bg">
      <Rail activeView={activeView} onSelectView={onSelectView} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar label={label} onReset={onReset} />
        <SummaryStrip summary={summary} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {children}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `src/App.tsx`**

```tsx
import { useState } from "react";
import type { ParsedTrace } from "./core/types";
import { ThemeProvider } from "./theme/ThemeProvider";
import { Loader } from "./components/Loader";
import { AppShell } from "./components/shell/AppShell";
import { TreeView } from "./components/views/TreeView/TreeView";
import { FlamegraphView } from "./components/views/FlamegraphView";
import { DiffView } from "./components/views/DiffView";
import { SpanDetail } from "./components/detail/SpanDetail";
import { DEFAULT_VIEW, type ViewId } from "./lib/views";

export default function App() {
  const [trace, setTrace] = useState<ParsedTrace | null>(null);
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW);
  const [error, setError] = useState<string | null>(null);

  const onLoad = (t: ParsedTrace, lbl: string) => {
    setTrace(t);
    setLabel(lbl);
    setSelectedId(t.roots[0]?.spanId ?? null);
    setActiveView(DEFAULT_VIEW);
    setError(null);
  };

  const reset = () => {
    setTrace(null);
    setSelectedId(null);
    setError(null);
    setLabel("");
  };

  const selected = selectedId ? (trace?.byId.get(selectedId) ?? null) : null;

  return (
    <ThemeProvider>
      {!trace ? (
        <Loader onLoad={onLoad} onError={setError} error={error} />
      ) : (
        <AppShell
          activeView={activeView}
          onSelectView={setActiveView}
          label={label}
          summary={trace.summary}
          onReset={reset}
        >
          <section className="min-h-0 overflow-hidden border-r border-border bg-panel">
            {activeView === "tree" && (
              <TreeView trace={trace} selectedId={selectedId} onSelect={setSelectedId} />
            )}
            {activeView === "flamegraph" && <FlamegraphView />}
            {activeView === "diff" && <DiffView />}
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

- [ ] **Step 3: Delete superseded components**

Run:
```bash
git rm src/components/Summary.tsx src/components/TraceTree.tsx src/components/SpanRow.tsx src/components/SpanDetail.tsx src/components/KindBadge.tsx src/components/Legend.tsx
```

- [ ] **Step 4: Typecheck + tests + build (full gate)**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; **19 tests** pass (9 core + 4 theme + 3 kinds + 4 views — wait, recount below); build PASS with no unresolved imports.
> Test count check: `parse.test.ts` 9 + `theme.test.ts` 4 + `kinds.test.ts` 3 + `views.test.ts` 4 = **20 tests**. Confirm none of the deleted components were imported anywhere (the rewrite removed all references).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): assemble app shell and remove v0 components"
```

---

## Task 14: Final verification (run the app, both themes)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server** via the preview tooling (or `npm run dev`) and load a sample.

- [ ] **Step 2: Confirm the tree view renders** — left rail with 3 view buttons (flamegraph/diff carry a "soon" dot), summary strip with the 7 stats, call tree + waterfall, and the detail panel populated on select. The browser console must be error-free.

- [ ] **Step 3: Toggle the theme** — click the rail's theme toggle. The whole UI must switch light↔dark with kind colors remaining legible. Reload and confirm the choice persisted (localStorage `tracelens.theme`).

- [ ] **Step 4: Click the flamegraph and diff rail buttons** — each shows its "Coming in v1" placeholder, not an error.

- [ ] **Step 5: Capture proof** — screenshot the tree view in **both** light and dark themes.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(ui): redesign verification fixes"
```

---

## Self-review notes (author)

- **Spec coverage:** shell/rail/topbar/summary (T6–8,13), tokens + light/dark (T1), theme toggle + persistence (T2,3), redesigned tree/waterfall/detail/loader (T9,10,12), view registry + stubs for flamegraph/diff/search/export (T5,8,11), core untouched + tests green (T13 gate). ✓
- **Non-goals honored:** no `src/core/` edits anywhere; search/export/flamegraph/diff are inert stubs. ✓
- **Type consistency:** `ViewId`/`DEFAULT_VIEW` (views.ts) used in Rail/AppShell/App; `kindColor()` (kinds.ts) used in SpanRow/KindBadge; `Theme`/`THEME_KEY` (theme.ts) used in ThemeProvider; `SummaryStrip`/`TreeView`/`SpanDetail` prop shapes match their call sites in AppShell/App. ✓
- **Tailwind risk:** `@theme inline` token mapping is verified by the Task 1 build step before any component depends on it.
