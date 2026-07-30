# TraceLens Doctor Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npx tracelens doctor`, which discovers the latest local Codex or Claude Code run and opens a deterministic, diagnosis-first local report whose findings link into the existing trace debugger.

**Architecture:** Keep one npm package. A dependency-free diagnosis layer under `src/core/diagnostics` analyzes the existing `ParsedTrace`; a small Node CLI discovers local sessions, computes baselines, and serves the packaged Vite app plus token-protected run data on `127.0.0.1`; React renders the report and routes findings into the existing tree as evidence.

**Tech Stack:** TypeScript 5.6, React 18, Vite 6, Vitest 4, Node.js 20+, Node built-in `fs`, `http`, `crypto`, and `child_process`, plus `tsup` as a development-only CLI bundler.

## Global Constraints

- Node.js runtime floor: `>=20`.
- The CLI server binds only to `127.0.0.1` and uses a random 256-bit bearer token.
- Trace responses use `Cache-Control: no-store`; do not add permissive CORS headers.
- No model API, backend, account, telemetry, or external request after package installation.
- Diagnosis is deterministic and local; every finding contains valid evidence span IDs.
- Baseline rules require at least five comparable completed runs and inspect at most ten previous runs.
- Active runs never receive a missing-completion diagnosis.
- `Copy report` excludes prompts, outputs, raw attributes, absolute paths, and authenticated URLs.
- Keep the existing static import, folder, live-watch, tree, flamegraph, diff, annotation, and GitHub Pages flows working.
- Use TDD for each behavior and commit after every task.

---

## File Structure

**New shared diagnosis files**

- `src/core/diagnostics/types.ts`: public diagnosis contracts.
- `src/core/diagnostics/traceFacts.ts`: deterministic trace flattening and operation normalization.
- `src/core/diagnostics/failureRules.ts`: terminal, repeated-failure, explicit-error, and incomplete rules.
- `src/core/diagnostics/behaviorRules.ts`: retry-loop, retry-storm, hotspot, and empty-result rules.
- `src/core/diagnostics/baseline.ts`: median and historical threshold rules.
- `src/core/diagnostics/analyze.ts`: orchestration, sorting, grouping, totals, and status.
- `src/core/diagnostics/reportText.ts`: privacy-safe copied report text.
- `src/core/diagnostics/index.ts`: stable exports for CLI and browser consumers.
- `src/core/diagnostics/testFixtures.ts`: shared deterministic trace fixtures for diagnosis tests.
- `src/core/doctorProtocol.ts`: browser/CLI wire contracts with no Node dependencies.

**New Doctor UI files**

- `src/components/doctor/DoctorView.tsx`: diagnosis-first page and actions.
- `src/components/doctor/FindingList.tsx`: severity-ordered findings and evidence navigation.
- `src/components/doctor/RunTotals.tsx`: compact run metrics.
- `src/components/doctor/RunPicker.tsx`: recent discovered runs supplied by the CLI server.
- `src/components/doctor/EvidenceBar.tsx`: back and multi-evidence navigation while inspecting a finding.
- `src/core/doctorTransport.ts`: browser-side token parsing and local API client.
- `src/core/evidence.ts`: ancestor/evidence navigation helpers.

**New CLI files**

- `cli/types.ts`: internal run candidate and repository contracts.
- `cli/discovery.ts`: standard path scanning, provider sniffing, and latest selection.
- `cli/baseline.ts`: lightweight head/tail extraction for comparable runs.
- `cli/repository.ts`: opaque IDs, active snapshot checks, parsing, diagnosis, and lazy run loading.
- `cli/server.ts`: authenticated loopback static/API server and idle lifecycle.
- `cli/openBrowser.ts`: cross-platform browser launch.
- `cli/selectRun.ts`: dependency-free terminal selection for `--list`.
- `cli/args.ts`: command-line parsing and help text.
- `cli/index.ts`: executable orchestration and shutdown.
- `cli/testFixtures.ts`: temporary-home and run-file builders used only by CLI tests.

**Modified integration and packaging files**

- `src/core/adapters/types.ts`, `src/core/adapters/index.ts`, `src/core/adapters/codex.ts`, `src/core/adapters/anthropic.ts`: optional lifecycle inspection.
- `src/App.tsx`, `src/lib/views.ts`, `src/components/shell/Rail.tsx`, `src/components/shell/AppShell.tsx`, `src/components/views/TreeView/TreeView.tsx`: Doctor state, view, and evidence routing.
- `src/components/Loader.tsx`: diagnosis-first wording and hierarchy.
- `package.json`, `package-lock.json`, `tsconfig.cli.json`, `tsup.config.ts`, `vitest.config.ts`: publishable CLI build and tests.
- `scripts/package-smoke.mjs`: packed-tarball binary verification.
- `README.md`, `.github/workflows/deploy.yml`: user workflow and release gates.

---

### Task 1: Diagnosis Contracts and Trace Facts

**Files:**
- Create: `src/core/diagnostics/types.ts`
- Create: `src/core/diagnostics/traceFacts.ts`
- Create: `src/core/diagnostics/traceFacts.test.ts`
- Create: `src/core/diagnostics/testFixtures.ts`
- Create: `src/core/diagnostics/index.ts`

**Interfaces:**
- Consumes: `ParsedTrace` and `RunNode` from `src/core/types.ts`.
- Produces: `DiagnosisContext`, `DiagnosisReport`, `Finding`, `BaselineSample`, `TraceFacts`, `buildTraceFacts(trace)`, and `operationKey(node)`.

- [ ] **Step 1: Write failing trace-fact tests**

```ts
import { describe, expect, it } from "vitest";
import { parseTrace } from "../parse";
import { buildTraceFacts, operationKey } from "./traceFacts";

describe("diagnostic trace facts", () => {
  it("sorts all nodes and separates tools and errors", () => {
    const trace = parseTrace([
      { span_id: "root", name: "run", start_time: 0, end_time: 30, status_code: "OK", attributes: { "openinference.span.kind": "AGENT" } },
      { span_id: "b", parent_span_id: "root", name: "shell", start_time: 20, end_time: 30, status_code: "ERROR", attributes: { "openinference.span.kind": "TOOL", "input.value": "npm test" } },
      { span_id: "a", parent_span_id: "root", name: "shell", start_time: 10, end_time: 15, status_code: "OK", attributes: { "openinference.span.kind": "TOOL", "input.value": "pwd" } },
    ]);
    const facts = buildTraceFacts(trace);
    expect(facts.ordered.map((node) => node.spanId)).toEqual(["root", "a", "b"]);
    expect(facts.tools.map((node) => node.spanId)).toEqual(["a", "b"]);
    expect(facts.errors.map((node) => node.spanId)).toEqual(["b"]);
  });

  it("canonicalizes structured tool inputs", () => {
    const trace = parseTrace([
      { span_id: "a", name: "shell", start_time: 0, end_time: 1, attributes: { "openinference.span.kind": "TOOL", "input.value": "{\"cwd\":\"/tmp\",\"command\":\"npm   test\"}" } },
      { span_id: "b", name: "shell", start_time: 2, end_time: 3, attributes: { "openinference.span.kind": "TOOL", "input.value": "{\"command\":\"npm test\",\"cwd\":\"/tmp\"}" } },
    ]);
    expect(operationKey(trace.byId.get("a")!)).toBe(operationKey(trace.byId.get("b")!));
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- src/core/diagnostics/traceFacts.test.ts`

