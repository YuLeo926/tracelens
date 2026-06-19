# Real Transcript Adapters (Codex rollout + Claude Code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Codex and Claude adapters read the saved-transcript formats users actually have — Codex session `rollout-*.jsonl` and Claude Code `*.jsonl` — with real per-event timestamps (paired tool call→result durations).

**Architecture:** Extend the existing `codex.ts` and `anthropic.ts`. Each keeps its current mapper, gains a transcript mapper, and its `detect`/`toLooseSpans` branch on the file shape. Registry, canonical model, and `normalizeSpan` are untouched.

**Tech Stack:** TypeScript (strict), Vitest. Core-only; no UI changes; no new public samples (synthetic fixtures inline in tests; real files validated in verification).

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/core/adapters/codex.ts` | 1 | **rewrite** — exec mapper (kept) + rollout mapper + branching adapter |
| `src/core/adapters/codex.test.ts` | 1 | **edit** — add rollout tests (keep exec tests) |
| `src/core/adapters/anthropic.ts` | 2 | **rewrite** — messages-log mapper (kept) + Claude Code mapper + branching adapter |
| `src/core/adapters/anthropic.test.ts` | 2 | **edit** — add Claude Code tests (keep messages-log tests) |

---

## Task 1: Codex rollout

**Files:** Rewrite `src/core/adapters/codex.ts`; edit `src/core/adapters/codex.test.ts`.

- [ ] **Step 1: Replace the ENTIRE contents of `src/core/adapters/codex.ts`** with:

```ts
import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

/* ── Codex exec --json (live event stream) ───────────────────────────── */

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

function isExecEvent(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const t = (el as CodexEvent).type;
  return (
    typeof t === "string" &&
    (t.startsWith("item.") || t.startsWith("turn.") || t.startsWith("thread."))
  );
}

function execToLooseSpans(events: CodexEvent[]): LooseSpan[] {
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
}

/* ── Codex session rollout (saved ~/.codex/sessions/.../rollout-*.jsonl) ── */

interface RolloutEvent {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

function isRolloutEvent(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const t = (el as RolloutEvent).type;
  return (
    t === "session_meta" || t === "turn_context" || t === "response_item" || t === "event_msg"
  );
}

function tsToMs(ts: unknown, fallback: number): number {
  if (typeof ts === "string") {
    const p = Date.parse(ts);
    if (!Number.isNaN(p)) return p;
  }
  return fallback;
}

function outputText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content
      .map((b) => (b && typeof b === "object" ? (b as { text?: unknown }).text : undefined))
      .filter((x): x is string => typeof x === "string");
    return t.length ? t.join("\n") : undefined;
  }
  return undefined;
}

