# TraceLens Self-Service Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an unfamiliar Codex user install TraceLens, run one evidence-based analysis of a real local session in three to five minutes, and optionally submit structured first-run feedback without uploading local data.

**Architecture:** A small framework-independent module owns the exact first-run prompt and canonical GitHub feedback URL. The CLI setup output and React loader consume that module, while a GitHub Issue Form collects explicit opt-in feedback. Repository-level contract tests parse the form and check the README so the three public surfaces cannot drift.

**Tech Stack:** TypeScript 5.6, React 18, Vitest 4, Vite 6, Node.js 20+, GitHub Issue Forms, `yaml` 2.9.0 as a test-only dependency.

## Global Constraints

- Keep Node.js `>=20` as declared in `package.json`.
- Ship this work as `@yuleo/tracelens@0.2.2`.
- Use this exact prompt: `Use TraceLens to analyze the most recent abnormal run in this project.`
- Use this canonical feedback URL: `https://github.com/YuLeo926/tracelens/issues/new?template=first-run-feedback.yml`.
- Do not add runtime dependencies, analytics, accounts, a backend, telemetry, new MCP tools, or diagnostic rules.
- Never prefill or submit logs, local paths, code, prompts, secrets, or session content.
- The viewer feedback link appears only on the initial loader surface, not persistently during trace inspection.
- Setup failures retain the existing bounded manual registration command and never claim success.
- Preserve the existing privacy disclosure that MCP evidence enters the current Codex conversation.

---

## File Map

- Create `src/core/firstRun.ts`: canonical prompt and feedback URL shared by browser and CLI code.
- Modify `cli/setupCodex.ts`: render exact self-service next steps after successful setup.
- Modify `cli/setupCodex.test.ts`: lock the success message for new and existing registrations.
- Create `.github/ISSUE_TEMPLATE/first-run-feedback.yml`: public, structured first-run feedback form.
- Create `src/core/firstRunAssets.test.ts`: parse the issue form and verify README/form contracts.
- Modify `package.json` and `package-lock.json`: add test-only `yaml` and later bump the package to `0.2.2`.
- Modify `src/components/Loader.tsx`: add the quiet initial-screen feedback link.
- Create `src/components/Loader.test.tsx`: verify link target, text, and safe external-link attributes.
- Modify `README.md`: replace the current short Codex setup block with the complete self-service funnel and focused troubleshooting.

---

### Task 1: Canonical First-Run Contract and CLI Setup Output

**Files:**
- Create: `src/core/firstRun.ts`
- Modify: `cli/setupCodex.ts`
- Modify: `cli/setupCodex.test.ts`

**Interfaces:**
- Produces: `FIRST_RUN_PROMPT: string` and `FIRST_RUN_FEEDBACK_URL: string` from `src/core/firstRun.ts`.
- Consumes: existing `SetupCodexResult` and unchanged Codex registration logic.
- Preserves: all existing failure messages and the manual `codex mcp add` command.

- [ ] **Step 1: Add failing assertions for the exact success message**

In `cli/setupCodex.test.ts`, add imports and a shared expected message:

```ts
import { FIRST_RUN_FEEDBACK_URL, FIRST_RUN_PROMPT } from "../src/core/firstRun";

const expectedConnectionMessage = [
  "TraceLens is connected to Codex.",
  "Start a new Codex task in the project you want to inspect.",
  `Ask Codex: "${FIRST_RUN_PROMPT}"`,
  "Evidence requested through TraceLens tools becomes part of the Codex conversation.",
  `First-run feedback (optional): ${FIRST_RUN_FEEDBACK_URL}`,
].join("\n");
```

Change the missing-registration test and exact-registration test to require:

```ts
expect(result.message).toBe(expectedConnectionMessage);
```

Change the `runCli setup codex` success assertion to:

```ts
expect(cli.stdout.write).toHaveBeenCalledWith(`${expectedConnectionMessage}\n`);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run cli/setupCodex.test.ts
```

