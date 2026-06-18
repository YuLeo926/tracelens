# Import Adapters — OTLP/OpenTelemetry (+ pluggable system) — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Sub-project:** 4 of N in the v1 effort. Prioritized ahead of flamegraph/diff because the project's real-world usefulness depends on accepting more source formats. This sub-project builds the pluggable adapter system + the first adapter (OTLP). Further adapters (raw OpenAI/Anthropic logs, Langfuse/Phoenix, Codex) are later sub-projects that each add one file.

## 1. Goal

Let a user drop a standard **OpenTelemetry (OTLP) JSON** export and have Tracelens auto-detect it and render it like any other trace — unlocking the broadest set of sources (most frameworks, and Codex's `[otel]` mode, emit OTLP). Establish a small pluggable adapter registry so adding the next format is one file.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| First format | OTLP / OpenTelemetry JSON (`{ resourceSpans: [...] }`) |
| Detection | **Auto-detect** by file shape (no manual format picker) |
| Architecture | Pluggable adapter registry in `src/core/adapters/`; adapters convert raw input to the existing `LooseSpan[]`, then the current `normalizeSpan` pipeline is reused unchanged |
| UI impact | None to the layout; one new clickable sample. The feature is transparent. |

## 3. Scope

### In scope
- A `TraceAdapter` registry: each adapter has `detect(json)` and `toLooseSpans(json)`.
- An **OTLP adapter**: flattens `resourceSpans → scopeSpans → spans`, unwraps OTLP's array-of-`{key,value}` attributes into a flat map, maps the numeric/`STATUS_CODE_*` status to the existing string form, and passes nanosecond times through (handled by the existing `toMs`). The flattened attributes (`gen_ai.*`, `openinference.*`) are mapped by the **existing** `normalizeSpan` — no duplicate attribute logic.
- A **native adapter**: the current array / `{spans}` / `{data}` extraction, moved into the registry as the fallback.
- `extractSpans` delegates to the registry (first adapter whose `detect` is true; else `[]`).
- A bundled `public/samples/otlp-trace.json` + a Loader sample button.
- Updated "no spans found" error text to mention OTLP.

### Non-goals (explicitly out)
- Other formats (OpenAI/Anthropic logs, Langfuse, Phoenix, Codex) — later sub-projects.
- A manual format-picker UI.
- OTLP **protobuf** (binary) — JSON OTLP only.
- Unwrapping OTLP `arrayValue`/`kvlistValue` attribute values into structured data (stringified is enough for display).
- Any change to the canonical model, the tree builder, or the UI components.

## 4. Architecture

```
src/core/
  openinference.ts        # unchanged except extractSpans delegates to the registry
  adapters/
    types.ts              # TraceAdapter interface
    native.ts             # array / {spans} / {data}  (the current default, moved here)
    otlp.ts               # OTLP -> LooseSpan[]
    index.ts              # ADAPTERS = [otlp, native]; extractSpansAuto(json)
```

- `TraceAdapter`: `{ id: string; label: string; detect(json: unknown): boolean; toLooseSpans(json: unknown): LooseSpan[] }`.
- `adapters/index.ts` exports `ADAPTERS` (OTLP first, native last) and `extractSpansAuto(json)` = the first adapter whose `detect(json)` is true, run its `toLooseSpans`; if none match, `[]`.
- `openinference.ts`'s `extractSpans` becomes a thin call to `extractSpansAuto`. `parse.ts` is unchanged (it still imports `extractSpans` + `normalizeSpan`).
- Adapters import `LooseSpan` **type-only** from `openinference.ts`, so there is no runtime import cycle.

## 5. OTLP adapter mapping

**`detect(json)`**: `json` is a non-null object whose `resourceSpans` (or `resource_spans`) is an array.

**`toLooseSpans(json)`**: for each `resourceSpans[] → scopeSpans[] (or scope_spans) → spans[]`, build a `LooseSpan`:

| LooseSpan field | From OTLP span |
|---|---|
| `span_id` | `spanId` |
| `parent_span_id` | `parentSpanId` if truthy/non-empty, else `null` |
| `trace_id` | `traceId` |
| `name` | `name` |
| `start_time_unix_nano` | `startTimeUnixNano` (existing `toMs` parses the nano string) |
| `end_time_unix_nano` | `endTimeUnixNano` |
| `status_code` | mapped from `status.code` → `"ERROR"` / `"OK"` / `"UNSET"` (see below) |
| `status_message` | `status.message` |
| `attributes` | OTLP `attributes` array → flat map (see below) |

- **Status code map**: numeric `2` or a string containing `"ERROR"` → `"ERROR"`; numeric `1` or containing `"OK"` → `"OK"`; otherwise `"UNSET"`. (Passed as the string form so the existing `pickStatus` handles it.)
- **Attribute unwrap** (`[{ key, value }]` → `{ [key]: scalar }`): `value.stringValue` → string; `value.intValue` → the value as-is (often a numeric string, which the existing `asNumber` handles); `value.doubleValue` → number; `value.boolValue` → boolean; anything else (`arrayValue`, `kvlistValue`, `bytesValue`) → `JSON.stringify(value)`.

Because the flattened attributes carry the standard `gen_ai.*` / `openinference.*` keys, the existing `normalizeSpan` derives kind, model, tokens, cost, input/output with no new code.

## 6. Data flow

`parseTrace(json)` → `extractSpans(json)` → `extractSpansAuto(json)` (registry picks OTLP or native) → `LooseSpan[]` → `normalizeSpan` each → existing tree + summary build. Identical from `normalizeSpan` onward.

## 7. Error handling / edge cases

- Unknown shape (no adapter matches) → `extractSpansAuto` returns `[]` → existing `TraceParseError("No spans found…")`, text updated to also mention OTLP.
- OTLP root spans with `parentSpanId: ""` → mapped to `null` so they are treated as roots.
- OTLP `int64` attributes serialized as strings → handled by existing `asNumber`.
- Empty `scopeSpans`/`spans` arrays → contribute nothing; if the whole file yields zero spans, the friendly error fires.
- A file that is a bare array still routes to the native adapter (unchanged behavior).

## 8. Testing

`src/core/adapters/otlp.test.ts` (Vitest, pure):
- `otlpAdapter.detect`: true for `{ resourceSpans: [...] }`, false for a bare span array and for `{ spans: [...] }`.
- `toLooseSpans` unwraps a `{key,value}` attribute array into a flat map (string/int/double/bool).
- Status code `2` (and `"STATUS_CODE_ERROR"`) → error; `1` → ok.
- End-to-end via `parseTrace(otlpSample)`: builds the correct tree (parent/child), maps a `gen_ai` LLM span's kind/model/tokens, and flags the error span.

`public/samples/otlp-trace.json`: a small OTLP export — a root agent span, a child `gen_ai` chat/LLM span (with `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`/`output_tokens`), and a tool span with `status.code = 2`.

All existing tests (parse, search, share, kinds, views, theme) stay green — `normalizeSpan` and the canonical model are untouched. Final gate: `typecheck` + `test` + `build`; then a quick dev-server check: click the new OTLP sample and confirm the tree/summary/detail render, and that the existing samples still work.

## 9. Execution order (incremental, green at every step)

1. `adapters/types.ts` + `adapters/native.ts` + `adapters/index.ts`; switch `openinference.extractSpans` to delegate (behavior identical — existing samples/tests stay green). [TDD: a test that the native adapter still extracts the existing samples.]
2. `adapters/otlp.ts` + `adapters/otlp.test.ts` (TDD); register it first in `ADAPTERS`.
3. `public/samples/otlp-trace.json` + Loader sample button; update the parse error text.
4. Verification gate (Section 8).

## 10. Risks & mitigations

- **Import cycle** (openinference ↔ adapters) — avoided by importing `LooseSpan` as a type-only import in adapters.
- **OTLP shape variance** (camelCase JSON vs snake_case from some exporters) — `detect` and the walk accept both `resourceSpans`/`resource_spans` and `scopeSpans`/`scope_spans`.
- **Scope creep into other formats** — the registry makes each future format a single new file; this sub-project ships OTLP only.
