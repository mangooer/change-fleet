---
artifact_type: development_work_item
id: WI-0029
status: done
title: Bundle review orchestration boundary
source: Proposal 0026 final slice confirmed by user
confirmed_by: user
confirmed_at: 2026-08-10
standing_policy:
design_proposal: docs/proposals/0026-shared-application-orchestration-boundary.md
---

# WI-0029: Bundle Review Orchestration Boundary

## Objective

Move Bundle assembly, independent quality review, the review-budget loop, and failure Gate
handling into a bounded `BundleReviewOrchestrator`, completing Proposal 0026.

## Context

WI-0025 through WI-0028 extracted shared leaves, supervision, and verification. This final slice
moves `finalizeCurrentBundle`, `reviewCurrentBundle`, `reviewCurrentBundleUntilBoundary`, and
`openBundleReviewFailureGate`; it also relocates `recordSupervisionStop` and
`supervisionResult` into `SupervisionOrchestrator`, where they belong.

## Scope

- Create `src/application/bundle-review-orchestrator.js` with the four Bundle methods moved from
  `ChangeFleetService`.
- Move `recordSupervisionStop` and `supervisionResult` into `SupervisionOrchestrator`.
- Route `executeChangeSet` Bundle calls and the `SupervisionOrchestrator` callbacks through the
  new orchestrator; delete the moved methods from `ChangeFleetService`.
- Remove imports that became unused after the move.

## Non-Goals

- No lifecycle, schema, command, CLI, console, or Operator operation change.
- No top-level `executeChangeSet` state machine change.

## Acceptance Criteria

- Bundle assembly, review, review-budget loop, and failure Gate handling exist only in
  `BundleReviewOrchestrator`; supervision stop/result exist only in `SupervisionOrchestrator`.
- `ChangeFleetService` routes manual and supervised Bundle paths through the orchestrators with
  identical evidence, Feedback, and Gate behavior.
- Unit, supervision, checkpoint, delivery, and application integration suites pass;
  `git diff --check` exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npm run test` | unit contracts | Required | Domain imports and application wiring |
| Supervision and application integration | autonomous supervision, boundaries | Required | Bundle review, Feedback repair, and Gate paths |
| Checkpoint, audit, console, restart integration | candidate recovery, audit, console | Required | Dispatch and evidence projection paths |
| Acceptance suites | CLI, two-repository, GitHub delivery | Required | Full lifecycle and delivery flows |
| `git diff --check` | repository quality | Required | Source and WorkItem/current-state change |

## Current Projection

- Current subject: `codex/wi-0022-kernel-debt-cleanup` from `main` at `20b2b9c` (WI-0029 work is
  branch-local on the same unlanded branch).
- Last verified state: implementation complete; deterministic gates below passed. Proposal 0026
  is now fully implemented.
- Next step: user review and landing of the completed application-orchestration boundary.

## Implementation Evidence

- `BundleReviewOrchestrator` owns `finalizeCurrentBundle`, `reviewCurrentBundle`,
  `reviewCurrentBundleUntilBoundary`, and `openBundleReviewFailureGate`; each body is unchanged
  except injected helper calls and the `validateCombinedCandidates` callback.
- `recordSupervisionStop` and `supervisionResult` moved into `SupervisionOrchestrator`, and the
  shadowing constructor assignments were removed.
- `ChangeFleetService` removed the six methods and now routes manual and supervised Bundle paths
  through `bundleReviewOrchestrator`; the file dropped below 3,900 lines.
- Review follow-up protects authoritative Run identity and lifecycle fields from operation-specific
  extension data, with a regression test for forged fields.
- Secondary cleanup failures now use one bounded representation: at most 8 entries, with bounded
  stage, code, and message fields in both Run and Delivery persistence.
- Proposal 0026 and Decision 0028 now state the implemented ownership boundary precisely:
  operation orchestrators own operation-scoped transaction closures while `ChangeFleetService`
  retains cross-operation and human authority.
- `docs/current-state.md` was compacted to 7,161 UTF-8 bytes, below the 8 KiB eager-Harness soft
  maximum, without moving current authority back into historical documents.
- `npm run test` under Node.js 24 exited 0: 87 tests passed.
- Supervision, application-boundary, checkpoint, audit, console, and restart integration exited
  0: 46 tests passed.
- CLI, two-repository, and GitHub delivery acceptance exited 0: 7 tests passed.
- `git diff --check` exited 0.
- The real Codex Provider flow remained excluded because no Provider boundary code changed.
