---
artifact_type: development_work_item
id: WI-0049
status: done
title: Common Git directory Project ownership enforcement
source: User explicitly requested continuation of accepted Proposal 0034 on 2026-08-18
confirmed_by: user
confirmed_at: 2026-08-18
standing_policy:
design_proposal: docs/proposals/0034-single-project-repository-ownership.md
---

# WI-0049: Common Git Directory Project Ownership Enforcement

## Objective

Enforce Decision 0036 at Project registration so one normalized `common_git_dir` can create only
one Repository binding in a Portfolio, while independent clones remain distinct local stores.

## Scope

- Compare normalized `common_git_dir` locators against every existing Project binding.
- Add each admitted Repository to the in-request ownership set so aliases cannot create two
  bindings inside one new Project.
- Retain the stable `AMBIGUOUS_SHARED_REPOSITORY` diagnostic.
- Add real-Git regression tests for direct, nested-path, linked-worktree, same-Project, and
  distinct-clone cases.
- Update Proposal 0034 and current-state with concise branch-local completion evidence.

## Non-Goals

- No Portfolio-level Repository registry, ownership transfer, shared Project membership, alias
  graph, schema migration, or remote-URL deduplication.
- No changes to ChangeSet selection, scheduling, Runtime, delivery, or existing registered state.

## Acceptance Criteria

- Direct, nested-path, and linked-worktree aliases of an owned Git store fail registration with
  `AMBIGUOUS_SHARED_REPOSITORY`, including aliases submitted in one Project request.
- A rejected registration makes no partial catalog change.
- Independent clones with the same canonical remote can be registered to different Projects.
- A Project can still register multiple genuinely distinct Repository stores.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Focused Node.js 24 integration test | real Git registration aliases and clones | Required | Directly exercises the changed admission boundary |
| Existing two-repository acceptance test | distinct stores in one Project | Required | Protects the allowed multi-Repository shape |
| `npm run check:harness` and `git diff --check` | repository memory and patch hygiene | Required | Harness handoff contract |

## Current Projection

- Current subject: completed branch-local implementation on branch `main`.
- Last verified state: registration compares normalized `common_git_dir` locators across existing
  and in-request bindings; selected Node.js 24 integration and acceptance tests pass.
- Next step: review and land the complete Proposal 0034, Decision 0036, and WI-0049 candidate.
- Active blocker or decision: none.

## Implementation Evidence

- `src/application/change-fleet-service.js` now builds one transaction-local ownership set from
  persisted `common_git_dir` locators and adds each admitted request binding before evaluating the
  next one. Rejection retains `AMBIGUOUS_SHARED_REPOSITORY` and occurs before catalog assignment.
- `test/integration/project-registration-ownership.test.js` uses real repositories, a nested path,
  a linked worktree, and two clones of one bare remote to freeze the accepted identity boundary and
  atomic rejection behavior.
- `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
  --test test/integration/project-registration-ownership.test.js
  test/acceptance/two-repository-flow.test.js` — exit `0`; Node.js 24.19.0 passed eight tests in
  two suites: four ownership cases and four existing multi-Repository acceptance cases.
- `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
  scripts/check-harness.mjs` and `git diff --check` — exit `0`; the Harness accepted three eager
  files and 49 WorkItems, and patch hygiene reported no error.
- Unverified boundary: no migration or audit scans previously persisted catalogs; shared Project
  membership, ownership transfer, and cross-host Repository identity remain deferred.

## Project Memory Impact

Current-state removes the linked-worktree admission gap and retains shared membership, transfer,
and cross-host identity as deferred boundaries.
