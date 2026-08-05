# 0023: Planning Is Conversation Until Exact Plan Approval

Status: Accepted

Date: 2026-08-05

Source: Repository Design Proposal 0021

Supersedes in part: Decision 0022 placement of every current feedback assessment on a revised
ChangePlan

## Decision

Before approval, an Agent's plan is a conversation message and linked Run artifact, not a
`ChangePlanRevision`. An approvable message carries an exact logical id, content digest, and
structured plan content. Explicit approval binds that exact message and atomically creates the next
confirmed Plan revision. The first confirmed Plan is revision 1; a later revision exists only after
a previously confirmed execution contract is deliberately replaced.

User requests and selected external issues seed the conversation but are not Plans or semantic
truth. Execution guidance and exact Bundle findings normally produce another Run, Candidate, or
Bundle under the current confirmed Plan. A typed authority change or materially invalidated design
assumption returns the same ChangeSet to planning; a distinct intent or required new base uses
explicit closure and successor creation.

Human feedback remains a bounded claim. The Agent assesses each actionable finding as `adopt`,
`adapt`, or `decline`; the assessment belongs to the planning message or correction Run that handles
it. It enters a ChangePlan only when that exact planning message is approved.

## Rationale

Versioning every conversational rewrite obscures the boundary between discussion and executable
authority. Replanning every implementation correction also adds control complexity without making
the result safer. Exact message approval preserves deterministic human authorization while keeping
the user experience conversational and Plan history limited to confirmed contracts.

## Consequences

- Conversation and superseded planning messages remain linked evidence outside default Runtime
  context.
- Plan confirmation, execution correction, true replanning, and successor creation remain distinct.
- Decision 0022's explicit feedback assessment remains, but no longer forces every finding through
  a new Plan.
- GitHub Issue and Linear adapters, tracker synchronization, Provider-session resume, checkpoints,
  and a general chat platform remain deferred.
