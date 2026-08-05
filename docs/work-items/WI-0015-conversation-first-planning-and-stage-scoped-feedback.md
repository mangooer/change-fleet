---
artifact_type: development_work_item
id: WI-0015
status: done
title: Implement conversation-first planning and stage-scoped feedback
source: 'User request: "按你说的做" after choosing direct bootstrap and abandoning stalled self-iteration ChangeSets'
confirmed_by: user
confirmed_at: 2026-08-05
started_by: user
started_at: 2026-08-05
review_ready_at: 2026-08-05
completed_by: agent
completed_at: 2026-08-05
standing_policy:
design_proposal: docs/proposals/0021-conversation-first-planning-and-stage-scoped-feedback.md
accepted_decisions:
  - docs/decisions/0022-explicit-revision-feedback-assessment.md
  - docs/decisions/0023-conversation-first-planning-and-stage-scoped-feedback.md
---

# WI-0015: Implement Conversation-First Planning And Stage-Scoped Feedback

## Objective

Implement Decision 0023 directly so ChangeFleet can resume self-iteration without manufacturing
Plan revisions for planning conversation or ordinary implementation correction.

## Scope

- Represent planning output as an exact conversation message and linked Run evidence with optional
  structured plan content.
- Create the first or next confirmed `ChangePlanRevision` only when a human approves an exact
  message id and content digest.
- Reject stale, mismatched, or replayed approval subjects deterministically while preserving
  idempotent replay of the same command.
- Continue planning conversation without Provider-session resume and without allocating Plan
  revisions.
- Route Bundle revision findings into correction under the current confirmed Plan by default;
  require a typed contract invalidation before true replanning.
- Attach one bounded `adopt | adapt | decline` assessment per current finding to the handling
  planning message or correction outcome.
- Preserve confirmed Plan history and explicitly normalize or retire incompatible unconfirmed
  legacy records.
- Update shared operations, persisted schema, Runtime projection and adapter contracts, CLI, local
  console, tests, and current authority.

## Non-Goals

- A general chat platform, streaming transport, Provider-session resume, or checkpoints.
- Linear or GitHub Issue intake, polling, synchronization, or writes.
- Automatic truth scoring, evidence ranking, or clarification state machines.
- Changing Repository authorization, Candidate or Bundle identity, delivery, or recovery.
- Continuing either abandoned bootstrap ChangeSet.

## Acceptance Criteria

- No `ChangePlanRevision` exists before exact human approval of an approvable planning message.
- Repeated planning turns replace the current approvable message without creating Plan history.
- Exact approval creates revision 1 for the first confirmed Plan and the next integer only after a
  confirmed Plan was invalidated and replaced.
- Ordinary execution and Bundle correction retain the confirmed Plan revision.
- Feedback assessment coverage and bounds are deterministic without making human prose truth.
- Existing confirmed Plan history stays readable; incompatible unconfirmed legacy subjects have an
  explicit deterministic disposition.
- Shared CLI and local console behavior delegate to the same application operations.
- Superseded messages, transcripts, usage, and cost remain outside default Runtime context.
- Selected targeted tests, the Node.js 24 full deterministic suite, and one authorized real Codex
  Provider flow pass on the final stable subject.

## Validation Selection

| Gate | Requirement | Reason |
| --- | --- | --- |
| Domain and schema unit tests | Required | Plan identity and persisted contract change |
| Store migration and restart integration | Required | Legacy unconfirmed records change meaning |
| Application lifecycle integration | Required | Conversation, approval, correction, and replan routing |
| Runtime context and Codex adapter tests | Required | New structured message and assessment placement |
| CLI and local console tests | Required | Shared operations expose the new human workflow |
| Two-Repository acceptance | Required | Shared ChangeSet and Bundle lifecycle changed |
| Node.js 24 full deterministic check | Required | Change crosses domain, store, Runtime, CLI, UI, and acceptance |
| Real Codex Provider | Required once | Verify the first production Runtime uses the new planning protocol |
| Real GitHub delivery | Excluded | Delivery identity and external writes are unchanged |
| Documentation, links, diff, and eager-size audit | Required | Accepted authority and Harness projection change |

