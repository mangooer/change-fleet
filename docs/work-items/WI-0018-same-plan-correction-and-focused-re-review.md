---
artifact_type: development_work_item
id: WI-0018
status: done
title: Complete the same-Plan correction loop
source: 'User request: "完成同 Plan 修正闭环"'
confirmed_by: user
confirmed_at: 2026-08-06
started_by: agent
started_at: 2026-08-06
review_ready_at: 2026-08-06
completed_by: user
completed_at: 2026-08-06
standing_policy:
design_proposal: docs/proposals/0022-risk-adaptive-candidate-verification.md
accepted_decisions:
  - docs/decisions/0022-explicit-revision-feedback-assessment.md
  - docs/decisions/0023-conversation-first-planning-and-stage-scoped-feedback.md
  - docs/decisions/0024-risk-adaptive-candidate-verification.md
---

# WI-0018: Complete The Same-Plan Correction Loop

## Objective

Implement Decision 0024's third vertical slice: route one exact `changes_required` verification
result to a bounded correction Run under the unchanged confirmed Plan, then perform at most one
focused re-review over the corrected exact subject.

## Scope

- Record a distinct correction Run and cost while reusing the execution AgentProfile and assigned
  writable WorkUnit workspace.
- Give correction only the current confirmed authority, exact blocking findings, relevant check
  evidence, and exact checkpoint identity; exclude review history, transcripts, and audit totals.
- Require one `adopt | adapt | decline` assessment for every current verification finding before a
  correction result can publish a new CandidateCheckpoint.
- Preserve the prior checkpoint and review as immutable history. A correction with Git changes
  creates a descendant subject and new checkpoint; a fully assessed no-change correction reuses
  the exact checkpoint instead of manufacturing an empty commit.
- Re-run exact repository validation for the corrected subject and invoke one focused read-only
  re-review bound to the prior findings, assessments, and correction delta.
- Permit a passing focused review to create the Candidate. Route another blocking verdict or an
  unresolved human decision to one terminal human gate rather than another automatic correction.
- Preserve non-blocking notes in the exact Candidate/Bundle projection and keep correction and
  re-review usage separately attributable without entering Runtime context.
- Recover interrupted correction and focused-review attempts without duplicating a completed
  correction or permitting an unbounded loop.

## Non-Goals

- A second automatic correction, generic retry or workflow engine, Provider-session continuation,
  or automatic Plan revision.
- UI states, dashboard metrics, another Provider, multi-reviewer consensus, or Candidate-set-level
  independent review.
- Treating verifier findings as controller-certified truth or allowing correction to expand scope.

## Acceptance Criteria

- `changes_required` causes exactly one fresh correction Run under the same confirmed Plan.
- The correction Runtime explicitly assesses every current blocking finding and can decline an
  incorrect claim with bounded rationale.
- A changed correction creates a new exact checkpoint while retaining the old checkpoint and
  review; an assessed no-change correction keeps the original exact subject.
- The corrected checkpoint executes its exact repository check and at most one focused re-review.
- Focused `pass` or `pass_with_notes` creates the Candidate; a second `changes_required` or any
  human decision blocks for human action without another correction Run.
- Restart cannot duplicate a completed correction, skip exact preflight, or exceed one focused
  re-review.
- Audit totals include separately countable correction and focused-review Runs; their usage and
  historical output remain outside ordinary Runtime input.

## Validation Selection

| Gate | Requirement | Reason |
| --- | --- | --- |
| Correction feedback and lifecycle unit tests | Required | New bounded assessment and transition rules |
| Real-Git correction integration | Required | Workspace continuation, descendant checkpoint, checks, and focused review |
| Restart and duplicate-dispatch integration | Required | Bounded loop and exact recovery authority |
| Runtime context and audit tests | Required | Bounded feedback input and separate cost attribution |
| Codex SDK deterministic adapter test | Required | New writable correction operation and focused prompt |
| Node.js 24 full deterministic check | Required | Shared Runtime, lifecycle, state, audit, and Bundle contracts change |
| Real Codex Provider | Required once on the stable subject | Adds a new Provider operation and correction protocol |
| Browser and GitHub gates | Excluded | UI and delivery behavior are unchanged |
| Documentation, links, diff, and eager-size audit | Required | Accepted authority and Harness projection change |

