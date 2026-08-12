---
artifact_type: repository_design_proposal
id: 0031
status: accepted
title: Autonomous task conversation and operator inbox
proposed_at: 2026-08-12
accepted_at: 2026-08-12
confirmed_by: user
decision: docs/decisions/0033-autonomous-task-conversation-and-operator-inbox.md
implementation_tracking: docs/work-items/WI-0041-autonomous-task-conversation-local-vertical-slice.md
---

# 0031: Autonomous Task Conversation And Operator Inbox

## Context

Proposal 0030 replaced the operation-oriented console with one task view and one Task Controller,
but the first real self-iteration showed that the ordinary route still behaves like a control-panel
workflow rather than a coding-Agent conversation.

Plan confirmation is still a default human stop. Long HTTP mutations hide whether the Controller is
actually advancing. User messages appear only after the server operation finishes, and the bounded
SSE projection shows todo updates but not a continuous safe work trace. Internal states such as Plan
confirmation, Bundle readiness, and Delivery failure still determine which buttons appear. A failed
Delivery became unrecoverable from the page because it had a record but no pull request, and a
missing remote target was reported as a generic remote-read failure.

The browser is not the cause. Packaging the same synchronous control route in a desktop shell would
retain these defects. ChangeFleet instead needs one Codex-style task conversation backed by an
asynchronous controller, while its task list provides stronger state than a single Agent frontend
because one operator manages many concurrent tasks.

## Decision

Keep the exact ChangeSet, TaskWorkspace, WorkUnit, Run, CandidateBundle, Evidence, and Git kernel.
Replace the ordinary interaction contract with one autonomous task conversation and six derived
operator states.

### One User Conversation, Multiple Internal Agent Sessions

One ChangeSet presents one continuing user conversation and one composer across planning,
execution, verification, review, and delivery. The ordinary page never opens separate Planner and
Executor chat boxes.

Planner, Executor, Verifier, Reviewer, and optional Supervisor remain separate Runs and may use
different Provider sessions, AgentProfiles, models, or Runtimes. Each receives only its role-specific
current projection. An Executor receives the confirmed Intent, semantic Plan, exact workspace
authority, and current Feedback; it does not receive the complete planning transcript. A Reviewer
receives the exact CandidateBundle and required evidence rather than the Executor's full narrative.

The user timeline labels role and stage so the handoff remains visible without coupling recovery to
one Provider thread. Provider-native continuation may optimize one role later but is not task
authority.

### Task Creation Is Bounded Run Authorization

Creating a task authorizes ChangeFleet to plan, execute, validate, review, repair, and, when
separately configured, publish within the frozen Repository, ref, Runtime permission, attempt,
elapsed-time, and Project-policy envelope.

The Planner returns a complete Intent draft, an optional semantic Plan, and one disposition:

- `ready`: the Plan is semantically complete and has no unresolved human question;
- `needs_input`: the Planner cannot safely complete the Plan without human input.

The Agent never confirms its own Plan. Core automatically activates an exact `ready` Plan when it
remains inside the pre-authorized envelope. The activation decision is recorded as policy authority
with the exact message digest, policy identity, and authorization-envelope digest.

Core opens one human request instead when the Plan has unresolved questions, requests Repository or
ref expansion, requires a permission or budget increase, conflicts with Project policy, or matches a
configured mandatory-approval boundary. This produces `needs_feedback`; it does not add a ChangeSet
phase.

When a human replies naturally to an open exact request, a read-only conversation Agent may propose
one currently offered action such as `approve_and_continue`, `approve_and_hold`, or
`continue_planning`. Core binds the proposal to the exact request and Plan digest, revalidates the
offered action, and performs it as human authority. An Agent interpretation cannot invent a new
action, broaden scope, or represent itself as the confirmer. Buttons may remain as accessible
shortcuts only when the same exact human decision is pending.

### Asynchronous Task Controller

Ordinary message, confirmation, resume, and delivery requests persist a bounded task command and
return immediately after acceptance. A background Task Controller owns the execution lease and
advances forced actions until it reaches a genuine human boundary, an explicit hold, exhausted
authority, or terminal outcome.

The first local implementation uses a durable local command queue plus one in-process worker. The
worker reconciles accepted incomplete commands on server restart, enforces one active controller
lease per ChangeSet, and preserves idempotency. It is not a distributed worker system or hosted
service graph.

HTTP uses `202 Accepted` for accepted background work. SSE carries command acknowledgement,
authoritative task projection changes, current Run identity, heartbeat, and safe activity events.
No long HTTP response represents task completion.

### Safe Task Timeline