Expected: FAIL because `src/core/firstRun.ts` does not exist and the current message does not include the exact prompt or feedback URL.

- [ ] **Step 3: Add the shared constants**

Create `src/core/firstRun.ts`:

```ts
export const FIRST_RUN_PROMPT =
  "Use TraceLens to analyze the most recent abnormal run in this project.";

export const FIRST_RUN_FEEDBACK_URL =
  "https://github.com/YuLeo926/tracelens/issues/new?template=first-run-feedback.yml";
```

- [ ] **Step 4: Render the exact message from setup**

In `cli/setupCodex.ts`, import the constants and replace `CONNECTION_MESSAGE`:

```ts
import { FIRST_RUN_FEEDBACK_URL, FIRST_RUN_PROMPT } from "../src/core/firstRun";

const CONNECTION_MESSAGE = [
  "TraceLens is connected to Codex.",
  "Start a new Codex task in the project you want to inspect.",
  `Ask Codex: "${FIRST_RUN_PROMPT}"`,
  "Evidence requested through TraceLens tools becomes part of the Codex conversation.",
  `First-run feedback (optional): ${FIRST_RUN_FEEDBACK_URL}`,
].join("\n");
```

Do not change `unavailable`, `isMissing`, conflict handling, or registration replacement behavior.

- [ ] **Step 5: Run focused tests and both type checks**

Run:

```bash
npx vitest run cli/setupCodex.test.ts
npm run typecheck
npm run typecheck:cli
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the CLI contract**

```bash
git add src/core/firstRun.ts cli/setupCodex.ts cli/setupCodex.test.ts
git commit -m "feat: guide Codex users through first analysis"
```

---

### Task 2: Structured GitHub First-Run Feedback Form

**Files:**
- Create: `.github/ISSUE_TEMPLATE/first-run-feedback.yml`
- Create: `src/core/firstRunAssets.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `FIRST_RUN_FEEDBACK_URL` from Task 1.
- Produces: a valid GitHub Issue Form selected by `template=first-run-feedback.yml`.
- Produces: a repository asset test that later also verifies README onboarding content.

- [ ] **Step 1: Install the YAML parser as a test-only dependency**

Run:

```bash
npm install --save-dev yaml@2.9.0
```

Expected: only `package.json` and `package-lock.json` dependency metadata change; `yaml` is not added to `dependencies`.

- [ ] **Step 2: Write the failing form contract test**

Create `src/core/firstRunAssets.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { FIRST_RUN_FEEDBACK_URL } from "./firstRun";

interface FormOption {
  label: string;
  required?: boolean;
}

interface FormField {
  type: string;
  id?: string;
  attributes?: {
    value?: string;
    description?: string;
    options?: Array<string | FormOption>;
  };
  validations?: { required?: boolean };
}

interface IssueForm {
  name: string;
  description: string;
  body: FormField[];
}

const formText = readFileSync(
  new URL("../../.github/ISSUE_TEMPLATE/first-run-feedback.yml", import.meta.url),
  "utf8",
);
const form = parse(formText) as IssueForm;
const byId = new Map<string, FormField>(
  form.body.flatMap((field) => (field.id ? [[field.id, field] as const] : [])),
);

describe("first-run feedback assets", () => {
  it("uses the dedicated GitHub issue form URL", () => {
    expect(FIRST_RUN_FEEDBACK_URL).toBe(
      "https://github.com/YuLeo926/tracelens/issues/new?template=first-run-feedback.yml",
    );
  });

  it("requires the fields needed to evaluate first-run success", () => {
    expect(form.name).toBe("First-run feedback");
    expect(form.description).toContain("first Codex analysis");
    for (const id of ["operating-system", "codex-surface", "setup", "session-selection", "analysis-useful", "reuse"]) {
      expect(byId.get(id)?.type).toBe("dropdown");
      expect(byId.get(id)?.validations?.required).toBe(true);
    }
  });

  it("warns that the issue is public and requires a privacy acknowledgement", () => {
    const markdown = form.body.find((field) => field.type === "markdown")?.attributes?.value ?? "";
    expect(markdown).toContain("public");
    expect(markdown).toContain("Do not include logs, local paths, secrets, private code, prompts, or conversation contents.");

    const privacy = byId.get("privacy");
    expect(privacy?.type).toBe("checkboxes");
    expect(privacy?.attributes?.options).toContainEqual({
      label: "I have not included private project or session data.",
      required: true,
    });
  });
});
```

