# Codex + Anthropic Import Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JSONL input support plus two import adapters — Anthropic (Claude) Messages logs and Codex `exec --json` event streams — auto-detected and rendered like any other trace.

**Architecture:** A `decodeTraceText` step accepts JSON or JSONL. Two new adapters plug into the existing registry (`[otlp, codex, anthropic, native]`); each maps its format to `LooseSpan[]` with canonical `gen_ai.*`/`openinference.*` attributes so `normalizeSpan` finishes the job. Neither format has timestamps, so times are synthetic (ordering preserved, flat waterfall).

**Tech Stack:** TypeScript (strict), Vitest. Core-only except two Loader sample buttons.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/core/parse.ts` | 1 | **edit** — add `decodeTraceText` + `parseTraceText` (JSON or JSONL) |
| `src/core/parse.test.ts` | 1 | **edit** — `decodeTraceText` tests |
| `src/components/Loader.tsx` | 1, 2, 3 | **edit** — use `parseTraceText` (1); add Anthropic (2) and Codex (3) sample buttons |
| `src/App.tsx` | 1 | **edit** — share auto-load uses `parseTraceText` |
| `src/core/adapters/anthropic.ts` | 2 | **create** — Claude Messages log → `LooseSpan[]` |
| `public/samples/anthropic-log.json` | 2 | **create** — sample Claude log |
| `src/core/adapters/anthropic.test.ts` | 2 | **create** — tests |
| `src/core/adapters/codex.ts` | 3 | **create** — Codex events → `LooseSpan[]` |
| `public/samples/codex-session.jsonl` | 3 | **create** — sample Codex session (JSONL) |
| `src/core/adapters/codex.test.ts` | 3 | **create** — tests |
| `src/core/adapters/index.ts` | 2, 3 | **edit** — register anthropic (2), codex (3) |

---

## Task 1: JSONL decode support

**Files:**
- Modify: `src/core/parse.ts`, `src/core/parse.test.ts`, `src/components/Loader.tsx`, `src/App.tsx`

- [ ] **Step 1: Add to `src/core/parse.ts`** — insert immediately AFTER the `parseTrace` function (after its closing `}` near the `summarize` function):

```ts
/** Decode raw file text as JSON, or as JSONL (newline-delimited JSON objects). */
export function decodeTraceText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const objs: unknown[] = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        objs.push(JSON.parse(t));
      } catch {
        /* skip non-JSON lines */
      }
    }
    if (objs.length === 0) {
      throw new TraceParseError("That file is not valid JSON or JSONL.");
    }
    return objs;
  }
}

/** Decode raw file text (JSON or JSONL) and parse it into a trace. */
export function parseTraceText(text: string): ParsedTrace {
  return parseTrace(decodeTraceText(text));
}
```

- [ ] **Step 2: Add tests to `src/core/parse.test.ts`.** Change the import line:
```ts
import { parseTrace, flatten, TraceParseError } from "./parse";
```
to:
```ts
import { parseTrace, flatten, TraceParseError, decodeTraceText } from "./parse";
```
and append this block at the end of the file:
```ts
describe("decodeTraceText", () => {
  it("parses whole-file JSON", () => {
    expect(decodeTraceText('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it("parses JSONL into an array, skipping blank lines", () => {
    expect(decodeTraceText('{"type":"a"}\n\n{"type":"b"}\n')).toEqual([
      { type: "a" },
      { type: "b" },
    ]);
  });
  it("throws on text that is neither JSON nor JSONL", () => {
    expect(() => decodeTraceText("not json at all")).toThrow(TraceParseError);
  });
});
```

- [ ] **Step 3: Run the parse tests**

Run: `npx vitest run src/core/parse.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 4: Wire `src/components/Loader.tsx`.** Change the import:
```tsx
import { parseTrace } from "../core/parse";
```
to:
```tsx
import { parseTraceText } from "../core/parse";
```
and in `ingest`, change:
```tsx
        onLoad(parseTrace(JSON.parse(text)), label, text);
```
to:
```tsx
        onLoad(parseTraceText(text), label, text);
```

- [ ] **Step 5: Wire `src/App.tsx`.** Change the import line:
```tsx
import { parseTrace } from "./core/parse";
```
to:
```tsx
import { parseTraceText } from "./core/parse";
```
and in the share auto-load effect, change:
```tsx
        onLoad(parseTrace(JSON.parse(payload.source)), payload.name, payload.source);
```
to:
```tsx
        onLoad(parseTraceText(payload.source), payload.name, payload.source);
```

- [ ] **Step 6: Full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS (no unused `parseTrace`); all tests pass (e.g. **46 passed**); build PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): accept JSONL input (decodeTraceText/parseTraceText)"
```

---

## Task 2: Anthropic (Claude) adapter

**Files:**
- Create: `src/core/adapters/anthropic.ts`, `public/samples/anthropic-log.json`, `src/core/adapters/anthropic.test.ts`
- Modify: `src/core/adapters/index.ts`, `src/components/Loader.tsx`

- [ ] **Step 1: Create `src/core/adapters/anthropic.ts`**

```ts
import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

interface AnthropicMessage {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
}
interface LogEntry extends AnthropicMessage {
  request?: { model?: string; messages?: unknown; system?: unknown };
  response?: AnthropicMessage;
  error?: unknown;
  timestamp?: unknown;
  start_time?: unknown;
}

function looksAnthropic(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const e = el as LogEntry;
  if (e.type === "message") return true;
  if (e.response && typeof e.response === "object") return true;
  if (e.usage && typeof e.role === "string") return true;
  return false;
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b &&
          typeof b === "object" &&
          (b as { type?: string }).type === "text" &&
          typeof (b as { text?: unknown }).text === "string",
      )
      .map((b) => b.text);
    return texts.length ? texts.join("\n") : JSON.stringify(content, null, 2);
  }
  return undefined;
}

