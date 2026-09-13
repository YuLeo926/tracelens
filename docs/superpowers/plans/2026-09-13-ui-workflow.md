# TraceLens UI Workflow Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task in the current workspace. Preserve all existing uncommitted fixes. Do not publish or commit without a separate request.

**Goal:** Make finding a session and reading its evidence consistent and usable on desktop and narrow screens.

**Architecture:** Keep parsing, MCP, pricing and privacy rules intact. Share the run overview across sources; isolate search and export coordination into hooks. Use responsive master/detail navigation and retain list state while inspecting a run.

**Tech Stack:** React 18, TypeScript, Tailwind, Vitest; Lucide for interface icons.

**Spec:** `output/ui-audit/review.md`, approved by the user on 2026-09-13.

## Global Constraints

- No replacement framework, cloud service, independent AI engine, pricing-table changes, or automatic diagnosis.
- Missing lifecycle remains unknown; preserve exact source/event identities in local navigation.
- Export previews remain frozen snapshots with explicit confirmation and unchanged source logs.
- Existing local-session URLs, stale-request protection and annotation isolation remain covered by integration tests.

## Task 1: Evidence and responsive navigation

Files: `AppShell.tsx`, `TopBar.tsx`, `Rail.tsx`, `SpanDetail.tsx`, `SpanRow.tsx`, `Loader.tsx`, `styles/index.css`; add `EvidenceText.tsx` and component regression tests.

- [x] Write regression assertions for evidence-before-annotation order, a keyboard-operable import button, and disclosure labels.
- [x] Implement a full-width narrow-screen detail mode with a Back to events command. Desktop retains a collapsible detail pane. Render event names before optional waterfall/model columns. Use labeled Lucide controls.
- [x] Verify focus restoration, overflow, and primary actions at 390x844 and 1280x800.

## Task 2: Shared run overview and session continuity

Files: `App.tsx`, `SessionOverview.tsx`, `FolderBrowser.tsx`, `ConversationList.tsx`, `SessionPicker.tsx`; add `core/session/browserSummary.ts` and tests.

- [x] Assert `browserSessionSummary(trace, label, source)` produces objective facts with unknown lifecycle when absent; repeated operations appear once.
- [x] Default manual imports and selected folder runs to the same overview used by local sessions. Keep Follow newest in the tree. Provide Sessions in the persistent toolbar when the source supports it.
- [x] Keep folder list mounted while hidden, preserve picker filters and scroll state, and reset them when the source changes.
- [x] Run integration tests for back-navigation, filtering, local event deep links and annotation isolation.

## Task 3: Focused state ownership and export readability

Files: `App.tsx`, `SharePreviewDialog.tsx`; add `useTraceSearch.ts`, `useExportReview.ts`, and `EvidenceText.tsx`.

- [x] Extract search traversal and export snapshot state without changing wire contracts. Protect export from late asynchronous actions after a source reset.
- [x] Add readable event and complete JSON modes to the frozen export snapshot. Search filters the preview only, never the exported data; confirmation applies to the entire export.
- [x] Verify unchanged export payload, fresh confirmation for each export, unavailable-cost behavior, and stale navigation guards.

## Task 4: Final verification

- [x] Run `npm test`, `npm run build`, `npm run pack:check`, and `node dist-cli/index.js check --json`.
- [x] Exercise import, overview, errors, mobile detail/back, folder/filter restoration and export in a real browser with synthetic logs. Save and inspect screenshots; do not upload personal logs.
- [x] Update the README with the changed workflow and return the local preview URL. Leave changes uncommitted and unpublished.

Verification: `output/playwright/ui-workflow/verification.md`. Preview: http://127.0.0.1:5173/.