- [ ] **Step 3: Run the asset test and verify it fails**

Run:

```bash
npx vitest run src/core/firstRunAssets.test.ts
```

Expected: FAIL with `ENOENT` because the issue form does not exist.

- [ ] **Step 4: Create the GitHub Issue Form**

Create `.github/ISSUE_TEMPLATE/first-run-feedback.yml`:

```yaml
name: First-run feedback
description: Tell us whether TraceLens completed a useful first Codex analysis.
title: "[First run] "
body:
  - type: markdown
    attributes:
      value: |
        Thanks for trying TraceLens. This issue is public.

        Do not include logs, local paths, secrets, private code, prompts, or conversation contents.
  - type: dropdown
    id: operating-system
    attributes:
      label: Operating system
      options:
        - Windows
        - macOS
        - Linux
        - Other
    validations:
      required: true
  - type: dropdown
    id: codex-surface
    attributes:
      label: Codex surface
      options:
        - Codex CLI
        - Codex Desktop
        - Other
    validations:
      required: true
  - type: dropdown
    id: setup
    attributes:
      label: Did setup complete?
      options:
        - "Yes"
        - "No"
        - "Unsure"
    validations:
      required: true
  - type: dropdown
    id: session-selection
    attributes:
      label: Did TraceLens select the correct session?
      options:
        - "Yes"
        - "No"
        - "Unsure"
        - Analysis was not reached
    validations:
      required: true
  - type: dropdown
    id: analysis-useful
    attributes:
      label: Was the analysis useful?
      options:
        - "Yes"
        - "Partly"
        - "No"
        - Analysis was not reached
    validations:
      required: true
  - type: dropdown
    id: reuse
    attributes:
      label: Would you use TraceLens again?
      options:
        - "Yes"
        - "Maybe"
        - "No"
    validations:
      required: true
  - type: textarea
    id: details
    attributes:
      label: Optional details
      description: This text will be public. Describe the step that helped or failed without including project or session data.
    validations:
      required: false
  - type: checkboxes
    id: privacy
    attributes:
      label: Privacy check
      options:
        - label: I have not included private project or session data.
          required: true
```

- [ ] **Step 5: Run the asset test and type check**

Run:

```bash
npx vitest run src/core/firstRunAssets.test.ts
npm run typecheck
```

Expected: PASS. `yaml` must remain in `devDependencies` only.

- [ ] **Step 6: Commit the feedback form**

```bash
git add .github/ISSUE_TEMPLATE/first-run-feedback.yml src/core/firstRunAssets.test.ts package.json package-lock.json
git commit -m "feat: collect opt-in first-run feedback"
```

---

### Task 3: Quiet Feedback Link on the Initial Viewer Surface

**Files:**
- Modify: `src/components/Loader.tsx`
- Create: `src/components/Loader.test.tsx`

**Interfaces:**
- Consumes: `FIRST_RUN_FEEDBACK_URL` from Task 1.
- Produces: one external `First-run feedback` link on `Loader` only.
- Preserves: current file loading, folder watch, samples, error handling, and theme behavior.

- [ ] **Step 1: Write the failing loader test**

Create `src/components/Loader.test.tsx`:

