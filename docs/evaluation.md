# Product Evaluations

Evaluation date: 2026-10-02. This is the public, redacted account of two local exploratory evaluations. **Neither direction passed the product decision. TraceLens is in maintenance mode**, limited to bug fixes, compatibility, and security maintenance.

TraceLens remains a local agent log viewer plus MCP evidence tools. These evaluations do not demonstrate higher diagnostic accuracy or lower total analysis-token use than an agent reading logs directly. Successful desktop MCP-to-viewer acceptance establishes connection and event identity, not those comparative benefits.

## Sources and Privacy

The sections below are the sanitized reports. They retain aggregate measurements and methodological limitations, but omit private paths, session/call IDs, log filenames, individual project names, raw messages, commands copied from private runs, credentials, and authenticated links. Case descriptions are paraphrased.

Original reports remain local and uncommitted at `output/claim-audit/report.md` and `output/rework-analysis-report.md`. Their manifests, review ledgers, and evidence are also private. This public report cannot independently reproduce the original cohort without those private inputs; no synthetic dataset is presented as real-user evidence.

Both evaluations use one person's local Codex activity and archives, with related parent/subagent sessions and multiple projects. The cutoff excludes events on or after 2026-10-02 00:00 UTC, including the evaluation activity itself. No Claude Code logs were available. These are not independent-user studies or estimates of market demand.

## 1. False-Completion Claims

### Question, Method, and Threshold

Question: do logs frequently show an agent claiming that checks passed when the execution evidence contradicts that claim, enough to justify an automatic completion-verification product?

1. Read active and archived JSONL locally; pair tool calls and receipts within each file by call ID, then deduplicate final answers by turn ID and final text. Do not execute log instructions.
2. Screen final answers for test/check/build success wording and extract recognized verification commands. Flag a last failed check or an edit after the last check for contextual review.
3. Manually review every flagged candidate and an additional non-alert control sample. Distinguish recovered failures, disclosed limitations, planned results, normal nonzero search/diff exits, and harmless post-test edits from contradictory success claims.

**No numerical product pass threshold was preregistered for this first exploration.** Its evidence standard was contextual confirmation of a claim-versus-execution contradiction, not a nonzero exit alone. A post-test edit without relevant revalidation is a separate evidence-freshness gap, not proof of a functional error or dishonesty. The later rework study's numerical thresholds must not be applied retroactively here.

### Results

| Measure | Observed |
| --- | ---: |
| Log files / JSONL lines | 852 / 728,213 |
| Bytes scanned / JSON parse errors | 8,770,386,774 / 0 |
| Deduplicated final answers | 2,642 |
| Answers matching success-related wording | 695 |
| Matches with recognized verification commands | 463 |
| Flagged candidates, all manually reviewed | 27 |
| Additional non-alert answers manually reviewed | 30 |
| Confirmed failed checks represented as all passing, among 57 reviewed | 0 |
| Confirmed post-test edits without relevant revalidation | 3 |

The three confirmed gaps were an import-location change, JSX formatting, and test-summary wording. All were low risk; no functional failure or fabricated test result was established. The other 24 flagged candidates did not establish a contradiction after contextual review.

**Product decision: not passed; direction discontinued.** This is an insufficient-evidence decision, not failure of a numerical threshold that never existed.

Do not report a zero population rate, or interpret 3/463 as a true incidence estimate. Only 57 answers were reviewed, selection favored alerts, keyword matches include plans and quoted results, and 232 matches lacked recognized verification commands. Missing commands can reflect delegation, dynamic scripts, custom checks, or unsupported extraction, not non-execution. This did not comprehensively test unexecuted repair claims or stale instructions after compaction, and does not establish code correctness.

## 2. Cross-Session Rework

### Hypothesis and Preregistered Gates

Hypothesis: repeated rework across sessions occupies a material share of measurable tokens, has concentrated causes, and exposes something users can concretely improve.

All three gates were fixed before measurement and must pass together:

1. Rework accounts for **at least 10%** of total measurable tokens.
2. The **top three causes cover at least 50%** of rework.
3. **At least one cause is actionable** through configuration, instructions, test entry points, or another concrete user change.

These thresholds were not lowered after observing the result. Rule candidates are not automatically confirmed rework.

