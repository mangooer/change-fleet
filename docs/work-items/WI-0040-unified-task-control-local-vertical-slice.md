---
artifact_type: development_work_item
id: WI-0040
status: done
title: Unified task control local vertical slice
source: Accepted Proposal 0030 and Decision 0032; confirmed by user
confirmed_by: user
confirmed_at: 2026-08-12
standing_policy:
design_proposal: docs/proposals/0030-unified-task-control-and-conversational-operator-flow.md
---

# WI-0040: Unified Task Control Local Vertical Slice

## Objective

Replace the operation-oriented local single-Repository route with one bounded Intent-drafting
conversation, exact confirm-and-run action, deterministic Task Controller, live task projection,
and task-first console while preserving the exact kernel.

## Scope

- Extend the Planner contract with one complete bounded Intent draft and carry it between fresh
  attempts without transcript replay.
- Confirm the exact Intent draft and Plan in one transaction.
- Add one shared Task Controller operation that advances the existing deterministic execution,
  verification, configured review, and repair machinery to the next human boundary.
- Make Plan confirmation run by default, with an explicit confirm-paused option.
- Add one stage-aware task-message operation for planning and current single-Repository Feedback.
- Add a bounded Server-Sent Events task projection from sanitized Run evidence, including Codex
  todo-list progress when available.
- Replace the local UI with a simple create dialog, grouped tasks, one conversation, semantic Plan
  progress, effective Runtime, compact metrics, pause/feedback, Bundle review, and audit dialog.
- Remove ordinary UI exposure of exact ids, digests, revisions, manual execution, and supervision
  controls while retaining exact server and audit semantics.
- Update accepted contract, architecture, README, and current-state projections.

## Non-Goals

- No Linear or GitHub Issue intake, SourceBinding implementation, Project editor, or branch scanner.
- No AgentProfile catalog or per-role task override; the configured profile remains effective.
- No new automatic-review risk engine beyond current Project policy.
- No Provider-native live steering, durable Provider thread, multi-Candidate lane, automatic Bundle
  acceptance, merge, deployment, remote access, or multi-user security.
- No compatibility path for obsolete private task records or the operation-oriented console.

## Acceptance Criteria

- A terse request can be clarified without leaving an obsolete executable Intent behind.
- Every Planner response carries the current task brief; a later reply retains earlier accepted
  clarification without full history.
- The exact approval subject binds both Intent and Plan and starts work by default exactly once.
- One Controller reaches Bundle review or a real human boundary without another execution or
  supervision choice.
- Duplicate UI submission cannot create overlapping Planner Runs.
- One conversation accepts planning input and current running Feedback with clear delivery state.
- Live activity and todo progress are bounded and presentation-only.
- Default views show task status, Runtime, Plan, tokens, elapsed time, attempts, retries, and repairs;
  exact audit detail is on demand.
- Loopback, Host, origin, CSRF, body bounds, exact Git authority, immutable Run evidence, validation,
  Bundle acceptance, and delivery rules remain intact.

## Validation

| Command or gate | Scope | Requirement |
| --- | --- | --- |
| Targeted domain and Runtime schema tests under Node.js 24 | Intent draft, context, progress events | Required during implementation |
| Targeted application tests under Node.js 24 | joint confirmation and Controller idempotency | Required |
| Targeted local HTTP tests under Node.js 24 | task message, SSE, security, duplicate prevention | Required |
| `npm run test:ui` under Node.js 24 | one-sentence create through Bundle review and audit dialog | Required |
| `npm run check` under Node.js 24 | stabilized replacement | Required once |
| `npm run check:harness` and `git diff --check` | authority and handoff | Required |
| Real Provider gate | paid interaction | Excluded from implementation gate; the preceding real task is design evidence |
| Real GitHub gate | external writes | Excluded; delivery semantics do not change |

## Current Projection

- Current subject: branch `codex/wi-0040-unified-task-control`, based on `99be18c`.
- Last verified state: Intent and Plan are jointly confirmed; one Controller owns default
  advancement; `planning | running | review | terminal` is the complete ChangeSet phase set; the
  task-first console uses one conversation, bounded SSE activity, compact metrics, and on-demand
  audit.
- Next step: review and land this atomic replacement. A later Proposal may add role-selectable
  AgentProfiles or tracker intake after this route has real operating evidence.
- Active blocker or decision: none.

## Implementation Evidence

- Planner outcomes carry a complete bounded Intent draft, and exact approval atomically records any
  changed Intent revision with the semantic Plan before the Task Controller runs.
- `changeset.controller.run` is the one default advancement operation; manual execution and
  supervision remain lower-level compatibility operations outside the ordinary page route.
- Stage-aware `changeset.message` routes planning, running Feedback, and Bundle revision feedback
  without exposing WorkUnit or Bundle subjects to the ordinary composer.
- ChangeSet phases were reduced to `planning | running | review | terminal`; delivery stays attached
  to review until a verified merge creates `terminal(done)`.
- The local server exposes a same-origin bounded SSE projection; Codex todo events retain only text
  and completion flags, while logs, command output, diffs, reasoning, and audit remain excluded.
- The console is task-first: a one-objective create dialog, grouped task list, one conversation,
  semantic Plan, live progress, compact Runtime/cost/retry summary, necessary Gates, Bundle review,
  GitHub delivery, and on-demand audit.
- Validation under Node.js 24 passed the unit suite, acceptance suite, Chromium UI path, Harness
  check, diff check, and the affected integration paths. A consolidated run reached 116/118
  integration tests before exposing two fixture/expectation defects; both were fixed and their exact
  failing tests then passed. This WorkItem does not represent that interrupted consolidated command
  as a full-suite pass.

## Project Memory Impact

The accepted contract will describe one task Controller and user-facing route. Detailed live events,
conversation, Runs, costs, and audit artifacts remain linked operational evidence rather than eager
Harness memory.
