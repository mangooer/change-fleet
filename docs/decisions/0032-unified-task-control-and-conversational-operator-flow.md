# 0032: Unified Task Control And Conversational Operator Flow

Status: Accepted

Date: 2026-08-12

Source: Repository Design Proposal 0030

## Decision

Retain ChangeFleet's exact workspace, Git, CandidateBundle, Run, Evidence, review, and delivery
kernel while replacing the ordinary task route with one draft-to-confirmed Intent flow, one Task
Controller, one cross-stage conversation, and a task-first operator projection.

A terse request is planning input, not independently executable authority. Every Planner response
carries the bounded current Intent draft. Exact Plan-message approval atomically confirms that
Intent and Plan, then runs the deterministic Task Controller by default. The Controller hides the
manual execution versus autonomous-supervision split and advances forced work until a genuine human
boundary or Bundle review.

The target ChangeSet phases are `planning | running | review | terminal`. Pause, input requests,
retry, validation, blockers, and merge wait remain derived. Delivery attaches exact external facts
to an accepted Bundle rather than becoming another task phase.

The local console presents task conversation, semantic steps, current activity, effective Runtime,
and compact cost and retry facts. Exact revisions, ids, SHAs, Runs, and Evidence remain available
through an on-demand audit surface. Streaming presentation cannot authorize transitions.

Project remains Repository topology rather than branch identity. Each task freezes its own base,
target, and generated branches. Later tracker adapters must use deterministic SourceBindings; an
Agent cannot choose authority.

## Consequences

- Decisions 0023, 0025, 0026, and 0031 are revised in part.
- The first implementation is an atomic local single-Repository replacement under WI-0040.
- Old private control records and operation-oriented UI compatibility are not retained.
- Runtime role catalogs, richer automatic-review rules, tracker routing, Provider-native steering,
  Candidate comparison lanes, automatic acceptance, and automatic merge remain later boundaries.