export const anthropicAdapter: TraceAdapter = {
  id: "anthropic",
  label: "Anthropic (Claude) log",
  detect(json) {
    return Array.isArray(json) && json.some(looksAnthropic);
  },
  toLooseSpans(json) {
    const entries = (Array.isArray(json) ? json : []) as LogEntry[];
    return entries.map((el, i): LooseSpan => {
      const response = (el.response ?? el) as AnthropicMessage;
      const request = el.request;
      const usage = response.usage ?? el.usage;
      const model = response.model ?? request?.model;
      const isError = response.type === "error" || !!el.error;
      const input = request
        ? JSON.stringify({ system: request.system, messages: request.messages }, null, 2)
        : undefined;
      const output = isError
        ? JSON.stringify(el.error ?? response, null, 2)
        : contentText(response.content);
      const time = el.timestamp ?? el.start_time ?? i;
      return {
        span_id: el.id ?? response.id ?? `claude-${i}`,
        parent_span_id: null,
        name: "claude.messages",
        status_code: isError ? "ERROR" : "OK",
        start_time: time,
        end_time: time,
        attributes: {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": model,
          "gen_ai.usage.input_tokens": usage?.input_tokens,
          "gen_ai.usage.output_tokens": usage?.output_tokens,
          "input.value": input,
          "output.value": output,
        },
      };
    });
  },
};
```

- [ ] **Step 2: Create `public/samples/anthropic-log.json`**

```json
[
  {
    "request": {
      "model": "claude-sonnet-4-6",
      "messages": [{ "role": "user", "content": "What is the capital of France?" }]
    },
    "response": {
      "id": "msg_01",
      "type": "message",
      "role": "assistant",
      "model": "claude-sonnet-4-6",
      "content": [{ "type": "text", "text": "The capital of France is Paris." }],
      "usage": { "input_tokens": 14, "output_tokens": 9 },
      "stop_reason": "end_turn"
    }
  },
  {
    "id": "msg_02",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-4-6",
    "content": [{ "type": "tool_use", "id": "tu_1", "name": "get_weather", "input": { "city": "Paris" } }],
    "usage": { "input_tokens": 320, "output_tokens": 42 },
    "stop_reason": "tool_use"
  },
  {
    "request": {
      "model": "claude-sonnet-4-6",
      "messages": [{ "role": "user", "content": "Summarize the weather." }]
    },
    "error": { "type": "error", "error": { "type": "overloaded_error", "message": "Overloaded" } }
  }
]
```

- [ ] **Step 3: Create `src/core/adapters/anthropic.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { anthropicAdapter } from "./anthropic";
import { parseTrace } from "../parse";
import log from "../../../public/samples/anthropic-log.json";

describe("anthropicAdapter.detect", () => {
  it("matches a Claude-log array only", () => {
    expect(anthropicAdapter.detect(log)).toBe(true);
    expect(anthropicAdapter.detect([{ span_id: "a" }])).toBe(false);
    expect(anthropicAdapter.detect([{ type: "item.completed" }])).toBe(false);
  });
});

