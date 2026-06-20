# Flamegraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flamegraph stub with a real icicle flamegraph weighted by duration / tokens / cost (toggleable), nested by call hierarchy, click-to-select.

**Architecture:** A pure `core/flame.ts` computes per-node aggregates and an icicle layout (`x0/x1/depth`). `FlamegraphView` renders positioned blocks + a metric toggle and drives the shared `selectedId`. The view registry entry flips to `ready`.

**Tech Stack:** React 18, TypeScript (strict), Tailwind v4, Vitest. Canonical model + `normalizeSpan` untouched.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/core/flame.ts` | 1 | **create** — aggregates + icicle layout |
| `src/core/flame.test.ts` | 1 | **create** — layout/total tests |
| `src/components/views/FlamegraphView.tsx` | 2 | **rewrite** — real flamegraph view |
| `src/App.tsx` | 2 | **edit** — pass trace/selected/onSelect |
| `src/lib/views.ts` | 2 | **edit** — flamegraph → `ready` |
| `src/lib/views.test.ts` | 2 | **edit** — two ready views |

---

## Task 1: Pure flamegraph layout (TDD)

**Files:** Create `src/core/flame.ts`, `src/core/flame.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/core/flame.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseTrace } from "./parse";
import { metricTotal, layoutFlame } from "./flame";
import research from "../../public/samples/research-agent.json";

const t = parseTrace(research);

describe("metricTotal", () => {
  it("duration total equals the root's wall-clock duration", () => {
    expect(metricTotal(t.roots, "duration")).toBe(t.roots[0].durationMs);
  });
  it("tokens total sums in+out across the trace", () => {
    expect(metricTotal(t.roots, "tokens")).toBe(
      t.summary.totalTokensIn + t.summary.totalTokensOut,
    );
  });
  it("cost is positive for the sample; empty forest is 0", () => {
    expect(metricTotal(t.roots, "cost")).toBeGreaterThan(0);
    expect(metricTotal([], "duration")).toBe(0);
  });
});

