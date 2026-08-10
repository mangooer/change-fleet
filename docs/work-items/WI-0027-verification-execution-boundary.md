---
artifact_type: development_work_item
id: WI-0027
status: done
title: Verification execution boundary
source: Proposal 0026 stage 3 first slice confirmed by user
confirmed_by: user
confirmed_at: 2026-08-10
standing_policy:
design_proposal: docs/proposals/0026-shared-application-orchestration-boundary.md
---

# WI-0027: Verification Execution Boundary

## Objective

Extract the verification validation-attempt execution mechanics into a bounded
`VerificationOrchestrator` without changing persisted shapes, lifecycle semantics, or the public
operation surface.

## Context

Proposal 0026 stages 1 and 2 extracted shared leaves and supervision. Stage 3 splits verification:
this slice moves requested-check, repository-check, and combined-check execution; the Runtime
dispatch flows (`resumeWorkUnitValidation` and `ensureIndependentVerificationPassed`) remain in
`ChangeFleetService` until the next slice.

## Scope

- Create `src/application/verification-orchestrator.js` with three methods moved verbatim from
  `ChangeFleetService`:
  - `executeVerificationRequestedChecks`
  - `ensureRepositoryValidationPassed`
  - `validateCombinedCandidates`
- Inject the service-owned helpers (`unitsForCurrentPlan`, `resolveValidationBlockers`,
  `stableErrorCode`) and the validators through the single composition root.
- Route the three in-service call sites through the orchestrator and delete the moved methods.
- Remove imports that became unused after the move.

## Non-Goals

- No Runtime-dispatch or admission-flow extraction yet; `resumeWorkUnitValidation` and
  `ensureIndependentVerificationPassed` stay in `ChangeFleetService` for the next slice.
- No lifecycle, schema, command, CLI, console, or Operator operation change.
- No top-level `executeChangeSet` state machine change.

## Acceptance Criteria

- The three validation-execution methods exist only in `VerificationOrchestrator`.
- `ChangeFleetService` routes requested-check, repository-check, and combined-check execution
  through the orchestrator with identical evidence and blocker behavior.
- Unit, checkpoint, supervision, retry, audit, and application integration suites pass;
  `git diff --check` exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npm run test` | unit contracts | Required | Domain imports and application wiring |
| Checkpoint and retry integration | candidate recovery, pre-Candidate retry | Required | Repository and combined validation execution paths |
| Supervision and audit integration | supervision, boundaries, audit | Required | Bundle validation and evidence projection paths |
| `git diff --check` | repository quality | Required | Source and WorkItem/current-state change |

## Current Projection

- Current subject: `codex/wi-0022-kernel-debt-cleanup` from `main` at `20b2b9c` (WI-0027 work is
  branch-local on the same unlanded branch).
- Last verified state: implementation complete; deterministic gates below passed.
- Next step: user review and landing; the verification Runtime-dispatch slice and Bundle
  finalization slice remain.

## Implementation Evidence

- `VerificationOrchestrator` owns requested-check, repository-check, and combined-check attempt
  execution; each body is unchanged from `ChangeFleetService` except injected helper calls.
- The three in-service call sites now use `this.verificationOrchestrator`; the moved methods and
  their now-unused imports were deleted.
- `npm run test` under Node.js 24 exited 0: 85 tests passed.
- Checkpoint, retry, supervision, application-boundary, restart, and audit integration exited 0:
  47 tests passed.
- `git diff --check` exited 0.
- The real Codex Provider flow remained excluded because no Provider boundary code changed.
