---
artifact_type: repository_design_proposal
id: 0025
status: accepted
title: Bundle-level independent quality review
proposed_at: 2026-08-07
accepted_at: 2026-08-07
confirmed_by: user
decision: docs/decisions/0027-bundle-level-independent-quality-review.md
implementation_tracking: docs/work-items/WI-0021-bundle-level-independent-quality-review.md
---

# 0025: Bundle-Level Independent Quality Review

## Context

WI-0020 proves that one confirmed Plan can advance a Candidate route through execution,
repository checks, optional Candidate verification, Feedback repair, and exact CandidateBundle
assembly without ordinary operator continuation. Autonomous authority then stops at Bundle review.

The current independent Verification Runtime is Candidate-bound. It can inspect one Repository
result, select relevant checks, review its diff, and return actionable Feedback. Combined validation
can execute Plan-bound cross-repository commands. Neither mechanism independently judges whether the
whole Bundle coherently satisfies the confirmed intent across all selected Repositories.

Making the human repeat that semantic review preserves authority but limits the goal of returning
only for a concise audit or a genuinely ambiguous decision. Reusing the Supervisor would mix routing
and quality judgment, while automatic Bundle acceptance would grant more authority than this stage
has earned.

## Decision

Add an optional, Plan-confirmed, read-only Bundle quality review between exact Bundle assembly and
final human review. One independent Review Runtime assesses the exact Bundle as a whole and returns
a bounded recommendation. It may recommend passage, return actionable Feedback to authorized
WorkUnits, or request a human Gate. It cannot accept the Bundle, publish it, merge it, expand scope,
or mutate a Candidate.

The first boundary is:

```text
exact CandidateBundle
  -> optional independent Bundle review
     -> pass recommendation -> human audit and Bundle decision
     -> actionable Feedback -> existing same-Plan repair loop -> new exact Bundle revision
     -> ambiguity, failure, or exhausted budget -> human Gate
```

### Deterministic Admission

The confirmed Plan records the effective Bundle review mode:

```text
none | independent
```

A Project may provide a default, but Plan confirmation freezes the effective mode, Review
AgentProfile, attempt ceiling, and relevant Feedback and elapsed-time ceilings. The kernel decides
whether a Review Run is required from those exact facts. It does not launch a model merely to ask
whether a model should review.

`none` preserves the current route and spends no Review Runtime cost. `independent` requires a
current passing assessment before the Bundle is presented as quality-reviewed. Changing the Bundle
revision, Plan revision, Candidate identity, or required evidence invalidates reuse of the earlier
assessment.

### Exact Read-Only Subject

One Bundle Review Run binds:

- the ChangeSet and confirmed Plan revision;
- the exact CandidateBundle revision and manifest digest;
- every Candidate base and head SHA;
- relevant repository, combined-check, verification, Feedback, and Gate evidence;
- the confirmed intent and acceptance expectations;
- the effective Review AgentProfile and budget.

The Runtime receives compact current facts plus linked exact artifacts and read-only access to the
Bundle Candidates. Large logs, transcripts, and full repository history remain outside the default
context. Candidate preflight and postflight must prove that no reviewed Git subject changed.

Repository checks and Candidate verification remain their existing evidence owners. The first
Bundle reviewer does not invent or run arbitrary new validation commands. Missing evidence becomes
a bounded finding or Gate rather than an ambient shell escape.

### One Review Run, Not Another Workflow

`review` becomes an Agent Run purpose beside `planning | execution | verification | supervision`.
It uses the common Run status lifecycle and is ChangeSet-scoped to one exact Bundle revision. No
Bundle-review-specific ChangeSet phase, WorkUnit stage, correction state, or waiting state is added.

The Review Agent is semantically read-only. ChangeFleet remains the only component that can validate
the structured result and perform an authorized transition. Runtime failure uses the generic Run
recovery path: retry within the frozen ceiling when safe, otherwise open a Gate.

### Bounded Assessment

The structured assessment has exactly one disposition:

```text
pass | feedback | gate
```

Every finding has a stable id, concise explanation, severity, exact evidence references, and the
affected Repository and WorkUnit identities when known. Findings are classified as:

- `blocking`: correctness, security, accepted behavior, compatibility, authorized scope, or required
  evidence prevents a passage recommendation;
- `advisory`: a useful improvement that does not prevent passage and remains audit-only.

`pass` means that the reviewer found no blocking issue against the confirmed contract. It is a
recommendation, not authority to accept the Bundle. Advisory findings remain visible but do not
manufacture another repair cycle.

