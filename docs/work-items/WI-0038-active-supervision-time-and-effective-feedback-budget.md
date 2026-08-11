---
artifact_type: development_work_item
id: WI-0038
status: done
title: Active supervision time and effective Feedback budget
source: Real self-iteration finding under Decision 0026; confirmed by user direction
confirmed_by: user
confirmed_at: 2026-08-11
standing_policy:
design_proposal:
---

# WI-0038: Active Supervision Time And Effective Feedback Budget

## Objective

Correct the accepted supervision budget implementation so elapsed supervision time excludes clean
human waits, while preserving one total execution-Run ceiling and making the effective Feedback
dispatch budget explicit.

## Context

The bounded real self-iteration reached Bundle review after one execution Run. Human
`request_revision` created one remaining Feedback cycle, but the task's total execution limit of one
correctly prevented a second execution Run. More importantly, the elapsed supervision counter kept
advancing while the system waited at human Bundle review and nearly exhausted the autonomous budget
without autonomous activity.

Decision 0026 already owns this boundary. This WorkItem fixes its implementation and projection; it
does not introduce a new supervision model.

## Scope

- Persist accumulated active supervision time and the optional start of the current active interval.
- Start the clock only while the autonomous controller loop is active; freeze it at clean stop,
  Gate, hold, interruption, or restart reconciliation, and continue cumulatively on resume.
- Keep `execution_attempt_limit_per_work_unit` as the total execution-Run ceiling, including
  Feedback-triggered Runs.
- Keep `feedback_cycle_limit_per_work_unit` as an additional subset ceiling and project its
  effective remaining dispatch capacity after the total execution ceiling is applied.
- Prevent deterministic routing from offering Feedback that cannot be dispatched under the total
  execution ceiling.
- Update targeted tests and current authority projections without adding lifecycle phases.

## Non-Goals

- No independent initial-execution and Feedback execution pools.
- No token hard stop, pricing, quota service, model routing, UI redesign, or Provider change.
- No delivery or merge of the external README self-iteration Candidate.
- No compatibility adapter for an already released persisted schema.

## Acceptance Criteria

- Elapsed supervision usage advances during an active controller interval and remains unchanged
  during Bundle review, an open Gate, or an operator hold.
- Resume continues from accumulated active time instead of restarting or including the human wait.
- Restart reconciliation leaves no active clock running and preserves deterministic recovery.
- Feedback progress exposes both its own remaining cycles and the effective dispatch capacity
  constrained by total execution attempts.
- A validation failure cannot offer `submit_feedback` after total execution capacity is exhausted.
- Existing autonomous execution, verification, Bundle review, Feedback repair, and restart paths
  retain their coarse phases and exact-subject behavior.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `node --test test/unit/supervision.test.js` under Node.js 24 | active clock derivation and combined counters | Required | Direct pure-domain boundary |
| `node --test test/integration/autonomous-supervision.test.js` under Node.js 24 | stop, human wait, resume, and restart | Required | Store and controller-loop behavior |
| `npm run check` under Node.js 24 | all deterministic accepted scopes | Required | Persisted supervision control and shared action projection change |
| `npm run check:harness` under Node.js 24 | WorkItem and current-state projection | Required | Repository Harness changes |
| `git diff --check` over branch base through working tree | complete WorkItem diff | Required | Formatting and handoff hygiene |
| Real Provider gate | paid Provider behavior | Excluded | The defect is deterministic controller accounting, not Provider invocation |
| Real GitHub gate | external delivery write | Excluded | Delivery is outside scope |

## Current Projection

- Current subject: accepted implementation commit `008eadf`, based on the WI-0037 replacement at
  `48af9ab`.
- Last verified state: active interval accounting, restart closure, and effective Feedback capacity
  passed the selected deterministic gates and the user accepted WI-0038 on 2026-08-11.
- Next step: none for this completed WorkItem; Git owns its exact landing history.
- Active blocker or decision: none.

## Implementation Evidence

- `supervision_control` now stores accumulated active milliseconds and an optional active interval
  start. The autonomous loop starts the clock only after reconciliation and freezes it on stop,
  Gate, or recovery; clean human waits no longer advance the budget.
- Execution attempts remain the total execution-Run ceiling. Feedback retains its own cycle counter
  and now projects `effective_remaining`, `effective_exhausted`, and `blocked_by`; deterministic
  validation routing does not offer Feedback when the total execution ceiling prevents dispatch.
- Control Store schema is 14 and the Supervisor-specific context projection is 2. No lifecycle
  phase, Provider path, compatibility adapter, or delivery behavior was added.
- The first `node --test test/unit/supervision.test.js` exited 1 because the old fixture did not mark
  its clock active; after updating the fixture and adding interval and composite-budget coverage,
  the same command exited 0 with 10 tests passed.
- `node --test test/integration/autonomous-supervision.test.js` exited 0 in 211.6 seconds with 21
  tests passed. After strengthening the human-wait test to resume after one hour, its first targeted
  run exited 1 because the fixture injected `now` instead of the service's `clock`; the corrected
  targeted command exited 0 in 10.8 seconds.
- `npm test` under Node.js 24.14.0 exited 0 in 21.1 seconds with 94 unit tests passed.
- Final `npm run check` under Node.js 24.14.0 exited 0 in 403.8 seconds: Harness validation found 38
  WorkItems; 94 unit, 116 integration, and 8 acceptance tests passed, followed by the Chromium
  console path.
- Real Provider and GitHub gates were excluded as selected: this is deterministic controller
  accounting with no Provider invocation or external delivery change.

## Project Memory Impact

This WorkItem preserves Decision 0026's bounded autonomous Supervisor and clarifies its existing
budget semantics. It adds no phase, workflow graph, or Agent-owned control authority.
