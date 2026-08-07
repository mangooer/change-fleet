---
artifact_type: repository_design_proposal
id: 0024
status: accepted
title: Policy-governed Agentic supervision
proposed_at: 2026-08-06
accepted_at: 2026-08-06
confirmed_by: user
decision: docs/decisions/0026-policy-governed-agentic-supervision.md
implementation_tracking: docs/work-items/WI-0020-plan-confirmed-agentic-supervision-vertical-slice.md
---

# 0024: Policy-Governed Agentic Supervision

## Context

ChangeFleet can now execute, validate, independently verify, repair through Feedback, recover Runs,
and assemble exact Bundles. The operator must still invoke ordinary continuation operations between
those steps. That is a useful control console, but it does not yet meet the product goal of approving
a Plan and returning only for a real decision or final audit.

A fully deterministic workflow would be safe but would accumulate rules for semantic questions such
as whether a failed check is environmental, which WorkUnit owns a cross-repository finding, whether
review feedback is material, or whether another AgentProfile is a better next attempt. A completely
Agent-controlled workflow would be flexible but could bypass authority, skip evidence, exceed budget,
or make recovery depend on private reasoning.

## Decision

Adopt a policy-governed Agentic Supervisor: a small deterministic control kernel derives the exact
currently authorized action set, while a Supervisor Agent chooses only when more than one legitimate
semantic route remains.

The relationship is deliberately asymmetric:

```text
Supervisor Agent proposes what to do.
ChangeFleet proves whether it may be done and performs the action.
```

### Plan-Bound Authorization

A confirmed ChangePlan records an effective supervision mode:

```text
manual | autonomous_until_review
```

A Project may supply a default, but the exact confirmed Plan records the effective value and its
bounded supervision budget. Confirming `autonomous_until_review` authorizes continued work only
under the same intent, Plan, Repository selections, Harness selections, Project ceilings, and
delivery boundary. It does not accept a Bundle, expand authority, publish externally, merge, deploy,
or approve an irreversible action.

The first autonomous stop target is the exact Bundle `review` phase. A local surface may combine
Plan confirmation and start into one interaction because the durable Plan contains the authority;
the UI is not the scheduler.

### Deterministic Action Catalog

For each current control snapshot, a pure policy function derives zero or more typed action
envelopes. Initial actions may include:

- dispatch an eligible execution Run;
- run or resume an exact repository or combined check;
- start required independent verification;
- submit bounded Feedback to an authorized WorkUnit;
- retry an eligible failed Run;
- assemble the exact CandidateBundle;
- open a human Gate;
- pause or stop supervision.

Each envelope binds current revision and subject identities, valid targets, preconditions, budget,
and an idempotency identity. If one mandatory action exists, the kernel performs it without an Agent
decision. Independent actions may run concurrently within existing WorkUnit and scheduler limits.

When semantic alternatives remain, ChangeFleet invokes one read-only Supervisor Run with a compact
current projection and the exact offered action envelopes. Its structured
`SupervisorDecisionProposal` selects an offered action or requests a human Gate and includes bounded
rationale, evidence references, and expected result. The kernel revalidates the entire envelope at
execution time. Stale, malformed, unauthorized, or over-budget proposals are rejected and never
become authority.

### One Run Lifecycle

`supervision` becomes an Agent Run purpose beside `planning | execution | verification`. It uses the
same common Run status lifecycle and does not add a ChangeSet or WorkUnit phase. A Supervisor Run is
ChangeSet-scoped, semantically read-only, and has no repository-write capability.

Every Supervisor invocation records its AgentProfile, input projection digest, offered action ids,
selected proposal, kernel disposition, duration, usage observations, and linked detailed artifact.
Large reasoning and logs remain outside aggregate state and ordinary Runtime context.

### Tools, Not Ambient Shell Authority

The Supervisor receives typed ChangeFleet operations, not unrestricted Control Store, Git, or shell
access. Tool implementations own authorization, exact-subject preflight, idempotency, evidence, and
postflight. Repository-specific commands may still be arbitrary programs selected by the Plan or
repository Harness, but ChangeFleet executes them through the existing evidence-producing Runner;
their result is not presumed deterministic merely because it came from a script.

