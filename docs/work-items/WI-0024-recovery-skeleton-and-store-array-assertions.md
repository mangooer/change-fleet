---
artifact_type: development_work_item
id: WI-0024
status: done
title: Recovery skeleton generalization and store array assertions
source: User-requested second cleanup group after the WI-0022 code review
confirmed_by: user
confirmed_at: 2026-08-07
standing_policy:
design_proposal:
---

# WI-0024: Recovery skeleton generalization and store array assertions

## Objective

Remove the five near-identical recovery reconciles and make the current-schema store fail loudly
when a ChangeSet record lacks required arrays, without changing recovery semantics or persisted
shapes.

## Context

The post-WI-0022 review classified `RunRecoveryService.reconcile*` as duplicated skeletons and the
`?? []` defensive defaults as legacy-tolerant reads. The user confirmed the medium-risk cleanup
group.

## Scope

- Generalize the five `reconcile*` methods into one `reconcileReferences` core with per-operation
  `prepare` and `applyResults` configuration.
- Preserve the existing behavior difference: execution reconciliation keeps its original
  no-throw-on-ambiguous behavior (`assertNoAmbiguous: false`); planning, verification,
  supervision, and review keep the ambiguous-recovery assertion.
- Require the full set of ChangeSet arrays at the ControlStore read boundary and reject incomplete
  current-schema records with `INVALID_CONTROL_RECORD` instead of treating missing arrays as empty.

## Non-Goals

- No lifecycle, phase, Run status, blocker, or last-error semantics change.
- No removal of `?? []` in pure domain helpers (they remain tolerant for projections and fixtures;
  the persistence boundary now fails first).
- No `ChangeFleetService` split or static-analysis tooling changes; those remain later groups.

## Acceptance Criteria

- All five recovery operations flow through one generic reconcile core.
- Execution recovery still records blockers for ambiguous runs without throwing; other operations
  still throw on ambiguous runs.
- ControlStore rejects a current-schema ChangeSet missing any required array without mutation.
- Unit, recovery, store, and affected application integration suites pass; `git diff --check`
  exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npm run test` | unit contracts | Required | Domain and lifecycle contracts unchanged |
| Recovery and dispatch integration | restart, supervision, checkpoint, retry | Required | All five reconcile operations execute |
| Store integration | filesystem store, current-schema | Required | New array assertions at persistence boundary |
| `git diff --check` | repository quality | Required | Source and WorkItem/current-state change |

## Current Projection

- Current subject: `codex/wi-0022-kernel-debt-cleanup` from `main` at `20b2b9c` (WI-0024 work is
  branch-local on the same unlanded branch).
- Last verified state: implementation complete; all deterministic gates below passed.
- Next step: user review and landing; the real Codex Provider gate remains unverified and
  unchanged.

## Implementation Evidence

- `RunRecoveryService.reconcileReferences` owns reference selection, cleanup capture,
  interruption, result collection, transaction commit, and the optional ambiguous assertion.
  Each operation supplies only its reference selector, cleanup adapter, and result application.
- Execution is the only operation that keeps `assertNoAmbiguous: false`, matching its original
  behavior; all other operations keep the assertion.
- `ControlStore.assertChangeSetRecord` requires the 17 arrays created by
  `ChangeFleetService.createChangeSet`; a new `current-store-schema` test proves incomplete
  current-schema records are rejected on read without mutation.
- `npm run test` under Node.js 24 exited 0: 85 tests passed.
- Recovery, supervision, checkpoint, retry, filesystem, and current-schema integration suites
  exited 0: 42 tests passed.
- Application-boundary, feedback, closure, and audit integration suites exited 0: 20 tests passed.
- `git diff --check` exited 0.
- The real Codex Provider flow remained excluded because no Provider boundary code changed.
