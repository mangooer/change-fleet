# 0016: Explicit ChangeSet Closure

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-04

Accepted: 2026-08-04

Supersedes:

Depends on: Decisions 0002, 0008, 0009, 0014, and 0017; WI-0009 recovery evidence

Decision: [Decision 0018](../decisions/0018-explicit-changeset-closure.md)

Implementation tracking: [WI-0011](../work-items/WI-0011-explicit-changeset-closure.md), `in_progress`

## Context

The failed `changefleet-wi-0009` dogfood ChangeSet now has an exact recovered Candidate and
immutable validation evidence, but the user wants to abandon that Runtime task and create a new
ChangeSet from a later branch tip. Current product operations can create the successor, but no
human operation can close an unfinished ChangeSet. Leaving the old aggregate merely `failed` keeps
it apparently actionable and does not distinguish an intentional business stop from an execution
failure.

Discussion considered an automatic replacement command, first-class WorkUnit attempts, and a full
Conductor-style checkpoint experience. They are unnecessary for this stage. Closing the old task
and creating a new task are independent user actions. Existing `changeset create` already freezes
the new branch and base; it must remain the only creation path rather than receiving an implicit
copy or replacement shortcut.

The current Runtime already records bounded Run usage, duration, profile, outcomes, validation, and
artifacts outside Agent context. Closing a ChangeSet does not require new cost aggregates or
lineage records. Per-task totals remain query-time projections over existing evidence.

## Decision

Add one explicit, idempotent, human-gated ChangeSet close operation. It marks one unfinished,
quiescent, pre-delivery ChangeSet `abandoned` and appends an immutable bounded closure decision.
The operation does not create or identify a successor.

The request contains an idempotency key, exact ChangeSet id, actor, one stable reason code, and a
bounded human summary. Initial reason codes are `no_longer_needed`, `restart_on_new_base`,
`route_abandoned`, `duplicate`, and `other`. Closure reason and decision metadata remain control
and audit data; they never enter Agent Runtime context.

Closure is allowed only when no Run reference or lifecycle command is in progress and no delivery
request has begun. Already terminal `done` or `abandoned` aggregates reject a new close request,
while replaying the original idempotency key returns its recorded result. A failed, blocked,
planning, executing, validating, Candidate-review, or accepted-but-unpublished ChangeSet may close
when it is otherwise quiescent. Bundle acceptance and historical evidence remain facts even if the
user later abandons before publication.

The close decision preserves intent, selections, Harness snapshots, Plans, WorkUnits, Runs,
checkpoints, validation attempts, Candidates, Bundles, commands, decisions, evidence, and observed
cost. It grants no permission to reset or delete workspaces, branches, commits, transcripts,
artifacts, PRs, or remote state. Closed ChangeSets remain readable and auditable but reject later
lifecycle mutation.

Expose the operation through the shared application allowlist and one retained experimental CLI
route. A later UI calls the same operation; it does not invoke the CLI. Users create a fresh task
with ordinary `changeset create`, explicitly choose its branch and target, and receive a newly
resolved exact base. ChangeFleet does not automatically copy intent, choose a successor id, link
tasks, or aggregate their cost.

## Why No Generic Resume Operation

Exact validation resume already uses state-specific `changeset execute` semantics and a fresh
idempotency key. A generic `resume` verb would ambiguously combine validation retry, Provider retry,
human response, replanning, and session continuation.

Human holds, turn checkpoints, rewind, restart, fork, conversation deletion, artifact retention,
automatic retry policy, and Provider-session resume depend on a later interactive Runtime and UI
boundary. They remain deferred rather than receiving speculative states or placeholder commands.

## Alternatives

### Leave The Old ChangeSet Failed

The user can create another ChangeSet today, but the old task remains operationally ambiguous and
visible as a failure that may still be resumed. Rejected as the final lifecycle behavior.

### Automatically Replace And Create A Successor

This duplicates ordinary creation, assumes the new intent and Repository scope, complicates
partial failure, and couples otherwise independent user actions. Rejected.

### Add WorkUnitAttempt And Detailed Cost Lineage

Existing Run and validation records already retain the measured cost and outcome. A new aggregate
solely for statistics is premature. Deferred until parallel attempt ownership creates a correctness
need rather than a reporting preference.

### Implement Conductor-Style Checkpoints Now

Turn-level Git refs, conversation boundaries, destructive rewind, forked workspaces, and content
retention are valuable developer-experience features, but the current one-shot structured Provider
and unfinished local console do not yet provide the required interaction boundary. Deferred.

## Acceptance Criteria

- One exact human close request transitions an eligible ChangeSet to `abandoned` and records its
  bounded reason without invoking Runtime, Git, validation, or delivery adapters.
- Close rejects active Runs, in-progress lifecycle commands, any begun delivery, terminal state,
  unknown reason codes, oversized summaries, stale or malformed identity, and arbitrary fields.
- Idempotent replay is stable; key reuse with different input fails.
- Every later ChangeSet lifecycle mutation rejects the abandoned aggregate while exact reads and
  audit queries remain available.
- Existing Runs, evidence references, aggregate usage, Candidates, Bundles, failed commands, and
  blockers are unchanged by closure.
- Shared application and CLI routes delegate to the same operation and expose no automatic
  successor, command execution, filesystem cleanup, or external write.
- New production boundaries have Simplified Chinese intent comments and no fake or temporary
  production command remains.

## Validation

- Domain tests for bounded closure reasons and stable diagnostics.
- Integration tests for quiescent closure from representative unfinished states, preservation,
  restart reads, idempotency, active-operation rejection, and delivery rejection.
- Shared operation and CLI tests for exact route and strict input delegation.
- Audit and Runtime-context regressions proving closed facts remain queryable but out of context.
- Affected acceptance tests and final deterministic `npm run check` under Node.js 24.
- `git diff --check`, link, status projection, eager Harness size, comment, and temporary-code
  audits.

## Non-Goals

- Creating, copying, linking, or recommending a successor ChangeSet.
- Re-resolving a base, switching a branch, revising selection, or copying old intent.
- Canceling an active process, automatic retry, retry budgets, generic resume, human hold, rewind,
  restart, fork, checkpoint UI, Provider-session resume, or Agent chat.
- Deleting or retaining workspace content, branches, commits, transcripts, artifacts, local refs,
  delivery branches, PRs, or external resources.
- New pricing, dashboards, comparison, lineage aggregates, or Runtime context fields.

## Acceptance

Accepted by the user on 2026-08-04 with the explicit boundary that closing and creating are separate
user actions. Resume-like developer-experience operations are deferred until an interactive stage.
