---
artifact_type: development_work_item
id: WI-0023
status: done
title: Shared Run record, reference, failure, and worktree helpers
source: User-requested first cleanup group after the WI-0022 code review
confirmed_by: user
confirmed_at: 2026-08-07
standing_policy:
design_proposal:
---

# WI-0023: Shared Run record, reference, failure, and worktree helpers

## Objective

Remove mechanical duplication without changing persisted shapes or lifecycle semantics:
consolidate Agent Run record construction, Run reference construction, secondary failure
attachment, and detached-worktree preparation into shared helpers.

## Context

The post-WI-0022 review found five near-identical Run-creation object literals, seven repeated
Run-reference push sites, one duplicated `preservePrimaryFailure` implementation across two
services, and three copies of the detached-worktree preparation block. The user confirmed the
low-risk mechanical cleanup group.

## Scope

- Add `createAgentRunRecord` and `createRunReference` builders to `src/domain/lifecycle.js`.
- Route all five Run creations and seven Run-reference pushes through the builders without
  changing field presence or values.
- Move `attachSecondaryFailure` and `preserveSecondaryFailure` into `src/domain/errors.js` and
  remove the duplicated local implementations from `ChangeFleetService` and
  `GithubDeliveryService`.
- Extract `prepareDetachedWorktree` and `assertWorkspaceAtCommit` in `RepositoryWorker` and use
  them from the execution, planning, and verification workspace preparers.

## Non-Goals

- No Run, ChangeSet, or WorkUnit schema changes; execution Run references keep their existing
  field shape (including the current attempt omission on ChangeSet-level execution references).
- No `ChangeFleetService` split, recovery skeleton generalization, defensive-default removal, or
  static-analysis tooling changes; those remain later groups.

## Acceptance Criteria

- All five Run-creation sites produce the same records through one builder.
- All seven Run-reference push sites produce the same references through one builder.
- Only one `preserveSecondaryFailure` implementation exists and both services use it.
- Execution, planning, and verification workspace preparation share one worktree-creation block
  while preserving each path's error codes and clean checks.
- Unit, integration, and acceptance suites pass; `git diff --check` exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npm run test` | unit contracts | Required | Builders and error helpers live in domain code |
| Changed integration suites | dispatch, recovery, workspace, audit, CLI | Required | Cross-component behavior changes |
| Acceptance suites | CLI, two-repository, GitHub delivery | Required | Delivery and lifecycle flows exercise shared helpers |
| `git diff --check` | repository quality | Required | Source change across shared files |

## Current Projection

- Current subject: `codex/wi-0022-kernel-debt-cleanup` from `main` at `20b2b9c` (WI-0023 work is
  branch-local on the same unlanded branch).
- Last verified state: implementation complete; all deterministic gates below passed.
- Next step: user review and landing; the real Codex Provider gate is unchanged and remains
  unverified (no Provider boundary code changed).

## Implementation Evidence

- `createAgentRunRecord` owns the common Run record template; planning, supervision, review,
  execution, and verification dispatch pass only operation-specific fields through `extra`.
- `createRunReference` owns the common reference fields; the execution ChangeSet-level reference
  intentionally omits `attempt` exactly as before.
- `preserveSecondaryFailure` and `attachSecondaryFailure` now live only in `src/domain/errors.js`;
  `GithubDeliveryService` and `ChangeFleetService` import them and no longer define local copies.
- `RepositoryWorker.prepareDetachedWorktree` and `assertWorkspaceAtCommit` serve the execution,
  planning, and verification workspace paths; verification still delegates HEAD and clean checks
  to `preflightVerificationWorkspace` with its own error codes.
- `npm run test` under Node.js 24 exited 0: 85 tests passed.
- All 19 integration suites ran under `node --test --test-concurrency=1` and exited 0:
  104 tests passed across dispatch, recovery, workspace, store, audit, CLI, and console suites.
- All 3 acceptance suites exited 0: 7 tests passed, including the GitHub delivery flow.
- `git diff --check` exited 0.
- The real Codex Provider flow remained excluded because no Provider boundary code changed.