```tsx
// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FIRST_RUN_FEEDBACK_URL } from "../core/firstRun";
import { ThemeProvider } from "../theme/ThemeProvider";
import { Loader } from "./Loader";

describe("Loader first-run feedback", () => {
  it("links to the opt-in public feedback form without interrupting the loader", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <ThemeProvider>
        <Loader onLoad={vi.fn()} onError={vi.fn()} />
      </ThemeProvider>,
    );

    const link = document.querySelector<HTMLAnchorElement>("a[data-first-run-feedback]");
    expect(link?.textContent).toBe("First-run feedback");
    expect(link?.href).toBe(FIRST_RUN_FEEDBACK_URL);
    expect(link?.target).toBe("_blank");
    expect(link?.rel.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/components/Loader.test.tsx
```

Expected: FAIL because the loader does not render the feedback link.

- [ ] **Step 3: Add the loader link**

Import `FIRST_RUN_FEEDBACK_URL` in `src/components/Loader.tsx` and add this after the samples block, inside the centered loader content:

```tsx
<a
  data-first-run-feedback
  href={FIRST_RUN_FEEDBACK_URL}
  target="_blank"
  rel="noopener noreferrer"
  className="text-[11px] text-faint underline decoration-border underline-offset-4 hover:text-muted"
>
  First-run feedback
</a>
```

Do not add the link to `AppShell`, `TopBar`, `Rail`, session views, or trace detail views.

- [ ] **Step 4: Run the focused test, integration test, and build**

Run:

```bash
npx vitest run src/components/Loader.test.tsx src/App.integration.test.tsx
npm run typecheck
npm run build:web
```

Expected: all commands PASS and the loader remains responsive.

- [ ] **Step 5: Manually inspect desktop and mobile loader layouts**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Verify at `1440x900` and `390x844`:

- the feedback link is below the sample grid;
- the file drop target and primary folder button remain visually dominant;
- no text overlaps or horizontal scrolling appears;
- opening a sample removes the loader and therefore removes the feedback link.

- [ ] **Step 6: Commit the viewer entry point**

```bash
git add src/components/Loader.tsx src/components/Loader.test.tsx
git commit -m "feat: expose first-run feedback from loader"
```

---

### Task 4: Self-Service README and Troubleshooting Contract

**Files:**
- Modify: `README.md`
- Modify: `src/core/firstRunAssets.test.ts`

**Interfaces:**
- Consumes: the setup command, exact prompt, canonical feedback URL, and existing viewer command.
- Produces: a three-to-five-minute quickstart and bounded troubleshooting section.
- Preserves: the deeper viewer feature documentation and privacy explanation.

- [ ] **Step 1: Extend the asset test with failing README assertions**

Add to `src/core/firstRunAssets.test.ts`:

```ts
import { FIRST_RUN_FEEDBACK_URL, FIRST_RUN_PROMPT } from "./firstRun";

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

it("keeps the self-service quickstart aligned with the product contract", () => {
  expect(readme).toContain("## Analyze a Codex run");
  expect(readme).toContain("npx @yuleo/tracelens setup codex");
  expect(readme).toContain(FIRST_RUN_PROMPT);
  expect(readme).toContain(FIRST_RUN_FEEDBACK_URL);
  expect(readme).toContain("### What success looks like");
  expect(readme).toContain("### First-run troubleshooting");
});
```

Consolidate the existing `FIRST_RUN_FEEDBACK_URL` import rather than adding a duplicate import declaration.

- [ ] **Step 2: Run the asset test and verify it fails**

Run:

```bash
npx vitest run src/core/firstRunAssets.test.ts
```

Expected: FAIL because the current README lacks the new headings and direct feedback link.

- [ ] **Step 3: Replace the current Codex first-use block**

Replace `## First use with Codex` through the paragraph before `## Why` with this structure and copy:

````markdown
## Analyze a Codex run

**Prerequisites:** Node.js 20 or newer, the Codex CLI for MCP registration, and at least one local Codex session.

Connect TraceLens to Codex:

```bash
npx @yuleo/tracelens setup codex
```

