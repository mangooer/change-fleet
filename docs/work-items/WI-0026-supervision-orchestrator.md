---
artifact_type: development_work_item
id: WI-0026
status: done
title: Supervision orchestration boundary
source: Proposal 0026 stage 2 confirmed by user
confirmed_by: user
confirmed_at: 2026-08-10
standing_policy:
design_proposal: docs/proposals/0026-shared-application-orchestration-boundary.md
---

# WI-0026: Supervision Orchestration Boundary

## Objective

Move the supervision command surface and autonomous dispatch loop out of `ChangeFleetService`
into a bounded `SupervisionOrchestrator` without changing persisted shapes, lifecycle semantics,
or the public operation surface.

## Context

Proposal 0026 stage 1 extracted shared leaf helpers. Stage 2 moves supervision: start, pause,
resume, progress, the autonomous dispatch loop, Supervisor action execution, Supervisor decision
invocation, disposition persistence, supervision Feedback, and supervision Gate handling.

## Scope

- Create `src/application/supervision-orchestrator.js` with the ten supervision methods moved
  verbatim from `ChangeFleetService`.
- Move supervision-only module helpers (`assertAutonomousPlanCurrent`,
  `projectSupervisionAction`, `createSupervisionProjection`,
  `boundedRejectedSupervisorProposal`) with the orchestrator.
- Inject the service-owned helpers and callbacks through the single composition root:
  idempotent command application, Project/state readers, validation-blocker resolution, recovery
  reconcile, execution/verification dispatch, Bundle finalization and review, and supervision
  stop/result persistence.
- Keep `ChangeFleetService` public delegates for the four Operator operations and the
  autonomous loop entry used by plan confirmation auto-start.

## Non-Goals

- No lifecycle, schema, command, CLI, console, or Operator operation change.
- No Bundle review extraction yet; `finalizeCurrentBundle`, `reviewCurrentBundle`,
  `reviewCurrentBundleUntilBoundary`, and `openBundleReviewFailureGate` stay in
  `ChangeFleetService` until the Bundle finalization slice.
- No top-level `executeChangeSet` state machine change.

## Acceptance Criteria

- Supervision methods exist only in `SupervisionOrchestrator`; `ChangeFleetService` delegates the
  public supervision surface.
- Supervision-only module helpers no longer exist in `ChangeFleetService`.
- The orchestrator never duplicates aggregate authority and invokes Providers only through
  `RunCoordinator`.
- Unit, supervision, and affected application integration suites pass; `git diff --check`
  exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npm run test` | unit contracts | Required | Domain and command surfaces unchanged |
| Autonomous supervision integration | supervision, review, recovery | Required | Full orchestrator dispatch loop coverage |
| Application, console, recovery, audit integration | boundaries, restart, console | Required | Callback wiring and public delegates |
| `git diff --check` | repository quality | Required | Source and WorkItem/current-state change |

## Current Projection

- Current subject: `codex/wi-0022-kernel-debt-cleanup` from `main` at `20b2b9c` (WI-0026 work is
  branch-local on the same unlanded branch).
- Last verified state: implementation complete; deterministic gates below passed.
- Next step: user review and landing; verification orchestrator and Bundle finalization slices
  remain.

## Implementation Evidence

- `SupervisionOrchestrator` owns `startSupervision`, `pauseSupervision`, `resumeSupervision`,
  `readSupervisionProgress`, `runAutonomousSupervision`, `executeSupervisionAction`,
  `invokeSupervisorDecision`, `recordSupervisorDisposition`, `recordSupervisionFeedback`, and
  `openSupervisionGate`.
- `ChangeFleetService` keeps one-line delegates for the four Operator operations and
  `runAutonomousSupervision` (used by plan-confirmation auto-start); internal supervision
  methods and the four supervision-only module helpers are deleted from the service.
- Execution, verification, Bundle, recovery, and stop/result mechanics stay in
  `ChangeFleetService` and are injected as callbacks; the orchestrator holds no second copy of
  aggregate authority.
- `npm run test` under Node.js 24 exited 0: 85 tests passed.
- Autonomous supervision, application-boundary, restart-recovery, and console integration exited
  0: 26 tests passed, including the full 15-test supervision suite.
- Checkpoint, retry, feedback, audit, SDK, and store integration exited 0: 47 tests passed.
- `git diff --check` exited 0.
- The real Codex Provider flow remained excluded because no Provider boundary code changed.
