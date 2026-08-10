# 0028: Shared Application Orchestration Boundary

Status: Accepted

Date: 2026-08-07

Source: Repository Design Proposal 0026

## Decision

ChangeFleet splits the `ChangeFleetService` monolith into a shared leaf service
(`ChangeSetRunService`), a `SupervisionOrchestrator`, a `VerificationOrchestrator`, and Bundle
review finalization. `ChangeFleetService` retains idempotent command lifecycle, cross-operation and
human authority, the top-level `executeChangeSet` state machine, and the public operation surface.

The split is implementation-only:

- persisted schema, Run/WorkUnit/ChangeSet lifecycle semantics, and evidence identities are
  unchanged;
- operator operation names, CLI routes, and local console routes are unchanged;
- extracted orchestrators receive dependencies through the single composition root and own only
  their operation-scoped transaction closures; they do not define another store, schema, or
  lifecycle model;
- no orchestrator invokes a Provider except through `RunCoordinator`.

## Rationale

`ChangeFleetService` is the only application monolith left after delivery, feedback, recovery,
validation, assembly, and audit were already bounded. Its largest methods mix semantic routing
with persistence and evidence mechanics, so each new Agent role multiplies branches in one
object. Bounded orchestration services make supervision and verification flows independently
testable while preserving the authoritative aggregate state machine.

## Consequences

- `ChangeFleetService` shrinks to command routing, cross-operation authority, and the top-level
  state machine. Operation-scoped transitions move with their orchestrator methods.
- New application files are added; no public API, schema, CLI, console, or Provider behavior
  changes.
- Implementation is tracked by confirmed WorkItems: WI-0025 (shared leaf service), then
  supervision, verification, and Bundle review orchestration slices.
- The top-level `executeChangeSet` state machine itself remains in `ChangeFleetService` unless a
  later proposal demonstrates that splitting it is required for maintainability.

## Implementation Clarification (2026-08-10)

“Aggregate authority” means the single persisted model, lifecycle rules, command identity, and
human/cross-operation decisions; it does not require every `transactChangeSet` closure to remain in
one class. Keeping operation-specific closures beside their orchestration avoids a callback facade
while preserving one composition root and one deterministic control contract.
