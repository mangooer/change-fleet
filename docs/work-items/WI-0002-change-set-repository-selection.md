---
artifact_type: development_work_item
id: WI-0002
status: done
title: Implement ChangeSet Repository selection and revision
source: "User request: 接受 Proposal 0006，之后创建唯一的 WI-0002。"
confirmed_by: user
confirmed_at: 2026-07-30
completed_by: user
completed_at: 2026-07-31
standing_policy:
design_proposal: docs/proposals/0006-change-set-base-selection-and-revision.md
accepted_decision: docs/decisions/0008-change-set-repository-selection.md
---

# WI-0002: Implement ChangeSet Repository Selection And Revision

## Objective

Replace implicit planning-time default-ref freezing with one restart-safe, caller-idempotent
RepositorySelectionRevision created with the ChangeSet and safely revised in the same aggregate.

## Context

[Decision 0008](../decisions/0008-change-set-repository-selection.md) owns the accepted behavior.
WI-0001 commit `761a0fe` is the exact starting implementation. This WorkItem changes deterministic
control authority before any real Provider is introduced.

## Scope

- Add RepositorySelectionRevision history and `current_repository_selection_revision` to
  ChangeSet state.
- Extend `createChangeSet` with an optional planning Repository subset and per-Repository branch and
  target selections.
- Default omitted planning scope to all Project Repositories and omitted branches to each local
  checkout's current symbolic branch observed at ChangeSet creation.
- Resolve and persist exact base SHAs before Runtime planning; keep dirty checkout content excluded.
- Make creation replay return the original persisted selection without re-resolving moved branches.
- Pass the current selection through the Control Contract and planning projection; inject its exact
  base and target into normalized WorkUnits.
- Add a typed Repository selection-change request and a caller-confirmed revision command.
- Supersede the prior selection, current plan, and non-terminal WorkUnits while preserving history
  and returning the same ChangeSet to planning.
- Add stable localized diagnostics and Simplified Chinese intent comments for changed production
  boundaries.
- Deliberately revise the private filesystem schema version if required; no released state
  migration contract exists.

## Non-Goals

- Exact historical commit or arbitrary tag selection.
- Agent authority to choose or approve branches, targets, Repository scope, or base SHAs.
- Real Provider, Runtime Skill Kit, token/cost telemetry, Linear, CLI, API, or UI.
- Git URL fetching, remote workers, delivery, merge, rebase, deployment, or rollback automation.
- Changing Candidate identity or implementing base-to-target integration.

## Acceptance Criteria

- Explicit branch selection at ChangeSet creation freezes the selected exact commit before planning.
- Omitted branch selection uses the local checkout's current symbolic branch at that exact time.
- Detached HEAD without an explicit branch fails with
  `REPOSITORY_BRANCH_SELECTION_REQUIRED` before Runtime invocation.
- Dirty and untracked checkout files never enter the frozen base or WorkUnit workspace.
- Moving a selected branch after creation does not alter planning, Harness discovery, workspace,
  recovery, Candidate, validation, or Bundle base identity.
- Repeating a completed `createChangeSet` command returns the original revision and SHA without
  re-resolving the moved branch.
- The planning-visible Repository set is a non-empty authorized subset; the ChangePlan may create
  WorkUnits for a non-empty subset of it and cannot add another Repository.
- `target_ref` defaults to the selected branch and may be explicitly different at creation.
- Runtime plan output cannot replace control-owned branch, target ref, or base SHA.
- Selection revision succeeds only in accepted states, preserves prior evidence, supersedes current
  authority, and causes new planning and confirmation in the same ChangeSet.
- Candidate and Bundle identity behavior remains exact and existing WI-0001 failure/recovery tests
  continue to pass.

## Validation

| Command or gate | Scope | Required |
| --- | --- | --- |
| `npm test` | Selection normalization, transitions, identity, diagnostics, and idempotency | Yes |
| `npm run test:integration` | Branch resolution, detached HEAD, moved refs, persistence, and recovery | Yes |
| `npm run test:acceptance` | Single- and multi-Repository creation, planning, revision, and Bundle flows | Yes |
| `npm run check` under Node.js 24 | Complete deterministic package gate | Yes |
| Targeted dependency/context audit | No Provider, telemetry, UI, delivery, or fake audit facts | Yes |

For every executed check record the exact command, exit code, concise observation, and remaining
unverified boundary.

## Current Projection

- Current subject: user-accepted complete WI-0002 implementation landed in the current Git history.
- Last verified state: Node.js `v24.14.0` passed 31 tests: 15 unit, 14 integration, and 2 serial
  acceptance flows.
- Next step: no work remains inside WI-0002; later Provider or observability work requires its own
  accepted authority.
- Active blocker or decision: none; completion and landing were requested by the user.

## Implementation Evidence

Implementation was started by the user's 2026-07-30 request, `启动 WI-0002`.
Completion was accepted by the user's 2026-07-31 request, `接受 WI-0002`.
Landing was requested by the user's subsequent request, `提交`.

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `npm test` | 0 | 15 unit tests passed selection normalization, exact plan authority, diagnostics, identity, idempotency, and bounded context behavior | Real Provider behavior remains deferred |
| `npm run test:integration` | 0 | 14 integration tests passed real-Git branch resolution, detached HEAD rejection, moved-ref replay, planning subset, selection requests and revisions, persistence, failure, and recovery | Git URLs and remote workers remain deferred |
| `npm run test:acceptance` | 0 | 2 serial acceptance flows passed one-Repository revision through exact Bundle history and the two-Repository dirty-checkout/restart flow | Delivery and target integration remain deferred |
| bundled Node.js `v24.14.0` invoking `npm-cli.js run check` | 0 | The accepted Node.js 24 gate passed all 31 tests on the exact review source | Real Provider conformance remains deferred |
| `npm ls --omit=dev --depth=0` | 0 | Production dependency tree remains empty | npm itself is development tooling |
| `git diff --check` plus targeted dependency, deferred-scope, and Chinese-comment audits | 0 | No whitespace errors, no deferred feature additions, and every production module retains a Chinese intent comment | Human review of behavior and comments remains |

## Project Memory Impact

Decision 0008 now has a user-accepted implementation in current Git history.
`docs/current-state.md` keeps new Provider and observability work behind separate authority.
