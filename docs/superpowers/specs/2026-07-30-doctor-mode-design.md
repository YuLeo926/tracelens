# TraceLens Doctor Mode Design

**Date:** 2026-07-30

**Status:** Approved

**Scope:** Reposition TraceLens from a trace viewer into a local diagnostic tool for individual Codex and Claude Code users.

## 1. Problem

Most users do not open a tool merely to browse old chat or agent history. They have a concrete question after a run behaves badly: why did it fail, loop, take so long, or consume unexpectedly many tokens?

TraceLens already has the underlying evidence tools: Codex and Claude adapters, a normalized trace model, error scanning, live folder access, token and cost summaries, a call tree, flamegraph, diff, and annotations. The missing layer is a low-friction trigger and a deterministic diagnosis that tells the user what deserves attention before asking them to inspect the trace manually.

## 2. Product Decision

The primary product becomes **TraceLens Doctor**, aimed at individual heavy Codex and Claude Code users.

The default flow is:

```text
npx tracelens doctor
  -> discover the most recent local agent session
  -> parse the run and read a lightweight project baseline
  -> produce a deterministic local diagnosis
  -> start a temporary loopback-only web server
  -> open a diagnosis-first report in the browser
  -> let the user drill into the existing trace views as evidence
```

The current trace viewer remains valuable, but it becomes the evidence layer behind the diagnosis rather than the default product entry point.

## 3. Goals

- Answer "what went wrong in my latest run?" with one command.
- Show only claims supported by concrete trace evidence.
- Keep all trace content local, with no model API, account, backend, or upload.
- Reuse the existing parser and debugger views instead of rebuilding them.
- Make every finding actionable by linking it to one or more evidence spans.
- Preserve the public web demo as an import and folder-diagnosis fallback.

## 4. Non-Goals

The first release will not include:

- a background process, system tray application, or failure notifications;
- LLM-generated analysis or API-key configuration;
- automatic remediation;
- team workspaces or hosted trace storage;
- a cross-project anomaly inbox;
- semantic similarity analysis of arbitrary tool inputs.

These are demand-driven follow-ups, not prerequisites for validating Doctor mode.

## 5. CLI Experience

### 5.1 Commands

```text
npx tracelens doctor             Diagnose the latest valid Codex or Claude run
npx tracelens doctor <file>      Diagnose a specific supported trace file
npx tracelens doctor --list      Select from recent detected runs
npx tracelens doctor --verbose   Include stack traces in CLI errors
```

`doctor` is the default subcommand in product messaging, but the explicit subcommand remains in the command syntax so future commands can be added without breaking compatibility.

### 5.2 Session discovery

The CLI checks standard locations under the current user's home directory:

- Codex: `~/.codex/sessions/**/*.jsonl`
- Claude Code: `~/.claude/projects/**/*.jsonl`

Candidates are ordered by modification time. The CLI selects the newest file that the existing sniffing and adapter layer recognizes. Unsupported files are skipped, not treated as fatal. A specified file is never silently replaced by another candidate.

`--list` shows provider, project, first-message title when available, modification time, and file size. Selection is performed with Node's terminal input; no extra interactive framework is required.

### 5.3 Baseline

For historical anomaly rules, the CLI reads lightweight metadata from up to 10 previous valid runs in the same project. It reuses the existing head/tail extraction approach and does not fully parse these baseline runs.

A baseline rule is disabled unless at least five comparable completed runs contain the required metric. This prevents a single previous run from being presented as a meaningful norm.

### 5.4 Local server lifecycle

After diagnosis, the CLI starts an HTTP server on a random available port bound only to `127.0.0.1`. It serves the packaged Vite build and authenticated local endpoints containing:

- metadata and opaque in-memory IDs for recent discovered runs;
- the raw source, display label, and provider for the selected run;
- the selected run's serialized `DiagnosisReport`;
- the lightweight baseline summary needed by the report UI.

`Open another run` uses the recent-run metadata endpoint. Selecting an opaque ID asks the CLI process to parse and diagnose that run on demand. Filesystem paths are never returned to the browser. The initial latest run is diagnosed before the browser opens so the first report does not wait on a second request.

The server uses a random 256-bit session token. The browser receives the token in the URL fragment, and API requests send it in an authorization header. The fragment is not sent in HTTP requests or referrers. The server exposes no permissive CORS headers and returns `Cache-Control: no-store` for trace data.

The process exits on `Ctrl+C` or after 30 minutes without an authenticated request. If automatic browser opening fails, the CLI prints the complete local URL.

## 6. Diagnosis Model

