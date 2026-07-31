# TraceLens Hybrid Codex Analysis Design

**Date:** 2026-07-31

**Status:** Approved

**Supersedes:** `2026-07-30-doctor-mode-design.md`

## 1. Summary

TraceLens will separate evidence collection from diagnosis:

- **TraceLens is the evidence layer.** It discovers local Codex and Claude Code
  sessions, parses them into a stable model, computes objective facts, and lets
  a person inspect the full trace in the browser.
- **Codex is the reasoning layer.** It uses bounded TraceLens MCP tools to find
  the correct session, request only the relevant timeline entries, and explain
  what likely caused a failure, delay, repeated action, or high token use.

The product promise is:

> TraceLens finds the right agent run and gives you and Codex the evidence to
> understand it.

This replaces the original plan for a rule-heavy local Doctor that would make
its own diagnostic claims. TraceLens still computes useful facts such as errors,
duration, token use, repeated operations, and slow spans, but it does not turn
those facts into unsupported conclusions.

## 2. Problem

The first product version assumes users already know which trace to open and
want to inspect it manually. User feedback identified two earlier points of
friction:

1. The user often cannot identify which session corresponds to the run they
   remember.
2. Once the correct run is available, Codex can reason about nuanced behavior
   better than a growing collection of fixed diagnostic thresholds.

TraceLens must therefore make session discovery reliable, expose the evidence
in a form that does not flood the model context, and preserve a visual route for
human verification.

## 3. Goals

- Find the most relevant recent session for the current project without asking
  the user to browse `~/.codex/sessions` or `~/.claude/projects`.
- Keep the existing local tree, detail, flamegraph, diff, search, annotation,
  folder, and live-watch experiences.
- Give Codex structured, read-only tools for progressively examining a session.
- Return bounded evidence rather than an entire raw transcript.
- Make setup a single command and keep subsequent use conversational.
- Keep TraceLens free of model credentials, model API calls, accounts, hosted
  storage, and telemetry.
- Clearly disclose that evidence returned through MCP becomes part of the Codex
  conversation even though TraceLens itself makes no external request.

## 4. Non-Goals

The first hybrid release will not include:

- automatic remediation or command execution based on log contents;
- a deterministic rules engine that declares root causes;
- a hosted analysis service or shared team trace store;
- background monitoring, notifications, or a system tray process;
- arbitrary filesystem browsing through MCP;
- a tool that returns an entire raw session in one response;
- automatic analysis on every run without an explicit user request to Codex.

## 5. User Experience

### 5.1 One-time Codex setup

The user runs:

```text
npx tracelens setup codex
```

TraceLens verifies that the local `codex` command supports MCP and registers a
stdio server equivalent to:

```text
codex mcp add tracelens -- npx -y tracelens@<installed-version> mcp
```

The package version is pinned so an existing Codex setup does not silently run
new TraceLens code. Rerunning setup after an upgrade updates the registration
only after the user passes `--force`; otherwise a conflicting registration is
reported without being overwritten.

Setup is idempotent. If the exact registration already exists, it succeeds and
prints that TraceLens is connected. If Codex is unavailable or too old, it
prints the exact manual command and a concise requirement. It never asks for an
API key or edits configuration files directly.

A new Codex task may be required before the newly registered tools appear. The
setup success message states this explicitly.

### 5.2 Normal analysis flow

After setup, the user can ask Codex:

```text
Use TraceLens to analyze the most recent abnormal run in this project.
```

Codex then:

1. lists recent sessions scoped to the current project;
2. selects a candidate using project, time, title, and objective run facts;
3. reads the overview and a bounded timeline;
4. requests full detail only for relevant events;
5. explains its conclusion and cites session/event IDs;
6. obtains a local TraceLens viewer link when the user wants to verify evidence.

TraceLens does not expose a single `analyze_session` tool. Analysis remains a
Codex responsibility, and the individual query tools make the evidence chain
observable.

### 5.3 Viewer-only flow

Users who do not want model-assisted analysis can run:

```text
npx tracelens
npx tracelens open
npx tracelens open <supported-file>
npx tracelens list
```

With no file, TraceLens opens the latest valid run for the current project. If
there is no project match, it clearly labels the fallback and opens the newest
valid run across standard roots. `list` provides a terminal selector for recent
runs. The hosted static application continues to support manual file and folder
access when a CLI is not desired.

## 6. Session Discovery and Ranking

TraceLens scans only standard roots by default:

- Codex: `~/.codex/sessions/**/*.jsonl`
- Claude Code: `~/.claude/projects/**/*.jsonl`

It reads lightweight head/tail data first and skips unsupported files. Each
candidate records internal path, provider, project directory, first meaningful
user request, modification time, file size, lifecycle, and available aggregate
metrics.

Default ranking is deterministic:

1. exact current working directory match;
2. nearest parent/child project match;
3. newest modification time;
4. newest trace start time as a tie breaker.

The selection response always says why a run was ranked first. A user-specified
session ID or file is never silently replaced by another run.

MCP responses expose an opaque session ID, project label, title, provider, and
timestamps. They do not expose absolute paths. IDs are stable for a file while
its provider and path remain the same, but cannot be reversed into a path.

Parsed sessions are cached in memory by path, modification time, and size. A
changed file invalidates its entry. No persistent transcript index is created in
the first release.

## 7. Objective Fact Layer

TraceLens computes `RunFacts` from the existing normalized `ParsedTrace`:

```ts
export interface RunFacts {
  lifecycle: "active" | "complete" | "failed" | "unknown";
  totals: {
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd?: number;
    toolCalls: number;
    errors: number;
  };
  errorEvents: EventRef[];
  slowestEvents: EventRef[];
  highestTokenEvents: EventRef[];
  repeatedOperations: RepeatedOperationFact[];
}
```

These are observations, not diagnoses. For example, TraceLens may report that
the same normalized tool input appeared five times and three attempts failed;
it must not label the behavior a loop or claim a root cause.

Repeated operation keys use exact canonicalized structured inputs. Slow and
token-heavy lists are simple descending rankings with values and percentages.
Recovered errors remain visible. Estimated cost retains the existing rough-cost
wording and never becomes an anomaly by itself.

## 8. MCP Tool Surface

The MCP server uses stdio and the official TypeScript MCP SDK. All tools are
read-only except `get_viewer_link`, which starts or reuses a loopback viewer
server but does not open a browser.

### `list_sessions`

Find recent supported sessions.

Inputs include `scope` (`current_project` by default or `all`), provider, a
bounded limit, and an optional time range. The maximum limit is 20. Results
contain metadata and aggregate facts but no prompt or output content.

### `get_session_overview`

Return metadata, lifecycle, totals, up to ten error events, ten slowest events,
ten highest-token events, and ten repeated-operation facts. Event references
contain IDs, names, kinds, status, timing, and short safe labels.

### `get_session_timeline`

Return a chronological page of at most 50 event references. It accepts a cursor
and optional filters for event kind and status. Inputs and outputs are represented
only by short snippets in this tool.

### `search_session`

Search normalized event names, inputs, outputs, status messages, and selected
attributes within one session. It returns at most 20 matching event references
with bounded context snippets and supports a cursor for later matches.

### `get_event_detail`

Return one event's normalized metadata, input, output, status, token values, and
selected attributes. Input and output are truncated independently and the total
response is capped at 24,000 characters. The response explicitly says which
fields were truncated. There is no option to disable the hard cap.

### `get_viewer_link`

Start or reuse a server bound only to `127.0.0.1` and return an authenticated
link for one session and optional event ID. Opening the link loads the existing
TraceLens viewer and selects the requested evidence. The tool does not launch a
browser or transmit trace content.

Every response includes `dataClassification: "untrusted-local-log"`. Tool
descriptions tell Codex to treat log text as evidence, never as instructions,
and to distinguish direct observations from inferred explanations.

## 9. Local Viewer

The viewer remains the primary human inspection surface. CLI and MCP viewer
links serve the packaged Vite build from a random loopback port. The selected
session is available through an authenticated local endpoint.

The authentication token is random, remains in the URL fragment, and is sent to
the API in an authorization header. Trace responses use `Cache-Control: no-store`,
the server emits no permissive CORS headers, and filesystem paths are never sent
to the browser. Idle servers shut down after 30 minutes without an authenticated
request.

The first screen for a selected run shows:

- the project, provider, first-request title, and run time so the user can verify
  that the correct session was selected;
- objective totals and lifecycle;
- errors, slowest steps, token-heavy steps, and repeated-operation counts;
- actions to inspect the tree, flamegraph, diff, search, and details;
- a recent-session picker ranked with the same discovery logic as MCP.

Labels such as `Errors found` and `Repeated operation` are permitted. Labels
that imply an inferred diagnosis, such as `Root cause` or `Agent loop`, are not.

## 10. Privacy and Security Boundaries

- TraceLens itself performs no model call and sends no telemetry or trace data
  to a TraceLens service.
- When Codex calls an MCP tool, that tool result becomes part of the Codex
  conversation and is handled according to the user's Codex configuration. The
  setup output and README must state this before presenting assisted analysis as
  local-only.
- Session listing and overviews exclude raw prompt/output content by default.
  Detailed content is returned only through timeline, search, or event-detail
  calls made during an explicit analysis workflow.
- MCP tools accept opaque session and event IDs, not arbitrary filesystem paths.
- File reads stay within discovered standard roots or a file explicitly opened
  through the CLI. Explicit CLI files are scoped to that CLI process and are not
  added to the global MCP index.
