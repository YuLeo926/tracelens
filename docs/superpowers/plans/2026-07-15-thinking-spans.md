# Thinking / Reasoning Spans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface recorded model thinking — Claude Code `thinking` blocks and Codex rollout `reasoning` summaries — as first-class LLM spans in the trace.

**Architecture:** Adapter-only change. Two parsers (`anthropic.ts` Claude Code branch, `codex.ts` rollout branch) gain block-type branches that emit `thinking` / `reasoning` spans into the existing flat span list. Tree, detail panel, search, annotations, and live tail consume spans generically, so no UI changes.

**Tech Stack:** TypeScript, Vitest, Vite. Spec: `docs/superpowers/specs/2026-07-15-thinking-spans-design.md`.

**Key real-data constraints (from the spec):**
- Claude Code thinking blocks are `{ type: "thinking", thinking: string, signature: string }`; **most are empty strings** (731/755 sampled) → skip when `thinking.trim()` is empty.
- `redacted_thinking` blocks → placeholder span `[Encrypted thinking — content not available]`.
- Codex rollout reasoning items are `payload { type: "reasoning", summary: [{ type: "summary_text", text }], content: null, encrypted_content }`; readable text is **only** in `summary` → join with `\n\n`, skip when empty.

---

### Task 1: Claude Code `thinking` / `redacted_thinking` blocks

**Files:**
- Modify: `src/core/adapters/anthropic.ts` (ClaudeBlock interface ~line 83; block loop in `claudeCodeToLooseSpans` ~line 166)
- Test: `src/core/adapters/anthropic.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/core/adapters/anthropic.test.ts` (after the existing `anthropicAdapter — Claude Code transcript` describe; reuses the existing `CC` fixture and the existing `parseTrace`/`flatten` imports):

```ts
const CCT = [
  { type: "user", timestamp: "2026-07-15T09:00:00.000Z", sessionId: "cc-t", message: { role: "user", content: "Why?" } },
  {
    type: "assistant",
    timestamp: "2026-07-15T09:00:01.000Z",
    message: {
      role: "assistant",
      model: "claude-sonnet-5",
      usage: { input_tokens: 10, output_tokens: 8 },
      content: [
        { type: "thinking", thinking: "The user wants X; I should check Y first.", signature: "sig-abc" },
        { type: "thinking", thinking: "", signature: "sig-empty" },
        { type: "text", text: "Checking Y." },
      ],
    },
  },
  {
    type: "assistant",
    timestamp: "2026-07-15T09:00:02.000Z",
    message: { role: "assistant", model: "claude-sonnet-5", content: [{ type: "redacted_thinking", data: "b64==" }] },
  },
];

describe("anthropicAdapter — Claude Code thinking blocks", () => {
  it("emits a thinking span (kind LLM, text in output) before the same message's text span", () => {
    const t = parseTrace(CCT);
    const nodes = flatten(t.roots);
    const names = nodes.map((n) => n.name);
    expect(names.indexOf("thinking")).toBeLessThan(names.indexOf("assistant"));
    const think = nodes.find((n) => n.name === "thinking")!;
    expect(think.kind).toBe("llm");
    expect(think.output).toBe("The user wants X; I should check Y first.");
    expect(think.model).toBe("claude-sonnet-5");
  });

  it("skips empty thinking; placeholders redacted_thinking", () => {
    const t = parseTrace(CCT);
    const thinks = flatten(t.roots).filter((n) => n.name === "thinking");
    expect(thinks).toHaveLength(2); // non-empty + redacted placeholder; the empty block is dropped
    expect(thinks[1].output).toContain("Encrypted thinking");
  });

  it("emits no thinking spans for a transcript without thinking", () => {
    const t = parseTrace(CC);
    expect(flatten(t.roots).some((n) => n.name === "thinking")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/adapters/anthropic.test.ts`
Expected: the 3 new tests FAIL (no `thinking` spans emitted yet); all pre-existing tests PASS.

- [ ] **Step 3: Implement the two block branches**

In `src/core/adapters/anthropic.ts`:

(a) Add `thinking?: string;` to `ClaudeBlock` (after `text?: string;`):

```ts
interface ClaudeBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}
```

(b) In `claudeCodeToLooseSpans`, extend the block `if/else if` chain (currently `text` → `tool_use`) with two branches after the `tool_use` branch:

```ts
      } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
        spans.push({
          ts,
          span: {
            span_id: `cc-think-${spans.length}`,
            parent_span_id: rootId,
            name: "thinking",
            status_code: "OK",
            start_time: ts,
            end_time: ts,
            attributes: {
              "openinference.span.kind": "LLM",
              "gen_ai.request.model": ln.message?.model,
              "output.value": b.thinking,
            },
          },
        });
      } else if (b.type === "redacted_thinking") {
        spans.push({
          ts,
          span: {
            span_id: `cc-think-${spans.length}`,
            parent_span_id: rootId,
            name: "thinking",
            status_code: "OK",
            start_time: ts,
            end_time: ts,
            attributes: {
              "openinference.span.kind": "LLM",
              "gen_ai.request.model": ln.message?.model,
              "output.value": "[Encrypted thinking — content not available]",
            },
          },
        });
      }
```

Notes: no usage attrs on thinking spans (tokens stay on the text span, per spec). Block order within the message is preserved because `spans.sort` is stable and thinking precedes text in the content array.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/adapters/anthropic.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/adapters/anthropic.ts src/core/adapters/anthropic.test.ts
git commit -m "feat(core): surface Claude Code thinking blocks as spans"
```

---

### Task 2: Codex rollout `reasoning` summaries

**Files:**
- Modify: `src/core/adapters/codex.ts` (helper after `callOutputText` ~line 162; `rolloutToLooseSpans` collection + emission ~lines 172-249)
- Test: `src/core/adapters/codex.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/core/adapters/codex.test.ts` (uses the existing `parseTrace`/`flatten` imports; a fresh fixture so the existing `ROLLOUT` assertions stay untouched):

```ts
const ROLLOUT_THINK = [
  { timestamp: "2026-07-15T09:00:00.000Z", type: "session_meta", payload: { id: "sess-t" } },
  { timestamp: "2026-07-15T09:00:01.000Z", type: "response_item", payload: { type: "reasoning", summary: [{ type: "summary_text", text: "**Plan**" }, { type: "summary_text", text: "Check files first." }], content: null, encrypted_content: "gAAA" } },
  { timestamp: "2026-07-15T09:00:02.000Z", type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: '{"command":"ls"}', call_id: "call_t1" } },
  { timestamp: "2026-07-15T09:00:02.500Z", type: "response_item", payload: { type: "function_call_output", call_id: "call_t1", output: "Exit code: 0\nsrc" } },
  { timestamp: "2026-07-15T09:00:03.000Z", type: "response_item", payload: { type: "reasoning", summary: [], content: null, encrypted_content: "gBBB" } },
  { timestamp: "2026-07-15T09:00:04.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] } },
];