The diagnosis engine is a pure TypeScript layer operating on the existing `ParsedTrace` plus optional baseline statistics.

```ts
export interface DiagnosisReport {
  version: 1;
  status: "needs-attention" | "no-obvious-issue" | "incomplete" | "active";
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

export interface Finding {
  ruleId: string;
  severity: "error" | "warning" | "info";
  confidence: "high" | "medium";
  title: string;
  explanation: string;
  evidenceSpanIds: string[];
}
```

Rules return structured facts, not free-form model prose. Findings are sorted by severity, then confidence, then earliest evidence time. Multiple hits from the same rule are grouped when they describe one repeated behavior.

## 7. Initial Diagnostic Rules

### 7.1 High-confidence failures

#### Terminal failure

The last meaningful command or tool operation failed and no later successful recovery step or completed answer followed. A single non-zero exit earlier in the run is not sufficient.

#### Repeated identical failure

The same normalized operation fails at least three times. Structured tool inputs are canonicalized before comparison; plain strings are trimmed and whitespace-normalized. The first and last failed attempts are evidence.

#### Explicit agent error

The adapter exposes an explicit terminal error or failed run status. The originating error span is evidence.

#### Malformed or truncated trace

The adapter can positively identify an incomplete tail or malformed final event. Absence of a generic completion event alone is not a high-confidence failure.

### 7.2 Medium-confidence behavior anomalies

#### Possible retry loop

The same normalized tool and input occur at least three times within a window of ten tool calls, with no materially different successful result. The title says "possible" and the finding remains medium confidence.

#### Retry storm

At least three failure/retry cycles target the same normalized operation, possibly separated by reasoning spans.

#### Duration or token hotspot

One span consumes at least 60% of the run's measured duration or token total, provided the total is large enough to make the ratio meaningful. This is informational unless the span also failed.

#### Repeated empty result

At least three repeated tool calls return an empty or explicitly no-result output and the agent continues issuing the same operation.

### 7.3 Baseline anomalies

Baseline findings are informational and require at least five comparable runs:

- total tokens exceed `2.5x` the project median and exceed an absolute floor of 50,000 tokens;
- duration exceeds `2.5x` the project median and is at least 60 seconds above it;
- tool calls exceed `2.5x` the project median and exceed it by at least 10 calls.

The report states the observed value, baseline median, comparison window, and threshold. Estimated price alone does not trigger a separate finding because it derives from tokens and a changeable price table.

### 7.4 Active runs and false-positive controls

The selected file is considered active when its adapter identifies an active run, or when its size or modification time changes between the stat taken before parsing and the stat taken immediately after parsing. Recent modification time by itself does not prove that a run is active. Rules may report concrete failures already present, but missing completion is not diagnosed while active.

Known probe patterns such as no-match searches, capability checks, and failures followed by a successful alternative remain visible in the trace but do not produce a terminal-failure finding. Every rule requires dedicated negative fixtures for these cases.

If no rule fires, the report says **No obvious issue found**. It does not manufacture a diagnosis.

## 8. Browser Experience

### 8.1 Diagnosis-first landing view

Doctor sessions open on a new `doctor` view containing:

1. **Overall status:** status label, finding count, and a short factual summary.
2. **Findings:** severity-ordered rows with confidence, explanation, and `Open evidence`.
3. **Run totals:** duration, tokens, estimated cost, tool calls, and errors.
4. **Actions:** `Inspect full trace`, `Copy report`, and `Open another run`.

The report is an operational screen, not a marketing page. It uses the existing compact application shell and visual tokens.

### 8.2 Evidence routing

Selecting `Open evidence`:

- changes the active view to `tree`;
- selects the first evidence span;
- expands ancestors needed to reveal it;
- preserves the finding context so a `Back to diagnosis` action returns to the report.

Findings with multiple evidence spans provide next/previous evidence controls. `Inspect full trace` opens the tree without applying an evidence filter.

### 8.3 Public web entry

The hosted static app continues supporting file drop, folder access, samples, live watch, and shared traces. Its entry copy changes from "browse a trace" language to "diagnose an agent run" language. Folder access should surface runs needing attention before the general conversation list, using the same diagnosis engine where enough data is available.

The CLI remains the recommended workflow because a public browser page cannot discover local session paths without user permission.

### 8.4 Report export

`Copy report` includes only:

- status and findings;
- aggregate metrics;
- sanitized tool or span names needed to understand evidence.

It excludes prompts, model outputs, raw attributes, absolute filesystem paths, and the local authenticated URL by default.

## 9. Code Organization

The repository remains a single package.