Expected: FAIL because `traceFacts.ts` does not exist.

- [ ] **Step 3: Add exact public contracts**

```ts
export type DiagnosisStatus = "needs-attention" | "no-obvious-issue" | "incomplete" | "active";
export type FindingSeverity = "error" | "warning" | "info";
export type FindingConfidence = "high" | "medium";

export interface Finding {
  ruleId: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  title: string;
  explanation: string;
  evidenceSpanIds: string[];
}

export interface BaselineSample {
  runId: string;
  project?: string;
  durationMs: number;
  totalTokens: number;
  toolCalls: number;
  completed: boolean;
}

export interface DiagnosisContext {
  active: boolean;
  malformedTail: boolean;
  baseline: BaselineSample[];
}

export interface DiagnosisReport {
  version: 1;
  status: DiagnosisStatus;
  findings: Finding[];
  totals: {
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd?: number;
    toolCalls: number;
    errors: number;
  };
}
```

In `testFixtures.ts`, define and export the helpers used by later diagnosis tests: `tool(id, order, status, input, output?)`, `answer(id, order, output?)`, `factsFrom(nodes)`, `context(overrides?)`, `tokenFacts(tokenCounts)`, `traceWithTokens(totalTokens)`, `sample(totalTokens)`, and `reportWithTerminalFailure()`. Each helper must build real native spans and call `parseTrace`/`buildTraceFacts`; no test may construct a partial `ParsedTrace` by type assertion.

- [ ] **Step 4: Implement stable operation normalization and fact extraction**

`operationKey` must combine `node.name` with a stable representation of `node.input`. Recursively sort object keys, preserve array order, and collapse whitespace in string values. Do not use fuzzy similarity.

```ts
export interface TraceFacts {
  trace: ParsedTrace;
  ordered: RunNode[];
  tools: RunNode[];
  errors: RunNode[];
  operationKeys: Map<string, string>;
}

export function buildTraceFacts(trace: ParsedTrace): TraceFacts {
  const ordered = [...trace.byId.values()].sort((a, b) => a.startMs - b.startMs || a.spanId.localeCompare(b.spanId));
  const tools = ordered.filter((node) => node.kind === "tool");
  return {
    trace,
    ordered,
    tools,
    errors: ordered.filter((node) => node.status === "error"),
    operationKeys: new Map(tools.map((node) => [node.spanId, operationKey(node)])),
  };
}
```

- [ ] **Step 5: Export the contracts and rerun the test**

Run: `npm test -- src/core/diagnostics/traceFacts.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/core/diagnostics
git commit -m "feat: add diagnostic trace facts"
```

---

### Task 2: High-Confidence Failure Rules and Lifecycle Inspection

**Files:**
- Create: `src/core/diagnostics/failureRules.ts`
- Create: `src/core/diagnostics/failureRules.test.ts`
- Modify: `src/core/adapters/types.ts`
- Modify: `src/core/adapters/index.ts`
- Modify: `src/core/adapters/codex.ts`
- Modify: `src/core/adapters/anthropic.ts`
- Test: `src/core/adapters/codex.test.ts`
- Test: `src/core/adapters/anthropic.test.ts`

**Interfaces:**
- Consumes: `TraceFacts`, `DiagnosisContext`, and `Finding` from Task 1.
- Produces: `TraceLifecycle`, `inspectTraceLifecycle(json)`, and `runFailureRules(facts, context)`.

- [ ] **Step 1: Write negative-first failure rule tests**

Cover all of these cases in `failureRules.test.ts`:

```ts
it("does not flag a recovered probe failure", () => {
  const facts = factsFrom([
    tool("probe", 1, "error", "rg missing"),
    tool("fallback", 2, "ok", "Get-ChildItem"),
    answer("done", 3),
  ]);
  expect(runFailureRules(facts, context()).map((finding) => finding.ruleId)).not.toContain("terminal-failure");
});

it("flags a final failed tool with no recovery", () => {
  const facts = factsFrom([tool("test", 1, "error", "npm test")]);
  expect(runFailureRules(facts, context())).toContainEqual(expect.objectContaining({
    ruleId: "terminal-failure",
    severity: "error",
    confidence: "high",
    evidenceSpanIds: ["test"],
  }));
});

it("groups three identical failures", () => {
  const facts = factsFrom([
    tool("a", 1, "error", "npm test"),
    tool("b", 2, "error", "npm test"),
    tool("c", 3, "error", "npm test"),
  ]);
  const finding = runFailureRules(facts, context()).find((item) => item.ruleId === "repeated-identical-failure");
  expect(finding?.evidenceSpanIds).toEqual(["a", "c"]);
});
```

- [ ] **Step 2: Run failure tests and verify failure**

Run: `npm test -- src/core/diagnostics/failureRules.test.ts`

Expected: FAIL because the rule module does not exist.

- [ ] **Step 3: Add optional adapter lifecycle inspection**

Add this contract without changing existing adapter conversion behavior:

```ts
export type TraceLifecycle = "active" | "complete" | "failed" | "unknown";

export interface TraceAdapter {
  id: string;
  label: string;
  detect(json: unknown): boolean;
  toLooseSpans(json: unknown): LooseSpan[];
  inspectLifecycle?(json: unknown): TraceLifecycle;
}
```

`inspectTraceLifecycle(json)` must return the first matching adapter's lifecycle or `unknown`. For Codex exec events, a trailing `turn.started` without `turn.completed`/`turn.failed` is `active`, `turn.completed` is `complete`, and `turn.failed` is `failed`. For Claude messages, a final assistant message with a non-empty `stop_reason` is `complete`; otherwise return `unknown`. Saved Codex rollout files without a reliable terminal marker remain `unknown`.

- [ ] **Step 4: Implement failure rules**

Export one orchestrator:

