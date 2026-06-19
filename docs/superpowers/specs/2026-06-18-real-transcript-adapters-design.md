# Real CLI-Agent Transcript Adapters — Codex rollout + Claude Code — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending spec review
**Sub-project:** 6 of N in the v1 effort. Makes the Codex and Claude adapters work on the formats users **actually have on disk** — Codex session *rollout* files and Claude Code *transcripts* — both confirmed by inspecting real files on this machine. The earlier `exec --json` and Anthropic-Messages-log mappers were built to other (also-real but less common) shapes; this extends each vendor adapter to also read its saved-transcript format.

## 1. Goal

Drag a real Codex session file (`~/.codex/sessions/.../rollout-*.jsonl`) or a real Claude Code transcript (`~/.claude/projects/.../*.jsonl`) into Tracelens and see the session as a trace **with real timings** (both formats carry per-event timestamps): a session root, one tool span per action (command / Read / Edit / Bash …) with real duration and pass/fail, and the assistant's messages.

## 2. Confirmed real formats

**Codex rollout** — JSONL, each line `{ timestamp, type, payload }`:
- `session_meta` → `payload.{id, cwd}`
- `turn_context` → `payload.model` (e.g. `gpt-5.5`)
- `response_item` / `payload.type="function_call"` → `{ name, arguments (JSON string: {command,...}), call_id }`
- `response_item` / `payload.type="function_call_output"` → `{ call_id, output }` (e.g. `"Exit code: 0\nWall time...\nOutput:..."`)
- `response_item` / `payload.type="message"`, `payload.role="assistant"` → `payload.content[].text`
- `response_item` / `payload.type="reasoning"` → encrypted, skipped
- `event_msg` / `payload.type="token_count"` → `payload.info.total_token_usage.{input_tokens, output_tokens}` (cumulative; use the last)

**Claude Code transcript** — JSONL, each line `{ type, message:{role, content, model, usage}, timestamp, uuid, parentUuid, sessionId }`:
- `assistant` message, content block `text` → `{ text }` (+ `message.model`, `message.usage.{input_tokens, output_tokens}`)
- `assistant` message, content block `tool_use` → `{ id, name, input }`
- `user` message, content block `tool_result` → `{ tool_use_id, content, is_error }`
- `user` message, plain text → the prompt

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Where the code lives | Extend the existing **`codex.ts`** (add rollout) and **`anthropic.ts`** (add Claude Code); registry unchanged |
| Detection | Each adapter's `detect` matches either of its two shapes; `toLooseSpans` dispatches |
| Timing | **Real** — pair tool call→result by id and use their timestamps for duration |
| What becomes a span | Tool calls (the actions) + assistant text messages; skip encrypted reasoning and boilerplate (env/permissions) |
| Raw stash | Keep the raw item/payload in attributes so unmapped fields still show |
| Samples / UI | Inline synthetic fixtures in tests; **no new Loader buttons** (5 is enough). Real-file validation happens in the verification task. |

## 4. Codex rollout → spans (in `codex.ts`)

- **Detect (rollout):** array, some element with `type` in `{session_meta, turn_context, response_item, event_msg}`. (Existing `exec --json` detect — `type` prefixed `item.`/`turn.`/`thread.` — stays; `toLooseSpans` picks the rollout mapper when rollout markers are present.)
- **Root span:** `span_id` = session id (`session_meta.payload.id`) or `"codex-session"`; `name="codex.session"`; attributes `openinference.span.kind="AGENT"`, `gen_ai.request.model` = `turn_context.payload.model`, `gen_ai.usage.input_tokens`/`output_tokens` = last `token_count` totals; `start_time` = first event timestamp, `end_time` = last.
- **Pair** `function_call` with its `function_call_output` by `call_id` (map of call_id → {output, timestamp}).
- **Tool span** per `function_call`: `span_id` = `call_id`; parent = root; `name` = `payload.name`; `input.value` = `JSON.parse(arguments).command ?? arguments`; `output.value` = paired output; `start_time` = call timestamp, `end_time` = output timestamp (real duration); `status` = ERROR if the output's `Exit code: N` is non-zero; attributes also stash the raw payload under `codex.item`; `openinference.span.kind="TOOL"`.
- **LLM span** per assistant `message`: `name="assistant"`, `output.value` = joined text, `start_time=end_time` = timestamp, `openinference.span.kind="LLM"`.
- Order spans by timestamp.

## 5. Claude Code transcript → spans (in `anthropic.ts`)

