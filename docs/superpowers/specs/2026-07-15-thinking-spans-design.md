# Thinking / Reasoning Spans — Design

**Date:** 2026-07-15
**Status:** Approved (design), pending spec review
**Sub-project:** Surface the model's recorded thinking. Claude Code transcripts store `thinking` blocks and Codex rollouts store `reasoning` summaries; both are currently skipped by the adapters. Emit them as first-class spans so the tree, detail panel, search, annotations, and live tail all pick them up for free.

## 1. Goal

When a Claude Code or Codex session log contains recorded thinking, show each piece as its own row in the call tree — named `thinking` (Claude Code) or `reasoning` (Codex), kind **LLM** — positioned where it happened, with the full text in the detail panel. No new UI: the existing span pipeline provides rendering, search, 👍/👎 annotation (thinking quality → eval datasets), and live-tail updates automatically. Adapter-only change, 100% client-side.

## 2. Real-data findings (drive the edge cases)

Verified against local `~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl`:

| Finding | Consequence |
|---|---|
| Claude Code thinking block = `{ type: "thinking", thinking: string, signature: string }` | Extract `thinking`; ignore `signature` |
| **731 of 755** thinking blocks sampled were empty strings | **Skip blocks whose text trims to empty** — otherwise the tree floods with blank rows |
| Claude API also defines `{ type: "redacted_thinking", data: base64 }` (none found locally, but documented) | Emit a `thinking` span with placeholder output `[Encrypted thinking — content not available]` so the user knows thinking happened |
| Codex reasoning item = `payload { type: "reasoning", summary: [{ type: "summary_text", text }], content: null, encrypted_content: "..." }` | Readable text lives **only in `summary`**; `content` is null and `encrypted_content` is undecodable — join summary texts, skip the rest |
| Codex reasoning with an empty `summary` exists (encrypted-only) | Skip it (no placeholder — unlike Claude's explicit redaction marker, an empty summary is routine noise) |

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Representation | One span per thinking block / reasoning item; sibling of the assistant/tool spans, parent = session root (same as today's flat layout) |
| Span kind | `LLM` (matches the Codex exec adapter, which already maps `reasoning` → LLM) |
| Span names | `thinking` (Claude Code), `reasoning` (Codex rollout) — mirrors each product's own vocabulary |
| Text placement | `output.value` = the thinking text (detail panel + search + annotation snapshot all read it) |
| Empty text | Skipped entirely (see real-data findings) |
| `redacted_thinking` | Placeholder span: `[Encrypted thinking — content not available]` |
| Codex `summary` with >1 block | Texts joined with `\n\n` |
| Ordering | Spans keep block order within a message (thinking naturally precedes the same message's text/tool_use); overall sort by timestamp unchanged |
| Usage/tokens | Not attached to thinking spans (stays on the assistant text span, as today) |
| Out of scope | Anthropic Messages **API log** format (one span per request; thinking blocks there stay ignored); Codex `encrypted_content` decoding (impossible); any hide/show toggle (YAGNI) |

## 4. Adapter changes

### `src/core/adapters/anthropic.ts` — `claudeCodeToLooseSpans`

In the assistant-message block loop, two new branches:

```ts
} else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
  // span: name "thinking", kind LLM, output.value = b.thinking, model attr as for text
} else if (b.type === "redacted_thinking") {
  // span: name "thinking", kind LLM,
  // output.value = "[Encrypted thinking — content not available]"
}
```

- `ClaudeBlock` gains `thinking?: string`.
- `span_id`: `cc-think-${spans.length}` (unique, consistent with the `cc-msg-` scheme).
- Same `ts`/model/status handling as the text branch; no usage attrs.

### `src/core/adapters/codex.ts` — `rolloutToLooseSpans`

- New branch: `p.type === "reasoning"` → collect `{ text, ts }` where `text` = join of `summary[].text` (string entries of `summary_text` blocks) with `\n\n`; push only if non-empty after trim.
- Emit like `messages`: span name `reasoning`, kind `LLM`, `output.value` = text, `span_id` = `codex-think-${k}`.
- The exec (`--json`) adapter already handles reasoning items — untouched.

No detection changes (both formats are already detected line-shapes).

## 5. What comes for free (verify, don't build)

- **Tree + detail:** thinking rows render with the LLM badge; click → full text.
- **Search:** `search.ts` matches on output values → thinking text is searchable.
- **Annotations:** 👍/👎 + tag + note on a thinking span; snapshot captures the text; exports include it.
- **Live tail:** re-parse on file growth picks up new thinking blocks as they're written.
- **Flamegraph/diff:** zero-duration LLM spans, same as assistant text today.

## 6. Error handling / edge cases

- `thinking` field missing or non-string → block ignored (type guard).
- Whitespace-only thinking → skipped.
- Codex `summary` not an array / entries without string `text` → treated as empty → skipped.
- Sessions without any thinking (thinking disabled) → zero new spans, output identical to today.
- Huge thinking texts: same handling as any large output (detail panel scrolls; annotation snapshot already caps at 8000 chars).

## 7. Testing

- **`anthropic.test.ts`:** assistant message with `[thinking, text, tool_use]` → emits a `thinking` span (kind LLM, correct output) **before** the text span; empty-string thinking emits nothing; `redacted_thinking` emits the placeholder span; a no-thinking transcript's span list is unchanged.
- **`codex.test.ts`:** rollout `reasoning` with two summary blocks → one `reasoning` span with joined text; `reasoning` with `summary: []` + `encrypted_content` → no span; ordering interleaves with function calls by timestamp.
- **Gate:** `typecheck && test && build` green; all existing tests stay green.
- **Manual:** load a real local Claude Code transcript with thinking + a real Codex rollout; verify rows, detail text, search hit, and an annotation on a thinking span.

## 8. Execution order (incremental, green at every step)

1. `anthropic.ts` thinking + redacted_thinking branches (TDD).
2. `codex.ts` rollout reasoning branch (TDD).
3. Verification gate + manual check with real local logs.
4. README: document thinking/reasoning display (positioning: "see what the model was thinking — from your own session logs").

## 9. Risks & mitigations

- **Tree noise in thinking-heavy sessions** — real data says non-empty blocks are rare (24/755); if a future model changes that, a hide-toggle is a cheap follow-up.
- **Format drift** (Claude Code or Codex renames fields) — type-guarded branches degrade to "no thinking spans", never a crash; adapters already follow this pattern.
- **User expectation vs. J-space** — README wording stays honest: this shows the *recorded* thinking text from logs, not model internals.
