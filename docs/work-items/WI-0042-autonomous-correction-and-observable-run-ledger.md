---
artifact_type: development_work_item
id: WI-0042
status: done
title: Autonomous correction and observable run ledger
source: WI-0041 bounded real self-iteration findings; explicitly confirmed by user
confirmed_by: user
confirmed_at: 2026-08-12
standing_policy:
design_proposal: docs/proposals/0031-autonomous-task-conversation-and-operator-inbox.md
---

# WI-0042: Autonomous Correction And Observable Run Ledger

## Objective

Close the bounded real self-iteration gaps in the accepted autonomous task route: continue clear
Verification repairs without a human, keep role results visible in one conversation, make live
activity continuously legible, and present per-Run work, result, timing, and usage as an audit-only
ledger.

## Scope

- Automatically continue exact `changes_required` Verification feedback while the confirmed Plan
  and existing correction budget still authorize repair.
- Stop only for an actual human decision, authority expansion, exhausted budget, explicit hold, or
  terminal outcome.
- Project safe execution and verification summaries into the task conversation without replaying
  them into later Agent context.
- Replace the static Plan-first side rail with current stage, todo, and recent safe activity;
  retain the immutable semantic Plan as collapsible reference.
- Distinguish Agent activity from browser live-connection health, including bounded recovery after
  initial or later connection failure.
- Extend the read-only audit projection and browser audit view with a chronological Run ledger:
  role, trigger, result, changed paths or findings, validation evidence, duration, Runtime identity,
  and per-Run token usage.
- Preserve the failed real ChangeSet as external acceptance evidence; do not accept or manually
  resume it.

## Non-Goals

- No hidden reasoning, raw Provider transcript, command output, full diff, or logs in ordinary task
  conversation or later-Agent context.
- No new ChangeSet phase, operator state, Supervisor action vocabulary, or automatic merge.
- No pricing model, normalized quality score, multiple reviewers, Provider-session continuation,
  or hosted worker architecture.
- No mutation of a semantic Plan merely to display execution progress.

## Acceptance Criteria

- A Verification `changes_required` result with exact findings automatically starts the bounded
  feedback execution and re-verification loop without human input.
- Exhausted repair authority or an uncertain Verification decision becomes one explicit human
  request instead of an idle `running` task.
- The ordinary conversation shows bounded summaries when planning, execution, feedback execution,
  verification, review, and delivery reach stable checkpoints.
- While a Run is active, the task page visibly updates its current role, attempt, todo, latest safe
  activity, and timestamps; connection health is displayed separately.
- The right rail prioritizes current progress and keeps the immutable Plan as secondary reference.
- The audit dialog shows a chronological ledger with each Run's input role, outcome summary,
  changed paths or findings when available, duration, token usage, and selected validation results.
- Audit-only ledger content is excluded from Runtime context projection and ChangeSet startup state.

## Validation

| Command or gate | Scope | Requirement |
| --- | --- | --- |
| Targeted unit tests under Node.js 24 | live connection state and audit ledger rows | Required |
| Targeted integration tests under Node.js 24 | automatic Verification repair and conversation summaries | Required |
| Local console integration tests under Node.js 24 | live/audit projection and security boundary | Required |
| Chromium UI path under Node.js 24 | live progress, connection recovery, and audit ledger | Required |
| `npm run check:harness` and `git diff --check` | repository authority and handoff | Required |
| `npm run check` under Node.js 24 | cross-tier final replacement | Required once after stabilization |
| Real Provider rerun | external acceptance | Excluded until the deterministic repair is committed on a new exact baseline |

## Current Projection

- Current subject: branch `codex/wi-0041-autonomous-task-conversation`, based on `a171702`.
- External evidence: ChangeSet `change-5d9ee4b8-3683-4e70-a2d5-30ec1813ec1a` stopped after a
  Verification `changes_required` result even though the task still projected `running`.
- Active implementation: reuse the two exact UI Candidate commits as source material, then repair
  automatic correction, safe summaries, live progress, and the audit ledger locally.
- Active blocker or decision: none.

## Implementation Evidence

- `node --test test/unit/autonomous-task-controller.test.js test/unit/live-connection.test.js`
  exited 0 against the final control-loop and connection-state modules: 8 tests passed. It proves
  exact feedback continues within budget, budget exhaustion requests a human, initial connection
  failures become visible, and reconnect/resync states remain separate from Agent activity.
- `node --test test/integration/runtime-audit-query.test.js` exited 0 against the final read-only
  audit projection: 8 tests passed in 48.3 seconds. It proves chronological planning, execution,
  verification, feedback, deterministic-check, timing, and usage rows without Runtime-context or
  write-side coupling.
- `npm run test:ui` exited 0 against Chromium in 63.9 seconds. The selected browser path exercised
  an interrupted SSE subscription and recovery, current-progress-first layout, immutable Plan
  reference, execution summaries in conversation, and the task-ledger dialog.
- `npm run check` exited 0 under Node.js 24 against the final source in 508.6 seconds: 109 unit, 120
  integration, and 8 acceptance tests passed, followed by the Chromium path. Real Git fixtures,
  restart recovery, supervision, Candidate, Bundle, delivery, audit, local HTTP, and Harness gates
  were included.
- A pre-final full-check attempt correctly failed because a new feedback-ledger assertion was
  attached to the adjacent non-feedback fixture. Moving it exposed that Verification verdicts
  needed their own audit conclusion; the projection now records `changes_required` separately from
  the successfully completed Verification Run. The final exact gate above passed after both fixes.
- The failed real ChangeSet `change-5d9ee4b8-3683-4e70-a2d5-30ec1813ec1a` remains unchanged as
  external acceptance evidence. No paid Provider rerun or real GitHub write was performed for this
  WorkItem.

## Project Memory Impact

The completed WorkItem and `docs/current-state.md` retain only the stable autonomous-loop and audit
boundary. Detailed failed ChangeSet evidence remains in Control Store and linked Run records, not
eager Harness context.