```text
cli/
  index.ts                 command parsing and lifecycle
  discovery.ts             standard paths and latest-run selection
  baseline.ts              lightweight comparable-run metadata
  server.ts                token-protected loopback HTTP server
  openBrowser.ts           cross-platform browser launch

src/core/diagnostics/
  types.ts                 DiagnosisReport and Finding
  analyze.ts               rule orchestration, sorting, grouping
  rules.ts                 deterministic initial rules
  baseline.ts              baseline comparison functions

src/components/doctor/
  DoctorView.tsx
  FindingList.tsx
  RunTotals.tsx
```

The CLI imports and bundles the existing adapters, parser, format logic, and new diagnosis core. The React app imports the same diagnosis types and renders the report. React remains absent from `src/core`.

`App.tsx` gains a Doctor-session bootstrap path and a `doctor` view, but the existing imported-trace and folder flows remain valid.

## 10. Packaging

The root package becomes publishable and adds:

```json
{
  "bin": { "tracelens": "dist-cli/index.js" },
  "files": ["dist", "dist-cli", "README.md", "LICENSE"],
  "engines": { "node": ">=20" }
}
```

Vite continues building the web application into `dist`. A small CLI bundler such as `tsup` builds the Node ESM entry into `dist-cli` with a Node shebang. The CLI resolves packaged web assets relative to `import.meta.url`, not the caller's working directory.

The GitHub Pages build keeps using `dist`. Package publishing additionally runs the CLI build and package smoke checks. The unscoped `tracelens` package name must be verified while authenticated immediately before the first publish; if unavailable, the fallback is a project-owned scope while retaining the `tracelens` binary name.

## 11. Error Handling

- **No standard directory:** print every checked path and suggest `doctor <file>`.
- **No recognized run:** distinguish an empty directory from unsupported files.
- **Specified file missing:** fail without falling back to another run.
- **Parse failure:** show the file and concise reason; include a stack only with `--verbose`.
- **Run still active:** report active state and avoid an incomplete-run claim.
- **Port conflict:** retry another random loopback port.
- **Browser launch failure:** keep serving and print the authenticated URL.
- **Baseline read failure:** continue without baseline findings and report the skipped comparison in verbose CLI output.
- **Client disconnect:** keep the server available until the idle timeout or `Ctrl+C`.

Expected CLI errors use non-zero exit codes and do not leave a server process behind.

## 12. Testing

### 12.1 Pure diagnosis tests

Each rule uses table-driven fixtures covering:

- the minimal positive case;
- a threshold boundary;
- a normal recovery or probe that must not trigger;
- grouping and evidence span selection;
- active and incomplete runs where relevant.

Report ordering, status derivation, baseline minimum sample size, median calculation, and copy-report sanitization receive separate unit tests.

### 12.2 CLI and filesystem tests

Temporary directories cover:

- Codex and Claude standard path discovery;
- newest valid run selection with unrelated JSON files present;
- explicit file behavior;
- project matching and the ten-run baseline limit;
- missing, empty, malformed, and inaccessible paths.

### 12.3 Server integration tests

Start the server on an ephemeral port and verify:

- static assets load;
- the session endpoint rejects missing and incorrect tokens;
- the correct token returns the expected report and source;
- responses use `no-store` and no permissive CORS policy;
- idle shutdown and explicit shutdown release the port.

### 12.4 End-to-end and packaging tests

- Run `doctor`, `doctor <file>`, and `doctor --list` against packaged fixtures with browser opening stubbed.
- Run `npm pack --dry-run` and verify only intended files are present.
- Install the generated tarball into a temporary directory and execute its `tracelens` binary.
- Keep existing typecheck, parser, pricing, view, and production-build tests green.

## 13. Acceptance Criteria

- `npx tracelens doctor` opens a diagnosis for the newest supported local run without asking the user to locate a file.
- A typical run up to 50 MB reaches an interactive local report within three seconds on a normal development machine, excluding initial npm download time.
- Every displayed finding links to valid evidence in the existing tree.
- Known recovered probe failures do not create a terminal-failure diagnosis in the test corpus.
- No external network request occurs after the npm package is installed and executed.
- The local trace endpoint is inaccessible without its random session token.
- A clean run produces `No obvious issue found` rather than a fabricated explanation.

## 14. Delivery Order

1. Add diagnosis types, rule engine, fixtures, and unit tests.
2. Add the Doctor report UI and evidence routing using sample reports.
3. Add CLI discovery and baseline extraction.
4. Add the authenticated local server and browser launcher.
5. Wire the packaged web app to CLI session data.
6. Update loader and README positioning.
7. Add package smoke tests and publish configuration.
8. Run the full verification and packaged-tarball acceptance checks.