```ts
export function runFailureRules(facts: TraceFacts, context: DiagnosisContext): Finding[] {
  return [
    ...terminalFailure(facts),
    ...repeatedIdenticalFailure(facts),
    ...explicitAgentError(facts),
    ...incompleteTrace(facts, context),
  ];
}
```

The terminal rule examines only meaningful nodes after the last failed tool: a later successful tool or an agent/LLM node with non-empty output counts as recovery. `context.active` suppresses incomplete findings. `context.malformedTail && !context.active` produces one high-confidence `malformed-trace` finding with the root span as evidence.

- [ ] **Step 5: Run focused adapter and failure tests**

Run: `npm test -- src/core/diagnostics/failureRules.test.ts src/core/adapters/codex.test.ts src/core/adapters/anthropic.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/core/adapters src/core/diagnostics/failureRules.ts src/core/diagnostics/failureRules.test.ts
git commit -m "feat: diagnose terminal run failures"
```

---

### Task 3: Behavioral Anomaly Rules

**Files:**
- Create: `src/core/diagnostics/behaviorRules.ts`
- Create: `src/core/diagnostics/behaviorRules.test.ts`
- Modify: `src/core/diagnostics/index.ts`

**Interfaces:**
- Consumes: `TraceFacts` and `Finding` from Tasks 1-2.
- Produces: `runBehaviorRules(facts)`.

- [ ] **Step 1: Write behavior rule tests with explicit thresholds**

```ts
it("flags three repeated empty tool results inside ten tool calls", () => {
  const facts = factsFrom([
    tool("a", 1, "ok", "search x", ""),
    tool("b", 2, "ok", "search x", "No results"),
    tool("c", 3, "ok", "search x", "[]"),
  ]);
  expect(runBehaviorRules(facts)).toContainEqual(expect.objectContaining({
    ruleId: "repeated-empty-result",
    confidence: "medium",
    evidenceSpanIds: ["a", "c"],
  }));
});

it("does not call distinct successful outputs a loop", () => {
  const facts = factsFrom([
    tool("a", 1, "ok", "page next", "page 1"),
    tool("b", 2, "ok", "page next", "page 2"),
    tool("c", 3, "ok", "page next", "page 3"),
  ]);
  expect(runBehaviorRules(facts).some((finding) => finding.ruleId === "possible-retry-loop")).toBe(false);
});

it("identifies a token hotspot at sixty percent", () => {
  const facts = tokenFacts([600, 200, 200]);
  expect(runBehaviorRules(facts)).toContainEqual(expect.objectContaining({ ruleId: "token-hotspot" }));
});
```

Also test 59.9% as a non-match, three same failed operations as `retry-storm`, and a repeated operation separated by more than ten tool calls as a non-match.

- [ ] **Step 2: Run behavior tests and verify failure**

Run: `npm test -- src/core/diagnostics/behaviorRules.test.ts`

Expected: FAIL because `behaviorRules.ts` does not exist.

- [ ] **Step 3: Implement the four behavioral rules**

`runBehaviorRules` returns findings for:

```ts
export const BEHAVIOR_RULE_IDS = [
  "possible-retry-loop",
  "retry-storm",
  "duration-hotspot",
  "token-hotspot",
  "repeated-empty-result",
] as const;
```

Use exact operation keys from Task 1. Treat trimmed empty strings, `[]`, `{}`, `null`, `no results`, and `not found` as empty outputs. A hotspot requires at least 10 seconds total duration or 1,000 total tokens so tiny runs do not receive ratio-only findings. Do not emit both `possible-retry-loop` and `retry-storm` for the same operation; the retry storm wins.

For a possible loop, inspect each ten-tool sliding window. A matching operation needs at least three occurrences, and the set of normalized non-empty outputs must contain at most one value. Three distinct successful outputs therefore cannot trigger the rule.

- [ ] **Step 4: Run behavior tests**

Run: `npm test -- src/core/diagnostics/behaviorRules.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the diagnosis test directory**

Run: `npm test -- src/core/diagnostics`

Expected: all Task 1-3 tests PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/core/diagnostics
git commit -m "feat: diagnose agent retry anomalies"
```

---

### Task 4: Baseline Findings, Report Assembly, and Safe Copy Text

**Files:**
- Create: `src/core/diagnostics/baseline.ts`
- Create: `src/core/diagnostics/baseline.test.ts`
- Create: `src/core/diagnostics/analyze.ts`
- Create: `src/core/diagnostics/analyze.test.ts`
- Create: `src/core/diagnostics/reportText.ts`
- Create: `src/core/diagnostics/reportText.test.ts`
- Create: `src/core/doctorProtocol.ts`
- Modify: `src/core/diagnostics/index.ts`

**Interfaces:**
- Consumes: all contracts and rule functions from Tasks 1-3.
- Produces: `median(values)`, `runBaselineRules(trace, samples)`, `analyzeTrace(trace, context)`, `formatDiagnosisReport(report)`, `DoctorRunSummary`, and `DoctorRunPayload`.

- [ ] **Step 1: Write baseline threshold tests**

```ts
it("requires five comparable completed runs", () => {
  const samples = [sample(10_000), sample(11_000), sample(12_000), sample(13_000)];
  expect(runBaselineRules(traceWithTokens(60_000), samples)).toEqual([]);
});

it("reports a 2.5x token increase above the absolute floor", () => {
  const samples = [10_000, 11_000, 12_000, 13_000, 14_000].map(sample);
  expect(runBaselineRules(traceWithTokens(60_000), samples)).toContainEqual(expect.objectContaining({
    ruleId: "token-baseline-spike",
    severity: "info",
    confidence: "medium",
  }));
});
```

Add equivalent duration and tool-call tests, plus non-matches for the absolute floors.

- [ ] **Step 2: Write report assembly and sanitization tests**

Assert that active status wins over incomplete, incomplete wins over needs-attention, error/warning findings produce needs-attention, no findings produce no-obvious-issue, severity sorting is stable, and copied text omits raw inputs and absolute paths.

```ts
expect(formatDiagnosisReport(report)).toBe([
  "TraceLens Doctor: needs attention",
  "1 finding",
  "",
  "ERROR [high] Run ended after a failed command",
  "npm test exited with code 1 and no recovery followed.",
  "",
  "Duration: 18m 42s | Tokens: 182000 | Tool calls: 47 | Errors: 1",
].join("\n"));
```

- [ ] **Step 3: Run the new tests and verify failure**

