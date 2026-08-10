---
artifact_type: development_work_item
id: WI-0031
status: done
title: Controller-restart execution retry and Gate occurrence identity
source: User-confirmed follow-up after landing WI-0030
confirmed_by: user
confirmed_at: 2026-08-10
standing_policy:
design_proposal:
---

# WI-0031: Controller-Restart Execution Retry And Gate Occurrence Identity

## Objective

Restore autonomous progress after a controller restart when the interrupted execution remains an
exact clean pre-Candidate retry, and ensure a resolved Gate cannot suppress a later Gate occurrence.

## Context

The alternative-AgentProfile trial exposed two control defects. Recovery records an interrupted
execution as `RUN_INTERRUPTED_AFTER_RESTART`, but retry admission and supervision maintained
separate retry-code sets that both omitted it. When supervision then opened a Gate, resolving and
resuming it could return the same resolved Gate for the same stable action id, leaving the
controller to loop until its dispatch ceiling.

## Scope

- Define execution retry-code admission once in the domain and use it from both supervision and
  deterministic retry preparation.
- Admit `RUN_INTERRUPTED_AFTER_RESTART` under the existing exact-base, clean-workspace, current-Plan
  preflight and existing attempt budget.
- Reuse a supervision Gate only while the matching occurrence remains open; preserve resolved
  Gates as immutable history and create a new Gate when the same unresolved facts recur.
- Add unit and real-Git restart/Gate regressions.

## Non-Goals

- No new lifecycle phase, Run status, retry state, Gate status, or public operation.
- No dirty-workspace reset, Provider-session resume, automatic budget increase, or retry outside
  the existing exact pre-Candidate contract.
- No change to operator interruption, verification recovery, Bundle review recovery, or delivery.
- No scoring, pricing, routing, or UI expansion.

## Acceptance Criteria

- A controller-restarted execution is offered the existing bounded `retry_execution` route.
- Deterministic retry preparation accepts that route only when all existing exact clean-base
  preconditions pass and records a fresh Run while preserving the interrupted Run.
- Resolving a supervision Gate and reaching the same Gate action again creates one new open Gate;
  the resolved occurrence remains unchanged.
- Existing explicit operator interruption remains non-retryable by autonomous supervision.
- Selected unit and real-Git integration tests pass; `git diff --check` exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `node --test test/unit/supervision.test.js` | shared retry admission and action derivation | Required | Direct domain rule coverage |
| `node --test --test-concurrency=1 test/integration/autonomous-supervision.test.js` | restarted execution and repeated Gate occurrence | Required | Exact autonomous control path with real Git workspaces |
| `node --test --test-concurrency=1 test/integration/pre-candidate-retry.test.js test/integration/restart-recovery.test.js` | existing deterministic retry and restart contracts | Required | Regression boundary for the shared predicate |
| `git diff --check` | repository quality | Required | Source, tests, and Harness edits |
| `npm run check` | all deterministic scopes | Excluded unless final diff expands | The bounded files directly cover all changed production paths |
| Real Codex Provider | external nondeterministic Provider | Excluded | Defects are deterministic control and recovery behavior |

## Current Projection

- Current subject: branch `codex/wi-0031-restart-retry-gate-identity` from `main` at `4850f7b`.
- Last verified state: implementation complete; selected domain, autonomous real-Git, retry, and
  restart regressions pass.
- Next step: user review and landing; a later bounded real trial may prove the corrected route with
  an external Provider.

## Implementation Evidence

- `executionFailureIsRetryable` is now the single domain source used by action derivation and exact
  retry preparation. It admits `RUN_INTERRUPTED_AFTER_RESTART` without bypassing existing Plan,
  Repository, Harness, clean-workspace, exact-base, or attempt-budget checks.
- Supervision Gate reuse now requires the matching Gate to remain open. A resolved occurrence stays
  immutable; recurrence creates a distinct open Gate even when the stable action id is unchanged.
- `node --test test/unit/supervision.test.js` exited 0 in 0.4 seconds: 8 domain tests passed,
  including the controller-restart retry action set.
- `node --test --test-concurrency=1 test/integration/autonomous-supervision.test.js` exited 0 in
  167.1 seconds: 17 real-Git scenarios passed, including fresh execution after restart, repeated
  Gate occurrence, and the unchanged operator-interruption stop.
- `node --test --test-concurrency=1 test/integration/pre-candidate-retry.test.js test/integration/restart-recovery.test.js`
  exited 0 in 46.6 seconds: 7 existing exact retry and restart scenarios passed, including refusal
  of dirty, moved-HEAD, and stale-authority workspaces.
- `git diff --check` exited 0 after implementation review. Eager Harness sizes remained within
  policy: `AGENTS.md` 6004 bytes, `WORKFLOW.md` 1264 bytes, and `docs/current-state.md` 7534 bytes.
- `npm run check` and a real Codex Provider run remain intentionally unexecuted. The bounded tests
  cover every changed production path; external Provider behavior is not part of this deterministic
  correction.

## Project Memory Impact

This is a completed branch-local corrective slice inside accepted recovery and supervision
semantics. Canonical `main` includes WI-0030 at `4850f7b` until this Candidate is reviewed and
landed.