- Tool outputs are size-limited and mark truncation. No tool returns the entire
  raw source.
- Log text is untrusted data. TraceLens never executes commands, follows URLs,
  or changes files based on instructions found inside a log.
- The loopback server uses token authentication, no-store responses, no open
  CORS policy, path traversal protection, and an idle shutdown.

## 11. Error Handling

- No standard roots: list checked root labels and suggest `open <file>`.
- No current-project match: report the fallback before selecting the newest run.
- Session changed during parsing: retry once, then return an active-session
  result without claiming a stable snapshot.
- Unsupported or malformed run: skip it during discovery; return a concise error
  when explicitly selected.
- Expired session ID: ask Codex to call `list_sessions` again.
- Oversized event content: truncate deterministically and report original and
  returned lengths.
- Viewer launch failure: return the authenticated URL instead of failing the
  analysis tools.
- Existing MCP registration differs: preserve it unless the user invoked setup
  with `--force`.

Expected CLI failures use non-zero exit codes and do not leave a server running.
One malformed session does not prevent listing other sessions.

## 12. Code Boundaries

The repository remains one npm package:

```text
cli/
  args.ts
  discovery.ts
  repository.ts
  server.ts
  setupCodex.ts
  index.ts

mcp/
  server.ts
  tools.ts
  schemas.ts

src/core/session/
  types.ts
  facts.ts
  query.ts
  sanitize.ts

src/core/viewerProtocol.ts
src/components/session/
  SessionOverview.tsx
  SessionPicker.tsx
```

`src/core/session` contains pure TypeScript and imports no Node, React, CLI, or
MCP code. CLI discovery maps files into the shared query layer. MCP tools call a
repository interface and do not read files directly. React consumes the same
facts and viewer protocol without importing MCP or Node modules.

## 13. Packaging

The package becomes publishable and provides one `tracelens` binary. Vite builds
the web viewer and a Node bundler builds the CLI/MCP entry. Runtime dependencies
include the official MCP SDK; React remains a web dependency.

The package includes only built web assets, built Node assets, README, and
LICENSE. A package smoke test installs the generated tarball in a temporary
directory and verifies:

- `tracelens --help`;
- `tracelens mcp` starts and completes an MCP initialization handshake;
- `tracelens setup codex` generates the expected pinned registration command
  with its process runner stubbed;
- required viewer assets are present.

The npm package name must be verified while authenticated before first publish.

## 14. Testing

### Discovery and facts

- current-project ranking, fallback ranking, ties, unsupported files, and active
  file changes;
- Codex and Claude metadata extraction;
- exact repeated-operation grouping;
- error, duration, token, and cost totals;
- parse-cache invalidation by path, modification time, and size.

### Query and privacy

- cursor pagination and every hard result limit;
- snippet and event-detail truncation boundaries;
- no absolute paths in any MCP response;
- overview excludes raw prompt/output content;
- searches cannot cross the selected session;
- log instructions remain inert strings.

### MCP and setup

- tool schemas and structured responses through an in-process MCP client;
- unknown/expired IDs and malformed arguments;
- exact, missing, and conflicting Codex registrations;
- `--force`, missing Codex CLI, and platform-safe argument spawning;
- no test edits the developer's real Codex configuration.

### Viewer and packaging

- authenticated loopback endpoints and no-store/no-CORS behavior;
- session and event deep links;
- session picker ranking and objective labels;
- desktop and 390 px layouts with no overlap;
- existing import, folder, live, tree, flamegraph, diff, search, share, and
  annotation tests remain green;
- packed-tarball installation and MCP handshake.

## 15. Acceptance Criteria

- A new user can connect TraceLens to Codex with one command and no manual config
  editing or API key.
- After starting a new Codex task, asking it to analyze the latest run causes it
  to find current-project sessions through TraceLens tools.
- Codex can explain an observed failure or delay using event IDs that open in the
  local viewer.
- No MCP response contains an absolute path or an unbounded transcript.
- The overview contains objective facts only and does not claim a root cause.
- Viewer-only use works without Codex and does not send trace content externally.
- Assisted-analysis documentation clearly states that selected MCP results enter
  the Codex conversation.
- The TraceLens process makes no external request after package installation.
- Existing trace formats and viewer workflows continue to work.

## 16. Delivery Order

1. Add shared session discovery contracts, objective facts, bounded queries, and
   tests.
2. Add the publishable CLI with `list`, `open`, local viewer serving, and package
   smoke tests.
3. Add MCP schemas, tools, stdio server, and integration tests.
4. Add idempotent `setup codex` with pinned-version registration.
5. Add session overview/picker UI and event deep links to the existing viewer.
6. Update README and in-app wording, including the assisted-analysis privacy
   boundary.
7. Run full tests, type checks, builds, packed installation, MCP handshake, and
   desktop/mobile browser acceptance checks.