Run: `npm test -- src/core/diagnostics/baseline.test.ts src/core/diagnostics/analyze.test.ts src/core/diagnostics/reportText.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement baseline rules and report orchestration**

`analyzeTrace` must be the only public orchestration entry point:

```ts
export function analyzeTrace(trace: ParsedTrace, context: DiagnosisContext): DiagnosisReport {
  const facts = buildTraceFacts(trace);
  const findings = sortAndGroupFindings([
    ...runFailureRules(facts, context),
    ...runBehaviorRules(facts),
    ...runBaselineRules(trace, context.baseline),
  ]);
  return {
    version: 1,
    status: deriveStatus(findings, context),
    findings,
    totals: totalsFrom(trace.summary),
  };
}
```

Use the exact thresholds from the approved specification. Do not derive a separate price anomaly.

- [ ] **Step 5: Implement privacy-safe report formatting**

`formatDiagnosisReport` uses only report fields. It must not accept `ParsedTrace`, `RunNode`, raw source, or a filesystem path; this API boundary prevents accidental content leakage.

Add the shared wire contracts in `doctorProtocol.ts` so browser code never imports from `cli/`:

```ts
export type DoctorProvider = "codex" | "claude";

export interface DoctorRunSummary {
  id: string;
  provider: DoctorProvider;
  title: string;
  project?: string;
  lastModified: number;
  sizeBytes: number;
}

export interface DoctorRunPayload {
  run: DoctorRunSummary;
  source: string;
  report: DiagnosisReport;
  baseline: BaselineSample[];
}
```

- [ ] **Step 6: Run all core diagnosis tests**

Run: `npm test -- src/core/diagnostics`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/core/diagnostics
git commit -m "feat: assemble local diagnosis reports"
```

---

### Task 5: Diagnosis-First React View

**Files:**
- Create: `src/components/doctor/DoctorView.tsx`
- Create: `src/components/doctor/FindingList.tsx`
- Create: `src/components/doctor/RunTotals.tsx`
- Create: `src/components/doctor/DoctorView.test.tsx`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `DiagnosisReport` and `Finding` from Task 1.
- Produces: `DoctorView` with callbacks `onOpenEvidence(spanIds)`, `onInspectTrace()`, `onCopyReport()`, and `onOpenRunPicker()`.

- [ ] **Step 1: Enable TSX tests without adding a DOM dependency**

Change Vitest's include to `['src/**/*.test.{ts,tsx}', 'cli/**/*.test.ts']`. Keep the Node environment; component tests use `react-dom/server`.

- [ ] **Step 2: Write the failing static-render test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DoctorView } from "./DoctorView";

it("renders findings before totals and exposes evidence actions", () => {
  const html = renderToStaticMarkup(
    <DoctorView
      report={reportWithTerminalFailure()}
      copied={false}
      onOpenEvidence={vi.fn()}
      onInspectTrace={vi.fn()}
      onCopyReport={vi.fn()}
      onOpenRunPicker={vi.fn()}
    />,
  );
  expect(html.indexOf("What happened")).toBeLessThan(html.indexOf("Run totals"));
  expect(html).toContain("Open evidence");
  expect(html).toContain("Run ended after a failed command");
  expect(html).toContain("Inspect full trace");
});
```

Add status fixtures for `active`, `incomplete`, `no-obvious-issue`, and singular/plural finding counts.

- [ ] **Step 3: Run the component test and verify failure**

Run: `npm test -- src/components/doctor/DoctorView.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 4: Implement the compact report view**

Use existing CSS tokens and Tailwind utilities. The root must be a full-width, scrollable operational view. Render status, findings, totals, and actions in that order. Findings use buttons, not clickable cards. Severity is communicated by text/icon and border color, never color alone.

```tsx
export interface DoctorViewProps {
  report: DiagnosisReport;
  copied: boolean;
  onOpenEvidence: (spanIds: string[]) => void;
  onInspectTrace: () => void;
  onCopyReport: () => void;
  onOpenRunPicker: () => void;
}
```

- [ ] **Step 5: Run component and type tests**

Run: `npm test -- src/components/doctor/DoctorView.test.tsx`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add vitest.config.ts src/components/doctor
git commit -m "feat: add diagnosis-first report view"
```

---

### Task 6: Doctor View Registration and Evidence Routing

**Files:**
- Create: `src/core/evidence.ts`
- Create: `src/core/evidence.test.ts`
- Create: `src/components/doctor/EvidenceBar.tsx`
- Create: `src/components/doctor/EvidenceBar.test.tsx`
- Modify: `src/lib/views.ts`
- Modify: `src/lib/views.test.ts`
- Modify: `src/components/shell/Rail.tsx`
- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/components/views/TreeView/TreeView.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `DoctorView` from Task 5 and `ParsedTrace.byId`.
- Produces: `doctor` as an optional view, `ancestorIds(byId, spanId)`, and App state transitions from a finding to evidence and back.

- [ ] **Step 1: Write failing evidence helper tests**

```ts
function nestedTrace() {
  return parseTrace([
    { span_id: "root", name: "run", start_time: 0, end_time: 10, attributes: { "openinference.span.kind": "AGENT" } },
    { span_id: "middle", parent_span_id: "root", name: "step", start_time: 1, end_time: 9, attributes: { "openinference.span.kind": "CHAIN" } },
    { span_id: "leaf", parent_span_id: "middle", name: "shell", start_time: 2, end_time: 3, attributes: { "openinference.span.kind": "TOOL" } },
  ]);
}

it("returns ancestors from root to parent", () => {
  const trace = nestedTrace();
  expect(ancestorIds(trace.byId, "leaf")).toEqual(["root", "middle"]);
});

it("returns an empty list for an unknown span", () => {
  expect(ancestorIds(nestedTrace().byId, "missing")).toEqual([]);
});
```

- [ ] **Step 2: Extend view registry tests**

Assert that `VIEWS` still contains the four existing ready views and that `DOCTOR_VIEW` is a separate ready definition. This keeps Doctor hidden when no report is loaded.

Add a static-render test for `EvidenceBar`: one evidence item renders only Back, while three items render `Evidence 2 of 3` plus enabled previous/next buttons.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `npm test -- src/core/evidence.test.ts src/lib/views.test.ts src/components/doctor/EvidenceBar.test.tsx`

Expected: FAIL because `ancestorIds` and `DOCTOR_VIEW` do not exist.

- [ ] **Step 4: Implement optional view plumbing**

Add `doctor` to `ViewId`, export `DOCTOR_VIEW`, and let `Rail` receive `views: ViewDef[]` instead of importing a fixed list. `AppShell` receives `views` and `showSummary`; defaults preserve existing behavior.

`TreeView` receives `revealId?: string | null`. When it changes, remove every ancestor returned by `ancestorIds` from the collapsed set, then scroll the selected row into view.

- [ ] **Step 5: Add App-level Doctor state transitions**

Add `doctorReport`, `doctorEvidenceIds`, and `doctorEvidenceIndex` state. The exact transitions are:

```ts
const openEvidence = (spanIds: string[]) => {
  setDoctorEvidenceIds(spanIds);
  setDoctorEvidenceIndex(0);
  setSelectedId(spanIds[0] ?? null);
  setActiveView("tree");
};

