# 0025: Unify Stage And Run Lifecycle

Status: Accepted

Date: 2026-08-06

Source: Repository Design Proposal 0023

Revises in part: Decision 0024's dedicated correction operation, bounded automatic correction
sequence, and focused re-review lifecycle; Decisions 0017 and 0024 operation-specific recovery
state

## Decision

ChangeFleet separates business phase, repository work phase, Agent invocation state, feedback,
human gates, blockers, and immutable result evidence.

A ChangeSet stores only `planning | working | review | delivery | terminal`. A current WorkUnit
stores `execution | verification | complete` independently from `current | superseded | excluded`.
Every Agent invocation is a `planning | execution | verification` Run with the common status
`queued | running | completed | failed | interrupted | cancelled`.

Feedback is immutable input and remains a claim assessed by an Agent. Human waiting and blockers
are separate Gate and Blocker records. UI activity is derived rather than persisted as compound
states.

There is no correction operation or focused-review lifecycle. Verifier or human revision feedback
returns a WorkUnit to execution and creates a feedback-triggered execution Run. A later exact
checkpoint naturally returns to verification; prior findings may narrow a verifier's input without
creating another state.

One generic Run reconciler handles controller loss and interruption. Operation-specific workspace
preflight remains bounded adapter behavior, not a separate aggregate state machine.

Decision 0024 remains authority for Candidate-bound admission, deterministic exact-subject checks,
optional independent read-only verification, verdict boundaries, and separate audit cost. Exact
repository, Plan, checkpoint, Candidate, Bundle, human-decision, and delivery authority remains
unchanged.

## Rationale

The implemented flat state model multiplied stage, activity, and outcome into operation-specific
names and modeled the same rework differently depending on whether feedback came from a human or a
verifier. That shape makes every new Agent role add state, recovery, audit, and UI branches.

Coarse phases plus one Run lifecycle preserve deterministic authority while allowing Agent
Runtimes to assess feedback, select checks, and continue semantic work without a Core-owned fixed
workflow chain.

## Consequences

- The pre-release persisted schema receives one atomic replacement and one-way migration.
- Existing immutable evidence and exact Git subjects remain preserved; old aggregate state names
  become migration-only history.
- Experimental CLI and local UI payloads may change during the cutover.
- No dual lifecycle model, generic workflow DSL, Agent graph, or plugin framework is introduced.
- Implementation is tracked by WI-0019 and must delete legacy states, duplicate Run references,
  correction prompts, and operation-specific recovery branches before acceptance.
