---
artifact_type: development_work_item
id: WI-0032
status: done
title: Path-safe temporary review workspaces and stable checkout diagnostics
source: User-confirmed follow-up after the bounded alternative-AgentProfile trial
confirmed_by: user
confirmed_at: 2026-08-10
standing_policy:
design_proposal:
---

# WI-0032: Path-Safe Temporary Review Workspaces And Stable Checkout Diagnostics

## Objective

Prevent Windows path growth from blocking exact Bundle review, while preserving durable logical
workspace identity and returning one stable bounded diagnostic when a temporary checkout cannot be
prepared.

## Context

A bounded real ChangeSet reached Bundle review with a valid exact Candidate, but Git exited `128`
before the Review Run because the configured workspace root, generated review workspace id, and a
long tracked path exceeded the effective Windows path boundary. Reopening the same Control Store
with a shorter workspace root proved that the Candidate and review contract were otherwise valid.

## Scope

- Give disposable Bundle-review worktrees a short deterministic physical directory derived from
  the Repository and logical workspace identities.
- Preserve the full logical `workspace_id` in Run and audit records; keep physical paths as host
  locators rather than durable identity.
- Map filesystem or Git failure while preparing an owned worktree to a stable localized
  `WORKSPACE_CHECKOUT_FAILED` error with bounded stage and rule diagnostics.
- Add real-Git coverage for long roots and tracked paths, logical/physical identity separation,
  cleanup, and stable preparation failure.

## Non-Goals

- No host-global `core.longpaths` mutation, alternate workspace root, clone worker, or remote worker.
- No lifecycle, Run, review, retry, budget, Bundle, or persisted-schema change.
- No change to normal execution or planning workspace naming.
- No automatic acceptance of the preserved trial Bundle and no real Provider invocation.

## Acceptance Criteria

- Bundle review succeeds under a fixture whose former physical path construction would exceed the
  common Windows path limit.
- The review Run retains its full logical workspace id while its physical directory uses a short
  deterministic segment and is removed after review.
- Owned-worktree preparation failures expose `WORKSPACE_CHECKOUT_FAILED`, not a platform errno or
  Git exit status such as `128`; the diagnostic identifies a bounded preparation stage and rule.
- Selected direct and real-Git integration tests pass; `git diff --check` exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npx --yes node@24 --test test/unit/diagnostics.test.js` | stable localized error contract | Required | The slice adds one public diagnostic code |
| `npx --yes node@24 --test --test-concurrency=1 test/integration/repository-worker.test.js` | short physical identity and preparation failure | Required | Direct real-Git adapter boundary |
| `npx --yes node@24 --test --test-concurrency=1 test/integration/autonomous-supervision.test.js` | exact Bundle-review creation and cleanup | Required | Owning end-to-end review path |
| `git diff --check` | repository quality | Required | Source, tests, and Harness edits |
| `npm run check` | all deterministic scopes | Excluded unless final diff expands | The selected suites directly own every changed production path |
| Real Codex Provider | external nondeterministic Provider | Excluded | The defect is deterministic workspace preparation |

## Current Projection

- Current subject: branch `codex/wi-0032-path-safe-review-workspaces` from `main` at `edb4c6c`.
- Last verified state: implementation complete; all selected gates pass.
- Next step: user review and landing; a later bounded real ChangeSet may prove the corrected host
  path with an external Provider.

## Implementation Evidence

- `RepositoryWorker` now maps a Bundle-review logical workspace id to
  `_review/br-<24-hex-digest>`, hashing both Repository and logical workspace identity. Run records
  retain the original logical id and host path locator; existing read-only preflight and cleanup
  remain shared with independent verification.
- Owned-worktree parent creation, stale-worktree pruning, and exact checkout failures now map to
  `WORKSPACE_CHECKOUT_FAILED` with bounded `workspace_preparation` stage and rule diagnostics.
  Failed checkout cleanup preserves its own failure only as secondary evidence.
- `npx --yes node@24 --test test/unit/diagnostics.test.js` exited 0 in 0.1 seconds: 10 diagnostic
  tests passed, including Chinese and English messages for the new stable code.
- `npx --yes node@24 --test --test-concurrency=1 test/integration/repository-worker.test.js`
  exited 0 in 16.3 seconds: 6 real-Git adapter scenarios passed. The new coverage proves a
  128-character logical id maps deterministically to a short path, checks out a long tracked file,
  cleans and recreates the workspace, and maps a preparation conflict to the stable diagnostic.
- `npx --yes node@24 --test --test-concurrency=1 test/integration/autonomous-supervision.test.js`
  exited 0 in 179.4 seconds after the final test edit: 19 real-Git autonomous scenarios passed.
  The owning regression proves review succeeds when the former full path would exceed 260
  characters and exposes `action_failed:WORKSPACE_CHECKOUT_FAILED` for a real preparation failure.
- `git diff --check` exited 0 after the final Harness update. Eager Harness sizes remain within
  policy: `AGENTS.md` 6004 bytes, `WORKFLOW.md` 1264 bytes, and `docs/current-state.md` 7640 bytes.
- `npm run check` and a real Codex Provider run remain intentionally unexecuted because the selected
  direct and owning integration suites cover this deterministic adapter/application correction.

## Project Memory Impact

This is a completed branch-local corrective slice inside accepted workspace and independent
Bundle-review semantics. Local `main` includes WI-0031 at `edb4c6c` until this Candidate is reviewed
and landed; canonical remote state remains separate until explicitly pushed.
