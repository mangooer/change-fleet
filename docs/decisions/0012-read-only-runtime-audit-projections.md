# 0012: Derive Read-Only Runtime Audit Projections

Status: Accepted

Date: 2026-08-03

Source: Repository Design Proposal 0010

## Decision

ChangeFleet will expose private, versioned `RunAuditProjection` and
`ChangeSetAuditProjection` views derived at query time from immutable ChangeSet, Run, evidence,
CandidateBundle, and human-decision records. Immutable source evidence remains authoritative;
audit results are not persisted as counters, rollups, lifecycle state, or recovery state.

An isolated `RuntimeAuditQueryService` owns this derivation. It depends only on read interfaces and
has no Agent Runtime, scheduler, `RepositoryWorker`, Git mutation, workspace mutation, or lifecycle
command dependency. Audit output remains operator/debug data and is excluded from Control
Contracts, current Run Context Projections, Agent prompts, Harness discovery, authority decisions,
and automatic routing.

Usage derivation is conservative. It selects exactly one valid Provider aggregate observation when
available, otherwise accepts one unambiguous observation, and reports an unknown total when
multiple observations may overlap. Cached input and reasoning output are not added again when the
Provider defines them as subsets. Null remains unknown. Each summary identifies its selected source
and reason, and aggregate-only Codex evidence never becomes invented per-step data.

Reports distinguish Provider and Run duration, validation duration, ChangeSet wall time, and human
gate time. They also distinguish Runtime, planning, WorkUnit, validation, Bundle, human-review, and
delivery outcomes. Delivery that is not implemented is unavailable rather than failed.

Each report binds a schema version, exact source identity, query parameters, factual payload, and
deterministic payload digest. Observation time is excluded from that digest. Required-reference or
identity corruption fails closed with a typed diagnostic; missing optional Provider fields remain
explicitly unknown. Output is bounded, paginated where needed, and links large artifacts rather
than embedding them.

Cross-ChangeSet comparison, portfolio scanning, rankings, causal claims, prices, dashboards,
exports, budgets, public query surfaces, and automatic optimization remain outside this decision.
A later comparison proposal must be informed by representative audit evidence.

## Rationale

WI-0003 and WI-0004 now preserve the usage, timing, Runtime settings, context, and Harness
identities required for factual audit. Query-time derivation avoids a second mutable authority and
can correct metric semantics without migrating historical rollups. Separating the query component
also prevents audit and analytics concerns from enlarging the deterministic command service or
silently affecting an Agent's behavior.

Deferring comparison keeps the first implementation bounded around evidence interpretation. It
also avoids presenting small, heterogeneous samples as meaningful Agent, model, context, or Harness
performance conclusions.

## Consequences

- The first implementation requires one separately confirmed Development WorkItem.
- Exact Run and ChangeSet ids are the only initial query subjects.
- Current Codex evidence supports Run-level aggregate observations, not per-step accounting.
- Deterministic tests are mandatory; one explicitly authorized final paid Provider flow may verify
  real evidence and remains outside the normal fast suite.
- Query interruption requires no recovery record because the query performs no writes.
- A later materialized view, exporter, comparison surface, or pricing system requires new accepted
  authority.