const inspectFullTrace = () => {
  setDoctorEvidenceIds([]);
  setDoctorEvidenceIndex(0);
  setActiveView("tree");
};

const backToDiagnosis = () => {
  setActiveView("doctor");
};
```

Render `DoctorView` across both AppShell columns and hide `SummaryStrip` while `activeView === "doctor"`. Do not add transport fetching yet; Task 9 supplies the report.

When `doctorReport` exists and the active view is not `doctor`, render `EvidenceBar` above the evidence view. It always includes `Back to diagnosis`. When a finding has multiple evidence IDs, it also renders previous/next controls and `Evidence N of M`; changing the index updates `selectedId` without resetting collapsed rows.

- [ ] **Step 6: Run focused tests and the production build**

Run: `npm test -- src/core/evidence.test.ts src/lib/views.test.ts src/components/doctor/EvidenceBar.test.tsx`

Expected: PASS.

Run: `npm run build`

Expected: PASS and existing import/share flows still compile.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/App.tsx src/core/evidence.ts src/core/evidence.test.ts src/lib/views.ts src/lib/views.test.ts src/components/shell src/components/views/TreeView/TreeView.tsx
git commit -m "feat: route diagnosis findings to trace evidence"
```

---

### Task 7: CLI Discovery, Baselines, and Lazy Run Repository

**Files:**
- Create: `cli/types.ts`
- Create: `cli/discovery.ts`
- Create: `cli/discovery.test.ts`
- Create: `cli/baseline.ts`
- Create: `cli/baseline.test.ts`
- Create: `cli/repository.ts`
- Create: `cli/repository.test.ts`
- Create: `cli/testFixtures.ts`
- Create: `tsconfig.cli.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `isTraceFileHead`, `extractConversationMeta`, `extractTokens`, `startMsOf`, `modelOf`, `parseTraceText`, `inspectTraceLifecycle`, and `analyzeTrace`.
- Produces: `RunCandidate`, `discoverRuns(options)`, `resolveExplicitRun(path)`, `buildBaseline(selected, candidates)`, `createDoctorRunRepository(options)`, and `DoctorRunRepository`. `DoctorRunSummary` and `DoctorRunPayload` come from `src/core/doctorProtocol.ts`.

- [ ] **Step 1: Add Node development types and CLI typecheck config**

Run: `npm install --save-dev @types/node tsup`

Create `tsconfig.cli.json` extending the root compiler options, set `types: ["node"]`, `lib: ["ES2022"]`, `noEmit: true`, and include `cli` plus the imported `src/core` modules.

- [ ] **Step 2: Write discovery tests using temporary homes**

```ts
it("finds Codex and Claude JSONL runs newest first", async () => {
  const home = await fixtureHome([
    codexRun(".codex/sessions/2026/07/30/a.jsonl", 100),
    claudeRun(".claude/projects/app/b.jsonl", 200),
    plainJson(".codex/sessions/config.json", 300),
  ]);
  const runs = await discoverRuns({ homeDir: home });
  expect(runs.map((run) => run.provider)).toEqual(["claude", "codex"]);
});

it("does not replace an invalid explicit path with another run", async () => {
  await expect(resolveExplicitRun("missing.jsonl")).rejects.toThrow("Run file not found");
});
```

Also cover empty directories, unsupported JSON, title/project extraction, and path separators.

Create `cli/testFixtures.ts` in the same step. It must export `fixtureHome(entries)`, `codexRun(path, mtime)`, `claudeRun(path, mtime)`, `plainJson(path, mtime)`, and `cleanupFixtureHomes()`. Each builder writes a complete parseable fixture into a tracked temporary directory; every CLI test file registers `afterEach(cleanupFixtureHomes)`.

- [ ] **Step 3: Write baseline and repository tests**

Assert that only the same project is compared, at most ten older runs are read, incomplete samples are marked `completed: false`, opaque IDs do not contain paths, and a file that changes between pre/post stats produces `context.active: true`.

- [ ] **Step 4: Run CLI tests and verify failure**

Run: `npm test -- cli/discovery.test.ts cli/baseline.test.ts cli/repository.test.ts`

Expected: FAIL because the CLI modules do not exist.

- [ ] **Step 5: Implement standard path discovery**

Use `fs.promises.readdir({ withFileTypes: true })` recursively. Read at most 64 KiB from each candidate head for `isTraceFileHead` and metadata. Sort recognized candidates by `lastModified` descending. Do not fully parse every discovered file.

```ts
export interface RunCandidate {
  path: string;
  provider: DoctorProvider;
  title: string;
  project?: string;
  lastModified: number;
  sizeBytes: number;
}
```

- [ ] **Step 6: Implement baseline extraction and repository loading**

Read 64 KiB from the head and 128 KiB from the tail of baseline candidates. Build at most ten `BaselineSample` values for the same project.

If a historical candidate disappears, becomes unreadable, or has unusable metadata, skip that candidate and continue. Record the skipped path only in the CLI's verbose diagnostic output; the browser payload contains no path and simply has fewer baseline samples.

`DoctorRunRepository` assigns `crypto.randomUUID()` IDs, exposes summaries without paths, and diagnoses lazily:

```ts
export interface DoctorRunRepository {
  list(): DoctorRunSummary[];
  load(id?: string): Promise<DoctorRunPayload>;
}

export interface CreateDoctorRunRepositoryOptions {
  candidates: RunCandidate[];
  selected: RunCandidate;
  verbose?: (message: string) => void;
}

export function createDoctorRunRepository(options: CreateDoctorRunRepositoryOptions): DoctorRunRepository;
```

For the selected run, stat before reading and immediately after parsing. If size or mtime changed, set `active: true`; retry the snapshot twice with a 100 ms delay before returning a parse error. Adapter lifecycle `active` also sets active. A lifecycle of `failed` remains a concrete finding, not an active run.

Handle a malformed final JSONL line deterministically. If parsing fails only on the final non-empty line, parse the complete prefix and set `malformedTail: !active`; if any earlier line is malformed, return the concise parse error. This makes the high-confidence malformed-tail rule reachable while ensuring an actively written partial line is not diagnosed as failure.

- [ ] **Step 7: Run CLI and existing metadata tests**

Run: `npm test -- cli src/core/conversationMeta.test.ts src/core/folderStats.test.ts src/core/traceSniff.test.ts`

Expected: PASS.

Run: `npx tsc -p tsconfig.cli.json`

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add cli package.json package-lock.json tsconfig.cli.json vitest.config.ts
git commit -m "feat: discover local agent runs"
```

