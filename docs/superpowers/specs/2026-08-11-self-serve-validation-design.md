# TraceLens Self-Service Validation Design

**Date:** 2026-08-11  
**Status:** Approved for planning  
**Target release:** 0.2.2

## 1. Goal

Validate that unfamiliar Codex users can independently install TraceLens and
complete one useful analysis of a real local session within three to five
minutes.

The 30-day target is at least five valid first-run feedback submissions. At
least four users should complete installation and receive an analysis, at least
three should confirm that TraceLens selected the right session, and at least
three should find the analysis useful and say they would use TraceLens again.

## 2. Product Decision

This phase uses a fully self-service funnel. TraceLens will improve onboarding
and offer an optional GitHub feedback form, but it will not add analytics,
accounts, a backend, or automated telemetry.

The browser viewer remains the human evidence surface. The MCP integration
remains the assisted-analysis path: TraceLens finds and exposes bounded local
evidence, while Codex performs the reasoning.

## 3. Non-Goals

- New MCP tools or diagnostic rules.
- A return to the superseded deterministic Doctor implementation.
- Anonymous analytics or installation tracking.
- Uploading logs, project paths, source code, prompts, or session contents.
- Supporting another provider or trace format during this release.
- A new promotional post that duplicates the existing Reddit thread.

## 4. First-Run Funnel

The README and product should present one primary Codex path:

1. Confirm Node.js 20 or newer, Codex, and at least one local Codex session.
2. Run `npx @yuleo/tracelens setup codex`.
3. Start a new Codex task in the project whose run should be inspected.
4. Ask: `Use TraceLens to analyze the most recent abnormal run in this project.`
5. Codex selects a current-project session, summarizes its findings, and cites
   TraceLens event IDs.
6. The user checks whether the selected session and findings match the real run.
7. The user may open the TraceLens viewer to inspect cited evidence.
8. The user may submit first-run feedback through GitHub.

A successful activation requires an evidence-based analysis of a real local
session. Installing the MCP server or opening the viewer alone does not count.

## 5. Onboarding Changes

### README

The top of the README will contain a compact `Analyze a Codex run` quickstart.
It will state the prerequisites, show the setup command and exact prompt, define
what successful output looks like, and link to focused troubleshooting.

Successful output means that Codex identifies the selected session, explains
what happened, and cites one or more TraceLens event IDs. The README will not
promise a correct root cause when the recorded evidence is incomplete.

Troubleshooting will cover only the likely first-run blockers:

- the tools do not appear until a new Codex task is started;
- no supported local sessions are found;
- the selected session is not from the intended project;
- an existing TraceLens MCP registration points at a different version;
- the user wants to verify evidence in the browser viewer.

### Setup Output

Successful `setup codex` output will print:

- confirmation that TraceLens is connected;
- the instruction to start a new Codex task in the target project;
- the exact first-run analysis prompt;
- the existing disclosure that requested evidence enters the Codex
  conversation;
- an optional first-run feedback link.

The same next step must be printed for both a new registration and an already
correct registration. Failure output must retain the current manual registration
command and must not claim that setup succeeded.

### Web Viewer

The initial/empty loading surface will include a quiet `First-run feedback`
link. The link will not be shown as a persistent banner while a user is
inspecting a trace, and no modal or automatic prompt will interrupt the viewer.

## 6. Feedback Form

Add a GitHub Issue Form dedicated to first-run feedback. It will request:

- operating system;
- Codex CLI or Codex Desktop;
- whether setup completed;
- whether the correct session was selected;
- whether the analysis was useful;
- whether the user would use TraceLens again;
- an optional problem description.

The form will explicitly tell users not to include logs, local paths, secrets,
private code, prompts, or conversation contents. A submitted issue is public,
and the form must say so before the free-text field.

The README, successful setup output, and web viewer will use the same canonical
feedback URL. The URL should open the dedicated issue form rather than the
generic issue chooser.

## 7. Measurement

Primary evidence is the submitted first-run form because it confirms the actual
outcome. npm downloads, GitHub stars, page views, and Reddit votes are exposure
signals only and do not count as successful activations.

After 30 days, decisions follow the dominant failure category:

- low traffic or no feedback: improve distribution and the feedback call to
  action;
- setup failures: repair installation and registration;
- wrong session selection: improve project matching and ranking;
- correct session but weak analysis: improve the evidence surface or analysis
  guidance;
- successful and useful analyses: continue distribution before adding features.

## 8. Privacy and Error Handling

TraceLens will not submit feedback automatically. Opening or submitting the
GitHub form is a deliberate user action. No local value will be inserted into
the form automatically.

Existing privacy boundaries remain unchanged: the browser viewer is
client-side, the MCP server is local and read-only, and evidence requested by
Codex becomes part of the current Codex conversation.

Setup errors must remain actionable and bounded. The CLI may print a manual MCP
registration command, but it must not expose session paths or attempt to repair
unrelated Codex configuration.

## 9. Verification

Automated verification will cover:

- setup output for a new registration;
- setup output for an already correct registration;
- existing-registration and unavailable-Codex failures;
- the canonical feedback URL used by the relevant product surfaces;
- the GitHub Issue Form structure and required privacy warning;
- the existing full unit and integration suite;
- TypeScript checks, production build, packed-package smoke test, and MCP
  handshake.

Manual verification will use a clean installed package and a real local Codex
session. It will confirm that the README can be followed without repository
knowledge, the exact prompt triggers TraceLens tools in a new task, event IDs
appear in the answer, the viewer can open cited evidence, and the feedback form
opens without prefilled private data.

## 10. Release and Distribution

Ship the onboarding changes as patch release `0.2.2`. Publish the npm package,
push the repository changes, verify GitHub Pages and CI, and run a fresh public
package installation.

After verification, append a concise update to the existing Reddit post and
link to the updated quickstart. Do not create a duplicate promotional post for
this validation round.