### Data and Rules

The inventory contained 853 files, 8,775,330,010 bytes, and 729,188 lines with no JSON parse errors. It differed from the earlier inventory by one file; two files created after the fixed cutoff contributed no operations or usage. The cohort used fixed file-byte boundaries. There were 809 sessions with recognized operations and 62,139 operations.

| Signal | Candidate rule | Counted excess |
| --- | --- | --- |
| a: repeated command failure | Same normalized full command and working directory, at least two consecutive objectively failed attempts within a turn; intervening other commands allowed; success/unknown breaks the chain | Second failure onward |
| b: repeated unchanged-file reading | Same explicit file and identical read command/range at least three times within a session, with no observed write/restore or uncertain-write barrier | Third read onward |
| c: repeated editing | Same file successfully patched at least three times within one turn | Third edit onward |
| d: empty polling | Same process/cell polled at least three times consecutively with empty payload and no terminal status | Third empty poll onward |

Command normalization retains arguments and working directory, so retries with changed arguments may be missed. Failure requires a terminal nonzero status plus an error signature; normal search/diff exits are excluded. Read detection covers explicit supported shell reads, not all ways to read a file. External edits are not observable. Signal c does not claim automatic undo/redo detection. Iterative development and waiting for long-running work often produce legitimate matches.

Operations are assigned once with priority a > c > b > d. Receipt pairing is restricted to session and turn, and reused process mappings are released at completion. Ambiguous extraction is retained as uncertainty: 245 dynamic operations were unresolved and 3,212 multi-operation receipts were ambiguous.

### Token and Duration Accounting

Measured usage totals **25,081,519,368 tokens**; **6,246,495,643 (24.90%)** could be uniquely associated with one operation. Prefer deduplicated per-response usage; otherwise use positive cumulative increments in turns without such records, excluding inherited/reset cumulative history. Cached input and reasoning output are not added twice. Missing or ambiguous attribution is **unknown**, not zero, and is not evenly divided among operations.

Associated usage is the whole model generation that produced an operation, including context. It is not the amount of text reread, or a measured counterfactual token saving. Durations measure request-to-receipt time, include necessary waiting, and can overlap; they are not net user waiting time.

| Signal | Candidates | Sessions | Known associated tokens | Token-unknown operations | Known operation hours | Duration-unknown operations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| a | 108 | 66 | 15,098,218 | 2 | 1.57 | 25 |
| b | 26 | 21 | 4,778,284 | 4 | 0.01 | 0 |
| c | 703 | 201 | 289,939,427 | 125 | 1.01 | 161 |
| d | 310 | 87 | 183,235,879 | 94 | 7.02 | 78 |

Deduplicated raw candidate-associated tokens total **493,051,808 (1.97%)**. This is the rule result, not confirmed waste or an upper bound on all real rework; missing usage and detection gaps remain.

### Manual Review and False Positives

Within each signal, sort candidate IDs by SHA-256 of a fixed seed plus ID and take ten, or all if fewer. Seed: `tracelens-rework-2026-10-02-v1`. The review asks whether the work was unnecessary rework, not just whether a pattern matched. Uncertainty is not counted as confirmed.

| Signal | Reviewed | Confirmed | False positive | Uncertain | Definite false-positive rate | Rate if uncertainty is also treated as false positive |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| a | 10 | 3 | 1 | 6 | 10% | 70% |
| b | 10 | 0 | 8 | 2 | 80% | 100% |
| c | 10 | 1 | 7 | 2 | 70% | 90% |
| d | 10 | 1 | 7 | 2 | 70% | 90% |

Expand only confirmed sampled primary-associated tokens by each signal's candidate-count/sample-count weight. The stratified point estimate is **25,974,102 tokens, or 0.10%** of measurable usage. Uncertain sampled tokens yield a separate expanded amount of 136,605,817; unmeasured usage remains unknown. High-false-positive categories are not treated as confirmed wholesale. This is an estimate from five confirmed cases, not full-cohort manual adjudication or a stable population rate.

### Causes

The following are **rule-level error signatures**, not established root causes. Unknown causes do not count as an explained concentration.