Start a new Codex CLI or Desktop task that can access the registered MCP server, in the project you want to inspect, then ask:

> Use TraceLens to analyze the most recent abnormal run in this project.

TraceLens ranks recent sessions for the current project and gives Codex bounded, read-only evidence. No separate model API or TraceLens account is required.

### What success looks like

Codex should identify the selected session, explain what happened, and cite one or more TraceLens event IDs. You can ask it to open the cited evidence in the local viewer, or run the viewer directly:

```bash
npx @yuleo/tracelens
```

An incomplete log may support observations without proving a root cause. Treat the cited events as the source of truth.

[Share first-run feedback](https://github.com/YuLeo926/tracelens/issues/new?template=first-run-feedback.yml) after trying the flow. The form is optional and public; do not include logs, paths, secrets, private code, prompts, or conversation contents.

### First-run troubleshooting

- **TraceLens tools are missing:** start a new Codex task after setup.
- **No supported sessions were found:** run Codex in the project first, or open a supported file with `npx @yuleo/tracelens open <file>`.
- **The wrong project session was selected:** start the Codex task from the intended project directory and ask TraceLens to list the candidate sessions before choosing one.
- **A different TraceLens registration already exists:** inspect it with `codex mcp get tracelens --json`; replace it only when intended with `npx @yuleo/tracelens setup codex --force`.
- **You want to verify the evidence:** ask Codex for a TraceLens viewer link or run `npx @yuleo/tracelens list`.

Setup is idempotent and pins the installed TraceLens version. Evidence requested through MCP enters the current Codex conversation and follows that conversation's data handling. Log text is treated as untrusted evidence and is never executed by TraceLens.
````

Keep the existing MCP tool table immediately after this quickstart, before `## Why`, because it supports users who want to understand the evidence surface.

- [ ] **Step 4: Run README contract and full documentation-adjacent checks**

Run:

```bash
npx vitest run src/core/firstRunAssets.test.ts cli/setupCodex.test.ts src/components/Loader.test.tsx
npm run typecheck
npm run typecheck:cli
git diff --check
```

Expected: all commands PASS and `git diff --check` prints nothing.

- [ ] **Step 5: Verify every documented command against installed CLI help**

Run:

```bash
npm run build:cli
node dist-cli/index.js --help
```

Expected: help includes `open`, `list`, `mcp`, and `setup codex`; every README command uses one of those supported forms.

- [ ] **Step 6: Commit the self-service documentation**

```bash
git add README.md src/core/firstRunAssets.test.ts
git commit -m "docs: add self-service Codex quickstart"
```

---

### Task 5: Prepare and Verify the 0.2.2 Release Candidate

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: all completed onboarding tasks.
- Produces: a clean, tested `@yuleo/tracelens@0.2.2` package candidate.
- Preserves: the existing package file allowlist and MCP handshake behavior.

- [ ] **Step 1: Bump package metadata without creating a tag**

Run:

```bash
npm version 0.2.2 --no-git-tag-version
```

Expected: `package.json` and `package-lock.json` both report `0.2.2`; no Git tag or commit is created.

- [ ] **Step 2: Run the complete automated verification gate**

Run:

```bash
npm test
npm run typecheck
npm run typecheck:cli
npm run build
npm run pack:check
git diff --check
```

Expected: every command PASS, the package smoke test completes a real MCP handshake, and no temporary tarball remains in the repository.

- [ ] **Step 3: Inspect packed contents and version**

Run:

```bash
npm pack --dry-run --json
node -e "const p=require('./package.json'); if(p.version!=='0.2.2') process.exit(1)"
```

Expected: the packed files contain `dist`, `dist-cli`, `README.md`, and `LICENSE`; `.github`, source tests, and local traces are absent.

- [ ] **Step 4: Run a clean local first-run rehearsal**

From a temporary install directory, install the packed tarball. Point `CODEX_HOME` at a separate temporary directory before running setup so the rehearsal cannot change the user's normal Codex registration. Keep the normal home directory available only when selecting a real local session for the manual analysis.

```bash
npx tracelens setup codex
```

Expected output contains the exact prompt, the evidence disclosure, and the canonical first-run feedback URL. Start a new Codex task and verify that TraceLens returns a selected session plus event IDs.

- [ ] **Step 5: Commit the release candidate**

```bash
git add package.json package-lock.json
git commit -m "release: prepare TraceLens 0.2.2"
```

- [ ] **Step 6: Confirm the repository is ready for external release**

Run:

```bash
git status --short --branch
git log -6 --oneline
```

Expected: the worktree is clean and `main` is ahead of `origin/main` only by the reviewed design, plan, implementation, documentation, and release commits.

---

### Task 6: Publish, Verify, and Update the Existing Reddit Thread

**Files:**
- No source file changes expected.

**Interfaces:**
- Consumes: the clean 0.2.2 release candidate from Task 5.
- Produces: pushed source, successful GitHub Pages deployment, public npm 0.2.2, a working public feedback form, and one update appended to the existing Reddit post.

- [ ] **Step 1: Obtain explicit confirmation for external publication**

Before mutating npm, GitHub, or Reddit, show the tested version, commit list, and clean status. Continue only after the user confirms publishing 0.2.2 and editing the existing Reddit post.

- [ ] **Step 2: Push source and wait for CI/Pages**

Run:

```bash
git push origin main
gh run list --repo YuLeo926/tracelens --limit 3
```

Wait for the workflow created by the 0.2.2 commit. Expected: build and deploy jobs both finish successfully before npm publication.

- [ ] **Step 3: Verify npm identity and publish**

Run:

```bash
npm whoami
npm publish --access public
npm view @yuleo/tracelens version
```

Expected: the authenticated npm account owns the scope and the final command prints `0.2.2`.

- [ ] **Step 4: Verify a fresh public installation**

Use a new system temporary directory, an isolated `CODEX_HOME`, and a project directory containing a supported sample session. Run:

```bash
npx -y @yuleo/tracelens@0.2.2 --help
npx -y @yuleo/tracelens@0.2.2 setup codex
codex mcp get tracelens --json
```

Expected registration transport:

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@yuleo/tracelens@0.2.2", "mcp"]
}
```

Remove only the verified system temporary directory after the check. Do not alter the user's normal Codex home during this rehearsal.

- [ ] **Step 5: Verify the hosted UI and feedback form**

Open:

```text
https://yuleo926.github.io/tracelens/
https://github.com/YuLeo926/tracelens/issues/new?template=first-run-feedback.yml
```

Verify the deployed loader shows the quiet feedback link, the form renders all required dropdowns, the public/privacy warning appears before the optional details field, and the form contains no prefilled local data. Do not submit a test issue.

- [ ] **Step 6: Append the verified update to the existing Reddit post**

Append this text to the original post only after public verification:

```markdown
**Update:** A comment here pointed out that finding the right session can be harder than reading it. TraceLens can now run as a local, read-only MCP tool for Codex: it ranks recent sessions for the current project and gives Codex bounded evidence to analyze.

Quickstart: `npx @yuleo/tracelens setup codex`

Then start a new Codex task in the project and ask: "Use TraceLens to analyze the most recent abnormal run in this project."

The browser viewer is still available. First-run feedback is optional and does not upload logs automatically: https://github.com/YuLeo926/tracelens/issues/new?template=first-run-feedback.yml
```

Do not create a second promotional post during this validation round.

- [ ] **Step 7: Record final release evidence**

Report:

- published npm version;
- Git commit and pushed branch;
- successful GitHub Actions run URL;
- GitHub Pages URL;
- public issue-form URL;
- Reddit thread URL;
- fresh-install and MCP registration result;
- any step that could not be verified.

Do not count downloads, stars, or page views as successful activations. The 30-day result is determined by submitted first-run feedback forms.
