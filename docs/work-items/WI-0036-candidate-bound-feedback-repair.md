---
artifact_type: development_work_item
id: WI-0036
status: done
title: Candidate-bound validation context and checkpoint-preserving Bundle feedback
source: Real self-iteration readme-validation-contract-20260811 exposed accepted-contract violations
confirmed_by: user
confirmed_at: 2026-08-11
standing_policy:
design_proposal:
---

# WI-0036: Candidate-Bound Validation Context And Checkpoint-Preserving Bundle Feedback

## Objective

Make selected repository checks intelligible as post-publication exact-Candidate validation and make
Bundle revision feedback continue from the current CandidateCheckpoint instead of restarting from
the original base.

## Context

The first real self-iteration after WI-0035 selected `git diff --check`. ChangeFleet ran the
authoritative command after Candidate publication in a clean workspace, so the command did not
exercise `base..candidate`. A human `request_revision` then exposed a second violation: Bundle
feedback cleared the current checkpoint and workspace, forcing execution to reimplement from the
base even after the Runtime declined the finding. This contradicts the accepted descendant and
assessed-no-change semantics already recorded in `SPEC.md` and architecture.

## Scope

- State in Runtime instructions that Plan-selected repository commands execute after Candidate
  publication in a clean workspace whose `HEAD` is the exact Candidate.
- Require planning and execution reasoning to distinguish an execution-time local check from later
  authoritative Candidate-bound evidence without teaching project-specific commands to Core.
- Preserve each current WorkUnit checkpoint and owned workspace when Bundle feedback returns it to
  execution; clear only review authority that must be recomputed.
- Reuse an assessed no-change checkpoint and publish a changed feedback result as its Git descendant.
- Add direct deterministic tests for prompt facts, exact checkpoint reuse, descendant publication,
  validation subject identity, and restart-safe state.

## Non-Goals

- No parser or hard-coded rejection rule for `git diff`, test frameworks, or project Harness commands.
- No new lifecycle phase, feedback verdict, retry state, Plan revision rule, or automatic truth score.
- No change to human Bundle acceptance, verification admission, combined validation, or delivery.
- No multi-reviewer routing, task-specific command synthesis, or automatic real-Provider rerun.

## Acceptance Criteria

- Planning instructions explain that a selected repository command must work after Candidate
  publication on clean `HEAD`, including commands whose default behavior depends on uncommitted
  changes.
- Bundle `request_revision` retains the exact checkpoint and workspace while removing the ordinary
  Candidate from current review authority.
- A feedback Run that assesses every finding and makes no Git change reuses the exact checkpoint;
  an actual change creates a descendant commit and a new checkpoint with round-delta evidence.
- Repository validation remains bound to the resulting exact checkpoint and cannot be mistaken for
  a local command the execution Agent ran before publication.
- Existing verification Feedback behavior and clean-base initial/retry behavior remain valid.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Affected Codex Runtime unit test under Node.js 24 | planning and execution instruction contract | Required | Direct prompt boundary changes |
| Affected Bundle-feedback integration tests under Node.js 24 | checkpoint reuse, descendant/no-change, validation identity and restart | Required | Direct lifecycle and real-Git behavior changes |
| Related supervision and acceptance tests under Node.js 24 | autonomous continuation and existing review flow | Conditional | Run when direct changes affect their fixtures |
| `npm run check` under Node.js 24 | all deterministic scopes | Required | Shared lifecycle and Candidate recovery behavior changes |
| `npm run check:harness` under Node.js 24 | exact ChangeFleet repository Harness | Required | WorkItem and current-state projections change |
| `git diff --check` over branch base through `HEAD` and the working tree | complete branch diff | Required | Avoid repeating the exact self-iteration evidence error |
| Real Provider gate | nondeterministic external-cost path | Excluded | The defect already has real evidence; deterministic repair proof is sufficient before another bounded trial |

## Current Projection

- Current subject: branch `codex/wi-0036-candidate-bound-feedback-repair` from `f1c1820`.
- Last verified state: deterministic implementation and all selected gates passed on 2026-08-11.
- Next step: user review and acceptance before an exact Git commit.
- Active blocker or decision: none.

## Implementation Evidence

- Human Bundle `request_revision` now removes only current Candidate review authority. It preserves
  each WorkUnit workspace, CandidateCheckpoint, admission, and exact validation attempt references;
  feedback execution therefore receives `candidate_sha` and preflights the current Candidate.
- A fully assessed no-change feedback Run reuses its source checkpoint across controller restart.
  A changed Run publishes a Git commit whose parent is the source Candidate and records only the
  round delta as feedback execution evidence; both paths return through ordinary validation and
  Bundle assembly.
- Codex planning instructions now state that the controller runs selected repository commands after
  Candidate publication in a clean workspace with `HEAD` at the Candidate. Execution instructions
  separate local diagnostics from authoritative attempts and explicitly permit assessed no-change
  feedback without manufacturing a diff.
- The first targeted run exposed two inaccurate test fixtures: one declared `feature.txt` changed
  while producing no Git delta, and one replacement omitted repository markers required by the
  fixture checks. After correcting those fixtures, the exact five new/affected scenarios passed.
- `node.exe --test test/integration/application-boundaries.test.js
  test/integration/autonomous-supervision.test.js test/integration/codex-sdk-runtime.test.js` under
  Node.js 24 exited 0: all 37 tests passed in 204.5 seconds.
- The first attempted full gate used pnpm against this npm-managed checkout and stopped during
  dependency synchronization before tests. npm restored the locked dependencies and the generated
  `.ignored`/`.pnpm` directories were removed. A later invocation correctly stopped at the Node 22
  PATH guard, and the next stopped at the 8 KiB eager current-state limit; neither was passing test
  evidence. The PATH and concise projection were corrected rather than bypassed.
- The final Node.js 24 `npm run check` exited 0 in 391 seconds. Harness validation reported 3 eager
  files and 36 WorkItems; 94 unit, 116 integration, and 7 acceptance tests passed, followed by the
  Chromium console path.
- Real Provider was not repeated: the closed 732,091-token trial already demonstrated the defect,
  while this repair changes deterministic lifecycle state and Runtime instructions rather than the
  Codex SDK invocation boundary.

## Project Memory Impact

This WorkItem restores already accepted CandidateCheckpoint and Feedback semantics. It does not add
a product boundary or make ChangeFleet understand repository-specific Harness commands.
