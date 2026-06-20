# Diff Two Runs — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Sub-project:** 8 of N — the last v1 roadmap feature. Fills the `diff` stub: load a second trace and compare it against the current one to catch regressions.

## 1. Goal

With a trace open (A = baseline), load a second trace (B = comparison) in the Diff view and see, at a glance, what regressed: a summary delta bar (duration / tokens / cost / errors A→B, worse in red, better in green) and a merged call tree where matched steps show their A→B delta and steps added / removed between runs are flagged.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Display | Merged, aligned tree + summary delta bar (not side-by-side) |
| Loading | Current trace = **A** (baseline); load **B** inside the Diff view; delta = `B − A` |
| Alignment | Match spans by **name + ordinal among same-name siblings**, recursively; unmatched = added (only in B) / removed (only in A) |
| Per-row metric | Duration is primary (A→B + Δ); tokens/cost live in the summary bar |
| Polarity | duration / tokens / cost / errors: higher = worse (red), lower = better (green); span/LLM/tool counts are neutral |
| Scope | Self-contained Diff view — no cross-trace sync with the shared detail panel; no per-field input/output diff or click-to-drill (later) |

## 3. Pure core — `src/core/diff.ts`

```ts
export type DiffStatus = "matched" | "added" | "removed";

export interface DiffNode {
  key: string;           // stable path key
  name: string;
  kind: SpanKind;
  a: RunNode | null;     // baseline span
  b: RunNode | null;     // comparison span
  status: DiffStatus;
  depth: number;
  children: DiffNode[];
}

export interface DiffStat { a: number; b: number; delta: number; } // delta = b - a

export interface DiffSummary {
  durationMs: DiffStat; spanCount: DiffStat; llmCalls: DiffStat;
  toolCalls: DiffStat; tokens: DiffStat; costUsd: DiffStat; errors: DiffStat;
}

export interface TraceDiff { roots: DiffNode[]; summary: DiffSummary; }

export function diffTraces(a: ParsedTrace, b: ParsedTrace): TraceDiff;
```

**Alignment** (`alignLevel(aNodes, bNodes, depth, prefix)`):
- Build a per-name FIFO queue of `bNodes`. For each `aNode` (in order), pop the first unused B with the same name → **matched** (recurse `alignLevel(a.children, b.children)`); none → **removed** (its subtree all removed). Then any unused B nodes (in original order) → **added** (subtree all added).
- A removed/added node's subtree is wholly removed/added (`a`/`b` set on the present side only).

**Summary** = `stat(a.summary.X, b.summary.X)` for duration/spanCount/llm/tool/(tokensIn+Out)/cost/errors, where `stat(a,b) = { a, b, delta: b-a }`.

Pure and tested; the canonical model is untouched.

## 4. View — `src/components/views/DiffView.tsx`

Replaces the stub. Props: `{ trace: ParsedTrace; label: string }` (A + its filename). Owns `traceB`, `labelB`, `errorB` state.

- **Before B is loaded:** a centered prompt — "Compare **{label}** against another trace" — with a drop zone + file picker. Ingest reuses `parseTraceText`; a parse failure shows a friendly inline error. A `.jsonl` (Codex/Claude) works too (decode handles it).
- **After B:** `const diff = useMemo(() => diffTraces(trace, traceB), [trace, traceB])`.
  - **Summary delta bar:** one cell per metric showing `A → B` and the signed Δ (+%); duration/tokens/cost/errors tinted red (worse) / green (better) / muted (equal); counts neutral. A small "Compare another" button clears B.
  - **Merged tree:** flatten `diff.roots` depth-first into rows. Each row: depth indent, kind color dot, name, and `A.dur → B.dur` with a colored Δ. Status styling: **matched** → Δ colored by polarity; **added** → green tint + "＋ only in B"; **removed** → red tint + name struck through + "－ only in A". Token-styled, light/dark; reuses `kindColor` + `core/format`.

## 5. Wiring

- `src/App.tsx`: `<DiffView trace={trace} label={label} />` (was `<DiffView />`).
- `src/lib/views.ts`: diff `status: "soon"` → `"ready"`.
- `src/lib/views.test.ts`: the ready-views assertion becomes `["tree", "flamegraph", "diff"]`.

## 6. Error handling / edge cases

- B fails to parse → inline error on the load prompt; A view unchanged.
- B identical to A → all matched, every Δ = 0, tree/bar render in neutral tones.
- Duplicate-name siblings → matched in sibling order (1st↔1st, 2nd↔2nd); extras are added/removed.
- A delta % uses `delta / a` only when `a > 0` (else show absolute Δ only, avoid divide-by-zero).
- Loading a new top-level trace (A) or `reset()` does not need to touch B — DiffView is remounted per trace; B is local to the view and cleared when A changes (DiffView keyed by A, or B reset in an effect on `trace`).
- The shared detail panel (aside) is not driven by the diff; it shows its default "Select a span" state on the Diff view.

## 7. Testing

`src/core/diff.test.ts` (pure): build two small traces via `parseTrace` on inline span arrays — B has one span with a longer duration, one span added, one removed vs A. Assert:
- a matched node has both `a` and `b` and the right names; an added node has `a === null`; a removed node has `b === null`.
- `summary.durationMs.delta`, `summary.errors.delta`, `summary.tokens.delta` have the expected sign/value.
- duplicate same-name siblings align by order.

All existing tests stay green (core gains `diff.ts`; `views.test.ts` updated). Final gate: `typecheck` + `test` + `build`; then dev-server — open sample A, switch to Diff, load a different sample as B, confirm the summary bar colors (red/green) and the added/removed markers, in light and dark.

## 8. Execution order (incremental, green at every step)

1. `core/diff.ts` + `core/diff.test.ts` (TDD).
2. `DiffView` (B loader + summary bar + merged tree) + App wiring + `views.ts` flip + `views.test.ts` update.
3. Verification gate.

## 9. Risks & mitigations

- **Name-based alignment fragility** — fine for re-runs of the same agent (names stable); genuinely different steps simply show as added/removed, which is still informative.
- **Big B file** — parsing is linear and reuses `parseTraceText`; the merged tree scrolls (the view-host section scrolls after the recent fix).
- **Scope creep** — input/output text diff, click-to-drill, and choosing the per-row metric are explicit later enhancements.