## Current Projection

- Current subject: direct bootstrap branch `codex/conversation-first-planning` at accepted base
  `a1fa86e48f4e411bcfb3bdbb086f0be061ec0465`.
- Closed history: `changefleet-runtime-guidance-normalization-v2` and
  `changefleet-conversation-first-planning` are abandoned with audit evidence preserved.
- Active blocker: none.
- Next step: land this completed direct bootstrap, then create the next ordinary ChangeSet through
  the conversation-first lifecycle.

## Implementation Evidence

- The preliminary Node.js 22 syntax and selected-unit command returned exit code `1`: all syntax
  checks passed, while 13 of 16 selected tests passed and three old protocol assertions still used
  `plan_proposed` or `confirmPlanRevision`. Node.js 24 was then used for every selected gate.
- Early Node.js 24 suite runs returned exit code `1` while obsolete fixtures were being replaced:
  the unit suite passed 57 of 58, the integration suite 56 of 64, the first selected integration
  rerun 31 of 32, and the first acceptance run 3 of 6. A later acceptance run passed 5 of 6 and
  isolated one outdated WorkUnit-state expectation. Each failure was corrected before the final
  stable subject; no failing result is reported as passed.
- Node.js 24 running `--test "test/unit/**/*.test.js"` returned exit code `0`: 60 tests passed,
  including revision-free plan content, exact confirmation identity, bounded conversation context,
  schemas, diagnostics, and shared operation routing.
- Node.js 24 running `--test "test/integration/**/*.test.js"` returned exit code `0`: 67 tests
  passed, including repeated planning conversation, stale approval rejection, v4-to-v6 migration,
  deterministic v5 unconfirmed-Plan retirement, same-Plan Bundle correction, typed Plan
  invalidation, restart, CLI, and exact local-console approval.
- Node.js 24 running `--test --test-concurrency=1 test/acceptance/two-repository-flow.test.js`
  followed by `--test test/integration/local-console-server.test.js` returned exit code `0`: two
  multi-Repository acceptance tests and three Console integration tests passed.
- The first Node.js 24 `scripts/run-ui-tests.mjs` attempt returned exit code `1` because the UI
  fixture still called the removed temporary `confirmPlanRevision` helper. After moving it to exact
  message approval and injecting `RunStore`, the same command returned exit code `0`; the Chromium
  Console path passed.
- Final Node.js 24 `scripts/run-checks.mjs` returned exit code `0` in 259.9 seconds: 60 unit, 67
  integration, 6 acceptance tests, and the Chromium UI gate passed on one stable working tree.
- With `CHANGEFLEET_RUN_REAL_CODEX=1`, Node.js 24 running `--test --test-concurrency=1
  test/provider/codex-real-flow.test.js` returned exit code `0` in 57.8 seconds. The real
  `host_user` Codex SDK flow planned and executed one exact-base Repository without invoking the
  Windows constrained Sandbox path. Provider audit observed 31,782 planning tokens, 64,955
  execution tokens, 96,737 task-total tokens, and 45,958 ms Run duration; these facts remained audit
  evidence rather than semantic Runtime context.
- Final `git diff --check` returned exit code `0`. Proposal, Decision, and WorkItem links exist.
  Eager Harness files measured 6,079 bytes for `AGENTS.md`, 1,264 for `WORKFLOW.md`, and 8,105 for
  `docs/current-state.md`, within their soft limits. Real GitHub delivery, another host OS, and a
  paid multi-Repository Provider flow were not run because their authority or boundary did not
  change.

## Acceptance Review

Accepted scope is implemented. Before approval there are only exact linked planning messages;
approval atomically creates a confirmed Plan revision. Ordinary review correction retains that
revision and records per-finding assessments on correction Runs. Only the typed
`plan_invalidation_required` outcome returns to planning, and incompatible unconfirmed v5 records
are explicitly retired during migration.

## Project Memory Impact

After this WorkItem lands, create the next ordinary ChangeSet through the new conversation-first
path and resume self-iteration without reviving the abandoned bootstrap records.
