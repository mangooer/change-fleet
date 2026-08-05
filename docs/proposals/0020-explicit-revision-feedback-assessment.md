# 0020: Explicit Revision Feedback Assessment

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-05

Accepted: 2026-08-05

Supersedes in part: Decision 0017 treatment of bounded revision feedback as unqualified Runtime input

Superseded in part by: [Proposal 0021](0021-conversation-first-planning-and-stage-scoped-feedback.md)
placement of assessment on the outcome that handles feedback

Depends on: Decisions 0001, 0002, 0005, 0010, and 0017

Blocks: Reliable replanning of `changefleet-runtime-guidance-normalization`

Decision: [Decision 0022](../decisions/0022-explicit-revision-feedback-assessment.md)

Implementation tracking: [WI-0014](../work-items/WI-0014-explicit-revision-feedback-assessment.md), `done`

## Context

`request_revision` already carries bounded current feedback into the next planning projection, but
the ChangePlan has no field showing how the Agent interpreted it. Two real replans silently chose a
stale repository projection over an explicit reviewer claim. Making reviewer text authoritative
would fix that example while creating a worse rule: humans can be mistaken, unreasonable, or
unaware of exact Git evidence.

The missing contract is explicit reconciliation, not priority inversion.

## Decision

Current revision feedback is a set of reviewer claims. When it exists, the planning Runtime must
return exactly one assessment for every `finding_id`:

- `adopt`: the finding is supported and the Plan follows it;
- `adapt`: the concern is valid but its facts or remedy need a stated correction;
- `decline`: the finding conflicts with confirmed intent, exact evidence, repository authority, or
  the ChangeFleet control contract.

Each assessment includes one bounded rationale. The Plan and WorkUnit tasks must agree with those
assessments. Core verifies exact coverage, uniqueness, allowed dispositions, and size; it does not
score truth or decide which evidence wins. Human plan confirmation reviews the assessment together
with the proposed work. Execution follows the confirmed Plan and blocks if new exact workspace
evidence makes it unsound.

The current feedback remains in planning and execution projections. Full review history, private
reasoning, transcripts, and large evidence remain linked outside default context.

## Alternatives

### Treat Human Feedback As Highest Authority

Rejected. Human review owns the gate but does not turn every factual claim or implementation remedy
into truth.

### Prompt The Agent Without Structured Output

Rejected. It is small but cannot detect omitted findings and already allowed silent conflict.

### Add Truth Scores Or A Clarification State Machine

Deferred. Confidence scores, automated evidence ranking, a new question lifecycle, and feedback
appeals are unnecessary for the first reliable boundary. The existing human Plan gate can accept or
reject the Agent's explicit assessment.

## Acceptance Criteria

- A revised Plan has one and only one assessment for every current finding.
- A Plan without current feedback has an empty assessment array.
- Assessments are bounded and restricted to `adopt | adapt | decline`.
- The Codex planning prompt requires evidence-based evaluation and forbids silent conflict.
- Execution treats the confirmed Plan, not raw feedback, as its actionable subject.
- Existing Plan history remains readable without migration or invented assessments.

## Non-Goals

- Declaring humans, Agents, repository prose, or Git universally authoritative for semantic truth.
- Persisting chain-of-thought, transcripts, complete review bodies, or audit cost in Runtime context.
- Adding an automatic clarification loop, feedback voting, or a new lifecycle state.
- Changing Bundle identity, repository authorization, delivery, or recovery semantics.

## Validation

- Domain tests for exact coverage, ordering, dispositions, bounds, and rejection of omissions.
- Runtime adapter tests for the strict output schema and reconciliation prompt.
- Application integration proving assessments persist into the confirmed execution projection.
- Runtime context version and regression tests.
- Full deterministic check because the shared Plan contract and context projection change.
