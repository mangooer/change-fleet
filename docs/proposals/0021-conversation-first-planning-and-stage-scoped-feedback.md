# 0021: Conversation-First Planning And Stage-Scoped Feedback

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-05

Accepted: 2026-08-05

Supersedes in part: [Decision 0022](../decisions/0022-explicit-revision-feedback-assessment.md)
placement of every current feedback assessment on a revised ChangePlan

Depends on: Decisions 0001, 0002, 0005, 0010, 0017, and 0022

Blocks: Confirmation of the current `changefleet-runtime-guidance-normalization-v2` planning output

Decision: [Decision 0023](../decisions/0023-conversation-first-planning-and-stage-scoped-feedback.md)

Implementation tracking: First implementation ChangeSet pending from the accepted exact baseline

## Context

ChangeFleet currently persists each structured planning output as a ChangePlan revision before the
human has accepted it. A correction made while the user and Agent are still discussing the plan
therefore appears as another durable Plan revision. Bundle `request_revision` feedback also returns
to planning by default, even when the confirmed Plan remains sound and only the implementation
needs correction.

That model confuses three different subjects:

- an Agent message shown during planning conversation;
- a human-confirmed execution contract;
- feedback about an execution attempt or exact CandidateBundle.

Conductor.build provides useful interaction evidence: GitHub or Linear issues can seed a workspace,
Plan Mode remains a conversation until the user approves a plan, and review comments are sent back
to the Agent in the same workspace. ChangeFleet needs stronger exact-subject and multi-Repository
control than Conductor, but it does not need to expose every conversational rewrite as a Plan
revision.

Official Conductor.build references consulted on 2026-08-05:

- [Agent modes](https://www.conductor.build/docs/concepts/agent-modes) describes Plan Mode as a
  conversation followed by approval or more feedback.
- [From issue to PR](https://www.conductor.build/docs/guides/issue-to-pr) starts a workspace from a
  GitHub or Linear issue and keeps planning, implementation, and review in that workspace.
- [Workflow](https://www.conductor.build/docs/concepts/workflow) sends Diff Viewer comments back to
  the Agent and treats the workspace as delegation scope and the branch or PR as integration scope.

## Decision

### Intake Seeds A Conversation

A user request or an explicitly selected external issue may seed a ChangeSet conversation. An
external source contributes a bounded reference and immutable fetched snapshot; it is not Plan,
repository authorization, or semantic truth. One large issue may be split into multiple
ChangeSets when its outcomes should be reviewed and delivered independently.

Later source changes are new input. They never silently change confirmed intent, Repository
selection, Plan, Candidate, or Bundle authority. Real GitHub Issue and Linear adapters remain
deferred.

### Planning Output Is A Message Until Approval

Before confirmation, an Agent may explain, ask questions, or show a complete structured plan in the
conversation. The user may reply and the Agent may show a corrected plan. These turns are Runtime
messages and linked Run evidence, not `ChangePlanRevision` records.

An approvable plan message carries an immutable logical message id, content digest, and structured
plan payload. The UI renders that message and offers an explicit approval action bound to the exact
id and digest. A later message may become the current approvable subject without allocating a Plan
revision. Question and explanation messages need not carry a plan payload.

Approval atomically validates the selected message payload and creates the next confirmed
`ChangePlanRevision`. The first approved plan is revision 1. Revision 2 exists only after revision 1
was confirmed, later became unsound or intentionally changed, and a new plan message was explicitly
approved. Superseded conversation messages remain linked session evidence rather than ChangeSet
Plan history.

### Feedback Follows The Current Stage

Feedback does not automatically mean replanning:

| Current stage | Default treatment | Durable result |
| --- | --- | --- |
| Planning conversation | Continue the conversation | Message and Run evidence; no Plan revision |
| Execution | Continue or retry implementation under the confirmed Plan | New Run or attempt under the same Plan |
| Bundle review | Correct the implementation against exact Bundle findings | New Candidate or Bundle revision under the same Plan |
| Confirmed Plan is invalidated | Return to planning conversation | New Plan revision only after approval |

Implementation-detail corrections, test failures, review findings, and dissatisfaction with the
current diff normally keep the same confirmed Plan. Repository scope, branch, target, authorization,
or a materially invalidated design assumption uses the existing typed decision boundary and may
require true replanning. A distinct business intent or required new base follows explicit closure
and successor creation instead of silently mutating the ChangeSet.

### Human Feedback Remains A Claim

Decision 0022's semantic rule remains: human feedback is review input, not automatic fact or
command. The Agent must assess every bounded actionable finding as `adopt`, `adapt`, or `decline`
with a concise rationale. Core validates coverage, identity, allowed values, and bounds without
deciding truth.

The assessment belongs to the outcome that handles the feedback:

- a planning message when the confirmed Plan truly needs replacement;
- an execution or correction Run when the confirmed Plan remains valid.

It is copied into a ChangePlan only when the assessed planning message is approved as the next
confirmed revision. Raw feedback alone never authorizes repository access, execution, Candidate
publication, Bundle acceptance, or delivery.

### Conversation Is Not Startup Context

Messages, transcripts, superseded planning responses, and detailed feedback remain linked artifacts.
Only the current exact task facts, current confirmed Plan slice, and bounded unresolved input enter
a new Runtime projection. Run usage and duration remain audit evidence and do not enter semantic
Runtime context by default. Provider-session resume is not required: ChangeFleet may continue the
product conversation through a fresh Runtime attempt using the bounded current projection.

## Alternatives

### Version Every Planning Response

Rejected. It turns normal conversation into control history, makes revision numbers meaningless,
and exposes internal orchestration concepts to the user.

### Use Unbound Chat With No Exact Approval Subject

Rejected. A human approval must identify exactly which structured plan became executable, especially
for a multi-Repository ChangeSet.

### Replan After Every Bundle Revision Request

Rejected. Most review feedback corrects implementation under an unchanged execution contract.
Replanning should be reserved for an invalidated confirmed Plan.

### Implement Full Tracker Synchronization Now

Deferred. External issue intake and projection are compatible with this boundary, but GitHub Issue
and Linear authentication, polling, writes, and status mapping are separate product work.

## Acceptance Criteria

- Planning conversation can show and replace an approvable plan without allocating Plan revisions.
- Approval binds one exact message id and digest and atomically creates the next confirmed Plan
  revision.
- The first confirmed plan is revision 1; later revisions require a previously confirmed Plan.
- Execution and Bundle feedback remain under the current Plan unless a typed condition requires
  true replanning.
- Every bounded actionable finding receives one explicit Agent assessment in the handling outcome.
- External source text remains bounded intake evidence rather than ChangeSet authority.
- Superseded messages, transcripts, and audit cost stay out of default Runtime context.
- CLI and future UI adapters call the same application operations; the user-facing workflow does
  not require knowledge of revision-allocation internals.

## Initial Implementation Boundary

The first implementation ChangeSet should plan one vertical slice:

1. conversation messages with an optional exact structured plan payload;
2. continued planning feedback without Plan revision allocation;
3. exact message approval that creates the first or next confirmed Plan revision;
4. correction Runs that assess Bundle findings under the current Plan by default;
5. migration or explicit retirement of incompatible unconfirmed planning records;
6. bounded context and audit projections for the new subjects.

The implementation must not add a general chat platform, streaming protocol, automatic feedback truth
scoring, Provider-session resume, checkpoints, a Linear adapter, GitHub Issue intake, or tracker
status writes.

The executing Agent must satisfy this repository's Harness, including creating and confirming the
required Development WorkItem inside the same Candidate. That Harness artifact is repository work,
not ChangeFleet intake or lifecycle authority.

## Validation

- Domain tests proving no Plan revision exists before exact approval.
- Application tests for repeated conversation, stale-message rejection, idempotent approval, and
  first-versus-later revision allocation.
- Execution and review tests proving ordinary findings retain the confirmed Plan and true contract
  invalidation returns to planning.
- Runtime adapter tests proving Agent assessment without treating user or repository prose as truth.
- Context tests proving superseded messages and detailed audit evidence remain outside the current
  projection.
- Full deterministic validation because Plan identity, review routing, and persisted lifecycle
  semantics change.