- **Detect (Claude Code):** array, some element whose `message` is an object with a `role` and whose top-level `type` is `"user"`/`"assistant"`. (Existing Messages-log detect stays; dispatch picks the Claude Code mapper when these markers are present.)
- **Root span:** `span_id` = `sessionId` or first `uuid` or `"claude-code-session"`; `name="claude-code.session"`; `openinference.span.kind="AGENT"`; `gen_ai.request.model` = first assistant `message.model`; `input.value` = first user text prompt; `start_time`/`end_time` = first/last timestamps.
- **Pair** every `tool_use` (assistant) with its `tool_result` (user, matched by `id`/`tool_use_id`) → output + `is_error` + result timestamp.
- For each assistant line, per content block:
  - `text` → **LLM span**: `name="assistant"`, `output.value`=text, `gen_ai.usage.*` from `message.usage`, `gen_ai.request.model` from `message.model`, `start_time=end_time`=line timestamp, kind `LLM`.
  - `tool_use` → **TOOL span**: `span_id`=block.id, parent=root, `name`=block.name (Read/Edit/Bash/…), `input.value`=`JSON.stringify(block.input)`, `output.value`=paired tool_result content, `start_time`=line timestamp, `end_time`=tool_result timestamp (real duration), `status`=ERROR if `is_error`, stash raw block under `claude.item`, kind `TOOL`.
- Skip standalone `user` tool_result lines (consumed via pairing) and the boilerplate; order by timestamp.

## 6. Architecture & data flow

- `codex.ts` and `anthropic.ts` each grow a second internal mapper + a branching `detect`/`toLooseSpans`. (If a file grows unwieldy, the rollout/Claude-Code mapper can move to its own module later; for now one cohesive file per vendor.)
- Everything downstream is unchanged: `parseTraceText` → `decodeTraceText` (JSONL already supported) → `extractSpansAuto` → adapter → `normalizeSpan` → tree. The canonical model and `normalizeSpan` are untouched.

## 7. Error handling / edge cases

- A `function_call` with no matching output → tool span with no output, `end_time` = `start_time`.
- A `tool_use` with no matching result → same.
- Missing `session_meta`/`turn_context` → root falls back to defaults (id `codex-session`, no model).
- Mixed/partial files → unknown lines are ignored; if zero spans result, the existing friendly "Spans were found but none had a span id" / "No spans found" error fires.
- Encrypted reasoning and boilerplate developer/environment messages are intentionally not turned into spans.
- The Messages-API-log and `exec --json` mappers keep working unchanged (dispatch only switches when the saved-transcript markers are present).

## 8. Testing

- `codex.test.ts` (extend): a synthetic **rollout** event array (session_meta + turn_context + a function_call/output pair that succeeds, one that fails with `Exit code: 1`, an assistant message, a token_count) → `detect` true; the tool span pairs output + has a real duration (`end > start`); the failed command is flagged; the root carries the model + token totals; the existing `exec --json` test still passes.
- `anthropic.test.ts` (extend): a synthetic **Claude Code** transcript array (a user prompt, an assistant text with usage+model, an assistant tool_use, a user tool_result with `is_error:true`) → `detect` true; the tool span pairs the result + flags the error + has a real duration; an assistant text span maps model/tokens; the existing Messages-log test still passes.
- All prior tests stay green. Final gate: `typecheck` + `test` + `build`.
- **Real-file verification (the "真实可用" proof):** in the verification task, run the adapter against the user's actual files — a `~/.codex/sessions/.../rollout-*.jsonl` (native_edge_bridge) and a `~/.claude/projects/.../*.jsonl` — via a throwaway Node script (or by loading in the dev server) and confirm it produces a sensible tree (root + tool/LLM spans, real durations, errors). No real-file content is committed.

## 9. Execution order (incremental, green at every step)

1. `codex.ts`: add rollout `detect` branch + `rolloutToLooseSpans`; extend `codex.test.ts` (TDD). 
2. `anthropic.ts`: add Claude Code `detect` branch + `claudeCodeToLooseSpans`; extend `anthropic.test.ts` (TDD).
3. Verification gate + real-file checks against the user's `.codex` and `.claude` files.

## 10. Risks & mitigations

- **Format variance across Codex/Claude versions** — lenient field access (`??`), raw-payload stash so nothing is lost, and detection by stable markers.
- **Token double-counting** (Claude per-message `input_tokens` includes resent context) — accepted; it reflects what the transcript records and only affects the roll-up total.
- **Large real files** — parsing is linear; the dev server reads the file once. (The biggest session on disk is ~180 MB; if performance is poor on giant files, that's a later optimization, out of scope here.)
- **Privacy** — only synthetic fixtures are committed; real files are read locally for verification only.
