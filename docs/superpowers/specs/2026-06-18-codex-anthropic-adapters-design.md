# Import Adapters — Codex + Anthropic (+ JSONL) — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Sub-project:** 5 of N in the v1 effort. Adds two concrete adapters to the registry built in sub-project 4, plus JSONL input support (needed by Codex). Format research: the Codex `exec --json` event schema was confirmed from the OpenAI Codex docs.

## 1. Goal

Let users open two common real-world sources: **Anthropic (Claude) Messages logs** and **Codex `codex exec --json`** event streams. Both render structure, tokens, and errors. (Neither format carries timestamps, so durations are synthetic — ordering is preserved, the waterfall is flat. This is accepted.)

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Formats | Anthropic Messages log (JSON array) + Codex `exec --json` (JSONL) |
| Codex input | JSONL (newline-delimited JSON) — add a decode step that tries whole-file JSON, then line-by-line |
| Detection | Auto-detect; registry order `[otlp, codex, anthropic, native]` |
| Timing | Real if a per-entry timestamp exists, else synthetic sequential by index (duration ≈ 0); waterfall is flat |
| Codex robustness | Stash each raw `item` into the span's attributes so unmapped fields still show in the Raw attributes panel |
| Anthropic shape | Flat — each Claude call is one LLM span (no fake hierarchy) |
| Codex shape | A synthetic root (the thread/turn, carrying turn tokens) with each `item` as a child |

## 3. Scope

### In scope
- **JSONL support**: `decodeTraceText(text)` — `JSON.parse` whole file; on failure, parse each non-empty line and collect into an array; throw a friendly error if nothing parses. Used by the Loader and the share-link auto-load (so both paths accept JSONL).
- **Anthropic adapter** (`adapters/anthropic.ts`): detect a log array of Claude calls; map each to an LLM `LooseSpan` (model, tokens, input, output, error) whose attributes use the canonical `gen_ai.*`/`input.value`/`output.value` keys so the existing `normalizeSpan` finishes the job.
- **Codex adapter** (`adapters/codex.ts`): detect a Codex event array; build a synthetic root + one child span per `item`; map known fields and stash the raw item.
- Two bundled samples + two Loader buttons.

### Non-goals (explicitly out)
- Real durations for these formats (no timestamps in the data).
- Streaming/partial parsing; OTLP protobuf; other vendors (OpenAI, Langfuse, …) — later, one file each.
- Deep Codex hierarchy (items are flat under the synthetic root).
- Perfect coverage of every Codex item field — unmapped fields are preserved via the raw-attributes stash.

## 4. JSONL decode — `src/core/parse.ts`

```ts
export function decodeTraceText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const objs: unknown[] = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try { objs.push(JSON.parse(t)); } catch { /* skip non-JSON lines */ }
    }
    if (objs.length === 0) {
      throw new TraceParseError("That file is not valid JSON or JSONL.");
    }
    return objs;
  }
}

/** Decode raw file text (JSON or JSONL) and parse it. */
export function parseTraceText(text: string): ParsedTrace {
  return parseTrace(decodeTraceText(text));
}
```

- `Loader.ingest`: `onLoad(parseTraceText(text), label, text)` (was `parseTrace(JSON.parse(text))`).
- `App` share auto-load: `parseTraceText(payload.source)` (was `parseTrace(JSON.parse(payload.source))`).

## 5. Anthropic adapter — `src/core/adapters/anthropic.ts`

**Accepted shapes** (array; each element is one Claude call), any of:
- an Anthropic Messages **response**: `{ type: "message", role: "assistant", model, content: [...], usage: { input_tokens, output_tokens } }`;
- a pair: `{ request: { model, messages, system? }, response: <message>, timestamp? }`.

**`detect(json)`**: `json` is an array and some element is an object with `type === "message"`, or a `response` object, or a `usage` + `role`.

**`toLooseSpans`**: for each element (index `i`):
- resolve `response` (`el.response ?? el`) and `request` (`el.request`);
- `model = response.model ?? request?.model`;
- `usage = response.usage`;
- `input` text = stringified `request` messages/system if present;
- `output` text = the `text` blocks of `response.content` joined (else `JSON.stringify(content)`);
- `error` if `response.type === "error"` or `el.error`;
- build a `LooseSpan`: `span_id = el.id ?? response.id ?? "claude-"+i`, `parent_span_id = null`, `name = "claude.messages"`, `status_code = error ? "ERROR" : "OK"`, times = `el.timestamp`/`el.start_time` if present else `start_time:i,end_time:i`, and `attributes` = `{ "gen_ai.operation.name": "chat", "gen_ai.request.model": model, "gen_ai.usage.input_tokens": usage?.input_tokens, "gen_ai.usage.output_tokens": usage?.output_tokens, "input.value": input, "output.value": output }`.

`normalizeSpan` then derives kind=`llm`, model, tokens, input/output from those attributes.

