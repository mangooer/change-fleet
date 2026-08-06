---
artifact_type: development_work_item
id: WI-0017
status: done
title: Implement the read-only Verification Runtime
source: 'User request: "实现只读 Verification Runtime"'
confirmed_by: user
confirmed_at: 2026-08-06
started_by: agent
started_at: 2026-08-06
review_ready_at: 2026-08-06
completed_by: user
completed_at: 2026-08-06
standing_policy:
design_proposal: docs/proposals/0022-risk-adaptive-candidate-verification.md
accepted_decisions:
  - docs/decisions/0024-risk-adaptive-candidate-verification.md
---

# WI-0017: Implement The Read-Only Verification Runtime

## Objective

Implement Decision 0024's second vertical slice: one optional, independently auditable Runtime
operation that reviews an exact CandidateCheckpoint without modifying Candidate Git state.

## Context

WI-0016 records immutable `independent_review` admission but deliberately fails closed before
starting another Runtime. The accepted next slice must turn that admission into a bounded review
without adding correction, repeated review, or UI workflow.

## Scope

- Add one `verification` Runtime operation with a strict structured schema.
- Use a separately recorded AgentProfile and Run so verification usage, duration, outcome, and
  Provider evidence remain independently attributable.
- Give the Runtime a disposable exact-Candidate workspace, confirmed authority, relevant native
  Harness, deterministic check evidence, and bounded current facts only.
- Require one `triage` or `deep_review` result with exactly one of `pass`, `pass_with_notes`,
  `changes_required`, or `human_decision_required`.
- Normalize bounded findings, notes, human questions, and additional structured check requests.
- Execute requested checks through the ChangeFleet Runner against the unchanged exact subject and
  bind their attempts to immutable evidence.
- Detect Runtime workspace mutation, fail closed on malformed output or missing evidence, and make
  interrupted verification retryable without repeating a passed deterministic repository check.
- Bind a successful independent review to the Candidate and CandidateBundle; expose it through
  current read and audit projections without putting usage or history into Runtime context.

## Non-Goals

- Agent code edits, same-Plan correction, finding assessment, or focused re-review.
- Multiple reviewers, consensus, generic workflow engines, or another Provider adapter.
- UI states, dashboards, pricing, quotas, or automatic Bundle acceptance.
- Dynamic replacement of Plan checks or arbitrary Repository scope expansion.

## Acceptance Criteria

- `basic` and `deterministic` admission still invoke no Verification Runtime.
- `independent_review` starts exactly one read-only verification attempt after the Plan-bound
  repository check passes.
- Triage and deep review are two depths of the same Run, not separate Agents.
- Passing outcomes promote only the exact unchanged Candidate and execute every requested check;
  failed checks, malformed output, Runtime mutation, blocking findings, and human questions cannot
  create a Candidate.
- Blocking findings use only the accepted contract, correctness, security, data, compatibility,
  scope, or evidence categories; optional improvement remains a note.
- Verification Run usage is included in total audit cost and separately countable by operation.
- Restart recovery abandons an incomplete verification Run safely and permits a fresh attempt over
  the same checkpoint without repeating already-passed deterministic evidence.

## Validation Selection

| Gate | Requirement | Reason |
| --- | --- | --- |
| Verification schema and domain unit tests | Required | New strict output, bounds, identity, and verdict rules |
| Candidate verification integration | Required | Runtime dispatch, read-only workspace, checks, outcomes, and recovery |
| Store migration integration | Required | New durable reviews and WorkUnit references |
| Runtime context and audit integration | Required | Bounded input, operation attribution, usage, and exclusion rules |
| Codex SDK deterministic adapter test | Required | New Provider operation and read-only prompt/schema path |
| Node.js 24 full deterministic check | Required | Shared domain, store, Runtime, lifecycle, audit, and Bundle contracts change |
| Real Codex Provider | Required once on the stable subject | Provider invocation adds a new operation |
| Browser and GitHub gates | Excluded | UI and delivery behavior are unchanged |
| Documentation, links, diff, and eager-size audit | Required | Accepted authority and Harness projection change |

## Current Projection

- Current subject: direct implementation on local `main`, without a self-iteration ChangeSet.
- Last verified state: WI-0016 is committed at `b2c0398` and the working tree started clean.
- Next step: user review and acceptance; commit only after acceptance.
- Active blocker: none.

## Implementation Evidence

- The ControlStore schema is version 8. Migration from version 7 adds bounded verification reviews,
  WorkUnit verification Run references, and exact Candidate review bindings.
- `independent_review` now reuses an exact passed repository check, invokes one separately recorded
  read-only verification Run, executes every requested check through the Runner, and promotes only
  a passing unchanged exact Candidate. Basic and deterministic admission still invoke no verifier.
- Verification uses a disposable detached exact-Candidate worktree. Mutation, malformed output,
  missing evidence, blocking findings, requested-check failure, and human decisions fail closed.
- Restart recovery abandons an incomplete verification Run and workspace, then starts a fresh
  verification attempt without repeating execution or an already-passed repository check.
- Audit projections count verification usage separately and include it in the ChangeSet total;
  Runtime-context tests prove usage, history, and raw validation output remain excluded.
- `node --test test/unit/verification.test.js test/unit/runtime-evidence.test.js test/unit/model.test.js test/unit/runtime-context.test.js` exited 0 with 29 passing tests after fixture and context-schema updates.
- `node --test test/integration/candidate-checkpoint-recovery.test.js` exited 0 with 9 passing
  Real-Git tests, including requested checks, blocking findings, mutation rejection, and interrupted
  verification recovery.
- `node --test test/integration/control-store-v4-migration.test.js test/integration/runtime-audit-query.test.js`
  exited 0 with 10 passing tests for migration and independent cost attribution.
- The first real Provider attempt exited 1 before dispatch because the current Codex strict schema
  rejected an optional `timeout_ms`. The command schema now requires every declared object field,
  and a recursive unit assertion protects all three operation schemas.
- `CHANGEFLEET_RUN_REAL_CODEX=1 node --test --test-concurrency=1 test/provider/*.test.js` then exited
  0. One real flow completed planning, execution, and verification Runs. Provider evidence recorded
  32,194, 65,560, and 69,070 tokens respectively; total observed usage was 166,824 tokens and the
  Provider-duration sum was 82,308 ms.
- One aggregate check attempt reached all passing code suites but exited 1 when the unchanged UI
  smoke timed out waiting for a PR link. `node scripts/run-ui-tests.mjs` immediately exited 0; the
  final aggregate rerun below supplies the authoritative full-gate result.
- Under Node.js `v24.14.0`, `node scripts/run-checks.mjs` exited 0 on the final subject: 69 unit, 77
  integration, and 6 serial acceptance tests passed, followed by the Chromium console smoke.
- `git diff --check` exited 0; affected local Markdown links resolved. Eager Harness sizes were
  6,079 bytes for `AGENTS.md`, 1,264 for `WORKFLOW.md`, and 7,953 for `docs/current-state.md`, all
  within their soft limits.
- Browser behavior, GitHub writes, correction, focused re-review, another Provider, paid
  multi-Repository verification, and non-Windows hosts were not exercised because they are
  unchanged or outside this slice.

## Project Memory Impact

The independent read-only Verification Runtime is implemented. Correction, focused re-review, and
their UI remain later Decision 0024 slices.
