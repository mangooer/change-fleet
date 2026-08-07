# 0017: Preserve Post-Provider Candidate Finalization And Recovery

Status: Accepted (operation-specific recovery state revised by Decision 0025; legacy recovery
surface removed by WI-0022)

Date: 2026-08-04

Source: Repository Design Proposal 0015

## Decision

After a Provider completes implementation and ChangeFleet publishes an exact Git commit, persist a
durable `CandidateCheckpoint` before repository validation begins. The checkpoint binds the exact
ChangeSet, current revisions, WorkUnit, Repository, target and base, candidate SHA, owned workspace,
changed paths, source Run, and creation time. It is implementation state, not a Candidate, review
subject, delivery subject, or acceptance decision.

Every repository-validation attempt records immutable bounded evidence, including process-spawn
failure. A later idempotent execution command may preflight and resume repository validation for the
unchanged checkpoint without invoking an Agent Runtime. Passing evidence promotes the subject to an
ordinary Candidate; failed attempts remain history. When current WorkUnits already have Candidates,
combined validation may likewise resume over the same exact subject without repeating Provider
work.

Private pre-checkpoint records may use one explicit human-gated legacy recovery operation. It must
bind an exact completed Run, plan and WorkUnit, base and candidate SHA, actor, owned clean workspace,
ancestry, and computed changed paths. It records distinct recovery provenance and never guesses,
resets, imports arbitrary commits, adopts dirty files, or changes confirmed authority.

Validation commands remain structured executable-plus-argv values. Native executables are launched
directly. On Windows only, a resolved `.cmd` or `.bat` locator may use one reviewed argv-preserving
adapter whose requested executable, resolved locator, adapter kind, and effective invocation are
recorded. This does not introduce caller-provided command strings or a generic shell mode.

A `request_revision` decision must carry a concise bounded summary and bounded actionable findings
for its exact Bundle. Only the current feedback projection enters later planning and execution
context; complete review artifacts and superseded decisions remain linked history outside default
Runtime input.

## Rationale

The WI-0009 dogfood Run completed costly semantic work and published a clean commit, but a Windows
`npm` spawn failure occurred before Candidate persistence. Treating finalization as one indivisible
post-Provider step loses the durable exact subject and makes recovery depend on repeating Provider
work. A checkpoint closes that gap while preserving the difference between implementation output
and validated Candidate authority.

The same evidence requires a narrow Windows batch-shim rule and a bounded way to return review
findings to the current ChangeSet. Both changes preserve structured control data and keep large
operational artifacts out of Runtime context.

## Consequences

- One confirmed WI-0010 implements the checkpoint, immutable validation attempts, exact resume,
  human-gated legacy recovery, Windows adapter, and bounded revision-feedback projection.
- WI-0009 is blocked until WI-0010 is accepted and landed. Its existing Run and commit remain
  evidence only and receive no Candidate or Bundle authority through this decision.
- Actual WI-0009 recovery must use the landed shared operation and unchanged exact subject; it does
  not form part of WI-0010 implementation validation.
- UI recovery controls, Provider-session resume, arbitrary commit import, generic shell execution,
  real Provider reruns, and GitHub external writes remain outside WI-0010.
- The exact pinned Windows adapter implementation or dependency is selected and reviewed during
  WI-0010 without relaxing this behavior and evidence boundary.