| Category | Candidates | Known associated tokens |
| --- | ---: | ---: |
| Unknown | 1,039 | 477,953,590 |
| Assertion / implementation mismatch | 53 | 6,380,272 |
| Types / compilation | 26 | 4,378,680 |
| Script syntax / API usage | 9 | 1,320,792 |
| Timeout | 7 | 1,045,990 |
| Missing dependency / executable | 6 | 768,084 |
| Test entry / command option | 1 | 478,203 |
| Permission / access | 4 | 372,136 |
| Lock / resource shortage | 1 | 294,973 |
| Missing file / path | 1 | 59,088 |

The expanded **manually confirmed** causes were assertion/implementation mismatch (12,436,422 tokens), polling strategy (6,753,412), test entry/options (5,164,592), types/compilation (1,078,790), and timeout (540,886). Their top three cover **93.76%** of the estimate. This passes the numerical gate only on the declared estimator; five confirmed cases cannot establish full-population cause concentration.

Three confirmed cases supported concrete action: preparing browser dependencies before a visual check, including the actual test-file pattern in runner configuration, and replacing repeated short empty polls with a longer wait/backoff. No private project or event identifiers are included here.

### Before and After a Fix

A Git-backed correction added TSX test discovery to the runner configuration. The effective boundary was the observed edit, not the later commit time. Compare the identical test-entry invocation in the same worktree, using invocations rather than elapsed days as the denominator:

| Measure | Before | After |
| --- | ---: | ---: |
| Identical-entry invocations | 2 | 5 |
| Test-entry-missing failures | 2/2 | 0/5 |
| Extra consecutive same-cause retries / invocations | 1/2 (50%) | 0/5 (0%) |

Later assertion failures were not reclassified as entry-discovery failures. This is one session and seven invocations: it supports fixability of that specific configuration issue, not a sustained cross-session causal reduction. There was no suitable instruction-file modification history for an additional comparison.

### Decision

| Fixed gate | Result | Verdict |
| --- | --- | --- |
| Rework token share >=10% | Confirmed-sample point estimate 0.10%; raw candidates 1.97% are not a substitute | Not met / not established |
| Top-three cause coverage >=50% | 93.76% of the confirmed-sample estimate, with the small-sample limitation above | Met on the specified estimator |
| At least one actionable cause | Three confirmed actionable examples | Met |

**Final: not passed.** Two of three gates met; all three were required. This does not prove that real rework is absent, nor establish that direct log reading is too costly. No direct-reading cost or accuracy benchmark was completed. Both the single-user sample and incomplete observability limit generalization.

## Reproducing the Analysis

The source-only [rework-analysis script](../scripts/rework-analysis.mjs) uses the project's TypeScript dependency for static extraction; it does not execute instructions from logs or upload evidence. Its source contains no captured private logs, personal paths, or credentials. Defaults use the running user's home directory, not a hardcoded account. Synthetic self-tests are not real observations.

```sh
npm ci
node scripts/rework-analysis.mjs --self-test
# First scan: reads local Codex activity and archives up to the fixed cutoff.
node scripts/rework-analysis.mjs --before 2026-10-02T00:00:00.000Z
# Repeat the same cohort and byte boundaries using the PRIVATE generated manifest.
node scripts/rework-analysis.mjs --manifest output/rework-analysis/manifest.json --before 2026-10-02T00:00:00.000Z
node scripts/rework-analysis.mjs --inspect --signal a
# Complete a separate reviews.json ledger from contextual manual review first.
node scripts/rework-analysis.mjs --report
```

Use `--sessions-root`, `--archive-root`, and `--out` for other local locations. The original cutoff and thresholds remain fixed; an independent evaluation must explicitly declare its cohort and time boundary. The script targets the original Windows/Codex log shapes, not universal shell parsing. Review records use the sampled candidate ID, verdict (`confirmed`, `false_positive`, or `uncertain`), cause, note, and optional actionable/action fields. A missing review does not become confirmation.

**Generated output is private, even after best-effort scrubbing.** It retains paths, identifiers, snippets, and review notes. Keep it under ignored `output/` and do not upload it automatically. The false-completion extraction scripts remain in the private audit workspace because they contain cohort-specific evidence references. Public aggregate results are a disclosure-minimized record, not a fully public replication dataset.
