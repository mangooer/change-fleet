---
artifact_type: repository_design_proposal
id: 0030
status: accepted
title: Unified task control and conversational operator flow
proposed_at: 2026-08-12
accepted_at: 2026-08-12
confirmed_by: user
decision: docs/decisions/0032-unified-task-control-and-conversational-operator-flow.md
implementation_tracking: docs/work-items/WI-0040-unified-task-control-local-vertical-slice.md
---

# 0030: Unified Task Control And Conversational Operator Flow

## Context

The first real local-console task proved that ChangeFleet's exact Git, workspace, Run, and audit
boundaries work, but the ordinary task route does not. A terse request was frozen as the current
Intent before Planner clarification. Later conversation changed the human's goal without replacing
that authority. The Planner then followed a repository next-task projection and repeatedly proposed
creating the same kind of ChangeSet that already contained it. Eight planning Runs consumed 737,591
reported tokens before one recursive Plan was confirmed.

The console also exposes internal operations as user workflow. Plan confirmation, manual execution,
autonomous supervision, Feedback, Gate resolution, verification, Bundle review, acceptance, and
delivery each appear as separate concepts or buttons. The persisted lifecycle is small, but users
must still choose among multiple orchestration paths. A confirmed manual Plan does not start work,
which made exact approval look ineffective.

This is not only a visual defect. The authority order and application-control route must change.
ChangeFleet should preserve its exact kernel while presenting one task, one conversation, one
controller, and only genuine human boundaries.

## Decision

Replace the current operator route with one task-control model while retaining ChangeSet,
TaskWorkspace, WorkUnit, Run, Candidate, CandidateBundle, Evidence, AgentProfile, and exact Git
authority.

### One Request, Draft Intent, And Plan Confirmation

ChangeSet creation records the operator's bounded raw request and selected Repository authority. It
does not make a terse sentence independently executable. The Planner maintains a bounded current
Intent draft containing objective, rationale, constraints, non-goals, acceptance criteria, resolved
decisions, and open questions.

Every completed planning response carries the complete current Intent draft. It may ask a question
without a Plan or attach one concise semantic Plan when ready. A later turn receives the current
request, current Intent draft, current user message, and immediately preceding assistant response;
it never relies on full transcript replay.

Approving an exact Plan-bearing message atomically confirms its Intent draft and semantic Plan. The
resulting Plan binds the confirmed Intent revision and Core-owned workspace-control digest. One
approval replaces the current two-step mental model of an already-confirmed vague Intent followed
by an unrelated Plan.

### One Task Controller

One deterministic Task Controller owns advancement after Plan confirmation. The ordinary operator
does not choose between `execute`, `supervision start`, `supervision resume`, verification repair,
or Bundle review dispatch.

The Controller derives the next exact legal action from the confirmed Plan, WorkUnits, Runs,
Candidates, Evidence, Feedback, Gates, holds, and budgets. A forced action runs directly. The
existing semantic Supervisor Agent remains an internal option only when several bounded legal
actions genuinely require model judgment.

Exact Plan approval defaults to `confirm and run`. A secondary explicit choice may confirm while
paused. Feedback or a resolved human request resumes the same Controller unless the task remains
held. The Controller stops only at Plan confirmation, a genuine human decision, an explicit hold,
Bundle review, terminal abandonment, or exhausted authority.

### Small Business Lifecycle And Derived Activity

The target ChangeSet business phases are:

```text
planning | running | review | terminal
```

Replanning returns `running` or `review` to `planning`; actionable review returns `review` to
`running`. Delivery is an exact external process attached to an accepted Bundle, not another task
phase. `needs_input`, `paused`, `retrying`, `validating`, `blocked`, and `waiting_for_merge` are
derived activity from Runs, Feedback, Gates, holds, Evidence, and Delivery records.

WorkUnit and Run detail remains internal scheduling and audit state. It is not removed merely to
make the UI smaller.

### One Cross-Stage Conversation

The task view owns one conversational surface. The application routes a human message by current
authority:

- planning input to the Planner;
- running input to bounded Feedback for the current WorkUnit or active Run;
- an explicit option to the current Gate;
- review findings to exact Bundle revision Feedback.

The UI does not require users to understand `Feedback`, `Gate`, `request_revision`, or Run lineage.
Core still records those exact facts. Active Provider work may receive native steering when a later
adapter proves it; otherwise input is durably queued for the next same-stage Run.

A loopback Server-Sent Events projection streams bounded current activity, Provider item summaries,
and Agent todo progress. Streamed presentation is not authority. Final normalized outcomes and
exact artifacts remain required before any transition. Full transcripts, raw commands and output,
reasoning, diffs, and evidence bodies remain audit-only.

### Runtime Roles And Review Policy

