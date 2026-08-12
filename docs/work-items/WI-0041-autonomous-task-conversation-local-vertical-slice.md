---
artifact_type: development_work_item
id: WI-0041
status: done
title: Autonomous task conversation local vertical slice
source: Accepted Proposal 0031 and Decision 0033; confirmed by user
confirmed_by: user
confirmed_at: 2026-08-12
standing_policy:
design_proposal: docs/proposals/0031-autonomous-task-conversation-and-operator-inbox.md
---

# WI-0041: Autonomous Task Conversation Local Vertical Slice

## Objective

Atomically replace the synchronous confirm-and-operate local route with one Codex-style task
conversation, bounded automatic Plan activation, restart-aware background advancement, six operator
states, and recoverable GitHub delivery while preserving the exact kernel.

## Scope

- Freeze task authorization for automatic Plan activation, human review, delivery publication,
  attempts, elapsed time, Repository scope, refs, and effective AgentProfile.
- Extend Planner outcomes with `ready | needs_input`; automatically activate eligible exact Plans
  as policy authority and create one exact human request otherwise.
- Add a durable local task-command queue, one in-process background worker, per-ChangeSet lease,
  idempotent reconciliation, and immediate accepted HTTP responses.
- Add a bounded durable presentation timeline for human messages, safe Agent progress, role handoff,
  Plan, todo, validation, review, Delivery, and terminal events.
- Derive only `running | needs_feedback | needs_review | waiting_for_merge | complete | cancelled`
  plus reason codes in default views.
- Replace the ordinary console with inbox grouping, one timeline/composer, optimistic message
  reconciliation, continuous activity, pause, review, Delivery, and cancellation.
- Make human Bundle acceptance publish or resume one exact Ready PR when authorized; support bounded
  transient retry, missing-target diagnostics, and visible failed-publication recovery.
- Remove ordinary UI dependence on default Plan confirmation, manual Controller start, separate PR
  creation, and refresh-only failed Delivery recovery.
- Update SPEC, architecture, README, current-state, and tests with the final branch-local truth.

## Non-Goals

- No raw chain-of-thought, complete Provider transcript, command output, diff, or audit evidence in
  the ordinary timeline or later-Agent context.
- No automatic merge, deployment, remote worker, webhook service, hosted multi-tenancy, desktop
  shell, tracker intake, or SourceBinding implementation.
- No AgentProfile catalog, automatic model routing, Candidate comparison, normalized quality score,
  or cost-policy optimization.
- No ChangeFleet-specific Harness or mandatory semantic command for registered repositories.

## Acceptance Criteria

- One low-risk task advances from one request to its configured review or merge boundary without a
  Plan-confirm or Controller-start click.
- Planner uncertainty creates needs-feedback; one same-conversation reply resumes the exact route.
- HTTP returns after durable command acceptance, while the background worker advances safely and
  reconciles accepted work after restart.
- One timeline shows immediate human messages and bounded safe activity across separate internal
  role Runs without leaking raw reasoning or history into subsequent Runtime context.
- Default task views expose exactly six operator states and deterministic reasons.
- Human review feedback repairs the same Plan; exact acceptance automatically publishes a Ready PR
  when authorized and merge observation produces complete.
- Failed Delivery remains visible and retryable; missing binding, missing target, transient network,
  divergence, and closed PR have distinct behavior.
- Cancellation stops automatic work, releases eligible resources, and preserves audit.
- Existing exact Repository authority, immutable Run evidence, Candidate and Bundle identity,
  validation, loopback security, human merge, and audit isolation remain intact.

## Validation

| Command or gate | Scope | Requirement |
| --- | --- | --- |
| Targeted unit tests under Node.js 24 | authorization, queue, timeline, six-state projection | Required during implementation |
| Targeted integration tests under Node.js 24 | auto Plan, restart, feedback, review, Delivery retry, cancellation | Required |
| Local HTTP integration tests under Node.js 24 | 202, security, SSE, idempotency | Required |
| Chromium UI path under Node.js 24 | one request through needs-review/waiting-merge with optimistic conversation | Required |
| Acceptance tests under Node.js 24 | existing exact single- and multi-Repository routes | Required |
| `npm run check` under Node.js 24 | stabilized shared contract and lifecycle replacement | Required once |
| `npm run check:harness` and `git diff --check` | authority and handoff | Required |
| Real Provider and GitHub write | paid/external interaction | Excluded until deterministic implementation passes; run later as a bounded self-iteration |

## Current Projection

- Current subject: branch `codex/wi-0041-autonomous-task-conversation`, based on `94c7f81`.
- Last verified state: the local task route durably accepts commands, automatically activates
  ready Plans, stops for Planner input, advances to review, publishes accepted Bundles, monitors
  merge, and projects one conversation plus six operator states.
- Next step: use the completed slice in one bounded real self-iteration from this exact branch
  baseline.
- Active blocker or decision: none.

## Implementation Evidence

- Added `TaskControlStore` for frozen local authorization, an append-only safe timeline, durable
  task commands, bounded short-transaction contention, worker leases, and restart recovery outside
  the ChangeSet aggregate.
- Added `AutonomousTaskController` for automatic Plan activation, deterministic task advancement,
  same-conversation feedback, operator pause/cancel, automatic Delivery publication, bounded
  transient retry, and merge monitoring.
- Planner outcomes now distinguish `ready | needs_input`; Core still compiles and exactly binds the
  semantic Plan before any execution.
- Default read models and the browser expose only `running | needs_feedback | needs_review |
  waiting_for_merge | complete | cancelled` with deterministic reasons, one safe conversation,
  optimistic human messages, and no routine Plan-confirm or Controller-start click.
- GitHub Delivery now has a browser binding form, automatic publication after acceptance, manual
  failed-publication retry, and `DELIVERY_TARGET_NOT_FOUND` distinct from remote transport failure.
- `node --test test/unit/task-control-store.test.js
  test/unit/autonomous-task-controller.test.js test/unit/runtime-evidence.test.js` exited 0: nine
  focused unit tests passed.
- `node --test test/integration/autonomous-task-flow.test.js` exited 0: Planner input,
  same-conversation resume, review, cancellation, resource release, and restart recovery passed.
- `node scripts/run-ui-tests.mjs` exited 0: the Chromium task path passed without manual Plan
  confirmation or separate PR-publication action.
- `node scripts/run-checks.mjs` exited 0 after the contention fix: Harness validation, 102 unit
  tests, 120 integration tests, eight acceptance tests, and the Chromium path passed.
- Real Provider use and real GitHub writes were not executed; those paid/external boundaries remain
  the next bounded self-iteration rather than deterministic implementation evidence.

## Project Memory Impact

SPEC and architecture will own the accepted authorization, asynchronous Controller, timeline, and
operator-state contract. Detailed events, transcripts, Runs, delivery attempts, and cost remain
linked operational evidence rather than eager Harness memory.
