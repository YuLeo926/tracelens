# Frontend Redesign (Foundation) — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Sub-project:** 1 of N in the v1 effort. This one establishes the redesigned UI foundation. Each v1 feature (search, export, flamegraph, diff, import adapters) is a later sub-project with its own spec → plan → implementation cycle.

## 1. Goal

Rebuild the Tracelens frontend into a multi-view "app shell" with a coherent, token-driven visual system (light + dark), so that subsequent v1 views (flamegraph, diff) and tools (search, export) plug into a stable structure instead of being bolted onto the v0 UI and later reworked.

This is a **UI-layer-only** redesign. The parsing core is not touched.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Visual direction | Light, clean, IDE-like; information-dense (not sparse) |
| Layout | Left icon rail (VS Code style) + main area |
| Theming | Light **and** dark, toggleable, token-driven, persisted |
| Search / Export / Flamegraph / Diff | UI entry points present but **stubbed** ("v1 待建"); real logic is later sub-projects |
| Execution strategy | Incremental in-place: build shell + tokens first, port components one by one, keep build/tests green at every step |

## 3. Scope

### In scope
- New app shell: left rail + top bar + summary strip + (view-host | detail) split.
- Design-token system with light + dark themes; remove scattered inline color styles.
- Theme toggle (light/dark), defaulting to system preference, overridable, persisted to `localStorage`.
- Redesign of all existing functionality: Loader (landing/drop), summary, call tree + waterfall (with a time axis), span detail, kind colors/legend.
- View-switcher skeleton: a view registry where `tree` is the only `ready` view; `flamegraph` and `diff` are registered as `soon`.
- Stubbed UI for search (persistent box + `⌘K` affordance) and export (button) — visible, inert, with a "coming in v1" affordance.

### Non-goals (explicitly out)
- Any real logic for flamegraph, diff, search, export, or import adapters.
- Any change to `src/core/` (types, openinference, parse, format) — it stays pure and its 9 tests stay green.
- New trace formats or parsing behavior.
- Multi-trace loading (needed by diff) — later.

## 4. Architecture

### Current (v0)
```
src/
  App.tsx                 # state + full layout
  main.tsx, index.css
  core/                   # pure, tested (UNCHANGED by this work)
  lib/kinds.ts
  components/  Loader, Summary, TraceTree, SpanRow, SpanDetail, KindBadge, Legend
```

### Target
```
src/
  App.tsx                       # thin: ThemeProvider + AppShell + view/selection state
  main.tsx
  styles/
    tokens.css                  # design tokens: light + dark; semantic + per-kind colors
    index.css                   # base + Tailwind entry
  theme/
    ThemeProvider.tsx           # theme context; localStorage; prefers-color-scheme
    useTheme.ts
  lib/
    kinds.ts                    # SpanKind -> { label, cssVar } (theme-agnostic reference)
    views.ts                    # view registry: { id, label, icon, status: 'ready'|'soon' }
  components/
    shell/
      AppShell.tsx              # rail + main CSS grid
      Rail.tsx                  # logo + view switcher + theme toggle (bottom)
      TopBar.tsx                # trace title + SearchBox + export(stub) + New trace
      SummaryStrip.tsx          # dense stat strip (redesigned Summary)
      SearchBox.tsx             # stub: disabled input + ⌘K hint + "coming in v1" tooltip
      ThemeToggle.tsx
    views/
      TreeView/
        TreeView.tsx            # call tree + waterfall (host for the tree)
        SpanRow.tsx             # redesigned row, aligned to the time axis
        TimeAxis.tsx            # ruler across the waterfall column
      FlamegraphView.tsx        # stub placeholder
      DiffView.tsx              # stub placeholder
    detail/
      SpanDetail.tsx            # redesigned detail panel
      KindBadge.tsx
    Loader.tsx                  # redesigned landing/drop screen
```

The `views/` boundary is what makes adding the real flamegraph/diff later a matter of swapping a stub for a real component plus flipping its registry `status` to `ready`.