Project configuration ultimately owns defaults for Planner, Executor, and Reviewer AgentProfiles.
A task may select an accepted preset before planning; the Plan does not carry model, permission, or
budget configuration. Per-Repository execution assignments and multi-Candidate comparison lanes are
later extensions.

The operator-facing review choice is `auto | required | none`. `auto` uses deterministic Project
policy and exact change facts such as multi-Repository scope, sensitive paths, migrations, public
contracts, missing validation, failures, and repair history. Agent risk reports may inform the
decision but cannot waive review. The first implementation retains the current configured profiles
and compiles the existing verification and Bundle-review policies behind the simplified view.

### Repository And Source Routing

A Project represents a stable Repository topology and long-lived defaults, not one branch. Each
ChangeSet independently freezes a base ref, exact base SHA, target ref, and generated task branch
for every selected Repository. Different base or release branches do not require another Project.

Future Linear or GitHub Issue adapters use confirmed SourceBindings to map source identity to one
Project, planning-visible Repository set, and per-Repository default refs. Explicit source metadata
wins over binding rules, which win over Project defaults. An ambiguous source remains an unrouted
edge item and does not let a Planner grant Repository or branch authority.

### Operator Information Architecture

The default task surface shows:

- a task list grouped by attention, planning, running, review, and completed activity;
- one conversation and current Agent activity;
- the semantic Plan steps and bounded progress;
- effective Runtime roles;
- total tokens, elapsed time, attempts, retries, repairs, and validation conclusion.

Exact ids, digests, revisions, SHAs, Run tables, raw Evidence, and provider details move behind an
on-demand audit panel. The create dialog requires only Project and one task request. Repository and
branch selection, Runtime presets, review override, and budgets are advanced settings with safe
Project defaults.

## Alternatives

### Restyle the existing console only

Rejected. It would preserve premature Intent authority and several competing advancement routes.

### Replace ChangeFleet with a workspace and chat shell

Rejected. It would discard the cross-Repository Bundle, exact evidence, independent review, cost
audit, recovery, and delivery boundaries that distinguish ChangeFleet from an Agent frontend.

### Persist every visible activity as another state

Rejected. Waiting, pause, retry, validation, and merge observation are derived from exact records.
They do not need compound lifecycle enums.

### Replay the full conversation or require one durable Provider thread

Rejected as authority. A bounded Intent draft and adjacent response keep fresh Runs coherent.
Provider continuation may optimize latency but cannot become recovery truth.

## First Implementation Slice

One atomic local single-Repository replacement will:

1. carry and confirm an Intent draft with the exact Plan message;
2. add one Task Controller entry point and make exact confirmation run by default;
3. expose one cross-stage message operation for planning and current running Feedback;
4. add a bounded live task event projection using existing Run evidence;
5. replace the local console with task-first list, conversation, Plan progress, compact metrics, and
   an on-demand audit panel;
6. remove ordinary UI dependence on manual execution and supervision controls;
7. preserve exact Core authority, deterministic checks, Bundle acceptance, and external delivery;
8. replace obsolete private state and tests rather than retain a compatibility route.

Role-profile catalogs, automatic review compilation beyond current Project policy, multi-Repository
source routing, tracker adapters, Provider-native steering, parallel Candidate lanes, remote access,
automatic Bundle acceptance, and automatic merge remain outside this WorkItem.

## Acceptance Criteria

- One sentence creates a planning task whose executable Intent is not frozen before clarification.
- A Planner question updates one bounded current Intent draft and a later turn cannot forget that
  draft merely because older transcript text is excluded.
- Approving the exact message confirms Intent and Plan together and starts the sole Controller by
  default.
- The Controller advances execution, deterministic validation, configured independent review, and
  repair until one genuine user boundary or Bundle review without another lifecycle button.
- The task page streams bounded activity, prevents duplicate concurrent Planner turns, and shows the
  current Plan and progress without exposing raw control records.
- A human can add feedback or pause from the same conversation surface while exact internal lineage
  remains auditable.
- The default list clearly distinguishes attention, planning, running, review, and completed tasks
  and shows effective Runtime and compact cost/retry facts.
- Existing exact repository authorization, immutable Run evidence, Candidate identity, Bundle
  acceptance, loopback security, and delivery rules remain enforced.

## Relationship To Prior Decisions

This decision revises Decisions 0023, 0025, 0026, and 0031 in part. It keeps conversation-first
planning, unified Runs, deterministic supervision authority, and the loopback adapter, but replaces
premature Intent execution authority, the user-visible manual/autonomous split, the delivery phase,
and the operation-oriented console route. Decisions 0030 and earlier exact workspace, Candidate,
evidence, and delivery identity remain in force.

## Revision History

- 2026-08-12: Accepted after the first real console ChangeSet exposed recursive planning, duplicate
  attempts, high planning cost, hidden manual execution, and an operation-oriented UI.
