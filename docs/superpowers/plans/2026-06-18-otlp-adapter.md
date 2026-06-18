# OTLP Import Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect and load OpenTelemetry (OTLP) JSON exports by adding a pluggable adapter registry plus an OTLP adapter that flattens OTLP into the existing `LooseSpan` pipeline.

**Architecture:** `src/core/adapters/` holds a `TraceAdapter` registry. Each adapter has `detect()` + `toLooseSpans()`. `openinference.extractSpans` delegates to the registry; everything from `normalizeSpan` onward is unchanged. The native (array / `{spans}` / `{data}`) extraction moves into the registry as the fallback; OTLP is a new adapter tried first.

**Tech Stack:** TypeScript (strict), Vitest. Core-only — no UI/component changes except one Loader sample button and one error-string tweak.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/core/adapters/types.ts` | 1 | **create** — `TraceAdapter` interface |
| `src/core/adapters/native.ts` | 1 | **create** — array / `{spans}` / `{data}` adapter (moved from `extractSpans`) |
| `src/core/adapters/index.ts` | 1, 2 | **create** (1), **edit** (2) — `ADAPTERS` + `extractSpansAuto` |
| `src/core/adapters/native.test.ts` | 1 | **create** — native adapter + routing tests |
| `src/core/openinference.ts` | 1 | **edit** — `extractSpans` delegates to `extractSpansAuto` |
| `src/core/adapters/otlp.ts` | 2 | **create** — OTLP → `LooseSpan[]` |
| `public/samples/otlp-trace.json` | 2 | **create** — bundled OTLP sample |
| `src/core/adapters/otlp.test.ts` | 2 | **create** — OTLP adapter + end-to-end tests |
| `src/components/Loader.tsx` | 3 | **edit** — add the OTLP sample button |
| `src/core/parse.ts` | 3 | **edit** — error text mentions OTLP |

---

## Task 1: Adapter registry + native adapter (behavior-preserving)

**Files:**
- Create: `src/core/adapters/types.ts`, `src/core/adapters/native.ts`, `src/core/adapters/index.ts`, `src/core/adapters/native.test.ts`
- Modify: `src/core/openinference.ts`

- [ ] **Step 1: Create `src/core/adapters/types.ts`**

```ts
import type { LooseSpan } from "../openinference";

/** Converts one input trace format into the canonical LooseSpan[] the
    normalizer understands. Add a format by adding one of these. */
export interface TraceAdapter {
  id: string;
  label: string;
  detect(json: unknown): boolean;
  toLooseSpans(json: unknown): LooseSpan[];
}
```

- [ ] **Step 2: Create `src/core/adapters/native.ts`** (the current behavior, as an adapter)

```ts
import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

/** The default format: a bare array of spans, or { spans: [...] }, or { data: [...] }. */
export const nativeAdapter: TraceAdapter = {
  id: "native",
  label: "Span array / OpenInference",
  detect(json) {
    if (Array.isArray(json)) return true;
    if (json && typeof json === "object") {
      const obj = json as Record<string, unknown>;
      return Array.isArray(obj.spans) || Array.isArray(obj.data);
    }
    return false;
  },
  toLooseSpans(json) {
    if (Array.isArray(json)) return json as LooseSpan[];
    if (json && typeof json === "object") {
      const obj = json as Record<string, unknown>;
      if (Array.isArray(obj.spans)) return obj.spans as LooseSpan[];
      if (Array.isArray(obj.data)) return obj.data as LooseSpan[];
    }
    return [];
  },
};
```

- [ ] **Step 3: Create `src/core/adapters/index.ts`** (registry; native only for now)

```ts
import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";
import { nativeAdapter } from "./native";

// More specific adapters go first; the native catch-all is last.
export const ADAPTERS: TraceAdapter[] = [nativeAdapter];

/** Detect the input format and flatten it to LooseSpan[]. */
export function extractSpansAuto(json: unknown): LooseSpan[] {
  for (const adapter of ADAPTERS) {
    if (adapter.detect(json)) return adapter.toLooseSpans(json);
  }
  return [];
}
```

- [ ] **Step 4: Write the failing test** — `src/core/adapters/native.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { nativeAdapter } from "./native";
import { extractSpansAuto } from "./index";