describe("layoutFlame", () => {
  const f = layoutFlame(t.roots, "duration");
  it("places the root across the full width at depth 0", () => {
    const root = f.cells.find((c) => c.depth === 0)!;
    expect(root.spanId).toBe(t.roots[0].spanId);
    expect(root.x0).toBeCloseTo(0, 5);
    expect(root.x1).toBeCloseTo(1, 5);
  });
  it("nests children left-to-right without overlap", () => {
    expect(f.maxDepth).toBeGreaterThanOrEqual(2);
    const d1 = f.cells.filter((c) => c.depth === 1).sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < d1.length; i++) {
      expect(d1[i].x0).toBeGreaterThanOrEqual(d1[i - 1].x1 - 1e-9);
    }
  });
  it("returns empty cells when the metric total is 0", () => {
    expect(layoutFlame([], "cost").cells).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/core/flame.test.ts`
Expected: FAIL — cannot resolve `./flame`.

- [ ] **Step 3: Create `src/core/flame.ts`**

```ts
// Pure icicle-flamegraph layout over the parsed tree, weighted by a metric.

import type { RunNode, SpanKind, SpanStatus } from "./types";

export type FlameMetric = "duration" | "tokens" | "cost";

export interface FlameCell {
  spanId: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  depth: number; // 0 = roots
  x0: number; // [0,1]
  x1: number; // [0,1]
  value: number; // aggregate for the metric
}

export interface FlameLayout {
  cells: FlameCell[];
  maxDepth: number;
  total: number;
  metric: FlameMetric;
}

function selfValue(node: RunNode, metric: FlameMetric): number {
  if (metric === "tokens") return (node.tokensIn ?? 0) + (node.tokensOut ?? 0);
  if (metric === "cost") return node.costUsd ?? 0;
  const childDur = node.children.reduce((s, c) => s + c.durationMs, 0);
  return Math.max(0, node.durationMs - childDur); // exclusive (self) time
}

/** subtree aggregate per spanId, in one pass. */
function aggregates(roots: RunNode[], metric: FlameMetric): Map<string, number> {
  const map = new Map<string, number>();
  const visit = (node: RunNode): number => {
    let total = selfValue(node, metric);
    for (const c of node.children) total += visit(c);
    map.set(node.spanId, total);
    return total;
  };
  for (const r of roots) visit(r);
  return map;
}

export function metricTotal(roots: RunNode[], metric: FlameMetric): number {
  const agg = aggregates(roots, metric);
  return roots.reduce((s, r) => s + (agg.get(r.spanId) ?? 0), 0);
}

export function layoutFlame(roots: RunNode[], metric: FlameMetric): FlameLayout {
  const agg = aggregates(roots, metric);
  const total = roots.reduce((s, r) => s + (agg.get(r.spanId) ?? 0), 0);
  const cells: FlameCell[] = [];
  if (total <= 0) return { cells, maxDepth: 0, total: 0, metric };

  let maxDepth = 0;
  const place = (node: RunNode, x0: number, x1: number, depth: number) => {
    if (x1 <= x0) return;
    maxDepth = Math.max(maxDepth, depth);
    const a = agg.get(node.spanId) ?? 0;
    cells.push({
      spanId: node.spanId,
      name: node.name,
      kind: node.kind,
      status: node.status,
      depth,
      x0,
      x1,
      value: a,
    });
    if (a <= 0) return;
    const scale = (x1 - x0) / a;
    let cursor = x0;
    for (const child of node.children) {
      const w = (agg.get(child.spanId) ?? 0) * scale;
      if (w > 0) place(child, cursor, cursor + w, depth + 1);
      cursor += w;
    }
  };

  let cursor = 0;
  for (const root of roots) {
    const w = (agg.get(root.spanId) ?? 0) / total;
    if (w > 0) place(root, cursor, cursor + w, 0);
    cursor += w;
  }
  return { cells, maxDepth, total, metric };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/core/flame.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/flame.ts src/core/flame.test.ts
git commit -m "feat(core): flamegraph aggregates + icicle layout"
```

---

## Task 2: Flamegraph view + wire it up

**Files:** Rewrite `src/components/views/FlamegraphView.tsx`; edit `src/App.tsx`, `src/lib/views.ts`, `src/lib/views.test.ts`.

- [ ] **Step 1: Replace the ENTIRE contents of `src/components/views/FlamegraphView.tsx`** with:

```tsx
import { useMemo, useState } from "react";
import type { ParsedTrace } from "../../core/types";
import { layoutFlame, metricTotal, type FlameMetric } from "../../core/flame";
import { kindColor } from "../../lib/kinds";
import { formatDuration, formatTokens, formatCost } from "../../core/format";

const ROW = 22;

const METRICS: Array<{ id: FlameMetric; label: string }> = [
  { id: "duration", label: "Duration" },
  { id: "tokens", label: "Tokens" },
  { id: "cost", label: "Cost" },
];

function fmt(metric: FlameMetric, v: number): string {
  if (metric === "duration") return formatDuration(v);
  if (metric === "tokens") return formatTokens(v);
  return formatCost(v);
}

interface Props {
  trace: ParsedTrace;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FlamegraphView({ trace, selectedId, onSelect }: Props) {
  const [metric, setMetric] = useState<FlameMetric>("duration");
  const totals = useMemo(
    () => ({
      duration: metricTotal(trace.roots, "duration"),
      tokens: metricTotal(trace.roots, "tokens"),
      cost: metricTotal(trace.roots, "cost"),
    }),
    [trace],
  );
  const layout = useMemo(() => layoutFlame(trace.roots, metric), [trace, metric]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border-soft px-3.5 py-1.5">
        <span className="text-[9px] uppercase tracking-wider text-faint">Flamegraph by</span>
        {METRICS.map((m) => {
          const empty = totals[m.id] <= 0;
          const active = m.id === metric;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => !empty && setMetric(m.id)}
              disabled={empty}
              title={empty ? `No ${m.label.toLowerCase()} data` : undefined}
              className={`rounded px-2 py-0.5 text-[11px] disabled:opacity-40 ${
                active ? "bg-elev text-accent-strong" : "text-muted hover:text-text"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {layout.cells.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-muted">No {metric} data in this trace.</div>
        ) : (
          <div className="relative w-full" style={{ height: (layout.maxDepth + 1) * ROW }}>
            {layout.cells.map((c) => {
              const color = c.status === "error" ? "var(--error)" : kindColor(c.kind);
              const widthPct = (c.x1 - c.x0) * 100;
              return (
                <button
                  key={c.spanId}
                  type="button"
                  onClick={() => onSelect(c.spanId)}
                  title={`${c.name} · ${fmt(metric, c.value)} · ${widthPct.toFixed(1)}%`}
                  className="absolute overflow-hidden rounded-sm border border-panel text-left text-[10px] leading-none text-white"
                  style={{
                    left: `${c.x0 * 100}%`,
                    width: `${widthPct}%`,
                    top: c.depth * ROW,
                    height: ROW - 2,
                    background: color,
                    outline: c.spanId === selectedId ? "2px solid var(--text)" : undefined,
                    outlineOffset: "-1px",
                  }}
                >
                  {widthPct > 4 && <span className="mono px-1">{c.name}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it in `src/App.tsx`.** Replace:
```tsx
            {activeView === "flamegraph" && <FlamegraphView />}
```
with:
```tsx
            {activeView === "flamegraph" && (
              <FlamegraphView trace={trace} selectedId={selectedId} onSelect={setSelectedId} />
            )}
```

- [ ] **Step 3: Flip the registry in `src/lib/views.ts`.** Replace:
```ts
  { id: "flamegraph", label: "Flamegraph", icon: "▦", status: "soon" },
```
with:
```ts
  { id: "flamegraph", label: "Flamegraph", icon: "▦", status: "ready" },
```

- [ ] **Step 4: Update `src/lib/views.test.ts`.** Replace:
```ts
  it("has exactly one ready view initially", () => {
    expect(VIEWS.filter((v) => v.status === "ready")).toHaveLength(1);
  });
```
with:
```ts
  it("has the tree and flamegraph ready", () => {
    const ready = VIEWS.filter((v) => v.status === "ready").map((v) => v.id);
    expect(ready).toEqual(["tree", "flamegraph"]);
  });
```

- [ ] **Step 5: Full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; all tests pass (e.g. **66 passed**); build PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): flamegraph view (duration/tokens/cost), wired into the rail"
```

---

## Task 3: Runtime verification

**Files:** none.

- [ ] **Step 1: Start the dev server**, load the **research-agent** sample, and click the **flamegraph** rail icon (its "soon" dot should be gone).

- [ ] **Step 2:** Confirm an icicle renders — `research_agent.run` spanning the top, children nested below, colored by kind. The `Duration / Tokens / Cost` toggle switches the weighting (all three have data in this sample).

- [ ] **Step 3:** Click a block → the right detail panel shows that span; the clicked block gets a selection outline. Hover a block → tooltip with name · value · percent.

- [ ] **Step 4:** Load the **tool-error** sample → the failed span shows in `--error` color. Load a trace with no cost (e.g. the OTLP or a Codex rollout) → the **Cost** toggle is disabled.

- [ ] **Step 5:** Check both light and dark themes; screenshot.

- [ ] **Step 6: Final commit (only if fixes were needed)**

```bash
git add -A
git commit -m "chore(ui): flamegraph verification fixes"
```

---

## Self-review notes (author)

- **Spec coverage:** aggregates + icicle layout w/ self/aggregate model (T1); metric toggle + empty-metric disable/message (T2 view); click→select + selection outline + tooltip (T2); kind colors + error color (T2); registry flip to ready (T2 views.ts/test). ✓
- **Type consistency:** `FlameMetric`/`FlameCell`/`FlameLayout` from `flame.ts` used by the view; `metricTotal`/`layoutFlame` signatures match; `FlamegraphView` props match the App call site. ✓
- **Green at every step:** T1 adds an isolated module; T2 flips the view + updates its test in the same task so `views.test` stays consistent; canonical model untouched. ✓
- **Cost data note:** the bundled `research-agent` sample has cost (~$0.01), so all three toggles are exercised; real Codex/Claude traces have no cost → that toggle disables gracefully.