---

### Task 8: Token-Protected Loopback Server

**Files:**
- Create: `cli/server.ts`
- Create: `cli/server.test.ts`
- Modify: `cli/types.ts`

**Interfaces:**
- Consumes: `DoctorRunRepository` from Task 7 and a built web root path.
- Produces: `startDoctorServer(options): Promise<DoctorServer>`.

- [ ] **Step 1: Write server security tests**

```ts
it("protects trace APIs with a bearer token", async () => {
  const server = await startFixtureServer();
  expect((await fetch(`${server.origin}/api/runs`)).status).toBe(401);
  expect((await fetch(`${server.origin}/api/runs`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  const response = await fetch(`${server.origin}/api/runs`, { headers: { authorization: `Bearer ${server.token}` } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  await server.close();
});
```

Add tests for `GET /api/runs/:id`, unknown IDs returning 404, static asset MIME types, path traversal rejection, an idle timeout, and explicit close releasing the port.

Define `startFixtureServer()` inside `server.test.ts`. It creates a temporary `index.html`, injects an in-memory repository with one `DoctorRunSummary`/`DoctorRunPayload`, starts the server with a fixed test token and 50 ms idle timeout, and registers `server.close()` in `afterEach`.

- [ ] **Step 2: Run server tests and verify failure**

Run: `npm test -- cli/server.test.ts`

Expected: FAIL because `server.ts` does not exist.

- [ ] **Step 3: Implement the server using Node built-ins only**

```ts
export interface DoctorServer {
  origin: string;
  url: string;
  token: string;
  port: number;
  closed: Promise<void>;
  close(): Promise<void>;
}

export interface StartDoctorServerOptions {
  repository: DoctorRunRepository;
  webRoot: string;
  idleMs?: number;
  token?: string;
}
```

Generate the default token with `randomBytes(32).toString("hex")`. Listen with `{ host: "127.0.0.1", port: 0 }`. The browser URL is `${origin}/?mode=doctor#token=${token}`. Static files are resolved under `webRoot`; reject any normalized path outside it. Unknown client routes fall back to `index.html`, but `/api/*` never does.

- [ ] **Step 4: Add authenticated-idle lifecycle**

Reset the 30-minute timer only after a successful authenticated API request. Static asset requests do not keep sensitive data alive indefinitely. `closed` resolves exactly once after idle shutdown or explicit close. `close()` clears the timer and awaits `server.close()`.

- [ ] **Step 5: Run server and CLI type tests**

Run: `npm test -- cli/server.test.ts`

Expected: PASS.

Run: `npx tsc -p tsconfig.cli.json`

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add cli/server.ts cli/server.test.ts cli/types.ts
git commit -m "feat: serve diagnoses on a protected loopback server"
```

---

### Task 9: Browser Transport, Recent-Run Picker, and Doctor Bootstrap

**Files:**
- Create: `src/core/doctorTransport.ts`
- Create: `src/core/doctorTransport.test.ts`
- Create: `src/components/doctor/RunPicker.tsx`
- Create: `src/components/doctor/RunPicker.test.tsx`
- Modify: `src/components/doctor/DoctorView.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: the Task 8 API, Task 4 wire types, Task 5 Doctor view, and Task 6 view routing.
- Produces: `readDoctorToken(hash)`, `createDoctorClient(token, fetchImpl)`, Doctor startup loading, and recent-run switching.

- [ ] **Step 1: Write transport tests**

```ts
it("reads only a hex token from the URL fragment", () => {
  expect(readDoctorToken("#token=ab12")).toBe("ab12");
  expect(readDoctorToken("#token=<script>")).toBeNull();
});

it("sends the token in Authorization and never in the request URL", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
  await createDoctorClient("ab12", fetchImpl).listRuns();
  expect(fetchImpl).toHaveBeenCalledWith("/api/runs", expect.objectContaining({
    headers: { authorization: "Bearer ab12" },
  }));
});
```

Define `jsonResponse(body, status = 200)` at the top of the test with `new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })`. Import wire types from `src/core/doctorProtocol.ts`, never from `cli/types.ts`.

- [ ] **Step 2: Write RunPicker static-render tests**

Assert newest-first rows, provider text, project/title fallback, selected state, Close, and Open callbacks. Do not expose paths in props or markup.

- [ ] **Step 3: Run browser transport tests and verify failure**

Run: `npm test -- src/core/doctorTransport.test.ts src/components/doctor/RunPicker.test.tsx`

Expected: FAIL because the transport and picker do not exist.

- [ ] **Step 4: Implement the authenticated client**

```ts
export interface DoctorClient {
  listRuns(): Promise<DoctorRunSummary[]>;
  loadRun(id?: string): Promise<DoctorRunPayload>;
}
```

Treat 401 as `This Doctor link is invalid or expired.`, 404 as `That run is no longer available.`, and other non-2xx responses as `TraceLens Doctor could not load the run.`. Do not persist the token in localStorage or sessionStorage.

- [ ] **Step 5: Bootstrap Doctor mode in App**

When `new URLSearchParams(location.search).get("mode") === "doctor"`, read the fragment token, create the client, fetch summaries and the default run, parse `payload.source`, set `doctorReport`, and set `activeView` to `doctor`. Doctor mode takes precedence over share-hash loading.

On run switch, fetch by opaque ID, replace trace/report/label/source atomically, and remain on Doctor view. On failure, keep the previous report visible and show a non-destructive error banner.

- [ ] **Step 6: Implement safe report copy**

Use `formatDiagnosisReport(doctorReport)` and `navigator.clipboard.writeText`. Set a temporary copied state for button feedback; never use raw source in this action.

- [ ] **Step 7: Run browser tests and production build**

Run: `npm test -- src/core/doctorTransport.test.ts src/components/doctor`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 8: Commit Task 9**

```bash
git add src/App.tsx src/core/doctorTransport.ts src/core/doctorTransport.test.ts src/components/doctor
git commit -m "feat: load Doctor reports in the browser"
```

---

### Task 10: Reuse Diagnosis in the Hosted Folder Overview

**Files:**
- Create: `src/lib/diagnosisScan.ts`
- Create: `src/lib/diagnosisScan.test.ts`
- Create: `src/hooks/useDiagnosisScan.ts`
- Modify: `src/components/live/DashboardView.tsx`
- Modify: `src/components/live/FolderBrowser.tsx`
- Modify: `src/App.tsx`
- Delete: `src/hooks/useFailedScan.ts`
- Delete: `src/lib/failedScan.ts`
- Delete: `src/lib/failedScan.test.ts`