describe("nativeAdapter", () => {
  it("detects a bare array and { spans } / { data }, not OTLP", () => {
    expect(nativeAdapter.detect([{ span_id: "a" }])).toBe(true);
    expect(nativeAdapter.detect({ spans: [] })).toBe(true);
    expect(nativeAdapter.detect({ data: [] })).toBe(true);
    expect(nativeAdapter.detect({ resourceSpans: [] })).toBe(false);
  });

  it("extracts spans from each shape", () => {
    expect(nativeAdapter.toLooseSpans([{ span_id: "a" }])).toHaveLength(1);
    expect(
      nativeAdapter.toLooseSpans({ spans: [{ span_id: "a" }, { span_id: "b" }] }),
    ).toHaveLength(2);
  });

  it("extractSpansAuto routes a bare array to native", () => {
    expect(extractSpansAuto([{ span_id: "a" }])).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run it — it fails (modules not created yet) then passes once Steps 1–3 exist**

Run: `npx vitest run src/core/adapters/native.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Modify `src/core/openinference.ts`** — delegate `extractSpans`.

Add, right after the line `import type { RawSpan, SpanKind, SpanStatus } from "./types";`:
```ts
import { extractSpansAuto } from "./adapters";
```
Then replace the whole `extractSpans` function:
```ts
/** Accepts an array of spans, { spans: [...] }, or { data: [...] }. */
export function extractSpans(json: unknown): LooseSpan[] {
  if (Array.isArray(json)) return json as LooseSpan[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.spans)) return obj.spans as LooseSpan[];
    if (Array.isArray(obj.data)) return obj.data as LooseSpan[];
  }
  return [];
}
```
with:
```ts
/** Detects the input format (OTLP, span array, { spans }, { data }) and flattens to LooseSpan[]. */
export function extractSpans(json: unknown): LooseSpan[] {
  return extractSpansAuto(json);
}
```

- [ ] **Step 7: Full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; all prior tests still pass plus the 3 new ones (e.g. **39 passed**); build PASS. (The delegation is behavior-identical for existing inputs, so `parse.test.ts` etc. stay green.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(core): pluggable trace adapter registry (native)"
```

---

## Task 2: OTLP adapter + sample

**Files:**
- Create: `src/core/adapters/otlp.ts`, `public/samples/otlp-trace.json`, `src/core/adapters/otlp.test.ts`
- Modify: `src/core/adapters/index.ts`

- [ ] **Step 1: Create `src/core/adapters/otlp.ts`**

```ts
import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

interface OtlpKV {
  key?: string;
  value?: Record<string, unknown>;
}
interface OtlpSpan {
  spanId?: string;
  parentSpanId?: string;
  traceId?: string;
  name?: string;
  startTimeUnixNano?: unknown;
  endTimeUnixNano?: unknown;
  status?: { code?: unknown; message?: string };
  attributes?: OtlpKV[];
}

function resourceSpansOf(json: unknown): unknown[] | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const rs = obj.resourceSpans ?? obj.resource_spans;
  return Array.isArray(rs) ? rs : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Unwrap an OTLP typed attribute value to a scalar (stringified for nested types). */
function unwrapValue(value: Record<string, unknown> | undefined): unknown {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("intValue" in value) return value.intValue; // often a numeric string
  if ("doubleValue" in value) return value.doubleValue;
  if ("boolValue" in value) return value.boolValue;
  return JSON.stringify(value); // arrayValue / kvlistValue / bytesValue
}

function attrsToMap(attrs: OtlpKV[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of attrs ?? []) {
    if (a && typeof a.key === "string") out[a.key] = unwrapValue(a.value);
  }
  return out;
}

/** OTLP status.code is 0/1/2 or "STATUS_CODE_*"; map to the string pickStatus reads. */
function mapStatus(code: unknown): string {
  const s = String(code ?? "").toUpperCase();
  if (code === 2 || s.includes("ERROR")) return "ERROR";
  if (code === 1 || s.includes("OK")) return "OK";
  return "UNSET";
}

export const otlpAdapter: TraceAdapter = {
  id: "otlp",
  label: "OpenTelemetry (OTLP)",
  detect(json) {
    return resourceSpansOf(json) !== null;
  },
  toLooseSpans(json) {
    const out: LooseSpan[] = [];
    for (const rs of resourceSpansOf(json) ?? []) {
      const rsObj = (rs ?? {}) as Record<string, unknown>;
      for (const ss of arr(rsObj.scopeSpans ?? rsObj.scope_spans)) {
        const ssObj = (ss ?? {}) as Record<string, unknown>;
        for (const s of arr(ssObj.spans)) {
          const span = (s ?? {}) as OtlpSpan;
          out.push({
            span_id: span.spanId,
            parent_span_id: span.parentSpanId ? span.parentSpanId : null,
            trace_id: span.traceId,
            name: span.name,
            start_time_unix_nano: span.startTimeUnixNano,
            end_time_unix_nano: span.endTimeUnixNano,
            status_code: mapStatus(span.status?.code),
            status_message: span.status?.message,
            attributes: attrsToMap(span.attributes),
          });
        }
      }
    }
    return out;
  },
};
```

- [ ] **Step 2: Create `public/samples/otlp-trace.json`**

```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [{ "key": "service.name", "value": { "stringValue": "support-agent" } }]
      },
      "scopeSpans": [
        {
          "scope": { "name": "tracelens.example" },
          "spans": [
            {
              "traceId": "0af7651916cd43dd8448eb211c80319c",
              "spanId": "b7ad6b7169203331",
              "name": "support_agent.run",
              "startTimeUnixNano": "1700000000000000000",
              "endTimeUnixNano": "1700000004500000000",
              "status": { "code": 1 },
              "attributes": [
                { "key": "openinference.span.kind", "value": { "stringValue": "AGENT" } },
                { "key": "input.value", "value": { "stringValue": "Help the user reset their password." } }
              ]
            },
            {
              "traceId": "0af7651916cd43dd8448eb211c80319c",
              "spanId": "1234567890abcdef",
              "parentSpanId": "b7ad6b7169203331",
              "name": "llm.plan",
              "startTimeUnixNano": "1700000000200000000",
              "endTimeUnixNano": "1700000001400000000",
              "status": { "code": 1 },
              "attributes": [
                { "key": "gen_ai.operation.name", "value": { "stringValue": "chat" } },
                { "key": "gen_ai.request.model", "value": { "stringValue": "gpt-4o" } },
                { "key": "gen_ai.usage.input_tokens", "value": { "intValue": "320" } },
                { "key": "gen_ai.usage.output_tokens", "value": { "intValue": "75" } },
                { "key": "gen_ai.prompt", "value": { "stringValue": "Plan how to reset the password." } },
                { "key": "gen_ai.completion", "value": { "stringValue": "1) search docs 2) call reset API" } }
              ]
            },
            {
              "traceId": "0af7651916cd43dd8448eb211c80319c",
              "spanId": "fedcba0987654321",
              "parentSpanId": "b7ad6b7169203331",
              "name": "tool.web_search",
              "startTimeUnixNano": "1700000001500000000",
              "endTimeUnixNano": "1700000002300000000",
              "status": { "code": 2, "message": "HTTP 503 from search provider" },
              "attributes": [
                { "key": "openinference.span.kind", "value": { "stringValue": "TOOL" } },
                { "key": "tool.name", "value": { "stringValue": "web_search" } },
                { "key": "input.value", "value": { "stringValue": "{\"query\":\"reset password\"}" } }
              ]
            },
            {
              "traceId": "0af7651916cd43dd8448eb211c80319c",
              "spanId": "0a1b2c3d4e5f6071",
              "parentSpanId": "b7ad6b7169203331",
              "name": "llm.answer",
              "startTimeUnixNano": "1700000002400000000",
              "endTimeUnixNano": "1700000004400000000",
              "status": { "code": 1 },
              "attributes": [
                { "key": "gen_ai.operation.name", "value": { "stringValue": "chat" } },
                { "key": "gen_ai.request.model", "value": { "stringValue": "gpt-4o" } },
                { "key": "gen_ai.usage.input_tokens", "value": { "intValue": "540" } },
                { "key": "gen_ai.usage.output_tokens", "value": { "intValue": "110" } },
                { "key": "gen_ai.completion", "value": { "stringValue": "Here is how to reset your password..." } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Write the failing test** — `src/core/adapters/otlp.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { otlpAdapter } from "./otlp";
import { parseTrace, flatten } from "../parse";
import otlp from "../../../public/samples/otlp-trace.json";

describe("otlpAdapter.detect", () => {
  it("matches the OTLP shape only", () => {
    expect(otlpAdapter.detect({ resourceSpans: [] })).toBe(true);
    expect(otlpAdapter.detect({ resource_spans: [] })).toBe(true);
    expect(otlpAdapter.detect([{ span_id: "a" }])).toBe(false);
    expect(otlpAdapter.detect({ spans: [] })).toBe(false);
  });
});

describe("otlpAdapter.toLooseSpans", () => {
  const loose = otlpAdapter.toLooseSpans(otlp);
  it("flattens every span and unwraps attribute values", () => {
    expect(loose).toHaveLength(4);
    const plan = loose.find((s) => s.name === "llm.plan")!;
    expect(plan.attributes!["gen_ai.request.model"]).toBe("gpt-4o");
    expect(plan.attributes!["gen_ai.usage.input_tokens"]).toBe("320");
  });
  it("maps the OTLP error status and parent id", () => {
    const tool = loose.find((s) => s.name === "tool.web_search")!;
    expect(tool.status_code).toBe("ERROR");
    expect(tool.parent_span_id).toBe("b7ad6b7169203331");
  });
});

describe("OTLP end-to-end via parseTrace", () => {
  const t = parseTrace(otlp);
  it("builds the tree and maps gen_ai semantics + errors", () => {
    expect(t.summary.spanCount).toBe(4);
    expect(t.roots).toHaveLength(1);
    expect(t.roots[0].name).toBe("support_agent.run");
    const plan = flatten(t.roots).find((n) => n.name === "llm.plan")!;
    expect(plan.kind).toBe("llm");
    expect(plan.model).toBe("gpt-4o");
    expect(plan.tokensIn).toBe(320);
    expect(t.summary.errors).toBe(1);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/core/adapters/otlp.test.ts`
Expected: FAIL — `./otlp` not found (and `parseTrace(otlp)` returns no spans until the adapter is registered).

- [ ] **Step 5: Register OTLP first in `src/core/adapters/index.ts`.**

Replace:
```ts
import { nativeAdapter } from "./native";

// More specific adapters go first; the native catch-all is last.
export const ADAPTERS: TraceAdapter[] = [nativeAdapter];
```
with:
```ts
import { otlpAdapter } from "./otlp";
import { nativeAdapter } from "./native";

// More specific adapters go first; the native catch-all is last.
export const ADAPTERS: TraceAdapter[] = [otlpAdapter, nativeAdapter];
```

- [ ] **Step 6: Run the OTLP test to verify it passes**

Run: `npx vitest run src/core/adapters/otlp.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; all tests pass (e.g. **43 passed**); build PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): OTLP/OpenTelemetry import adapter + sample"
```

---

## Task 3: Surface it — Loader sample + error text

**Files:**
- Modify: `src/components/Loader.tsx`
- Modify: `src/core/parse.ts`

- [ ] **Step 1: Add the OTLP sample to `src/components/Loader.tsx`.** Replace the `SAMPLES` array:
```tsx
const SAMPLES = [
  { file: "research-agent.json", label: "Research agent", hint: "7 spans · 3 LLM · 2 tools" },
  { file: "tool-error.json", label: "Tool error + recovery", hint: "6 spans · 1 error" },
];
```
with:
```tsx
const SAMPLES = [
  { file: "research-agent.json", label: "Research agent", hint: "7 spans · 3 LLM · 2 tools" },
  { file: "tool-error.json", label: "Tool error + recovery", hint: "6 spans · 1 error" },
  { file: "otlp-trace.json", label: "OpenTelemetry (OTLP)", hint: "4 spans · OTLP format" },
];
```

- [ ] **Step 2: Update the parse error text in `src/core/parse.ts`.** Replace:
```ts
    throw new TraceParseError(
      'No spans found. Expected a JSON array of spans, or an object with a "spans" array.',
    );
```
with:
```ts
    throw new TraceParseError(
      'No spans found. Expected a JSON array of spans, an object with a "spans" array, or an OpenTelemetry (OTLP) export.',
    );
```

- [ ] **Step 3: Full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; tests pass; build PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): bundle an OTLP sample + mention OTLP in the load error"
```

---

## Task 4: Runtime verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server.** On the loader screen, confirm there are now **three** sample buttons including "OpenTelemetry (OTLP)".

- [ ] **Step 2: Click the OTLP sample.** Confirm the tree renders 4 spans (`support_agent.run` → `llm.plan`, `tool.web_search`, `llm.answer`), the summary shows 4 spans / 2 LLM / 1 tool / 1 error, `tool.web_search` is flagged red, and an LLM span's detail shows model `gpt-4o` and its tokens. Console error-free.

- [ ] **Step 3: Regression.** Click the "Research agent" sample and confirm it still renders exactly as before.

- [ ] **Step 4: Final commit (only if verification fixes were needed)**

```bash
git add -A
git commit -m "chore(core): OTLP verification fixes"
```

---

## Self-review notes (author)

- **Spec coverage:** registry + `TraceAdapter` (T1); native moved into registry + `extractSpans` delegates (T1); OTLP flatten + attribute unwrap + status map + nano times (T2 `otlp.ts`); auto-detect order OTLP-then-native (T2 index); bundled sample + Loader button (T2/T3); error text mentions OTLP (T3); core model/`normalizeSpan` untouched. ✓
- **Type consistency:** `TraceAdapter`/`LooseSpan` used across types/native/otlp/index; `extractSpansAuto` consumed by `openinference.extractSpans`; `parseTrace`/`flatten` used in the OTLP test. ✓
- **Green at every step:** T1 is behavior-identical (native does what `extractSpans` did); OTLP files only start parsing in T2 once registered; `normalizeSpan` and the canonical model never change, so `parse`/`search`/`share` tests stay green. ✓
- **Cycle risk:** adapters import `LooseSpan` type-only from `openinference`; only `openinference → adapters` is a runtime import.
