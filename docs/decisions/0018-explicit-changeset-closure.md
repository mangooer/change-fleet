# 0018: Explicit ChangeSet Closure

Status: Accepted

Date: 2026-08-04

Source: Repository Design Proposal 0016

## Decision

Add one explicit, idempotent, human-gated operation that closes an unfinished, quiescent,
pre-delivery ChangeSet as `abandoned`. It records a bounded stable reason and actor while preserving
all existing intent, authority revisions, Runs, evidence, cost observations, checkpoints,
Candidates, Bundles, commands, decisions, and blockers.

Closing does not create or link a successor, resolve another branch, change a base, copy intent,
invoke an Agent, run validation, clean a workspace, delete content, or mutate external state. A new
task continues to use ordinary `changeset create` and receives its own explicit branch and exact
base selection.

An active Run or lifecycle command, begun delivery, or terminal aggregate blocks closure. Closed
ChangeSets remain readable and auditable but reject later lifecycle mutation. The operation is
shared by the experimental CLI and future UI rather than implemented separately per adapter.

## Rationale

The WI-0009 dogfood task should be intentionally closed before the user creates a fresh ChangeSet
from a later base. An automatic replacement operation would duplicate creation and assume successor
authority. Detailed attempt models are not justified by cost reporting because existing immutable
Run evidence already supports per-ChangeSet totals.

## Consequences

- WI-0011 implements the close-only vertical slice.
- Generic resume, human hold, rewind, restart, fork, turn checkpoints, conversation deletion,
  retention, automatic retry, and Provider-session continuation remain deferred.
- The old and new ChangeSets account for their own cost. Cross-task lineage or aggregate reporting
  requires later evidence and accepted authority.