**Interfaces:**
- Consumes: `analyzeTrace` from Task 4, existing conversation metadata, folder readers, and the current 30 MB scan cap.
- Produces: `RunDiagnosis = DiagnosisReport | "pending" | "skipped" | "unknown"` and `useDiagnosisScan(dir, conversations)`.

- [ ] **Step 1: Write cache migration and selection tests**

```ts
it("round-trips a versioned diagnosis report cache", () => {
  const storage = fakeStorage();
  saveDiagnosisCache({ "folder/run:1:10": reportWithTerminalFailure() }, storage);
  expect(loadDiagnosisCache(storage)["folder/run:1:10"]).toEqual(reportWithTerminalFailure());
});

it("ignores the old numeric failed-scan cache", () => {
  const storage = fakeStorage({ "tracelens:failed": JSON.stringify({ run: 2 }) });
  expect(loadDiagnosisCache(storage)).toEqual({});
});
```

Define `fakeStorage(initial = {})` in the test with the complete `Storage` interface used by the current `failedScan.test.ts`. Also test `cacheKey(folder, name, mtime, size)`, corrupt storage, and `MAX_SCAN_BYTES` remaining exactly `30 * 1024 * 1024`.

- [ ] **Step 2: Run scan tests and verify failure**

Run: `npm test -- src/lib/diagnosisScan.test.ts`

Expected: FAIL because the diagnosis scan cache does not exist.

- [ ] **Step 3: Implement the versioned diagnosis cache and hook**

`useDiagnosisScan` follows the existing newest-first, cancellable, one-file-at-a-time pattern. Read the file handle's size/mtime before and after its text; combine that change with `inspectTraceLifecycle(decodeTraceText(text))` to determine active state. For each parseable file, call:

```ts
analyzeTrace(parseTraceText(text), {
  active: fileChanged || lifecycle === "active",
  malformedTail: false,
  baseline: [],
});
```

The hosted folder scan does not invent baseline data. Cache complete `DiagnosisReport` objects under a new storage key. Files over 30 MB are `skipped`; parse/read errors are `unknown` and are not cached.

- [ ] **Step 4: Replace the folder's error-only dashboard section**

Rename `Runs with errors` to `Runs needing attention`. Include reports whose status is `needs-attention` or `incomplete`, sorted by error finding count, then warning count, then newest modification time. Each row shows its highest-severity finding title and still opens the existing trace view. Active, clean, skipped, and unknown runs do not inflate the attention count.

- [ ] **Step 5: Run folder and diagnosis tests**