## 5. Styling & theming

- **Tokens** live in `styles/tokens.css` under `:root[data-theme="light"]` and `:root[data-theme="dark"]`:
  - Semantic: `--bg`, `--panel`, `--rail`, `--text`, `--muted`, `--faint`, `--border`, `--border-soft`, `--track`, `--accent`, `--accent-strong`, `--error`.
  - Per-kind: `--kind-agent`, `--kind-llm`, `--kind-tool`, `--kind-retriever`, `--kind-chain`, `--kind-embedding`, `--kind-reranker`, `--kind-guardrail`, `--kind-evaluator`, `--kind-unknown`.
- Light and dark each define a tuned value for every token (e.g. light `--kind-llm: #d97706`, dark `--kind-llm: #E8A23D`).
- **`kinds.ts` returns a CSS-variable reference, not a hex value**, so a span's color is correct in both themes automatically and the legend/badge/row/waterfall all stay in sync.
- Tailwind v4 `@theme` maps the semantic tokens to utility classes; components prefer utilities + a small number of semantic classes. **Goal: no per-element inline color styles remain.**
- Theme switch = set `data-theme` on the root element. No component re-styling needed.

## 6. Data flow

- Parsing unchanged: `parseTrace(json) -> ParsedTrace` (`roots`, `byId`, `summary`).
- `App` state: `trace: ParsedTrace | null`, `label: string`, `selectedId: string | null`, `activeView: ViewId`, `error: string | null`.
- `ThemeProvider` owns theme independently (context + `localStorage`).
- `Rail` sets `activeView`. The view host renders the matching view; only `tree` renders real content, `flamegraph`/`diff` render a stub state.
- `SummaryStrip` reads `trace.summary`; `TreeView` reads `trace.roots` + `flatten()`; `SpanDetail` reads `trace.byId.get(selectedId)`.

## 7. Error handling

- Keep `TraceParseError` flow in `Loader`; restyle the error banner with tokens.
- Stub views show a friendly "coming in v1" placeholder, never an error state.
- Theme: default to `prefers-color-scheme`; a manual choice is persisted and wins; missing/invalid persisted value falls back to system.
- Selecting a span that no longer exists (e.g. after loading a new trace) resets selection to the first root, as today.

## 8. Testing & verification

- `src/core/` tests remain untouched and must stay green (9 tests).
- Add focused pure-unit tests for new logic:
  - `views.ts` registry shape (ids unique, exactly one initial `ready`).
  - theme resolution (system default, persisted override, invalid value fallback).
  - `kinds.ts` mapping (every `SpanKind` maps to a defined css var + label).
- Final verification gate:
  - `npm run typecheck` green, `npm test` green, `npm run build` green.
  - Run dev server; load a sample; confirm tree + waterfall + summary + detail render.
  - Toggle theme; screenshot **both** light and dark.
  - Switch to flamegraph/diff; confirm the stub placeholder shows.

## 9. Execution order (incremental, build stays green)

1. `tokens.css` (light+dark) + `ThemeProvider` + `ThemeToggle`; verify on the existing UI.
2. `lib/kinds.ts` → css-var references; `lib/views.ts` registry.
3. `shell/AppShell` + `Rail` + `TopBar` + `SummaryStrip`; wire `activeView`.
4. `views/TreeView` (port `TraceTree`/`SpanRow`, add `TimeAxis`); `detail/SpanDetail` + `KindBadge` redesign.
5. `Loader` redesign; `SearchBox`/export stubs; `FlamegraphView`/`DiffView` stubs.
6. Slim `App.tsx` to providers + shell; delete superseded components.
7. Verification gate (section 8).

## 10. Risks & mitigations

- **Tailwind v4 theming setup** — establish `tokens.css` + verify one component before porting the rest (step 1).
- **Scope creep into v1 features** — search/export/flamegraph/diff are stubs by contract; any real logic is a separate sub-project.
- **Regressing v0 behavior** — incremental port keeps the app runnable; the core and its tests are the safety net.
