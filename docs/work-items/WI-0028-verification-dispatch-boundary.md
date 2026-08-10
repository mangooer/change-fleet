---
artifact_type: development_work_item
id: WI-0028
status: done
title: Verification dispatch boundary
source: Proposal 0026 stage 3 second slice confirmed by user
confirmed_by: user
confirmed_at: 2026-08-10
standing_policy:
design_proposal: docs/proposals/0026-shared-application-orchestration-boundary.md
---

# WI-0028: Verification Dispatch Boundary

## Objective

Move the verification Runtime-dispatch flows into `VerificationOrchestrator`, completing Proposal
0026 stage 3, without changing persisted shapes, lifecycle semantics, or the public operation
surface.

## Context

WI-0027 moved validation-attempt execution. This slice moves the flows that drive them:
`resumeWorkUnitValidation` (admission, repository validation, verification focus, independent
review, Candidate promotion) and `ensureIndependentVerificationPassed` (workspace preparation,
verification Run dispatch, outcome handling, review and Feedback/Gate recording).

## Scope

- Move `resumeWorkUnitValidation` and `ensureIndependentVerificationPassed` into
  `VerificationOrchestrator` with their full dependency set injected through the composition root.
- Route the in-service call sites (`executeWorkUnit` and the `SupervisionOrchestrator` callback)
  through the orchestrator and delete the moved methods from `ChangeFleetService`.
- Remove imports that became unused after the move.

## Non-Goals

- No lifecycle, schema, command, CLI, console, or Operator operation change.
- No Bundle review extraction yet; that remains the final Proposal 0026 slice.
- No top-level `executeChangeSet` state machine change.

## Acceptance Criteria

- Verification dispatch and validation execution exist only in `VerificationOrchestrator`.
- `ChangeFleetService` routes execution and supervision resume paths through the orchestrator
  with identical evidence, admission, review, Feedback, and Gate behavior.
- Unit, checkpoint, supervision, retry, feedback, audit, and application integration suites pass;
  `git diff --check` exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npm run test` | unit contracts | Required | Domain imports and application wiring |
| Checkpoint and supervision integration | candidate recovery, supervision | Required | Independent review, Feedback repair, and Candidate promotion paths |
| Retry, feedback, audit, restart, boundaries integration | pre-Candidate, interrupt, audit | Required | Dispatch and evidence projection paths |
| `git diff --check` | repository quality | Required | Source and WorkItem/current-state change |

## Current Projection

- Current subject: `codex/wi-0022-kernel-debt-cleanup` from `main` at `20b2b9c` (WI-0028 work is
  branch-local on the same unlanded branch).
- Last verified state: implementation complete; deterministic gates below passed.
- Next step: user review and landing; the Bundle finalization slice remains.

## Implementation Evidence

- `VerificationOrchestrator` now owns the complete verification flow; both moved methods keep
  their bodies unchanged except injected helper calls and the already-extracted
  `executeVerificationRequestedChecks` reference.
- `ChangeFleetService` removed both methods plus six now-unused imports; `executeWorkUnit` and
  the supervision resume callback route through `this.verificationOrchestrator`.
- `npm run test` under Node.js 24 exited 0: 85 tests passed.
- Checkpoint, supervision, retry, feedback, audit, restart, and application-boundary integration
  exited 0: 51 tests passed.
- `git diff --check` exited 0.
- The real Codex Provider flow remained excluded because no Provider boundary code changed.
