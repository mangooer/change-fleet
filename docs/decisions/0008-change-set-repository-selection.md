# 0008: ChangeSet Repository Selection And Revision

Status: Accepted

Date: 2026-07-30

Source: Repository Design Proposal 0006

## Decision

Creating a ChangeSet establishes `RepositorySelectionRevision` 1 before any Runtime planning
invocation. The caller may provide a non-empty planning-visible subset of the Project's registered
Repositories; omission means every registered Repository is visible to planning.

For each visible Repository, the caller may select a branch and target ref. If no branch is
provided, ChangeFleet re-reads that local checkout's current symbolic branch at ChangeSet creation.
It resolves the selected branch to one exact commit and persists:

```text
repository_id
branch_ref
resolved_base_sha
target_ref
selection_source       caller | current_checkout
resolved_at
```

Dirty and untracked checkout files are never part of the base. Detached HEAD has no current branch;
without an explicit branch, creation fails with `REPOSITORY_BRANCH_SELECTION_REQUIRED`.
`target_ref` defaults to `branch_ref` but may be selected separately at creation.

The caller-idempotency fingerprint binds requested Repository ids, branches, and targets. A replay
of a completed creation command returns its persisted exact selection without resolving moved
branches again.

The current ChangePlan may create WorkUnits for any non-empty subset of the planning-visible
Repository set. Runtime output cannot replace control-owned branches, target refs, or base SHAs. An
Agent may only return a typed `RepositorySelectionChangeRequest`.

A confirmed later selection creates the next revision in the same ChangeSet, supersedes the prior
selection, current plan, and non-terminal WorkUnits, preserves all historical attempts and
evidence, and returns to planning. Revision is allowed in `analyzing`,
`awaiting_plan_confirmation`, or `replanning`. At `candidate_review`, the reviewer first requests
revision. `delivery_ready`, `done`, and any future delivery phase require a new ChangeSet.

Candidate identity remains `repository_id + target_ref + base_sha + candidate_sha`; symbolic branch
names explain authority but do not replace exact Git identity.

## Rationale

The branch selected for a task controls which source and Repository Harness an Agent may inspect
and modify. It must be confirmed before planning rather than trusted from an Agent plan. Freezing
the selected branch once gives every later Run, workspace, Candidate, validation, and recovery step
one stable Git subject while preserving a simple default based on the user's current checkout.

Planning visibility and execution scope are different. A caller may authorize several Repositories
for analysis while the plan creates WorkUnits only for Repositories that actually need changes.

## Consequences

- WI-0001's planning-time default-ref freeze is replaced by creation-time Repository selection.
- Exact historical commit selection remains deferred; WI-0002 accepts branch refs only.
- The first real Provider remains blocked until this deterministic authority boundary is complete.
- Provider telemetry, UI, delivery, Git URL materialization, and remote workers remain separate.