`feedback` requires at least one blocking finding and exact authorized WorkUnit targets. ChangeFleet
converts the validated findings to the existing bounded Feedback operation. The execution Agent
assesses each claim as `adopt | adapt | decline`; reviewer text is evidence, not automatically true.
Ambiguous ownership, a required Plan change, scope expansion, or an irreversible decision uses
`gate` instead of guessing a repair target.

### Same-Plan Repair And Bundle Identity

Validated Feedback follows the existing generic route: the targeted WorkUnit returns to execution,
publishes a new exact checkpoint, repeats only invalidated evidence, and contributes to a new Bundle
revision. The old Bundle and its assessment remain immutable audit history.

Under `autonomous_until_review`, supervision may continue through required Bundle Review Runs and
their bounded same-Plan repairs. It stops with a current pass recommendation, a Gate, exhausted
budget, operator hold, Plan invalidation, or terminal outcome. This revises Proposal 0024's first
stop target from an unassessed exact Bundle to an exact Bundle with its required review disposition;
human Bundle acceptance remains unchanged.

### Cost, Recovery, And Audit

Each Review Run uses existing Runtime usage, duration, retry, artifact, and AgentProfile evidence.
ChangeSet totals derive from those immutable Run records. No new pricing table, comparison database,
or quality score is introduced.

The common reconciler accounts for an interrupted Review Run before another attempt. A completed
assessment may be reused only for the same exact Plan, Bundle manifest, Candidates, and evidence
identity. Invalid structured output, stale bindings, Provider failure, and exhausted attempts fail
closed to retry or a human Gate; they never become an implicit pass.

The local audit surface shows the disposition, blocking and advisory findings, exact subject,
AgentProfile, usage, duration, attempts, and stop reason. Detailed reasoning remains a linked
artifact and is not injected into later execution context unless a validated finding is routed as
Feedback.

## Considered Alternatives

### Keep Bundle review entirely human

Preserve it as the fallback and final authority, but reject it as the only quality path. It prevents
the accepted autonomous route from reducing routine semantic review effort.

### Reuse Candidate verification as Bundle review

Reject it. Candidate verification owns one Repository subject and its selected checks. Bundle review
owns cross-repository coherence and the complete intent; conflating them weakens evidence identity.

### Let the Supervisor review its own route

Reject it. The Supervisor selects authorized next actions. An independent Review Runtime provides a
separate quality perspective and avoids making routing rationale count as review evidence.

### Automatically accept a passing Bundle

Defer it. A Review Agent recommendation does not grant the human Bundle-acceptance authority, and it
does not authorize delivery or merge.

### Start with several reviewers, candidate competition, or model scoring

Defer them. The first slice must prove one exact Bundle assessment and repair route. Multiple judges,
alternative Candidates, normalized quality scoring, and automatic model selection need comparable
evidence after this boundary is stable.

## First Implementation Slice

The first confirmed WorkItem should:

1. freeze `none | independent`, one Review AgentProfile, and bounded attempts in the confirmed Plan;
2. add the ChangeSet-scoped `review` Run purpose and exact Bundle review input projection;
3. validate `pass | feedback | gate` assessments and bounded finding targets;
4. dispatch required review after exact Bundle assembly without a Supervisor model call;
5. route valid blocking Feedback through the existing same-Plan repair and revalidation loop;
6. preserve advisory findings without forcing repair;
7. stop at human review only with a current pass recommendation or explicit Gate reason;
8. expose the assessment and its existing Run cost evidence through shared read operations and the
   local console.

The slice uses one configured Review AgentProfile. Automatic Bundle acceptance, delivery, merge,
parallel reviewers, alternative Candidate competition, quality scoring, and automatic model routing
remain deferred.

## Acceptance Criteria

- Review admission is a deterministic consequence of the exact confirmed Plan.
- Every Review Run and assessment binds one immutable Bundle revision and all exact Candidate SHAs.
- The reviewer cannot mutate Candidates, expand authority, accept a Bundle, deliver, or merge.
- `pass` remains a recommendation; advisory findings do not create endless repair cycles.
- Blocking Feedback targets authorized WorkUnits and reuses the existing Plan, Feedback, Run, and
  evidence lifecycle.
- A changed Candidate or Bundle requires a new assessment; stale evidence never transfers.
- Runtime failure, invalid output, ambiguity, and budget exhaustion fail closed to retry or Gate.
- Review usage, duration, attempts, findings, and stop reason remain auditable but outside ordinary
  Agent context.
- No new aggregate phase, WorkUnit stage, correction state, or generic workflow graph is introduced.
- Human Bundle acceptance, delivery, merge, authority expansion, and Plan revision remain explicit
  gates.
