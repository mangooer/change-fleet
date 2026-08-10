---
artifact_type: repository_design_proposal
id: 0026
status: accepted
title: Shared application orchestration boundary
proposed_at: 2026-08-07
accepted_at: 2026-08-07
confirmed_by: user
decision: docs/decisions/0028-shared-application-orchestration-boundary.md
implementation_tracking: docs/work-items/WI-0025-shared-run-command-and-workspace-helpers.md
---

# 0026: Shared Application Orchestration Boundary

## Context

`ChangeFleetService` is the only remaining application monolith: roughly 6,200 lines and about 50
public methods covering planning, autonomous supervision, Bundle review, execution, verification,
delivery orchestration, workspace cleanup, idempotent command lifecycle, and failure wrapping.
Its largest methods (`ensureIndependentVerificationPassed` at about 570 lines,
`executeWorkUnit` at about 545 lines, `planChangeSet` at about 506 lines, and
`reviewCurrentBundle` at about 437 lines) mix semantic routing with persistence and evidence
mechanics.

The repository already splits other application concerns into bounded services:
`GithubDeliveryService`, `FeedbackService`, `RunCoordinator`, `RunRecoveryService`,
`RepositoryValidator`, `CombinedValidator`, `BundleAssembler`, `ChangeSetViewService`, and
`RuntimeAuditQueryService`. `ChangeFleetService` retains that pattern's exception: one class owns
every operation's orchestration, so each new operation multiplies branches inside the same object.

This proposal changes no product contract. It changes the internal application boundary so that
supervision, verification, and Bundle review orchestration become independent classes while the
aggregate authority and command lifecycle stay in `ChangeFleetService`.

## Decision

Split `ChangeFleetService` in stages without changing persisted shapes, lifecycle semantics, public
operation names, CLI routes, or local console routes:

1. Extract shared leaf helpers into a bounded service (`ChangeSetRunService`): Runtime event
   appending, Run reference marking, WorkUnit failure and blocker persistence, command failure
   persistence, planning workspace cleanup, and supervision workspace cleanup.
2. Extract supervision orchestration (`startSupervision`, `pauseSupervision`,
   `resumeSupervision`, autonomous loops, Supervisor action execution, disposition persistence,
   supervision Feedback and Gate handling) into a `SupervisionOrchestrator`.
3. Extract verification orchestration (admission dispatch, requested-check execution, combined
   validation, and pass determination) into a `VerificationOrchestrator`.
4. Extract Bundle review and finalization mechanics that are already partially owned by
   `BundleAssembler` into the orchestrator boundary.

`ChangeFleetService` keeps:

- idempotent command lifecycle and command audit authority;
- cross-operation transitions plus human Bundle decision and delivery authority;
- the top-level `executeChangeSet` state machine that drives planning, execution, verification,
  Bundle assembly, review, and delivery;
- the public API shape consumed by `OperatorApplication`, the CLI, and the local console.

Each extracted orchestrator receives its dependencies through the `ChangeFleetService`
constructor (single composition root). An orchestrator owns only the transaction closures for its
operation; it shares the same `ControlStore`, domain lifecycle rules, and leaf services rather than
maintaining a second aggregate model.

## Boundaries

- Orchestrators may read and mutate persisted Run, evidence, and ChangeSet state only through the
  shared stores, lifecycle functions, and leaf services assembled by `ChangeFleetService`.
- Each orchestrator may write only facts owned by its operation. Cross-operation command identity,
  human Bundle decisions, delivery authority, schema, and lifecycle rules remain outside it.
- No orchestrator may redefine command identity, idempotency, or command failure semantics.
- No orchestrator may start a Provider invocation except through `RunCoordinator`.
- No orchestrator may change workspace cleanup, verification admission, or Bundle authority rules.
- The split is implementation-only: SPEC.md, accepted Decisions, CLI routes, local console routes,
  and Operator operation names remain unchanged.

## Rationale

The monolith makes each new Agent role add branches to one object, raising review cost and the
risk of accidental cross-operation coupling. The bounded-service pattern already works in this
repository (delivery, feedback, recovery, validation, assembly, audit). Splitting orchestration
keeps the authoritative aggregate state machine intact while making supervision and verification
flows independently testable and reviewable.

Stage 1 is a pure mechanical extraction covered by the existing deterministic suites. Stages 2
through 4 move method groups and rely on the same suites plus the focused supervision,
verification, and Bundle review integration suites as regression nets. The real Codex Provider
gate is not affected because no Provider boundary code changes.

## Consequences

- `ChangeFleetService` shrinks to command routing, cross-operation authority, and the top-level
  state machine; operation-scoped transactions move with their orchestrator methods.
- New files are added; no public API, persisted schema, CLI, or console behavior changes.
- Each stage is one confirmed WorkItem with its own evidence; proposal and Decision history is
  preserved.

## Implementation Clarification (2026-08-10)

The original wording said that every aggregate transaction closure remained in
`ChangeFleetService`. That was too broad: moving an orchestration method while leaving all of its
state transitions behind would replace one monolith with a large callback surface. The accepted
implementation instead moves each operation's transaction closures with that operation while
retaining one store, one lifecycle contract, one composition root, and the cross-operation and
human authorities listed above. This clarification changes no persisted or product behavior.

## Open Questions

- None for this boundary. A later proposal may split the top-level `executeChangeSet` state
  machine itself if measured maintainability still requires it.