describe("anthropicAdapter.toLooseSpans", () => {
  const loose = anthropicAdapter.toLooseSpans(log);
  it("maps each call to an LLM span with model + tokens", () => {
    expect(loose).toHaveLength(3);
    expect(loose[0].attributes!["gen_ai.request.model"]).toBe("claude-sonnet-4-6");
    expect(loose[0].attributes!["gen_ai.usage.input_tokens"]).toBe(14);
  });
  it("flags an error entry", () => {
    expect(loose[2].status_code).toBe("ERROR");
  });
});

describe("Anthropic end-to-end via parseTrace", () => {
  const t = parseTrace(log);
  it("builds N flat LLM spans with the right roll-up", () => {
    expect(t.roots).toHaveLength(3);
    expect(t.summary.llmCalls).toBe(3);
    expect(t.summary.errors).toBe(1);
    expect(t.summary.totalTokensIn).toBe(14 + 320);
  });
});
```

- [ ] **Step 4: Run the test to verify it FAILS**

Run: `npx vitest run src/core/adapters/anthropic.test.ts`
Expected: FAIL — `./anthropic` not found / `parseTrace(log)` not yet routed.

- [ ] **Step 5: Register in `src/core/adapters/index.ts`.** Replace:
```ts
import { otlpAdapter } from "./otlp";
import { nativeAdapter } from "./native";

// More specific adapters go first; the native catch-all is last.
export const ADAPTERS: TraceAdapter[] = [otlpAdapter, nativeAdapter];
```
with:
```ts
import { otlpAdapter } from "./otlp";
import { anthropicAdapter } from "./anthropic";
import { nativeAdapter } from "./native";

// More specific adapters go first; the native catch-all is last.
export const ADAPTERS: TraceAdapter[] = [otlpAdapter, anthropicAdapter, nativeAdapter];
```

- [ ] **Step 6: Add the Loader button.** In `src/components/Loader.tsx`, add to the `SAMPLES` array (after the `otlp-trace.json` entry):
```tsx
  { file: "anthropic-log.json", label: "Claude (Anthropic) log", hint: "3 calls · 1 error" },
```

- [ ] **Step 7: Run the OTLP/anthropic test + full gate**

Run: `npx vitest run src/core/adapters/anthropic.test.ts` (expect PASS, 3 tests), then `npm run typecheck && npm test && npm run build` (all green, e.g. **49 passed**).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): Anthropic (Claude) Messages log adapter + sample"
```

---

## Task 3: Codex adapter

**Files:**
- Create: `src/core/adapters/codex.ts`, `public/samples/codex-session.jsonl`, `src/core/adapters/codex.test.ts`
- Modify: `src/core/adapters/index.ts`, `src/components/Loader.tsx`

- [ ] **Step 1: Create `src/core/adapters/codex.ts`**

