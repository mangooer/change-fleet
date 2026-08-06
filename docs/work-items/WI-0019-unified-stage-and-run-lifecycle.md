---
artifact_type: development_work_item
id: WI-0019
status: done
title: Replace operation-specific states with unified stage and Run lifecycle
source: User requested revision and acceptance of Proposal 0023, followed by one atomic replacement WorkItem and the code refactor.
confirmed_by: user
confirmed_at: 2026-08-06
started_by: agent
started_at: 2026-08-06
review_ready_at: 2026-08-06
completed_by: agent
completed_at: 2026-08-06
standing_policy:
design_proposal: docs/proposals/0023-unified-stage-and-run-lifecycle.md
accepted_decisions:
  - docs/decisions/0001-control-plane-boundary.md
  - docs/decisions/0002-changeset-and-bundle-aggregate.md
  - docs/decisions/0017-post-provider-candidate-finalization-and-recovery.md
  - docs/decisions/0024-risk-adaptive-candidate-verification.md
  - docs/decisions/0025-unified-stage-and-run-lifecycle.md
---

# WI-0019: Replace Operation-Specific States With Unified Stage And Run Lifecycle

## Objective

Atomically replace the current flat ChangeSet and WorkUnit state machine with Decision 0025's
coarse phases, one generic Agent Run lifecycle, generic feedback lineage, derived presentation
activity, and one Run recovery path while preserving exact Git subjects and immutable evidence.

## Context

The current implementation has separate validation, verification, correction, focused-review,
failure, and human-decision state branches. Proposal 0023 and Decision 0025 accept a breaking
pre-release schema cutover and require removal rather than a retained compatibility workflow.

## Scope

- Add pure ChangeSet and WorkUnit phase contracts and one generic Run contract.
- Replace flat aggregate state writes and checks across planning, execution, verification, Bundle
  review, delivery, closure, audit, CLI, and local UI projections.
- Normalize human and verifier rework into feedback-triggered execution Runs; remove the correction
  Runtime operation and focused-review lifecycle state.
- Merge WorkUnit execution, verification, and correction reference arrays into one ordered Run
  reference collection with operation, trigger, and lineage.
- Replace operation-specific interrupted-Run recovery with one reconciler and bounded
  operation-specific workspace preflight handlers.
- Add a one-way persisted-state migration that preserves immutable Run, evidence, checkpoint,
  Candidate, Bundle, decision, and delivery identities.
- Delete legacy state branches, prompts, duplicated references, obsolete tests, and superseded
  accepted-contract text in the same WorkItem.
- Keep all new or materially changed source logic documented with concise Chinese comments.

## Non-Goals

- A generic workflow DSL, configurable Agent graph, new Provider, live session steering, or
  Provider-session resume authority.
- New UI features, Linear, automatic merge, deployment, remote workers, pricing, or dashboards.
- Changing Repository authorization, exact Git, Candidate, Bundle, validation-evidence, or GitHub
  delivery identity.
- Preserving experimental internal payload or state-name compatibility through a permanent dual
  model.

## Acceptance Criteria

- Persistent ChangeSet phase is limited to `planning | working | review | delivery | terminal`.
- Current WorkUnit phase is limited to `execution | verification | complete`, separate from
  `current | superseded | excluded` disposition.
- Agent Runs use only `planning | execution | verification` and the common status lifecycle.
- Human and verifier revision feedback both create ordinary feedback-triggered execution lineage.
- Feedback, interruption, failure, blocker, and human waiting do not create compound aggregate
  states.
- One generic reconciler covers interrupted Agent Runs without repeating completed Runtime work or
  weakening exact workspace preflight.
- Audit and presentation derive phase/activity and retain exact per-Run and total costs outside
  ordinary Runtime context.
- Multi-repository behavior permits one WorkUnit to execute while another verifies.
- Production code and ordinary tests contain no removed state names, correction operation, focused
  lifecycle, or duplicate verification/correction Run-reference arrays.
- Historical immutable subjects and evidence survive migration; unsafe in-flight state fails
  closed without guessing.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Changed domain and lifecycle tests | Phase, Run, feedback, transition contracts | Required | Direct shared-contract coverage |
| Store migration and restart integration | Persisted schema and generic recovery | Required | One-way migration and crash safety |
| Real-Git checkpoint and verification integration | Workspace, exact subjects, feedback re-execution | Required | Candidate authority must remain exact |
| Runtime context and audit tests | Unified lineage, cost, context exclusion | Required | Observability boundary changes |
| Codex SDK deterministic adapter tests | Removed correction operation and unified prompts | Required | Provider protocol changes |
| CLI, HTTP, and browser tests | Derived phase/activity and shared operations | Required when affected | Presentation contracts change |
| Two-repository acceptance | Concurrent WorkUnit phases and Bundle formation | Required | Core multi-repository behavior changes |
| Node.js 24 `npm run check` | Complete changed dependency surface | Required once stable | Shared schema, stores, Runtime, UI, and acceptance all change |
| Real Codex Provider flow | Unified planning, execution, verification protocol | Required once stable | Provider operation and prompts change |
| Real GitHub external write | External delivery | Excluded | Delivery identity and write behavior are unchanged |
| Documentation, links, diff, and eager-size audit | Accepted authority and Harness | Required | Proposal, Decision, SPEC, architecture, and current projection change |