## Current Projection

- Current subject: direct implementation on local `main` at `872d061`.
- WI-0017 is complete and the working tree started clean.
- Accepted by the user on 2026-08-06. Next step: update canonical projections and commit the exact
  accepted subject.
- Active blocker: none.

## Implementation Evidence

- ControlStore schema v9 adds bounded correction Run references and initial/focused review lineage;
  migration from v8 supplies safe empty/default fields without creating Candidate authority.
- One initial `changes_required` review now starts correction in the assigned writable execution
  workspace under the unchanged Plan. The Runtime must assess every source finding; only typed
  invalidation returns to planning.
- Publication preserves the prior checkpoint and review. A real correction delta creates a
  descendant checkpoint; an honestly reported assessed no-change result reuses the exact subject
  without an empty commit. The correction Run records reported and actual delta separately.
- Corrected subjects repeat exact repository validation and receive one focused read-only review
  bound to the source review, old and new SHAs, assessments, and actual delta. Focused disagreement
  or a human question enters `decision_required` without another automatic correction.
- Recovery abandons incomplete correction or focused-review attempts. It requires clean exact-head
  preflight before correction retry, reuses passing validation evidence, and never redispatches a
  completed correction.
- Runtime audit totals include `correction` separately while retaining all execution and both
  verification Runs in the ChangeSet total. Context integration proves those totals, history, and
  raw outputs do not enter correction or review input.
- `node --test test/unit/verification.test.js test/unit/runtime-evidence.test.js test/unit/runtime-context.test.js test/unit/diagnostics.test.js test/integration/codex-sdk-runtime.test.js test/integration/control-store-v4-migration.test.js test/integration/repository-worker.test.js`
  exited 0 with 46 passing tests across schema, lineage, prompt, migration, diagnostics, and Git
  publication behavior.
- Targeted Real-Git tests passed for changed correction, explicit no-change decline, focused
  disagreement, interrupted correction, and interrupted focused-review recovery. The final full
  integration run below contains all five paths.
- Under Node.js `v24.18.1`, `npm exec --yes --package=node@24 -- node
  scripts/run-checks.mjs` exited 0: 70 unit, 84 integration, and 6 serial acceptance tests passed,
  followed by the Chromium console check.
- The first real-Provider scenario command exited 1 because the execution Agent reasonably wrote
  the final value immediately, so initial review passed and no correction existed. The fixture was
  tightened to make the staged draft part of confirmed intent and the exact WorkUnit task; no
  production rule was weakened.
- `$env:CHANGEFLEET_RUN_REAL_CODEX='1'; npm exec --yes --package=node@24 -- node --test
  --test-concurrency=1 test/provider/codex-real-flow.test.js` then exited 0. One real flow completed
  `planning -> execution -> verification -> correction -> verification`; observed Provider totals
  were 239,468 tokens and 126,329 ms, with every Run independently auditable.
- `git diff --check` exited 0 and a targeted eight-file Markdown link scan exited 0. Eager Harness
  sizes are 6,079 bytes for `AGENTS.md`, 1,264 for `WORKFLOW.md`, and 6,636 for
  `docs/current-state.md`, within their soft limits.
- Another Provider, paid multi-Repository correction, non-Windows hosts, GitHub writes, new browser
  states, and the human gate UI/action were not exercised because they are unchanged or deferred.

## Project Memory Impact

Same-Plan automatic correction and one focused re-review are implemented and accepted. UI and
additional automatic loops remain later work.