## 6. Codex adapter — `src/core/adapters/codex.ts`

**`detect(json)`**: `json` is an array and some element is an object whose `type` starts with `thread.` / `turn.` / `item.` (e.g. `item.completed`, `turn.completed`).

**`toLooseSpans`** over the event array:
- `threadId` from the `thread.started` event; `usage` from the `turn.completed` event; note a `turn.failed` event.
- Items: walk events, keyed by `item.id`; `item.completed` overrides `item.started`. Preserve first-seen order.
- **Root span** (always present): `span_id = threadId ?? "codex-session"`, `parent_span_id = null`, `name = "codex.session"`, `start_time: 0`, `end_time: <itemCount>`, `status_code = turnFailed ? "ERROR" : "OK"`, attributes `{ "openinference.span.kind": "AGENT", "gen_ai.usage.input_tokens": usage?.input_tokens, "gen_ai.usage.output_tokens": usage?.output_tokens }`.
- **Item spans** (index `j`): `span_id = item.id ?? "codex-item-"+j`, `parent_span_id = rootId`, `name = item.type`, `start_time:j, end_time:j`, `status_code = (item.status==="failed"||item.status==="error") ? "ERROR" : "OK"`, attributes:
  - `"openinference.span.kind"` from `item.type`: `command_execution`/`file_change`/`mcp_tool_call`/`web_search` → `TOOL`; `agent_message`/`reasoning` → `LLM`; `plan`/`todo_list` → `CHAIN`; else omitted (→ unknown);
  - `"input.value"`: `item.command` (command_execution) / `item.query` (web_search) / else omitted;
  - `"output.value"`: `item.text` (agent_message/reasoning) / `item.aggregated_output ?? item.output` (command_execution) / else omitted;
  - `"codex.item"`: the whole raw `item` (so the Raw-attributes panel shows every field, mapped or not).

`normalizeSpan` derives kind/model/tokens/input/output from those attributes; the root carries the turn's token totals.

## 7. Registration & data flow

- `adapters/index.ts`: `ADAPTERS = [otlpAdapter, codexAdapter, anthropicAdapter, nativeAdapter]` (specific first; `native`'s "any array" stays last).
- Flow unchanged downstream: `parseTraceText(text)` → `decodeTraceText` → `parseTrace` → `extractSpansAuto` (registry) → `normalizeSpan` → tree.

## 8. Error handling / edge cases

- A bare span array still routes to `native` (Anthropic/Codex detects are specific).
- JSONL with some malformed lines → those lines are skipped; valid events still parse.
- Empty/garbage file → `decodeTraceText` throws the friendly "not valid JSON or JSONL" error.
- Codex with zero items → just the root span renders.
- Synthetic times mean the detail "Started" may read near `00:00:00` — acceptable and documented (these formats omit timestamps).

## 9. Testing

- `parse.test.ts` (add): `decodeTraceText` parses a JSON array, parses a JSONL string into an array, skips a blank line, and throws on `"not json"`.
- `adapters/anthropic.test.ts`: detect true for a Claude-log array / false for a span array + Codex array; mapping yields kind `llm`, model, tokensIn/out, input/output; an error entry flips status; end-to-end `parseTrace` builds N flat spans.
- `adapters/codex.test.ts`: detect true for a Codex event array / false for others; the root carries turn tokens; a `command_execution` item → tool kind with the command as input and the raw item in `codex.item`; an `agent_message` → llm with text output; end-to-end `parseTrace` builds root + items with the error item flagged.
- Samples: `public/samples/anthropic-log.json` (2–3 Claude calls incl. one tool_use and one error) and `public/samples/codex-session.jsonl` (thread/turn + a command_execution, an agent_message, and a failed item; a `turn.completed` with usage).
- All existing tests stay green; `normalizeSpan`/canonical model unchanged. Final gate: `typecheck` + `test` + `build`; dev-server: click both new samples and confirm they render (structure, tokens, errors), and that prior samples still work.

## 10. Execution order (incremental, green at every step)

1. `decodeTraceText`/`parseTraceText` in `parse.ts` (TDD) + switch `Loader`/`App` to `parseTraceText`. Existing behavior preserved.
2. `anthropic.ts` + sample + test + register + Loader button.
3. `codex.ts` + sample + test + register + Loader button.
4. Verification gate.

## 11. Risks & mitigations

- **Codex schema drift** (built to docs, not a real file) — mitigated by the raw-item attribute stash (nothing is lost) and lenient field access (`??`/optional). Real-file tweaks become one-liners.
- **Adapter collision** — specific `detect`s (message-shape vs Codex `type` prefixes vs OTLP `resourceSpans`) keep them disjoint; `native` (any array) stays last.
- **JSONL false positives** — `decodeTraceText` only falls back to line parsing when whole-file `JSON.parse` fails, so normal JSON is unaffected.