function rolloutToLooseSpans(events: RolloutEvent[]): LooseSpan[] {
  let sessionId: string | undefined;
  let model: string | undefined;
  let usageIn: number | undefined;
  let usageOut: number | undefined;
  let firstTs: number | undefined;
  let lastTs = 0;

  const outputs = new Map<string, { output?: string; ts: number }>();
  const calls: Array<{ callId: string; name?: string; args?: string; ts: number }> = [];
  const messages: Array<{ text?: string; ts: number }> = [];

  events.forEach((ev, i) => {
    const ts = tsToMs(ev.timestamp, i);
    if (firstTs === undefined) firstTs = ts;
    lastTs = ts;
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    if (ev.type === "session_meta") {
      sessionId = (p.id as string) ?? sessionId;
    } else if (ev.type === "turn_context") {
      model = (p.model as string) ?? model;
    } else if (ev.type === "event_msg" && p.type === "token_count") {
      const total = ((p.info as Record<string, unknown>)?.total_token_usage ?? {}) as Record<string, unknown>;
      if (typeof total.input_tokens === "number") usageIn = total.input_tokens;
      if (typeof total.output_tokens === "number") usageOut = total.output_tokens;
    } else if (ev.type === "response_item") {
      if (p.type === "function_call") {
        calls.push({ callId: String(p.call_id ?? `call-${i}`), name: p.name as string, args: p.arguments as string, ts });
      } else if (p.type === "function_call_output") {
        outputs.set(String(p.call_id), { output: p.output as string, ts });
      } else if (p.type === "message" && p.role === "assistant") {
        messages.push({ text: outputText(p.content), ts });
      }
    }
  });

  const rootId = sessionId ?? "codex-session";
  const spans: Array<{ ts: number; span: LooseSpan }> = [];

  for (const c of calls) {
    const out = outputs.get(c.callId);
    let command: string | undefined = c.args;
    try {
      const a = JSON.parse(c.args ?? "") as { command?: unknown };
      if (typeof a.command === "string") command = a.command;
    } catch {
      /* keep raw arguments */
    }
    const m = out?.output?.match(/^Exit code:\s*(\d+)/m);
    const isError = !!m && m[1] !== "0";
    spans.push({
      ts: c.ts,
      span: {
        span_id: c.callId,
        parent_span_id: rootId,
        name: c.name ?? "function_call",
        status_code: isError ? "ERROR" : "OK",
        start_time: c.ts,
        end_time: out?.ts ?? c.ts,
        attributes: {
          "openinference.span.kind": "TOOL",
          ...(command !== undefined ? { "input.value": command } : {}),
          ...(out?.output !== undefined ? { "output.value": out.output } : {}),
          "codex.item": { name: c.name, arguments: c.args, output: out?.output },
        },
      },
    });
  }
  messages.forEach((msg, k) => {
    spans.push({
      ts: msg.ts,
      span: {
        span_id: `codex-msg-${k}`,
        parent_span_id: rootId,
        name: "assistant",
        status_code: "OK",
        start_time: msg.ts,
        end_time: msg.ts,
        attributes: {
          "openinference.span.kind": "LLM",
          ...(msg.text !== undefined ? { "output.value": msg.text } : {}),
        },
      },
    });
  });
  spans.sort((a, b) => a.ts - b.ts);

  const root: LooseSpan = {
    span_id: rootId,
    parent_span_id: null,
    name: "codex.session",
    status_code: "OK",
    start_time: firstTs ?? 0,
    end_time: lastTs,
    attributes: {
      "openinference.span.kind": "AGENT",
      ...(model !== undefined ? { "gen_ai.request.model": model } : {}),
      "gen_ai.usage.input_tokens": usageIn,
      "gen_ai.usage.output_tokens": usageOut,
    },
  };
  return [root, ...spans.map((s) => s.span)];
}

/* ── Adapter (handles both Codex formats) ────────────────────────────── */