The Supervisor may recommend an allowed AgentProfile or additional bounded check only when Project
and Plan policy expose that choice. It cannot create credentials, change Runtime permissions, invent
an AgentProfile, raise a budget ceiling, or make its own output satisfy a required check.

### Autonomous Repair And Escalation

Ordinary Provider failure, exact-check failure, and actionable verification findings continue under
the confirmed Plan when a valid route exists. Evidence or review findings become bounded Feedback;
the affected WorkUnit re-enters execution, reuses its authorized workspace where safe, produces a
new exact checkpoint, and revalidates the affected subject. Agent feedback assessment remains
`adopt | adapt | decline`; neither a verifier nor Supervisor claim is automatically true.

The autonomous loop stops only when:

- an exact Bundle is ready for final review;
- repository, branch, path, permission, or other authority must expand;
- a material Plan assumption is invalid and a new Plan requires exact approval;
- an unresolved product or irreversible external decision requires a human;
- a semantic choice cannot be bounded to the offered action set;
- the supervision budget is exhausted;
- an operator hold, interruption, abandonment, or terminal outcome applies.

Verifier improvement suggestions that do not affect correctness, security, accepted behavior,
authorized scope, compatibility, or required evidence remain non-blocking audit observations. They
do not create an endless repair loop.

### Budget And Recovery

Project policy owns ceilings. The confirmed Plan records effective limits for execution attempts,
verification attempts, Feedback repair cycles, elapsed supervision time, and usage where the
Provider exposes enforceable observations. Unknown or delayed token coverage remains honestly
`estimated | unknown`; ChangeFleet does not claim a hard token stop it cannot enforce.

Autonomous authorization, current Plan identity, exhausted counters, Supervisor decisions, Runs,
Evidence, Feedback, Gates, and holds are durable. After controller loss, the generic Run reconciler
first accounts for incomplete work. Supervision may continue only when the same authorization is
still current, no Gate or hold prevents dispatch, and exact preflight succeeds. Passed evidence is
not repeated merely because the controller restarted.

## Considered Alternatives

### Pure deterministic Supervisor

Retain it as the safety kernel, but reject it as the only decision maker. Semantic routing would
either become brittle special cases or unnecessarily escalate ordinary work to humans.

### Fully Agent-controlled workflow

Reject it. An Agent cannot own repository authorization, canonical transitions, exact Git identity,
budget ceilings, evidence acceptance, Bundle acceptance, or external delivery authority.

### Generic Agent graph or workflow DSL

Defer it. The accepted boundary is one policy loop and typed action catalog, not a user-programmable
orchestration framework.

## First Implementation Slice

The first confirmed WorkItem should prove one Candidate route from a confirmed Plan to exact Bundle
review:

1. persist effective `manual | autonomous_until_review` authorization and bounded ceilings;
2. add the read-only `supervision` Run purpose and structured decision proposal;
3. derive exact allowed action envelopes and execute forced actions without a model call;
4. invoke the Supervisor only for a genuine semantic branch;
5. automatically advance execution, exact checks, required verification, Feedback repair, and
   Bundle assembly;
6. expose shared start, pause, resume, Gate, and read-only progress operations without driving the
   CLI from UI;
7. recover without repeating completed Provider work or passed exact evidence;
8. record per-Run and ChangeSet totals outside ordinary Agent context.

The slice uses the current configured execution and verification AgentProfiles. Alternative
Candidate competition, blind judging, automatic model routing, automatic PR publication or merge,
remote workers, and a generic Agent graph remain deferred until this single-route loop is proven.

## Acceptance Criteria

- One exact Plan confirmation can authorize unattended progress to Bundle review.
- Normal failed checks and actionable verifier Feedback can repair and reverify without an operator
  continuation command.
- Forced next actions do not spend a Supervisor model call.
- Every Supervisor proposal is selected from an exact offered action set and revalidated before
  mutation.
- Supervisor rejection, usage, duration, retry, Feedback, and final stop reason are auditable.
- No new correction, focused-review, waiting, failure, or supervision-specific aggregate phase is
  persisted.
- Human review, authority expansion, budget extension, delivery, merge, and irreversible actions
  remain explicit gates.
- Multi-Repository dependency and exact Bundle behavior remain valid even though the first slice
  does not compare alternative Candidates.
