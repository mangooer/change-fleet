# 0027: Adopt Bundle-Level Independent Quality Review

Status: Accepted

Date: 2026-08-07

Source: Repository Design Proposal 0025

Revises in part: Decision 0026's exact autonomous stop target and closed list of Agent Run purposes;
human Bundle acceptance and the common Run lifecycle remain unchanged

## Decision

ChangeFleet will support an optional, Plan-confirmed, independent quality review of one exact
CandidateBundle before final human review. Deterministic Plan policy selects `none | independent`,
one Review AgentProfile, and bounded attempts. The kernel does not invoke an Agent merely to decide
whether review is required.

`review` is a ChangeSet-scoped, semantically read-only Agent Run purpose using the common Run status
lifecycle. Its input binds the confirmed Plan, exact Bundle manifest and digest, every Candidate
base and head SHA, and relevant validation, verification, Feedback, Gate, and risk evidence. Exact
preflight and postflight prevent a review result from transferring to a changed subject.

The bounded assessment disposition is `pass | feedback | gate`. A passage recommendation has no
Bundle-acceptance, delivery, merge, scope-expansion, or Plan-revision authority. Blocking findings
may become Feedback only when they target exact authorized WorkUnits; execution assesses every
claim as `adopt | adapt | decline`. Advisory findings remain audit evidence and do not force repair.
Ambiguity, stale identity, invalid output, failure, or exhausted budget retries safely or opens a
human Gate.

Under `autonomous_until_review`, required Bundle review and bounded same-Plan repair may continue
without an operator continuation command. Any changed Candidate produces a new Bundle revision and
requires a new assessment. Automatic work stops with a current passage recommendation, Gate, hold,
Plan invalidation, exhausted budget, or terminal outcome. Human Bundle acceptance remains explicit.

## Rationale

Candidate verification owns one Repository result, combined validation owns deterministic
cross-repository commands, and the Supervisor owns bounded action routing. None independently judges
whether the whole exact Bundle coherently satisfies the confirmed intent. A separate read-only
Review Runtime adds that quality perspective without moving semantic truth or acceptance authority
into the deterministic Core.

## Consequences

- WI-0021 is the only first implementation WorkItem for this decision.
- The existing ChangeSet, WorkUnit, Feedback, Gate, and common Run lifecycles are reused; no review-
  specific aggregate phase or correction state is added.
- Review usage, duration, attempts, findings, and stop reasons use existing Run and audit evidence
  outside ordinary Agent context.
- The first reviewer does not invent validation commands or mutate Candidate workspaces.
- Automatic Bundle acceptance, delivery, merge, parallel reviewers, Candidate competition,
  normalized quality scoring, and automatic model routing remain deferred.