export const codexAdapter: TraceAdapter = {
  id: "codex",
  label: "Codex (exec --json / session rollout)",
  detect(json) {
    return Array.isArray(json) && json.some((el) => isExecEvent(el) || isRolloutEvent(el));
  },
  toLooseSpans(json) {
    const arr = Array.isArray(json) ? json : [];
    if (arr.some(isRolloutEvent)) return rolloutToLooseSpans(arr as RolloutEvent[]);
    return execToLooseSpans(arr as CodexEvent[]);
  },
};
```

- [ ] **Step 2: Append rollout tests to `src/core/adapters/codex.test.ts`** (keep everything already there; add at the end):

```ts
const ROLLOUT = [
  { timestamp: "2026-06-15T12:59:51.565Z", type: "session_meta", payload: { id: "sess-1", cwd: "E:/proj" } },
  { timestamp: "2026-06-15T12:59:51.598Z", type: "turn_context", payload: { model: "gpt-5.5" } },
  { timestamp: "2026-06-15T12:59:59.386Z", type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: '{"command":"ls"}', call_id: "call_1" } },
  { timestamp: "2026-06-15T12:59:59.754Z", type: "response_item", payload: { type: "function_call_output", call_id: "call_1", output: "Exit code: 0\nOutput:\nsrc" } },
  { timestamp: "2026-06-15T13:00:02.000Z", type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: '{"command":"cat missing"}', call_id: "call_2" } },
  { timestamp: "2026-06-15T13:00:02.300Z", type: "response_item", payload: { type: "function_call_output", call_id: "call_2", output: "Exit code: 1\ncat: missing: not found" } },
  { timestamp: "2026-06-15T13:06:40.328Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] } },
  { timestamp: "2026-06-15T13:06:40.477Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 20707, output_tokens: 330 } } } },
];

describe("codexAdapter — session rollout", () => {
  it("detects the rollout shape", () => {
    expect(codexAdapter.detect(ROLLOUT)).toBe(true);
  });

  it("pairs a command with its output and gives it a real duration", () => {
    const t = parseTrace(ROLLOUT);
    const ls = t.byId.get("call_1")!;
    expect(ls.kind).toBe("tool");
    expect(ls.input).toBe("ls");
    expect(ls.output).toContain("src");
    expect(ls.durationMs).toBeGreaterThan(0);
    expect(ls.status).toBe("ok");
  });

  it("flags a non-zero exit code and maps model + tokens on the root", () => {
    const t = parseTrace(ROLLOUT);
    expect(t.byId.get("call_2")!.status).toBe("error");
    expect(t.summary.errors).toBe(1);
    expect(t.roots[0].name).toBe("codex.session");
    expect(t.roots[0].model).toBe("gpt-5.5");
    expect(t.roots[0].tokensIn).toBe(20707);
    const msg = flatten(t.roots).find((n) => n.name === "assistant")!;
    expect(msg.kind).toBe("llm");
  });
});
```

(The file already imports `parseTrace, flatten` and `codexAdapter`. If `flatten` is not imported there, add it to the existing `import { parseTrace, flatten } from "../parse";` line.)

- [ ] **Step 3: Run codex tests**

Run: `npx vitest run src/core/adapters/codex.test.ts`
Expected: PASS — existing exec tests + 3 new rollout tests.

- [ ] **Step 4: Full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; all tests pass (e.g. **57 passed**); build PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): read real Codex session rollout files (.codex/sessions)"
```

---

## Task 2: Claude Code transcript

**Files:** Rewrite `src/core/adapters/anthropic.ts`; edit `src/core/adapters/anthropic.test.ts`.

- [ ] **Step 1: Replace the ENTIRE contents of `src/core/adapters/anthropic.ts`** with:

```ts
import type { LooseSpan } from "../openinference";
import type { TraceAdapter } from "./types";

/* ── Anthropic Messages API log ──────────────────────────────────────── */

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

function looksMessagesLog(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const e = el as LogEntry;
  if (e.type === "message") return true;
  if (e.response && typeof e.response === "object") return true;
  if (e.usage && typeof e.role === "string") return true;
  return false;
}

function textBlocks(content: unknown): string | undefined {
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

function messagesLogToLooseSpans(entries: LogEntry[]): LooseSpan[] {
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
      : textBlocks(response.content);
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
}

/* ── Claude Code transcript (saved ~/.claude/projects/.../*.jsonl) ─────── */

interface ClaudeBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}
interface ClaudeLine {
  type?: string;
  timestamp?: string;
  uuid?: string;
  sessionId?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
}

function looksClaudeCode(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const e = el as ClaudeLine;
  return (
    (e.type === "user" || e.type === "assistant") &&
    !!e.message &&
    typeof e.message === "object" &&
    typeof e.message.role === "string"
  );
}

function ccTsToMs(ts: unknown, fallback: number): number {
  if (typeof ts === "string") {
    const p = Date.parse(ts);
    if (!Number.isNaN(p)) return p;
  }
  return fallback;
}

function blocksOf(content: unknown): ClaudeBlock[] {
  if (Array.isArray(content)) return content as ClaudeBlock[];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function claudeCodeToLooseSpans(lines: ClaudeLine[]): LooseSpan[] {
  const results = new Map<string, { output?: string; isError?: boolean; ts: number }>();
  let sessionId: string | undefined;
  let model: string | undefined;
  let firstPrompt: string | undefined;
  let firstTs: number | undefined;
  let lastTs = 0;

  lines.forEach((ln, i) => {
    const ts = ccTsToMs(ln.timestamp, i);
    if (firstTs === undefined) firstTs = ts;
    lastTs = ts;
    sessionId = ln.sessionId ?? sessionId;
    if (ln.message?.model) model = model ?? ln.message.model;
    for (const b of blocksOf(ln.message?.content)) {
      if (b.type === "tool_result" && b.tool_use_id) {
        results.set(b.tool_use_id, {
          output: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
          isError: b.is_error,
          ts,
        });
      }
      if (ln.message?.role === "user" && b.type === "text" && firstPrompt === undefined && typeof b.text === "string") {
        firstPrompt = b.text;
      }
    }
  });

  const rootId = sessionId ?? "claude-code-session";
  const spans: Array<{ ts: number; span: LooseSpan }> = [];

  lines.forEach((ln, i) => {
    if (ln.message?.role !== "assistant") return;
    const ts = ccTsToMs(ln.timestamp, i);
    const usage = ln.message?.usage;
    for (const b of blocksOf(ln.message?.content)) {
      if (b.type === "text" && typeof b.text === "string") {
        spans.push({
          ts,
          span: {
            span_id: `cc-msg-${spans.length}`,
            parent_span_id: rootId,
            name: "assistant",
            status_code: "OK",
            start_time: ts,
            end_time: ts,
            attributes: {
              "openinference.span.kind": "LLM",
              "gen_ai.request.model": ln.message?.model,
              "gen_ai.usage.input_tokens": usage?.input_tokens,
              "gen_ai.usage.output_tokens": usage?.output_tokens,
              "output.value": b.text,
            },
          },
        });
      } else if (b.type === "tool_use" && b.id) {
        const r = results.get(b.id);
        spans.push({
          ts,
          span: {
            span_id: b.id,
            parent_span_id: rootId,
            name: b.name ?? "tool_use",
            status_code: r?.isError ? "ERROR" : "OK",
            start_time: ts,
            end_time: r?.ts ?? ts,
            attributes: {
              "openinference.span.kind": "TOOL",
              "input.value": JSON.stringify(b.input, null, 2),
              ...(r?.output !== undefined ? { "output.value": r.output } : {}),
              "claude.item": b,
            },
          },
        });
      }
    }
  });
  spans.sort((a, b) => a.ts - b.ts);

  const root: LooseSpan = {
    span_id: rootId,
    parent_span_id: null,
    name: "claude-code.session",
    status_code: "OK",
    start_time: firstTs ?? 0,
    end_time: lastTs,
    attributes: {
      "openinference.span.kind": "AGENT",
      ...(model !== undefined ? { "gen_ai.request.model": model } : {}),
      ...(firstPrompt !== undefined ? { "input.value": firstPrompt } : {}),
    },
  };
  return [root, ...spans.map((s) => s.span)];
}

/* ── Adapter (handles both Anthropic/Claude formats) ─────────────────── */

export const anthropicAdapter: TraceAdapter = {
  id: "anthropic",
  label: "Anthropic / Claude (API log / Claude Code)",
  detect(json) {
    return Array.isArray(json) && json.some((el) => looksMessagesLog(el) || looksClaudeCode(el));
  },
  toLooseSpans(json) {
    const arr = Array.isArray(json) ? json : [];
    if (arr.some(looksClaudeCode)) return claudeCodeToLooseSpans(arr as ClaudeLine[]);
    return messagesLogToLooseSpans(arr as LogEntry[]);
  },
};
```

- [ ] **Step 2: Append Claude Code tests to `src/core/adapters/anthropic.test.ts`** (keep existing; add at the end). Ensure `flatten` is imported (change the existing `import { parseTrace } from "../parse";` to `import { parseTrace, flatten } from "../parse";`):

```ts
const CC = [
  { type: "user", timestamp: "2026-06-18T10:00:00.000Z", sessionId: "cc-1", message: { role: "user", content: "Fix the bug." } },
  { type: "assistant", timestamp: "2026-06-18T10:00:01.000Z", message: { role: "assistant", model: "claude-haiku-4-5-20251001", usage: { input_tokens: 30, output_tokens: 12 }, content: [{ type: "text", text: "I'll read the file." }] } },
  { type: "assistant", timestamp: "2026-06-18T10:00:02.000Z", message: { role: "assistant", model: "claude-haiku-4-5-20251001", usage: { input_tokens: 40, output_tokens: 5 }, content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "a.ts" } }] } },
  { type: "user", timestamp: "2026-06-18T10:00:03.500Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "EISDIR: illegal operation", is_error: true }] } },
];

describe("anthropicAdapter — Claude Code transcript", () => {
  it("detects the Claude Code shape", () => {
    expect(anthropicAdapter.detect(CC)).toBe(true);
  });

  it("maps an assistant text to an LLM span with model + tokens", () => {
    const t = parseTrace(CC);
    expect(t.roots[0].name).toBe("claude-code.session");
    const msg = flatten(t.roots).find((n) => n.name === "assistant")!;
    expect(msg.kind).toBe("llm");
    expect(msg.model).toBe("claude-haiku-4-5-20251001");
    expect(msg.tokensIn).toBe(30);
  });

  it("pairs a tool_use with its tool_result, real duration + error flag", () => {
    const t = parseTrace(CC);
    const tool = t.byId.get("toolu_1")!;
    expect(tool.kind).toBe("tool");
    expect(tool.name).toBe("Read");
    expect(tool.output).toContain("EISDIR");
    expect(tool.status).toBe("error");
    expect(tool.durationMs).toBeGreaterThan(0);
    expect(t.summary.errors).toBe(1);
  });
});
```

- [ ] **Step 3: Run anthropic tests**

Run: `npx vitest run src/core/adapters/anthropic.test.ts`
Expected: PASS — existing messages-log tests + 3 new Claude Code tests.

- [ ] **Step 4: Full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck PASS; all tests pass (e.g. **60 passed**); build PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): read real Claude Code transcripts (.claude/projects)"
```

---

## Task 3: Verification (incl. real files)

**Files:** none.

- [ ] **Step 1: Unit gate** — confirm `npm run typecheck && npm test && npm run build` all pass on the merged work.

- [ ] **Step 2: Real Codex rollout** — run the adapter against an actual file and confirm a sensible tree. From the repo root:
```bash
node -e "const {parseTraceText}=require('./src/core/parse.ts');" 2>/dev/null || true
```
(That won't run TS directly; instead use a throwaway check: read the file, JSON.parse each line, call the built adapter via a tiny `vite-node`/`tsx` script, OR load it in the dev server.) Concretely, start the dev server and drag-drop / load `C:\Users\zhouy\.codex\sessions\2026\06\15\rollout-2026-06-15T20-59-42-019ecb5d-b61e-7d52-be38-0f840cc8428b.jsonl`; confirm a `codex.session` root with `shell_command` tool spans (real durations), the assistant message, model `gpt-5.5`, and token totals. Console error-free.

- [ ] **Step 3: Real Claude Code transcript** — load a `C:\Users\zhouy\.claude\projects\...\*.jsonl` transcript; confirm a `claude-code.session` root with `Read`/`Edit`/`Bash` tool spans (real durations), assistant messages, model, and any errored tools flagged.

- [ ] **Step 4: Regression** — the bundled samples (research/otlp/exec-codex/anthropic-log) still load.

- [ ] **Step 5: Final commit (only if fixes were needed)**

```bash
git add -A
git commit -m "chore(core): real transcript adapter verification fixes"
```

---

## Self-review notes (author)

- **Spec coverage:** rollout mapper (T1) — session root w/ model+tokens, function_call↔output pairing w/ real duration, exit-code error, assistant messages; Claude Code mapper (T2) — session root, tool_use↔tool_result pairing w/ real duration + is_error, assistant text w/ model+tokens; both branch off the existing mapper via `detect`/dispatch; real-file verification (T3). ✓
- **Disjoint detection:** exec=`item./turn./thread.`; rollout=`session_meta/turn_context/response_item/event_msg`; messages-log=`type:message`/`response`/`usage+role`; Claude Code=`type:user|assistant` + `message.role`. Registry order `[otlp, codex, anthropic, native]` keeps rollout→codex and transcript→anthropic. ✓
- **Green at every step:** each task keeps the existing mapper + tests and adds the new path; `normalizeSpan`/canonical model untouched. ✓
- **Type consistency:** both new mappers return `LooseSpan[]`; helpers (`tsToMs`/`ccTsToMs`, `outputText`/`textBlocks`, `blocksOf`) are file-local; `parseTrace`/`flatten` used in tests. ✓
