# 0022: Revision Feedback Requires Explicit Agent Assessment

Status: Accepted

Date: 2026-08-05

Source: Repository Design Proposal 0020

Supersedes in part: Decision 0017 treatment of bounded revision feedback as unqualified Runtime input

Superseded in part by: Decision 0023 placement of assessment on the outcome that handles feedback

## Decision

Human `request_revision` feedback is bounded review input, not automatic fact or command. A revised
ChangePlan must contain exactly one bounded assessment for each current finding: `adopt`, `adapt`,
or `decline`, with a concise rationale grounded in confirmed intent, exact Git and repository
authority, and the control contract.

Core validates exact coverage, uniqueness, allowed values, and bounds without deciding semantic
truth. Human Plan confirmation accepts or rejects the Plan together with its assessments. Execution
implements that confirmed Plan and blocks rather than silently substituting raw feedback when new
exact evidence shows a conflict.

## Rationale

Silent priority between human prose and repository prose is unauditable, and either source may be
wrong. Structured assessment forces the Agent to expose its reconciliation while retaining the
existing human gate and small Runtime context.

## Consequences

- New Plans carry bounded `revision_feedback_assessments`; old Plans remain readable as history.
- Planning output schema and Runtime context projection advance together.
- Raw feedback remains visible for evaluation but does not independently authorize execution.
- Truth scoring, private reasoning capture, clarification state machines, and feedback appeals stay
  deferred.