ChangeFleet records a bounded append-only presentation timeline linked outside aggregate startup
state. It includes:

- accepted human messages and their `pending | accepted | applied | failed` presentation status;
- Agent-authored progress summaries;
- stage and Runtime-role handoffs;
- semantic Plan cards and human requests;
- bounded todo updates and tool-activity categories;
- changed-file counts and validation or review conclusions;
- Delivery attempts, recovery, pull-request identity, and terminal result.

The browser adds a local pending message immediately, then reconciles it with the durable server
event. A failed submission remains visible and retryable with the same idempotency identity.

Raw chain-of-thought, hidden reasoning, command output, full logs, diffs, credentials, and evidence
bodies are not timeline content. They remain unavailable or audit-only. Presentation events and
historical conversation are excluded from default later-Agent context; role projections select only
the current Intent, Plan, Feedback, human request, and adjacent message needed for the next Run.

### Six Operator States

The task list exposes exactly these derived states:

| Operator state | Meaning |
| --- | --- |
| `running` | ChangeFleet has an active or authorized next action and can continue without a human |
| `needs_feedback` | Work cannot continue until a human supplies information, authority, configuration, or recovery choice |
| `needs_review` | The exact CandidateBundle is ready and Project or task policy requires human result review |
| `waiting_for_merge` | An exact pull request is open and ChangeFleet is monitoring external merge |
| `complete` | The configured exact completion boundary has been observed |
| `cancelled` | A human explicitly cancelled the task and no automatic work may continue |

Reason codes explain the state without creating more user states, for example
`planner_question`, `authorization_required`, `paused_by_user`, `delivery_configuration_missing`,
`review_ready`, `pull_request_open`, or `retry_exhausted`.

The persisted ChangeSet lifecycle remains `planning | running | review | terminal`. Operator state
is derived with deterministic precedence from terminal outcome, cancellation, current Delivery,
current Bundle policy, open human requests, holds, blockers, queued commands, and active Runs.
An Agent Run ending does not end the task while validation, review, repair, or delivery remains
authorized.

### Review, Delivery, And Recovery

Review policy decides whether an exact Bundle requires human review. Independent Review Agents may
recommend passage, bounded repair, or a human request, but cannot accept a Bundle.

When policy explicitly permits unattended passage, Core may record an exact policy acceptance after
all required evidence and review conditions pass. Otherwise the task becomes `needs_review`. Human
review feedback is ordinary conversation input routed to exact Bundle Feedback under the same Plan.

Accepting an exact Bundle also authorizes Ready-PR publication when the task authorization and a
confirmed Delivery binding permit it. The task moves directly to `waiting_for_merge`; the ordinary
route does not require another create-PR button. Automatic merge remains prohibited.

Delivery classifies missing configuration or non-recoverable divergence as `needs_feedback`.
Transient Git and GitHub failures use bounded, idempotent retry against the same delivery request and
deterministic remote branch. The UI exposes the precise failure and a retry action whenever automatic
retry is exhausted. A Delivery record without a pull request must never hide publication recovery
behind refresh-only controls. A missing remote target ref has a distinct diagnostic from transport
failure.

### Pause, Feedback, And Cancellation

Pause and conversation input are the primary manual controls while a task is active. A pause records
an operator hold, interrupts the current Run when safe, and produces `needs_feedback`. A later human
message may update current Feedback and resume the Controller.

Cancellation is explicit. It stops queued advancement, interrupts active work, releases eligible
workspace resources, and preserves immutable Runs, Candidates, cost, and audit evidence. Ordinary
failure never implies cancellation. Core may continue to represent it as `terminal(abandoned)` with
an exact cancellation reason; the operator projection is `cancelled`.

### Operator Information Architecture

The task inbox groups work in this order:

1. needs feedback;
2. needs review;
3. running;
4. waiting for merge;
5. complete;
6. cancelled.

Each card shows objective, reason, current role and Runtime, latest activity, elapsed time, compact
token/run/failure/repair counts, unread activity, and pull-request identity when applicable. Normal
Agent handoffs, validation, and retry do not notify the operator. Entering needs-feedback,
needs-review, waiting-for-merge, complete, or cancelled may notify.

The task page centers the timeline and one composer. Plan, current todo, safe activity, and compact
metrics are supporting projections. Exact ids, revisions, SHAs, complete Run history, raw evidence,
and detailed cost remain on-demand audit.

## Alternatives

### Separate Planner And Executor Chat Windows

Rejected. Internal role sessions need isolation, but two user conversations fragment intent,
feedback, unread state, and recovery. One task timeline can label every role handoff.

### Keep Plan Confirmation As The Default Gate