```ts
import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

interface CodexItem {
  id?: string;
  type?: string;
  status?: string;
  command?: string;
  text?: string;
  query?: string;
  aggregated_output?: string;
  output?: string;
  [k: string]: unknown;
}
interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const KIND_BY_ITEM: Record<string, string> = {
  command_execution: "TOOL",
  file_change: "TOOL",
  mcp_tool_call: "TOOL",
  web_search: "TOOL",
  agent_message: "LLM",
  reasoning: "LLM",
  plan: "CHAIN",
  todo_list: "CHAIN",
};

function isCodexEvent(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const t = (el as CodexEvent).type;
  return (
    typeof t === "string" &&
    (t.startsWith("item.") || t.startsWith("turn.") || t.startsWith("thread."))
  );
}

export const codexAdapter: TraceAdapter = {
  id: "codex",
  label: "Codex exec --json",
  detect(json) {
    return Array.isArray(json) && json.some(isCodexEvent);
  },
  toLooseSpans(json) {
    const events = (Array.isArray(json) ? json : []) as CodexEvent[];
    let threadId: string | undefined;
    let usage: { input_tokens?: number; output_tokens?: number } | undefined;
    let turnFailed = false;
    const items = new Map<string, CodexItem>();
    const order: string[] = [];

    for (const ev of events) {
      if (ev.type === "thread.started") threadId = ev.thread_id ?? threadId;
      else if (ev.type === "turn.completed") usage = ev.usage ?? usage;
      else if (ev.type === "turn.failed") turnFailed = true;
      else if ((ev.type === "item.started" || ev.type === "item.completed") && ev.item) {
        const id = ev.item.id ?? `item-${order.length}`;
        if (!items.has(id)) order.push(id);
        items.set(id, { ...items.get(id), ...ev.item, id });
      }
    }

    const rootId = threadId ?? "codex-session";
    const out: LooseSpan[] = [
      {
        span_id: rootId,
        parent_span_id: null,
        name: "codex.session",
        status_code: turnFailed ? "ERROR" : "OK",
        start_time: 0,
        end_time: order.length,
        attributes: {
          "openinference.span.kind": "AGENT",
          "gen_ai.usage.input_tokens": usage?.input_tokens,
          "gen_ai.usage.output_tokens": usage?.output_tokens,
        },
      },
    ];

    order.forEach((id, j) => {
      const item = items.get(id)!;
      const kind = item.type ? KIND_BY_ITEM[item.type] : undefined;
      const input = item.command ?? item.query;
      const output = item.text ?? item.aggregated_output ?? item.output;
      const isError = item.status === "failed" || item.status === "error";
      out.push({
        span_id: id,
        parent_span_id: rootId,
        name: item.type ?? "item",
        status_code: isError ? "ERROR" : "OK",
        start_time: j,
        end_time: j,
        attributes: {
          ...(kind ? { "openinference.span.kind": kind } : {}),
          ...(input !== undefined ? { "input.value": input } : {}),
          ...(output !== undefined ? { "output.value": output } : {}),
          "codex.item": item,
        },
      });
    });

    return out;
  },
};
```

- [ ] **Step 2: Create `public/samples/codex-session.jsonl`** (newline-delimited JSON; keep each event on one line)

```
{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"completed","aggregated_output":"docs\nsdk\nexamples"}}
{"type":"item.completed","item":{"id":"item_2","type":"web_search","query":"openinference span attributes","status":"completed"}}
{"type":"item.completed","item":{"id":"item_3","type":"command_execution","command":"bash -lc 'cat missing.txt'","status":"failed","aggregated_output":"cat: missing.txt: No such file or directory"}}
{"type":"item.completed","item":{"id":"item_4","type":"agent_message","text":"The repo has docs, sdk, and examples directories."}}
{"type":"turn.completed","usage":{"input_tokens":24763,"output_tokens":122}}
```