## Current Projection

- Current subject: `codex/wi-0019-unified-stage-run-lifecycle` from local `main` at `1baae1d`.
- Proposal 0023 and Decision 0025 are accepted; WI-0019 is complete on the branch.
- The user accepted the atomic replacement, tests, evidence, and Harness projections together as
  one exact landing Candidate.
- Landing this Candidate makes the unified lifecycle canonical without another Harness-status
  mutation. The next design discussion is Proposal 0024's bounded autonomous Supervisor.
- Active blocker or decision: none.

## Implementation Evidence

- Control schema v10 persists only coarse ChangeSet phase, WorkUnit phase/disposition, generic Run
  references, immutable Feedback, Gates, Blockers, and exact artifacts. New pure transition tables
  reject invalid routes and derive the five presentation activities without persisting them.
- The v9-to-v10 migration covers every old ChangeSet and WorkUnit state, merges duplicate execution
  and verification references, normalizes old rework Runs and narrowed reviews, preserves in-flight
  facts, and records one deterministic migration evidence summary. RunStore independently preserves
  old operation/status provenance while writing only the new identity.
- Planning, execution, verification, Bundle review, delivery, closure, Runtime context, audit, CLI,
  HTTP, and local UI now use the unified model. Human and verifier findings both produce Feedback;
  handling uses an execution Run with trigger `feedback`, followed by ordinary verification.
  Repeated actionable findings do not create another aggregate state or a hard-coded one-pass loop.
- `RunCoordinator` owns live Provider calls and local interruption. `RunRecoveryService` is the one
  persisted-running-Run reconciler, with bounded planning, writable-execution, and read-only-review
  cleanup/preflight adapters. The old three recovery implementations were removed from the facade.
- `FeedbackService`, `RepositoryValidator`, `CombinedValidator`, and `BundleAssembler` separate
  immutable input, exact command evidence, and Bundle identity from lifecycle authorization. The
  application facade retains idempotency and authority rather than becoming a workflow engine.
- Multi-repository acceptance pauses the second independent execution and observes the first
  WorkUnit in `verification`, the second in `execution` with a running Run, and the ChangeSet in
  `working` before both complete normally.
- The shared operation surface adds Feedback submit, local Run interruption, Gate resolution, and
  start/continue. The local browser exposes all four. CLI retains Feedback, Gate, and execute, but
  deliberately omits Run interruption because a new CLI process cannot own an existing live Run.
- Syntax checks plus selected lifecycle, migration, feedback, interruption, recovery,
  exact-checkpoint, Harness, HTTP, and two-repository tests exited 0. One high-concurrency Windows
  child exit was reproduced individually as resource pressure; the complete stable gate below
  passed without changing test semantics.
- Under Node.js `v24.14.0`,
  `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts/run-checks.mjs`
  exited 0 in 535.7 seconds: 74 unit, 90 integration, and 7 serial acceptance tests passed, followed
  by the pinned Chromium local-console check.
- `$env:CHANGEFLEET_RUN_REAL_CODEX='1'; <Node24> --test --test-concurrency=1
  'test/provider/**/*.test.js'` exited 0 in 156.7 seconds. One real flow completed planning,
  execution, verification, feedback-triggered execution, and re-verification. Five independently
  auditable Runs reported 279,739 total tokens and 124,190 ms aggregate Runtime duration; no UAC or
  extra Provider authorization prompt appeared.
- `git diff --check` exited 0. An 11-file affected Markdown link scan exited 0. Eager Harness sizes
  are 6,079 bytes for `AGENTS.md`, 1,264 for `WORKFLOW.md`, and 6,823 for
  `docs/current-state.md`, within their soft limits. A removed-name scan found old lifecycle terms
  only in explicit migration fixtures/code and chronological Proposal, Decision, and WorkItem
  history.
- Another Provider, paid multi-Repository Provider execution, non-Windows hosts, live Provider
  feedback steering, GitHub external writes, and durable Provider-session resume remain unverified
  or deferred. Deterministic multi-repository Git/GitHub fixtures and the local Chromium surface did
  pass.

## Project Memory Impact

Decision 0025 and WI-0019 are accepted. This exact Candidate contains the complete atomic
replacement, project Harness update, evidence, and landing projection; merging it establishes the
new canonical baseline without a later status-only commit.