Rejected. It prevents unattended simple tasks and makes the operator follow every session. Task
creation already provides a narrower and more auditable authorization envelope.

### Let The Planner Confirm Its Own Plan

Rejected. An Agent may declare semantic readiness but cannot grant authority. Automatic activation
comes from frozen policy; natural-language approval is revalidated against one exact offered human
action.

### Persist Six New ChangeSet Phases

Rejected. The states are an operator inbox projection over existing exact facts, not another
lifecycle state machine.

### Package The Current Page As A Desktop Client First

Rejected. A desktop shell would not repair synchronous execution, delayed messages, incomplete
activity, or Delivery recovery. A later thin client may reuse the same HTTP, SSE, and application
operations.

## First Implementation Slice

One atomic replacement WorkItem will implement the local vertical route from task creation through
merge observation:

1. freeze bounded automatic-run and review/delivery authorization at task creation;
2. compile `ready | needs_input` Planner outcomes and policy-activate eligible Plans;
3. add a durable local command queue, one background Controller worker, leases, restart recovery,
   and `202 Accepted` mutations;
4. add one durable presentation timeline with optimistic-message reconciliation and bounded safe
   Agent activity;
5. derive and expose only the six operator states plus reason codes;
6. replace the ordinary console with one timeline/composer and inbox grouping;
7. preserve separate Planner, Executor, Verifier, Reviewer, and Supervisor Run contexts;
8. make exact human Bundle acceptance publish a Ready PR when authorized, with bounded retry and a
   visible recovery route;
9. add explicit cancellation and workspace release;
10. remove obsolete default Plan-confirm, manual Controller, create-PR, and refresh-only UI routes
    after equivalent application coverage passes.

The slice must retain existing exact multi-Repository kernel semantics, although paid real-provider
acceptance may remain a bounded single-Repository self-iteration.

## Non-Goals

- No raw chain-of-thought or hidden reasoning display.
- No automatic GitHub merge, deployment, remote worker, webhook service, or hosted multi-tenancy.
- No desktop application shell.
- No Linear or GitHub Issue intake, SourceBinding implementation, or multi-Project repository rules.
- No automatic model routing, Candidate comparison lanes, normalized quality scoring, or universal
  pricing calculation.
- No requirement that registered repositories provide ChangeFleet-specific checks or Harness.
- No full historical timeline or cost projection in later Agent context.

## Acceptance Criteria

- A low-risk task created with defaults advances from one request through Plan activation,
  execution, required verification, and its configured review boundary without another click.
- A Planner that genuinely needs information produces one needs-feedback task with an exact reason;
  a human reply in the same conversation resumes the correct internal role.
- One visible conversation preserves human and safe Agent activity across separate Planner,
  Executor, Verifier, Reviewer, and Delivery Runs without replaying its full history into each Run.
- User messages appear immediately, reconcile to durable status, and remain retryable after failure.
- Long-running work returns from HTTP immediately and continues through a restart-safe local worker;
  SSE makes current role, heartbeat, todo, recent activity, and state changes observable.
- The task list exposes only running, needs feedback, needs review, waiting for merge, complete, and
  cancelled, each with a deterministic reason.
- Human review feedback repairs the same Plan through the conversation. Acceptance automatically
  creates or resumes one exact Ready PR when authorized, and merge observation produces complete.
- Missing Delivery binding, missing remote target, transient network failure, branch divergence, and
  closed PR have distinct visible recovery behavior; a failed publication remains retryable.
- Cancellation stops automatic advancement, releases eligible resources, and preserves audit.
- Exact Repository authority, Candidate and Bundle identity, immutable evidence, permission bounds,
  human merge, and audit-cost isolation remain enforced.

## Relationship To Prior Decisions

This Proposal revises Proposal 0030 and Decision 0032 by making bounded automatic Plan activation
the ordinary route, making the Task Controller asynchronous, replacing its current operator-status
vocabulary with six inbox states, and defining one presentation timeline over separate internal
Agent sessions. It preserves Proposal 0030's joint Intent/Plan identity, one task surface, small
business lifecycle, exact kernel, and audit boundary.

Decisions 0023 through 0027 continue to govern Feedback assessment, exact verification, unified
Runs, bounded Supervisor proposals, and independent Bundle review. Their low-level operations become
internal Controller mechanisms rather than ordinary user workflow.

## Revision History

- 2026-08-12: Proposed from the first real unified-console self-iteration and follow-up operator
  discussion about Codex-style conversation, autonomous simple tasks, multi-task state management,
  internal role sessions, and Delivery recovery.
- 2026-08-12: Accepted by the user as the authority for Decision 0033 and WI-0041.
