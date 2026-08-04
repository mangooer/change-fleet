---
artifact_type: development_work_item
id: WI-0011
status: in_progress
title: Implement explicit ChangeSet closure
source: 'User request: "按这个执行" after accepting separate close and create actions'
confirmed_by: user
confirmed_at: 2026-08-04
started_by: user
started_at: 2026-08-04
review_ready_at:
completed_by:
completed_at:
standing_policy:
design_proposal: docs/proposals/0016-explicit-changeset-closure.md
accepted_decisions:
  - docs/decisions/0018-explicit-changeset-closure.md
---

# WI-0011: Implement Explicit ChangeSet Closure

## Objective

Implement the accepted close-only lifecycle boundary so a user can intentionally abandon one
unfinished quiescent ChangeSet, preserve its exact history and measured cost, and independently use
the existing creation flow for any later task.

## Scope

- Add bounded domain normalization for closure reason code and summary.
- Add one idempotent `closeChangeSet` service operation that appends a human closure decision and
  transitions an eligible aggregate to `abandoned` without calling Runtime, Git, validation,
  workspace, delivery, or external adapters.
- Reject active Runs or lifecycle commands, begun delivery, terminal aggregates, invalid reasons,
  and repeated mutation after closure.
- Preserve every prior authority revision, Run, evidence, usage, checkpoint, validation attempt,
  Candidate, Bundle, command, decision, and blocker.
- Keep abandoned ChangeSets readable through exact state and audit projections while excluding
  closure detail from Runtime context.
- Expose `changeset.close` through the shared application allowlist and retained experimental CLI
  grammar `changeset close --config <path> --request <path|->`.
- Add Simplified Chinese intent comments to new production and non-obvious lifecycle boundaries.
- Keep all fixtures and fake adapters test-only; remove temporary production helpers.

## Non-Goals

- Creating, copying, linking, or aggregating a successor ChangeSet.
- Base resolution, selection revision, branch switching, intent copying, or replacement chains.
- Generic resume, retry, human hold, rewind, restart, fork, turn checkpoints, transcript deletion,
  artifact retention, automatic retry, or Provider-session resume.
- Canceling an active Run, cleaning workspaces, deleting Git refs, or closing PRs.
- UI controls, real Provider calls, browser validation, GitHub writes, pricing, dashboards, or
  cross-ChangeSet comparison.

## Acceptance Criteria

- A valid exact request closes an eligible ChangeSet as `abandoned` and returns a stable bounded
  result with no Runtime, Git, validation, delivery, or cleanup call.
- The persisted closure decision contains actor, reason code, summary, and decision time; none enter
  later Runtime context.
- Idempotent replay returns the same result and mismatched reuse fails.
- Active Run or command, begun delivery, `done`, and `abandoned` states reject closure with stable
  localized diagnostics.
- Every later lifecycle mutation on the abandoned ChangeSet fails closed; exact reads and audit
  projections still work and retain measured usage.
- Shared application and CLI routes are strict and do not add automatic task creation.
- Production changes contain required Chinese intent comments and no temporary command remains.

## Validation Selection

| Command or gate | Scope | Requirement |
| --- | --- | --- |
| Domain and diagnostic unit tests | reason bounds and stable codes | Required |
| Application integration | preservation, state gates, idempotency, restart | Required |
| Shared operation and CLI tests | exact allowlist and delegation | Required |
| Audit/context regression | retained cost, readable close, zero Runtime context | Required |
| Affected acceptance tests | ordinary create remains independent | Required |
| Full deterministic `npm run check` under Node.js 24 | final stable implementation | Required |
| Real Provider, browser, GitHub | external and semantic work | Excluded |
| Documentation and boundary audit | links, status, sizes, comments, temporary code | Required |

## Current Projection

- Current subject: WI-0011 is the sole active prerequisite implementation WorkItem.
- Last verified state: Proposal 0016 and Decision 0018 are accepted; no close operation exists yet.
- Next step: implement and validate the close-only shared operation.
- Active blocker or decision: none. WI-0009 remains open until this feature is accepted and used.

## Implementation Evidence

Pending implementation.

## Acceptance Review

Pending implementation, selected validation, and user review.

## Project Memory Impact

WI-0011 is accepted unfinished work. It does not close the actual WI-0009 Runtime ChangeSet or
change the landed implementation baseline until reviewed, accepted, and committed.
