# Token / Cost / Duration Flamegraph — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Sub-project:** 7 of N in the v1 effort. Fills the `flamegraph` stub view (currently "coming in v1") with a real icicle flamegraph weighted by duration, tokens, or cost.

## 1. Goal

Show at a glance where a run's **time and money** went: an icicle flamegraph where each block's width is its share of a chosen metric (duration / tokens / cost), nested by call hierarchy, colored by span kind, and clickable to inspect.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Metrics | Duration **and** Tokens **and** Cost, toggleable; default Duration |
| Layout | Icicle (root on top spanning full width; children below, left-aligned) |
| Weighting | duration = wall-clock nesting (children nest inside parent); tokens/cost = subtree sum (parent = self + descendants) |
| Empty metric | If a metric's total is 0 (e.g. cost is usually absent), disable its toggle and show a friendly "no data" message |
| Interaction | Click a block → select it (shared detail panel updates); hover → tooltip; current selection highlighted |
| Code | Pure `core/flame.ts` (layout, tested) + `FlamegraphView`; flip the view registry entry to `ready` |

## 3. Weighting model (the heart)

For a node and a metric, define:

- **selfValue(node, metric)**:
  - duration: `max(0, durationMs - Σ child.durationMs)` (the node's exclusive time)
  - tokens: `(tokensIn ?? 0) + (tokensOut ?? 0)`
  - cost: `costUsd ?? 0`
- **aggregate(node, metric)** = `selfValue(node) + Σ aggregate(child)`.
  - For duration this telescopes to `durationMs` (wall-clock of the subtree), so children — whose durations sum to ≤ the parent's — nest inside, and the parent's exposed remainder is its self/gap time.
  - For tokens/cost it is the subtree's summed tokens/cost; the parent's exposed remainder is its own tokens/cost.
- **total** = `Σ aggregate(root)`.

This single model gives all three metrics a consistent, correct flamegraph; only `selfValue` differs per metric.

## 4. Pure core — `src/core/flame.ts`

```ts
export type FlameMetric = "duration" | "tokens" | "cost";

export interface FlameCell {
  spanId: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  depth: number;       // 0 = roots
  x0: number;          // [0,1] left edge
  x1: number;          // [0,1] right edge
  value: number;       // aggregate for the metric
}

export interface FlameLayout {
  cells: FlameCell[];
  maxDepth: number;
  total: number;       // sum of root aggregates
  metric: FlameMetric;
}

export function metricTotal(roots: RunNode[], metric: FlameMetric): number;
export function layoutFlame(roots: RunNode[], metric: FlameMetric): FlameLayout;
```

`layoutFlame`: compute `aggregate` per node (recursive); `total = Σ root aggregates`; if `total === 0` return `{ cells: [], maxDepth: 0, total: 0, metric }`. Otherwise place roots across `[0,1]` ∝ their aggregate; for a node at `[x0,x1]` with aggregate `A`, emit a cell, then lay its children left-to-right: `scale = (x1-x0)/A`, `cursor = x0`, each child gets `[cursor, cursor + childAggregate*scale]` and recurses; the leftover up to `x1` is the exposed self portion (no child). Cells with zero width are skipped.

## 5. View — `src/components/views/FlamegraphView.tsx`

Replaces the stub. Props: `{ trace: ParsedTrace; selectedId: string | null; onSelect: (id: string) => void }`.

- **Header:** a segmented toggle `Duration | Tokens | Cost`. A metric whose `metricTotal` is 0 is disabled. Default `duration`; if the active metric has no data, show a centered "No <metric> data in this trace." message instead of the graph.
- **Graph:** a vertically-scrollable container. For each `FlameCell`, an absolutely-positioned `<button>`: `left: x0*100%`, `width: (x1-x0)*100%`, `top: depth*ROW` (ROW ≈ 22px), height `ROW-2`, background = `kindColor(kind)` (or `var(--error)` for error spans), a truncated label shown when the block is wide enough. Container height = `(maxDepth+1)*ROW`.
- **Interaction:** click → `onSelect(spanId)`; the selected cell gets a visible ring/outline; `title` tooltip = `${name} · ${formattedValue} · ${pct}%` using `formatDuration`/`formatTokens`/`formatCost`.
- Token-styled (light/dark), reuses `kindColor` + `core/format`.

## 6. Wiring

- `src/App.tsx`: render `<FlamegraphView trace={trace} selectedId={selectedId} onSelect={setSelectedId} />` (was `<FlamegraphView />`).
- `src/lib/views.ts`: flamegraph `status: "soon"` → `"ready"` (its rail "soon" dot disappears automatically; diff stays "soon").
- `src/lib/views.test.ts`: update the "exactly one ready view" assertion to **two** (tree + flamegraph).

## 7. Error handling / edge cases

- All-zero metric (cost on a tokenless/costless trace) → empty state + disabled toggle; default stays on a metric that has data (duration always does).
- A subtree with zero aggregate gets zero width and is omitted (no invisible click targets).
- Very deep traces → the container scrolls vertically (the view-host section already scrolls after the recent fix).
- Selecting in the flamegraph drives the same `selectedId` as the tree, so switching back to the tree keeps the selection.
- Search controls are inactive off the tree view (already the case), so the flamegraph is unaffected by an active query.

## 8. Testing

`src/core/flame.test.ts` (pure, using the bundled `research-agent` sample):
- `metricTotal(roots, "duration")` equals the root's `durationMs`; `"tokens"` equals the summed tokens; `"cost"` > 0 for the sample (it has cost), and `metricTotal([], m)` is 0.
- `layoutFlame(roots, "duration")`: the root cell spans `x0≈0, x1≈1`, depth 0; children are at depth 1 with widths proportional to their durations and non-overlapping (`x` ranges tile left-to-right); `maxDepth` ≥ 2 (the retriever under web_search).
- `layoutFlame` with a zero metric returns empty cells.

All existing tests stay green (core gains `flame.ts`; `views.test.ts` updated for two ready views). Final gate: `typecheck` + `test` + `build`; then dev-server check — switch to the flamegraph view, toggle Duration/Tokens/Cost, click a block and confirm the detail panel syncs, in light and dark.

## 9. Execution order (incremental, green at every step)

1. `core/flame.ts` + `core/flame.test.ts` (TDD).
2. `FlamegraphView` (real) + App wiring + `views.ts` flip + `views.test.ts` update.
3. Verification gate.

## 10. Risks & mitigations

- **Metric semantics confusion** (duration nests, tokens/cost sum) — the unified `selfValue` model keeps it correct; the tooltip shows the concrete value + percent so the meaning is legible.
- **Label legibility on thin blocks** — labels render only above a width threshold; full info is in the tooltip and the detail panel on click.
- **Scope** — no zoom/drill-down (click a block to zoom) in v1; that's a possible later enhancement.