- [ ] **Step 3: Create `src/core/adapters/codex.test.ts`** (uses the decoded event array inline; JSONL decoding itself is covered in `parse.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { codexAdapter } from "./codex";
import { parseTrace, flatten } from "../parse";

const EVENTS = [
  { type: "thread.started", thread_id: "thread-1" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item_1", type: "command_execution", command: "bash -lc ls", status: "completed", aggregated_output: "docs\nsdk" } },
  { type: "item.completed", item: { id: "item_2", type: "web_search", query: "openinference", status: "completed" } },
  { type: "item.completed", item: { id: "item_3", type: "command_execution", command: "cat missing", status: "failed", aggregated_output: "No such file" } },
  { type: "item.completed", item: { id: "item_4", type: "agent_message", text: "Done." } },
  { type: "turn.completed", usage: { input_tokens: 24763, output_tokens: 122 } },
];

describe("codexAdapter.detect", () => {
  it("matches a Codex event array only", () => {
    expect(codexAdapter.detect(EVENTS)).toBe(true);
    expect(codexAdapter.detect([{ span_id: "a" }])).toBe(false);
    expect(codexAdapter.detect([{ type: "message" }])).toBe(false);
  });
});

describe("codexAdapter.toLooseSpans", () => {
  const loose = codexAdapter.toLooseSpans(EVENTS);
  it("builds a root carrying turn tokens + one span per item", () => {
    expect(loose).toHaveLength(5);
    expect(loose[0].name).toBe("codex.session");
    expect(loose[0].attributes!["gen_ai.usage.input_tokens"]).toBe(24763);
    expect(loose[0].attributes!["openinference.span.kind"]).toBe("AGENT");
  });
  it("maps a command_execution to a tool with input + raw stash", () => {
    const cmd = loose.find((s) => s.span_id === "item_1")!;
    expect(cmd.attributes!["openinference.span.kind"]).toBe("TOOL");
    expect(cmd.attributes!["input.value"]).toBe("bash -lc ls");
    expect(cmd.attributes!["codex.item"]).toBeTruthy();
  });
});

describe("Codex end-to-end via parseTrace", () => {
  const t = parseTrace(EVENTS);
  it("builds root + items with kinds, tokens, and the failed item", () => {
    expect(t.roots).toHaveLength(1);
    expect(t.roots[0].name).toBe("codex.session");
    expect(t.summary.toolCalls).toBe(3);
    expect(t.summary.llmCalls).toBe(1);
    expect(t.summary.errors).toBe(1);
    const agent = flatten(t.roots).find((n) => n.name === "agent_message")!;
    expect(agent.kind).toBe("llm");
  });
});
```

- [ ] **Step 4: Run the test to verify it FAILS**

Run: `npx vitest run src/core/adapters/codex.test.ts`
Expected: FAIL — `./codex` not found / not routed.

- [ ] **Step 5: Register in `src/core/adapters/index.ts`.** Replace:
```ts
import { otlpAdapter } from "./otlp";
import { anthropicAdapter } from "./anthropic";
import { nativeAdapter } from "./native";

// More specific adapters go first; the native catch-all is last.
export const ADAPTERS: TraceAdapter[] = [otlpAdapter, anthropicAdapter, nativeAdapter];
```
with:
```ts
import { otlpAdapter } from "./otlp";
import { codexAdapter } from "./codex";
import { anthropicAdapter } from "./anthropic";
import { nativeAdapter } from "./native";

// More specific adapters go first; the native catch-all is last.
export const ADAPTERS: TraceAdapter[] = [otlpAdapter, codexAdapter, anthropicAdapter, nativeAdapter];
```

- [ ] **Step 6: Add the Loader button.** In `src/components/Loader.tsx`, add to the `SAMPLES` array (after the `anthropic-log.json` entry):
```tsx
  { file: "codex-session.jsonl", label: "Codex exec --json", hint: "4 steps · 1 failed" },
```

- [ ] **Step 7: Run the codex test + full gate**

Run: `npx vitest run src/core/adapters/codex.test.ts` (expect PASS, 4 tests), then `npm run typecheck && npm test && npm run build` (all green, e.g. **53 passed**).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): Codex exec --json import adapter + sample"
```

---

## Task 4: Runtime verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server.** The loader shows **five** sample buttons including "Claude (Anthropic) log" and "Codex exec --json".

- [ ] **Step 2: Click "Claude (Anthropic) log".** Confirm 3 flat LLM spans (`claude.messages`), summary 3 LLM / 1 error, the third span flagged red, and a span's detail shows model `claude-sonnet-4-6` + tokens. Console error-free.

- [ ] **Step 3: Click "Codex exec --json".** Confirm a `codex.session` root with 4 child items (two `command_execution`, one `web_search`, one `agent_message`), summary 3 tool / 1 LLM / 1 error, the failed command flagged red, and that clicking an item shows the raw item under "Raw attributes" (`codex.item`). This exercises the JSONL path end-to-end. Console error-free.

- [ ] **Step 4: Regression.** Click "Research agent" and "OpenTelemetry (OTLP)" — both still render as before.

- [ ] **Step 5: Final commit (only if verification fixes were needed)**

```bash
git add -A
git commit -m "chore(core): Codex/Anthropic adapter verification fixes"
```

---

## Self-review notes (author)

- **Spec coverage:** JSONL decode + wiring (T1); Anthropic flat LLM spans w/ model/tokens/input/output/error (T2); Codex synthetic root + items + raw-item stash + turn tokens + failed item (T3); registration order `[otlp, codex, anthropic, native]` (T3); synthetic timing via index (T2/T3); two samples + two Loader buttons. ✓
- **Type consistency:** both adapters return `LooseSpan[]` and feed `normalizeSpan`; `decodeTraceText`/`parseTraceText` consumed by Loader + App; `TraceAdapter` shape unchanged. ✓
- **Green at every step:** T1 preserves behavior (JSON still parses); each adapter only starts routing once registered; `native`'s any-array stays last; `normalizeSpan`/canonical model untouched. ✓
- **Disjoint detects:** OTLP=`resourceSpans`; Codex=`type` prefixed `item.`/`turn.`/`thread.`; Anthropic=`type:"message"`/`response`/`usage`+`role`; native=any array (last). ✓
- **Codex schema risk:** raw item stashed in `codex.item` so unmapped real-file fields still display; field access is lenient (`??`).
