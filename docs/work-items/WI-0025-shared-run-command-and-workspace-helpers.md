---
artifact_type: development_work_item
id: WI-0025
status: done
title: Shared Run, command, and workspace helpers
source: Proposal 0026 stage 1 confirmed by user
confirmed_by: user
confirmed_at: 2026-08-07
standing_policy:
design_proposal: docs/proposals/0026-shared-application-orchestration-boundary.md
---

# WI-0025: Shared Run, command, and workspace helpers

## Objective

Extract the first shared leaf service (`ChangeSetRunService`) from `ChangeFleetService` so later
orchestrators can reuse Run, command, and workspace mechanics without reaching into the monolith.

## Context

Proposal 0026 splits the application orchestration boundary in stages. Stage 1 moves the leaf
operations that every operation shares: Runtime event appending, Run reference marking, WorkUnit
failure and blocker persistence, command failure persistence, planning workspace cleanup, and
supervision workspace cleanup.

## Scope

- Add `currentPlanWorkUnits` to `src/domain/lifecycle.js` and consolidate the recovery service's
  private copy onto it.
- Create `src/application/change-set-run-service.js` with the seven shared leaf methods moved
  verbatim from `ChangeFleetService`.
- Wire the new service through the constructor: `RunCoordinator` events and
  `RunRecoveryService` planning cleanup use it; all in-class call sites route to it.

## Non-Goals

- No lifecycle, schema, or error-code change.
- No supervision or verification orchestrator yet; those are later Proposal 0026 slices.
- No public API, CLI, console, or Operator operation change.

## Acceptance Criteria

- `ChangeFleetService` no longer defines the seven leaf methods.
- All call sites route through `ChangeSetRunService` with identical behavior.
- Run recovery and RunCoordinator wiring use the shared service.
- Unit and affected integration suites pass; `git diff --check` exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npm run test` | unit contracts | Required | Shared domain helper and application wiring |
| Recovery and dispatch integration | restart, supervision, checkpoint, retry | Required | Leaf helpers execute on every dispatch and failure path |
| Application and audit integration | boundaries, audit, console | Required | Command failure and Run reference persistence paths |
| `git diff --check` | repository quality | Required | Source and WorkItem/current-state change |

## Current Projection

- Current subject: `codex/wi-0022-kernel-debt-cleanup` from `main` at `20b2b9c` (WI-0025 work is
  branch-local on the same unlanded branch).
- Last verified state: implementation complete; deterministic gates below passed.
- Next step: user review and landing; supervision and verification orchestrator slices remain.

## Implementation Evidence

- `ChangeSetRunService` owns `appendRuntimeEvent`, `markRunReference`, `failWorkUnit`,
  `blockWorkUnit`, `markCommandFailed`, `cleanupPlanningWorkspaces`, and
  `cleanupSupervisionWorkspace`; each body is unchanged from `ChangeFleetService`.
- `lifecycle.currentPlanWorkUnits` centralizes the current-Plan WorkUnit filter; the recovery
  service imports it instead of its private copy.
- `RunCoordinator` and `RunRecoveryService` wiring and all thirteen in-class call sites now use
  `this.runService`.
- `npm run test` under Node.js 24 exited 0: 85 tests passed.
- Recovery, supervision, checkpoint, retry, store, application-boundary, feedback, closure, and
  audit integration suites exited 0.
- `git diff --check` exited 0.
- The real Codex Provider flow remained excluded because no Provider boundary code changed.