describe("codexAdapter — rollout reasoning items", () => {
  it("emits a reasoning span (kind LLM) with the joined summary text", () => {
    const nodes = flatten(parseTrace(ROLLOUT_THINK).roots);
    const think = nodes.find((n) => n.name === "reasoning")!;
    expect(think.kind).toBe("llm");
    expect(think.output).toBe("**Plan**\n\nCheck files first.");
  });

  it("skips encrypted-only reasoning (empty summary) and orders by timestamp", () => {
    const nodes = flatten(parseTrace(ROLLOUT_THINK).roots);
    expect(nodes.filter((n) => n.name === "reasoning")).toHaveLength(1);
    const names = nodes.map((n) => n.name);
    expect(names.indexOf("reasoning")).toBeLessThan(names.indexOf("shell_command"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/adapters/codex.test.ts`
Expected: the 2 new tests FAIL (`find` returns undefined → TypeError, and length 0); all pre-existing tests PASS.

- [ ] **Step 3: Implement collection + emission**

In `src/core/adapters/codex.ts`:

(a) Helper after `callOutputText`:

```ts
// A rollout `reasoning` item's readable text lives only in `summary`
// ({ type: "summary_text", text } blocks); `content` is null and
// `encrypted_content` cannot be decoded, so encrypted-only items yield nothing.
function reasoningSummaryText(summary: unknown): string | undefined {
  if (!Array.isArray(summary)) return undefined;
  const texts = summary
    .map((b) => (b && typeof b === "object" ? (b as { text?: unknown }).text : undefined))
    .filter((x): x is string => typeof x === "string");
  const joined = texts.join("\n\n").trim();
  return joined || undefined;
}
```

(b) In `rolloutToLooseSpans`, next to the `messages` declaration:

```ts
  const reasonings: Array<{ text: string; ts: number }> = [];
```

(c) In the `response_item` `if/else if` chain, after the `message`/assistant branch:

```ts
      } else if (p.type === "reasoning") {
        const text = reasoningSummaryText(p.summary);
        if (text !== undefined) reasonings.push({ text, ts });
      }
```

(d) After the `messages.forEach(...)` emission block, before `spans.sort(...)`:

```ts
  reasonings.forEach((r, k) => {
    spans.push({
      ts: r.ts,
      span: {
        span_id: `codex-think-${k}`,
        parent_span_id: rootId,
        name: "reasoning",
        status_code: "OK",
        start_time: r.ts,
        end_time: r.ts,
        attributes: {
          "openinference.span.kind": "LLM",
          "output.value": r.text,
        },
      },
    });
  });
```

The exec (`--json`) adapter already maps `reasoning` items — do not touch it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/adapters/codex.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/adapters/codex.ts src/core/adapters/codex.test.ts
git commit -m "feat(core): surface Codex rollout reasoning summaries as spans"
```

---

### Task 3: Verification gate + browser check

**Files:**
- Create (scratchpad, not committed): `<scratchpad>/make-share.mjs`

- [ ] **Step 1: Full gate**

Run: `npm run typecheck` then `npm test` then `npm run build`
Expected: all green, zero failures. (`npm run build` includes `tsc --noEmit`.)

- [ ] **Step 2: Build a share link containing a thinking block**

Write `<scratchpad>/make-share.mjs` (gzip+base64url matches `decodeShare`'s format):

```js
import { gzipSync } from "node:zlib";

const trace = [
  { type: "user", timestamp: "2026-07-15T09:00:00.000Z", sessionId: "demo", message: { role: "user", content: "Why is the build slow?" } },
  { type: "assistant", timestamp: "2026-07-15T09:00:01.000Z", message: { role: "assistant", model: "claude-sonnet-5", usage: { input_tokens: 12, output_tokens: 40 }, content: [
    { type: "thinking", thinking: "The user asks about build speed. Likely a cold cache; check the config before answering.", signature: "sig" },
    { type: "text", text: "Let me check your build config." },
  ] } },
];
const payload = JSON.stringify({ name: "thinking-demo.jsonl", source: JSON.stringify(trace) });
const b64 = gzipSync(Buffer.from(payload)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log(`#t=${b64}`);
```

Run: `node <scratchpad>/make-share.mjs` → copy the printed `#t=...` fragment.

- [ ] **Step 3: Verify in the browser preview**

1. Start the dev server via the preview tools (`.claude/launch.json` name `dev` → `npm run dev`, port 5173; create the launch entry if missing).
2. Navigate to `http://localhost:5173/#t=<fragment from step 2>`.
3. `read_page`: the tree contains a **thinking** row (LLM badge) above the assistant row.
4. Click the thinking row: the detail panel shows the full thinking text.
5. Search (`⌘K`) for `cold cache`: the thinking span matches.
6. Screenshot as proof.

- [ ] **Step 4: Spot-check a real local log**

Optional but preferred when a non-empty-thinking transcript exists locally: find one via
`grep -l '"thinking":"[^"]' ~/.claude/projects/*/*.jsonl | head -1`, open the app's folder picker manually is NOT automatable — instead reuse the Step-2 script pattern: read the first ~200 lines of that real file into `source` and load it via a share link. Verify real thinking rows render.

---

### Task 4: README

**Files:**
- Modify: `README.md` ("What it does" section, after the "Call tree with an inline waterfall" bullet)

- [ ] **Step 1: Add the feature bullet**

Insert after the call-tree bullet:

```markdown
- **Model thinking, surfaced** — Claude Code `thinking` blocks and Codex `reasoning` summaries show up as their own rows in the tree, right where they happened; click one to read the model's recorded thought process in full. They're searchable and annotatable like any other span — rate the *thinking*, not just the answer, when building eval sets. (This shows the thinking text your logs already record; encrypted thinking is marked as such, and it's not a window into model internals.)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README covers thinking/reasoning span display"
```

---

## Self-review notes

- Spec §4 both adapters → Tasks 1–2; §5 "comes for free" → Task 3 steps 3.3–3.5; §7 tests → Tasks 1–2 step 1 + Task 3 gate; §8 README → Task 4. No gaps.
- Names/ids consistent: `thinking` / `reasoning` span names, `cc-think-*` / `codex-think-*` ids, kind `LLM` throughout.
- Ordering assertions rely on stable `Array.prototype.sort` (ES2019+), same as existing adapter behavior.
