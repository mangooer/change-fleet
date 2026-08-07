# 0026: Adopt Policy-Governed Agentic Supervision

Status: Accepted

Date: 2026-08-06

Source: Repository Design Proposal 0024

Revises in part: Decision 0025's closed list of Agent Run purposes; the common Run lifecycle and
coarse ChangeSet and WorkUnit phases remain unchanged

## Decision

ChangeFleet will support Plan-confirmed autonomous progress through a policy-governed Agentic
Supervisor. A deterministic kernel derives exact authorized action envelopes and directly performs
forced actions. A read-only Supervisor Agent is invoked only when legitimate semantic alternatives
remain; it may select an offered action or request a human Gate, but it cannot grant authority or
execute ambient control mutations.

A confirmed Plan records `manual | autonomous_until_review` and bounded effective supervision
limits within Project ceilings. Autonomous authority ends at exact Bundle review and never implies
Bundle acceptance, external publication, merge, deployment, permission expansion, or irreversible
approval.

`supervision` is a ChangeSet-scoped Agent Run purpose using the existing common Run lifecycle. It
adds no ChangeSet or WorkUnit phase. Every proposal binds the current projection and offered action
ids, is revalidated before execution, and records separate usage and disposition evidence.

Ordinary failed checks and actionable review findings may become Feedback and continue through the
same Plan and WorkUnit workspace. Authority expansion, Plan invalidation, unresolved product choice,
unbounded routing, budget exhaustion, operator hold, or final Bundle review stops automatic work.

## Rationale

Pure rules are reliable for authority, identity, evidence, and recovery but brittle for semantic
routing. A fully Agent-controlled workflow is flexible but cannot safely own those control facts.
The accepted split preserves a small deterministic kernel while using Agent reasoning only where it
adds value.

## Consequences

- The next implementation WorkItem is one single-Candidate autonomous vertical slice.
- Current Plan fields remain the quality contract; no parallel QualityContract aggregate is added.
- Supervisor tools are typed shared operations, not CLI calls or unrestricted shell authority.
- Alternative Candidate competition, blind judging, automatic model routing, and automatic merge
  remain deferred.
- Decision 0025 remains authoritative for coarse phases, Feedback, Gates, Blockers, and the common
  Run status lifecycle.
