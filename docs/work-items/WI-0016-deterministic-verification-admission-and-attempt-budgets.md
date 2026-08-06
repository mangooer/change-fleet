---
artifact_type: development_work_item
id: WI-0016
status: done
title: Implement deterministic verification admission and attempt budgets
source: 'User request: "先实现“确定性验证准入与尝试预算”切片"'
confirmed_by: user
confirmed_at: 2026-08-06
started_by: agent
started_at: 2026-08-06
review_ready_at: 2026-08-06
completed_by: agent
completed_at: 2026-08-06
standing_policy:
design_proposal: docs/proposals/0022-risk-adaptive-candidate-verification.md
accepted_decisions:
  - docs/decisions/0024-risk-adaptive-candidate-verification.md
---

# WI-0016: Implement Deterministic Verification Admission And Attempt Budgets

## Objective

Implement the first Decision 0024 vertical slice directly in the repository, without running a
self-iteration ChangeSet or introducing a Verification Runtime.

## Context

Current validation binds a timeout to the Plan command and repeats that unchanged value when an
exact CandidateCheckpoint resumes. It also has no immutable Candidate-bound admission record.

## Scope

- Freeze a minimal Project verification policy into each new ChangeSet.
- Add a preliminary Plan verification expectation and exact check-coverage rationale.
- Persist one immutable deterministic admission decision for each exact CandidateCheckpoint.
- Allow operator admission input to raise, but never lower, Project and Plan requirements.
- Fail closed when deterministic facts select `independent_review`, because that Runtime is deferred.
- Separate semantic check identity from attempt timeout and accept bounded timeout overrides on an
  unchanged check and exact subject.
- Record requested and effective budgets, duration, environment identity, and evidence per attempt.
- Migrate existing catalog and ChangeSet records deterministically.

## Non-Goals

- A Verification Runtime, semantic diff review, correction Run, focused re-review, or review UI.
- Dynamic Agent-selected check requests after Candidate publication.
- Multiple check commands per Repository or a generic policy language.
- Provider, GitHub delivery, deployment, or tracker changes.

## Acceptance Criteria

- A low-risk exact Candidate records a `basic` admission without invoking another Runtime.
- Project policy, Plan expectation, operator elevation, reported-path divergence, and unresolved
  Plan boundaries produce deterministic bounded reasons.
- `independent_review` admission remains durable and cannot promote a Candidate in this slice.
- Retrying an unchanged check may change only its timeout within the frozen Project maximum and
  does not change the validation subject or invoke a Runtime.
- Every attempt records its check identity, requested/effective timeout, environment, duration,
  result, and immutable evidence.
- Existing v6 data migrates without granting new Candidate authority.

## Validation Selection

| Gate | Requirement | Reason |
| --- | --- | --- |
| Domain model and verification unit tests | Required | New identities, policy precedence, and bounds |
| Candidate recovery integration | Required | Exact-check timeout retry and zero-Runtime recovery change |
| Store migration integration | Required | Control schema and frozen Project policy change |
| Runtime schema and context tests | Required | Plan expectation and policy projection change |
| ChangeSet view tests | Required | New admission and check metadata projection |
| Node.js 24 full deterministic check | Required | Domain, schema, store, lifecycle, and recovery all change |
| Real Codex Provider | Excluded | Provider invocation and Agent loop are unchanged |
| Browser and GitHub gates | Excluded | UI behavior and external delivery are unchanged |
| Documentation, links, diff, and eager-size audit | Required | Accepted authority and Harness projection change |

## Current Projection

- Current subject: accepted direct implementation on the existing `main` working tree.
- Active blocker: none.
- Next step: land the exact working-tree subject without starting a self-iteration ChangeSet.

## Implementation Evidence

- An initial Node.js 22 selected run of four affected unit files returned exit code `1`: 13 of 23
  tests passed and ten fixtures lacked the new explicit check rationale or projection version. The
  fixtures were corrected; this result was not treated as the required Node.js 24 gate.
- Bundled Node.js `v24.14.0` ran the focused domain, Candidate recovery, and migration command with
  exit code `0` in 56.9 seconds: 23 tests passed. The recovery fixture changed only the repository
  timeout from 300 ms to 2,000 ms over the same Checkpoint, check identity, and Plan; it invoked no
  Runtime during resume.
- Bundled Node.js 24 ran the complete unit scope with exit code `0` in 16.9 seconds: 65 tests passed.
- Bundled Node.js 24 ran the complete integration scope with exit code `0` in 83.9 seconds: 69 tests
  passed before the final v6 migration case was added.
- Bundled Node.js 24 ran the focused Runtime context, schema, verification, audit, and migration
  command with exit code `0` in 35.5 seconds: 23 tests passed, including immutable attempt metadata
  binding in the read-only audit projection.
- Final bundled Node.js 24 `scripts/run-checks.mjs` returned exit code `0` in 275.4 seconds: 65 unit,
  70 integration, 6 acceptance tests, and the Chromium local-console path passed on the stable
  working tree.
- Final `git diff --check`, new-file trailing-whitespace inspection, and targeted Proposal,
  Decision, and WorkItem link checks returned exit code `0`. Eager Harness files measured 6,079
  bytes for `AGENTS.md`, 1,264 for `WORKFLOW.md`, and 7,888 for `docs/current-state.md`, within their
  soft limits.
- Real Codex Provider and real GitHub external-write gates were not run because Provider invocation,
  independent verification, and delivery authority are unchanged. Another host OS remains
  unverified.

## Acceptance Review

The first Decision 0024 slice is complete. Every new ChangeSet freezes a minimal Project policy;
Plans carry a preliminary expectation and check rationale; exact checkpoints receive one immutable
admission; and `independent_review` fails closed. Attempt timeout is no longer semantic check
identity, bounded overrides retain the same Plan and subject, and every attempt carries auditable
budget, environment, duration, outcome, and evidence fields. The Control Store migrates v4 through
v6 without granting admission to historical Candidates. No Verification Runtime was added.

## Project Memory Impact

After this slice lands, independent Verification Runtime work remains a separate later WorkItem.
