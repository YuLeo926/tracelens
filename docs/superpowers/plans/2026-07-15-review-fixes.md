# Review Findings Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct token and cost metrics, preserve thinking/reasoning fidelity and ordering, remove the folder-count cap, and run tests in deployment CI.

**Architecture:** Keep vendor parsing in the existing adapters and folder statistics module. Response-level Claude usage is assigned exactly once, adapter roots publish an explicit `tracelens.llm.calls` roll-up, pricing uses ordered exact-family rules plus the conversation timestamp, and cache creation retains the one-hour subset needed for billing.

**Tech Stack:** TypeScript, Vitest, React, Vite, GitHub Actions.

## Global Constraints

- Thinking and reasoning spans remain kind `LLM` and keep their full recorded text.
- Thinking and reasoning spans never receive token usage directly.
- Existing JSON/JSONL formats remain backward compatible.
- Cost remains labeled and implemented as a rough standard-tier estimate.
- Every production-code behavior change follows a failing Vitest test first.

---

### Task 1: Claude response-level usage and LLM call roll-up

**Files:**
- Modify: `src/core/adapters/anthropic.ts`
- Modify: `src/core/adapters/codex.ts`
- Modify: `src/core/parse.ts`
- Test: `src/core/adapters/anthropic.test.ts`
- Test: `src/core/adapters/codex.test.ts`

**Interfaces:**
- Produces: root attribute `tracelens.llm.calls: number`.
- Consumes: existing `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` normalization.

- [x] Add a Claude regression fixture with two text blocks and a tool-only assistant response; assert one usage charge per response and the exact total `50 in / 13 out`.
- [x] Assert one assistant response containing thinking plus text reports one LLM call, while thinking remains kind `llm` and has no token fields.
- [x] Run `npx vitest run src/core/adapters/anthropic.test.ts` and confirm the new assertions fail with duplicated/missing usage and inflated calls.
- [x] Assign usage only to the first text block; accumulate usage for responses without text on the session root; add the explicit assistant-response count to the root.
- [x] Make `summarize` prefer summed numeric `tracelens.llm.calls` attributes over counting every LLM-kind span.
- [x] Add the Codex rollout root count so newly emitted reasoning spans do not change the prior assistant-message count.
- [x] Run the two adapter test files and confirm all assertions pass.

### Task 2: Codex reasoning fidelity and stable ordering

**Files:**
- Modify: `src/core/adapters/codex.ts`
- Test: `src/core/adapters/codex.test.ts`

**Interfaces:**
- Produces: source-order metadata used only as a stable timestamp tie-breaker.

- [x] Add tests proving `"  indented thought  "` is preserved, non-`summary_text` blocks are ignored, and equal-timestamp `reasoning -> function_call -> assistant` order is retained.
- [x] Run `npx vitest run src/core/adapters/codex.test.ts` and confirm all three assertions fail for the reviewed reasons.
- [x] Filter summary entries by `type === "summary_text"`, use `trim()` only for the emptiness check, and retain each source event index.
- [x] Sort emitted spans by timestamp and then source index.
- [x] Re-run the Codex adapter tests and confirm they pass.

### Task 3: Current model pricing and cache TTL billing

**Files:**
- Modify: `src/core/folderStats.ts`
- Modify: `src/hooks/useConversations.ts`
- Test: `src/core/folderStats.test.ts`

**Interfaces:**
- Extends `ConvStat` and token extraction with `cacheWrite1hIn?: number`.
- Extends `estimateCostUsd` with optional `cacheWrite1hIn` and `atMs` arguments after the existing parameters.

- [x] Add official-rate tests for `gpt-5.6-sol/terra/luna`, `gpt-5.4-pro`, Claude Fable/Mythos, legacy Opus/Haiku, and Sonnet 5 before/after `2026-09-01T00:00:00Z`.
- [x] Add extraction and pricing tests for `usage.cache_creation.ephemeral_1h_input_tokens`; assert one million Sonnet 4.6 one-hour cache-write tokens cost `$6`.
- [x] Run `npx vitest run src/core/folderStats.test.ts` and confirm the new cases fail against the old table and aggregate-only cache shape.
- [x] Add ordered specific price rules, date-aware Sonnet 5 resolution, and separate 5-minute/1-hour write rates.
- [x] Preserve aggregate `cacheWriteIn`, store its one-hour subset, and pass the conversation date through dashboard aggregation.
- [x] Re-run folder statistics tests and confirm they pass.

### Task 4: Complete folder scans and deployment tests

**Files:**
- Modify: `src/lib/folderWatch.ts`
- Create: `src/lib/folderWatch.test.ts`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- `scanTraceFiles(dir)` returns every extension-matching file in newest-first order.

- [x] Add a fake directory-handle test with 301 JSONL files and assert all 301 are returned in newest-first order.
- [x] Run `npx vitest run src/lib/folderWatch.test.ts` and confirm it fails at the old length of 300.
- [x] Remove the default scan limit and retain deterministic sorting.
- [x] Re-run the folder-watch test and confirm it passes.
- [x] Verify `deploy.yml` currently lacks an `npm test` step, then add it between `npm ci` and `npm run build`.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, `npm audit`, and `git diff --check`.