Run: `npm test -- src/lib/diagnosisScan.test.ts src/core/diagnostics src/components/live/ConversationList.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS with no imports of `useFailedScan` or `failedScan` remaining.

- [ ] **Step 6: Commit Task 10**

```bash
git add src/App.tsx src/components/live src/hooks src/lib
git commit -m "feat: surface diagnosed runs in folder overview"
```

---

### Task 11: CLI Executable and npm Packaging

**Files:**
- Create: `cli/args.ts`
- Create: `cli/args.test.ts`
- Create: `cli/openBrowser.ts`
- Create: `cli/openBrowser.test.ts`
- Create: `cli/selectRun.ts`
- Create: `cli/selectRun.test.ts`
- Create: `cli/index.ts`
- Create: `cli/index.test.ts`
- Create: `tsup.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.cli.json`

**Interfaces:**
- Consumes: discovery/repository from Task 7 and server from Task 8.
- Produces: the `tracelens` binary and publishable `dist-cli/index.js`.

- [ ] **Step 1: Write exact argument parser tests**

```ts
expect(parseArgs(["doctor"])).toEqual({ command: "doctor", file: undefined, list: false, verbose: false });
expect(parseArgs(["doctor", "run.jsonl", "--verbose"])).toEqual({ command: "doctor", file: "run.jsonl", list: false, verbose: true });
expect(parseArgs(["doctor", "--list"])).toEqual({ command: "doctor", file: undefined, list: true, verbose: false });
expect(() => parseArgs(["doctor", "a.jsonl", "b.jsonl"])).toThrow("Only one run file can be specified");
```

Also test `--help`, unknown flags, and defaulting an empty argv to the Doctor command.

Write `selectRun.test.ts` with injected `Readable`/`Writable` streams. Assert that entering `2` returns the second summary, an out-of-range value re-prompts, and an ended input rejects with `Run selection was cancelled.`.

- [ ] **Step 2: Write browser launcher and orchestration tests**

Inject a spawn function and assert these platform commands:

- Windows: `cmd.exe /d /s /c start "" <url>`
- macOS: `open <url>`
- Linux: `xdg-open <url>`

For `runCli`, inject discovery, repository, server, browser, stdout, and stderr. Verify explicit files do not fall back, browser failure prints the URL, verbose controls stack output, and SIGINT closes the server.

Add a `resolveWebRoot(moduleUrl)` test asserting that a bundled module URL ending in `/dist-cli/index.js` resolves the sibling `/dist` directory, independent of the caller's working directory.

- [ ] **Step 3: Run CLI entry tests and verify failure**

Run: `npm test -- cli/args.test.ts cli/openBrowser.test.ts cli/selectRun.test.ts cli/index.test.ts`

Expected: FAIL because the executable modules do not exist.

- [ ] **Step 4: Implement argument parsing and browser opening**

The browser launcher returns `Promise<boolean>` and never throws to the top-level CLI. Only generated loopback URLs reach the platform command. Use `spawn` with `detached: true`, `stdio: "ignore"`, and `windowsHide: true`, then `unref()` after the `spawn` event.

- [ ] **Step 5: Implement `runCli` and executable lifecycle**

```ts
export interface CliDependencies {
  homeDir: string;
  webRoot: string;
  openBrowser(url: string): Promise<boolean>;
  input: NodeJS.ReadableStream;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export async function runCli(argv: string[], deps: CliDependencies): Promise<number>;
```

`runCli` discovers or validates a run, creates the repository, preloads the selected diagnosis, starts the server, opens the browser, prints the local URL and shutdown instructions, and waits until SIGINT, SIGTERM, or idle close. Expected user errors return non-zero without leaving a listener.

When `--list` is present, call `selectRun(runs, input, output)` before creating the repository. Print numbered rows with provider, title, project, relative modification time, and size; never print the absolute path. Await `server.closed` after installing signal handlers, and remove those handlers in `finally`.

- [ ] **Step 6: Make the root package publishable**

Create `tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["cli/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist-cli",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
```

Update `package.json` with:

```json
{
  "private": false,
  "bin": { "tracelens": "dist-cli/index.js" },
  "files": ["dist", "dist-cli", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build:web": "vite build",
    "build:cli": "tsup --config tsup.config.ts",
    "build": "npm run typecheck && npm run typecheck:cli && npm run build:web && npm run build:cli",
    "typecheck:cli": "tsc -p tsconfig.cli.json"
  }
}
```

Preserve all existing scripts not replaced above. Ensure `dist-cli/index.js` is executable in the packed tarball.

- [ ] **Step 7: Run CLI tests and inspect build outputs**

Run: `npm test -- cli`

Expected: PASS.

Run: `npm run build`

Expected: `dist/index.html` and `dist-cli/index.js` both exist.

- [ ] **Step 8: Commit Task 11**

```bash
git add cli package.json package-lock.json tsconfig.cli.json tsup.config.ts
git commit -m "feat: package the TraceLens Doctor CLI"
```

---

### Task 12: Product Positioning, Package Smoke Test, and Release Gate

**Files:**
- Create: `scripts/package-smoke.mjs`
- Modify: `src/components/Loader.tsx`
- Modify: `README.md`
- Modify: `.github/workflows/deploy.yml`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: the completed CLI and web application.
- Produces: diagnosis-first user guidance and an automated packed-binary verification command.

- [ ] **Step 1: Add a packed-tarball smoke script**

The script must:

1. run `npm pack --dry-run --json` and inspect its file list;
2. run `npm pack --json` to produce the tarball;
3. inspect the returned file list for `dist/index.html`, `dist-cli/index.js`, `README.md`, and `LICENSE`;
4. extract/install the tarball into a temporary directory;
5. execute the installed binary with `--help` and assert exit code 0 plus `tracelens doctor` in stdout;
6. delete the temporary directory and generated tarball in a `finally` block.

Expose it as `npm run pack:check`.

Use `spawnSync` with the platform npm executable and fail with captured stdout/stderr:

```js
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function runNpm(args, options = {}) {
  return process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", ...args], { encoding: "utf8", ...options })
    : spawnSync("npm", args, { encoding: "utf8", ...options });
}

const temp = mkdtempSync(join(tmpdir(), "tracelens-pack-"));
let tarball;
try {
  const dryRun = runNpm(["pack", "--dry-run", "--json"]);
  if (dryRun.status !== 0) throw new Error(dryRun.stderr || dryRun.stdout);
  const dryResult = JSON.parse(dryRun.stdout)[0];
  const names = new Set(dryResult.files.map((file) => file.path));
  for (const required of ["dist/index.html", "dist-cli/index.js", "README.md", "LICENSE"]) {
    if (!names.has(required)) throw new Error(`Packed file missing: ${required}`);
  }
  const packed = runNpm(["pack", "--json"]);
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
  const result = JSON.parse(packed.stdout)[0];
  tarball = join(process.cwd(), result.filename);
  const installed = runNpm(["install", tarball, "--ignore-scripts"], { cwd: temp });
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);
  const bin = process.platform === "win32" ? join(temp, "node_modules", ".bin", "tracelens.cmd") : join(temp, "node_modules", ".bin", "tracelens");
  const help = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", bin, "--help"], { cwd: temp, encoding: "utf8" })
    : spawnSync(bin, ["--help"], { cwd: temp, encoding: "utf8" });
  if (help.status !== 0 || !help.stdout.includes("tracelens doctor")) throw new Error(help.stderr || help.stdout);
} finally {
  rmSync(temp, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
}
```

- [ ] **Step 2: Run the smoke script and verify the initial failure**

Run: `npm run pack:check`

Expected: FAIL until package files and binary behavior exactly match the assertions.

- [ ] **Step 3: Reposition the functional entry screen**

Change the Loader heading to `Diagnose an agent run.` The folder action becomes the first action and reads `Diagnose a local session folder`; trace-file drop remains a secondary action. Samples start with the failed/recovery fixtures. Keep the privacy statement visible and do not create a marketing landing page.

- [ ] **Step 4: Rewrite README's first-use path**

The README opening must lead with:

```bash
npx tracelens doctor
```

Explain that it finds the latest Codex or Claude Code run, starts a temporary loopback report, and uploads nothing. Move manual file import and the hosted demo below the CLI quickstart. Preserve format support, architecture, development commands, and the explicit rough-cost wording.

- [ ] **Step 5: Strengthen CI without changing Pages output**

In `.github/workflows/deploy.yml`, keep `path: dist` and add `npm run typecheck`, `npm run typecheck:cli`, and `npm run pack:check` after tests/build. Do not publish to npm from this workflow; the first npm publish remains a deliberate authenticated release action after verifying package-name ownership.

- [ ] **Step 6: Run the complete automated gate**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run typecheck:cli`

Expected: PASS.

Run: `npm test`

Expected: all existing and new tests PASS.

Run: `npm run build`

Expected: PASS with web and CLI outputs.

Run: `npm run pack:check`

Expected: PASS and no tarball/temp directory remains.

- [ ] **Step 7: Perform browser acceptance checks**

Start a packed CLI against `public/samples/codex-session.jsonl`. In desktop and mobile-width Chromium, verify:

- diagnosis is the first view;
- each finding opens a valid evidence span and Back to diagnosis works;
- recent-run picker never displays absolute paths;
- Copy report contains no prompt/output/path/token;
- invalid/removed token produces the expired-link error;
- Tree, Flamegraph, Diff, Annotation, file import, and static hosted mode remain usable;
- browser network requests after load target only the loopback Doctor origin;
- a representative 50 MB run reaches an interactive report within three seconds on the development machine, with initial npm download excluded;
- no controls overlap and all text fits at 390 px and 1440 px widths.

- [ ] **Step 8: Commit Task 12**

```bash
git add scripts/package-smoke.mjs src/components/Loader.tsx README.md .github/workflows/deploy.yml package.json package-lock.json
git commit -m "docs: make Doctor the primary TraceLens workflow"
```

---

## Final Verification

- [ ] Compare every implemented command, status, threshold, security control, and non-goal against `docs/superpowers/specs/2026-07-30-doctor-mode-design.md`.
- [ ] Run `git diff --check` and confirm no unintended generated assets are tracked.
- [ ] Run `git status --short` and confirm only intentional changes remain.
- [ ] Request a code review focused on false-positive rules, local-server security, and package contents.
- [ ] Address findings, rerun the complete automated gate, and only then prepare the npm release or push requested by the user.
- [ ] Immediately before any first npm publish, run `npm whoami` and authenticated `npm view tracelens`; if the unscoped name is unavailable, switch the package name to an owned scope while retaining `bin.tracelens`.
