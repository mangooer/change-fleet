# 0010: Read-Only Runtime Audit Projections

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-03

Discussion revised: 2026-08-03

Accepted: 2026-08-03

Supersedes:

Depends on: Proposal 0005, Decision 0009, WI-0003 `done`, and WI-0004 `done`

Decision: [Decision 0012](../decisions/0012-read-only-runtime-audit-projections.md)

Implementation tracking:
[WI-0005](../work-items/WI-0005-read-only-runtime-audit-projections.md), `done`

## Context

Decision 0009 and WI-0003 preserve immutable Runtime invocation identity, timing, available
Provider usage, confidence, coverage, Agent Profile identity, context-projection identity, and raw
artifact references. WI-0004 adds exact Repository Harness selection and discovery identity. The
2026-08-03 real Codex gate demonstrates why the next boundary must distinguish several facts:

- planning and execution have separate usage and duration;
- cached input is a subset of input, not an additional token charge to add blindly;
- Provider-duration sums differ from end-to-end wall time;
- the Provider may report aggregate usage while effective model, monetary cost, request tree, or
  actual Harness-load events remain unavailable;
- a successful Runtime call, Candidate, validation, Bundle, human acceptance, and delivery are
  different outcomes.

The source evidence now exists, so read-only derivation is appropriately sequenced. Pricing,
budget enforcement, dashboards, automatic optimization, and a universal effectiveness score are
not.

## Problem

Operators need to answer factual audit questions without replaying raw JSON by hand:

- What did each Run consume and how long did it take?
- What observable Runtime usage belongs to one WorkUnit or ChangeSet?
- How many attempts completed, failed, were cancelled, or were abandoned?
- Did Runtime completion lead to a Candidate, successful validation, a Bundle, or human acceptance?
- Which Agent Profile, requested Runtime settings, context projection, and Harness revision were
  associated with the observation?
- Which observations are missing, incomplete, overlapping, or unsupported?

Mutable counters would create a second authority beside immutable evidence. Unbounded audit output
would reproduce the context and storage problem the Harness deliberately avoids. A single success
or quality score would erase important lifecycle distinctions. Cross-ChangeSet comparison is a
later stage after representative audit evidence exists.

## Options Considered

### Option A: Derive bounded reports at query time

Read immutable ControlStore, RunStore, EvidenceStore, Bundle, and linked artifact metadata when an
operator requests a report. Return a deterministic projection without persisting the projection.

Advantages:

- immutable source evidence remains the only authority;
- restart, retry, and supersession cannot leave a rollup stale;
- metric corrections do not require rewriting historical aggregates;
- the first implementation is local, read-only, and independently testable;
- audit output stays outside ordinary Agent context.

Tradeoffs:

- repeated queries repeat local reads and derivation;
- broad portfolio queries require explicit bounds;
- historical reports can change when the query schema changes unless the report version is shown.

### Option B: Persist counters and materialized rollups

Update Run, WorkUnit, ChangeSet, profile, and model totals as lifecycle events occur.

Advantages:

- fast repeated reads;
- natural input for a dashboard.

Tradeoffs:

- introduces duplicate authority and reconciliation rules;
- retries, recovery, evidence repair, and query-version changes can invalidate counters;
- schema migration arrives before a stable operational surface exists;
- persisted comparisons may be mistaken for lifecycle state.

Reject this option for the first derivation stage.

### Option C: Export evidence to an external analytics system first

Send Runtime evidence to OpenTelemetry, a data warehouse, or another observability backend.

Advantages:

- mature aggregation and visualization;
- suitable for larger installations later.

Tradeoffs:

- adds external delivery, credentials, retention, privacy, and failure semantics;
- makes local audit dependent on infrastructure not otherwise required by ChangeFleet;
- still needs a canonical ChangeFleet metric contract.

Defer this option. A later exporter may consume the accepted read-only projection.

## Recommendation

Adopt Option A. Add one private `RuntimeAuditQueryService` that derives versioned Run and ChangeSet
facts from immutable evidence. Do not persist report results, mutate lifecycle state, feed them into
ordinary Runtime context, or implement cross-ChangeSet comparison in the first stage.

## Proposed Design

### 1. Keep immutable evidence authoritative

The query layer may read:

- ChangeSet state and current or superseded revision identity;
- Run records and immutable Runtime invocation evidence;
- WorkUnit state, attempts, Candidate identity, and repository-check evidence;
- exact CandidateBundle and combined-validation evidence;
- human Bundle decisions;
- Agent Profile, context-projection, Repository selection, and Harness selection identity;
- bounded artifact references already authorized for audit.

It does not read full transcripts, prompts, source snapshots, or Harness bodies by default. It does
not repair, normalize in place, or enrich source records.

Every report uses this conceptual envelope:

```text
audit_projection_schema_version
source_identity
query_parameters
generated_at
payload
payload_digest
```

The deterministic digest covers schema version, source identity, query parameters, and payload.
`generated_at` describes observation time and is excluded from that digest. Equivalent immutable
evidence and query parameters therefore produce the same factual payload digest.

### 2. Add two read-only projections behind an isolated query component

The initial private application boundary exposes conceptually:

```text
getRunAudit(run_id)
getChangeSetAudit(change_set_id, detail_page)
```

`getRunAudit` reports one exact attempt and its Provider observations.

`getChangeSetAudit` reports lifecycle facts and totals derived from every referenced Run and exact
validation subject. Detailed Run rows are paginated; totals still describe the complete referenced
set or declare why completeness is unknown.

`RuntimeAuditQueryService` depends only on read interfaces for the ControlStore, RunStore,
EvidenceStore, and exact Bundle decision evidence. It does not depend on `RepositoryWorker`, an
Agent Runtime, the scheduler, or any mutation port. This keeps audit derivation outside the
deterministic lifecycle command service.

The first implementation does not create a public API, CLI, dashboard, scheduled report, or query
language. Those surfaces may call this boundary later.

### 3. Derive usage without double counting

Each Run preserves all raw `UsageObservation` rows. Its derived canonical usage follows a
conservative rule:

1. prefer exactly one valid Provider-reported `scope = aggregate` observation;
2. when there is no aggregate, accept exactly one valid observation as the Run summary;
3. when several observations may overlap and no explicit non-overlap relation exists, expose the
   rows but set the derived Run total to `unknown` with reason `ambiguous_observation_overlap`;
4. never add cached input to input again;
5. never add reasoning output to output again when the Provider defines it as a subset;
6. never turn null fields into zero.

The derived summary identifies the chosen observation and records the selection reason. Current
Codex evidence remains Run-level `scope = aggregate` and `coverage = aggregate_only`; the query
does not invent per-step values when the Provider did not report them.

A ChangeSet token total sums only canonical known Run totals. It also reports:

```text
referenced_run_count
observed_run_count
unknown_run_count
coverage_breakdown
confidence_breakdown
```

The numeric sum is labeled `observed_total_tokens`, not an implied complete total when any Run is
unknown.

### 4. Keep duration clocks distinct

Reports distinguish:

- Provider or Runtime duration reported for each invocation;
- sum of non-overlapping known Run durations;
- repository and combined validation duration when recorded;
- ChangeSet elapsed wall time when valid lifecycle timestamps bound it;
- human-gate elapsed time only when both boundary timestamps exist;
- unknown queue, child-request, or tool time.

Provider-duration sum and end-to-end elapsed time are never presented as interchangeable.
Parallel Run durations may overlap; a sum is work duration, not wall duration.

### 5. Report stage outcomes instead of one success score

The initial report keeps these outcomes separate:

| Level | Factual result |
| --- | --- |
| Runtime attempt | completed, failed, cancelled, abandoned |
| Planning | plan proposed, selection change requested, invalid outcome, failed |
| WorkUnit | Candidate ready, failed, blocked, superseded, incomplete |
| Validation | repository check and combined check pass, fail, or unavailable |
| Bundle | assembled exact revision or absent |
| Human review | accepted, rejected, revision requested, or absent |
| Delivery | not implemented, therefore unavailable rather than failed |

Failure codes and attempt counts are reported without collapsing them into a generic failure rate.
Derived rates may be shown only beside their numerator, denominator, exclusions, and report schema
version.

### 6. Defer cross-ChangeSet comparison

The accepted first stage does not implement cohort grouping, rankings, recommendations, causal
claims, or `compareChangeSets`. Run and ChangeSet projections preserve the stable Agent Profile,
requested and observable Runtime settings, context-projection, Harness-selection, operation,
attempt, validation, and scope identities that a later comparison proposal may use.

That later stage must be based on representative audit evidence and must define explicit bounded
inputs, sample counts, exclusions, missingness, and confounders before implementation. Audit
projection acceptance alone does not authorize portfolio scanning or automatic routing.

### 7. Keep output bounded and deterministic

Initial bounds are:

- one exact Run or ChangeSet id per query;
- at most 100 detailed Run rows in one response page;
- stable ordering by ChangeSet id, Run creation time, attempt, and Run id;
- bounded failure-code dictionaries with explicit omitted counts;
- artifact references rather than embedded transcript, diff, log, prompt, or snapshot bodies.

Equivalent source evidence, query parameters, and audit schema produce the same source digest and
factual values. Pagination changes detail presentation, not complete-set totals.

### 8. Preserve context and authority isolation

Audit projections are operator/debug output. They are excluded from:

- Control Contracts;
- planning and execution Context Projections;
- Agent prompts and Harness discovery;
- plan confirmation, Bundle review, and delivery authority;
- automatic Agent Profile or model selection.

An Agent may analyze an audit report only through a future explicit human-authorized diagnostic
operation. That operation is not part of this proposal.

### 9. Remain read-only and restart-safe

Audit queries acquire no scheduler or delivery lock and perform no writes to control, Run,
evidence, workspace, Git, or registered Repository state. A query interrupted by process loss is
simply rerun. It creates no recovery record.

Tests compare store and Git identity before and after queries. Restarting the service over the same
evidence must reproduce the same source-bound values apart from `generated_at`.

### 10. Keep missing and malformed evidence honest

Missing optional Provider values remain null with an explicit reason. A broken required reference,
identity mismatch, or malformed immutable evidence fails the affected query with a stable typed
diagnostic; it is not silently skipped from a favorable total.

Reports distinguish:

- excluded by caller filter;
- missing optional observation;
- unsupported Provider coverage;
- invalid required evidence;
- lifecycle stage not yet reached.

## First Implementation Stage

After acceptance, create exactly one Development WorkItem for one read-only vertical slice:

1. implement versioned `RunAuditProjection` and `ChangeSetAuditProjection` derivation;
2. implement an isolated `RuntimeAuditQueryService` over read-only store interfaces;
3. add stable localized diagnostics for invalid references, overlap ambiguity, and query bounds;
4. prove zero writes to aggregate, evidence, workspace, Git, and registered Repository state;
5. prove audit fields do not enter Runtime context;
6. cover aggregate-only Codex usage, unknown fields, retries, failure, cancellation, abandonment,
   validation, Bundle review, and restart;
7. retain test fixtures only under test support and add no production fake evidence source.

The stage exits after deterministic tests reproduce reports solely from immutable references and
one explicitly authorized, one-time final real Codex flow observes the same Run and ChangeSet
totals already stored by the Provider adapter. The paid gate stays outside `npm run check` and is
not repeated automatically. The stage does not continue into comparison, pricing, dashboard,
export, or optimization work.

## Acceptance Criteria

1. Run and ChangeSet reports are reproducible from immutable evidence and stable query parameters.
2. Aggregate-only Codex usage produces the same per-Run and ChangeSet observed totals as its source
   evidence without double counting cached or reasoning subsets.
3. Missing, partial, overlapping, or malformed observations are visible and never silently treated
   as complete zero-valued evidence.
4. Runtime, WorkUnit, validation, Bundle, human-review, and delivery outcomes remain distinct.
5. Provider-duration sums, validation time, human-gate time, and wall time remain distinct.
6. `RuntimeAuditQueryService` has no Runtime, scheduler, RepositoryWorker, or mutation dependency.
7. Query results and totals are not persisted as ChangeSet lifecycle authority.
8. No audit value enters ordinary planning or execution context.
9. Queries perform no filesystem, Git, registered checkout, workspace, or control-state mutation.
10. Results remain bounded and deterministic across restart.
11. Comparison, pricing, monetary normalization, budgets, dashboards, exports, automatic routing,
    and a public
    API or CLI remain absent.
12. No production mock, fake Provider evidence, or speculative analytics framework remains after
    review.

## Validation

| Gate | Scope |
| --- | --- |
| Unit tests | canonical usage selection, null preservation, duration semantics, rates, bounds, diagnostics |
| Store integration tests | reference integrity, retries, failures, Bundle decisions, restart reproduction, zero writes |
| Context regression | audit fields absent from Control Contract and Runtime Context Projection |
| Existing acceptance suite | no lifecycle or Candidate regression |
| Opt-in real Codex gate | source evidence and read-only derived Run/ChangeSet totals agree |
| `git diff --check` plus eager-size and fake-path audit | Harness and repository hygiene |

The real Provider gate remains explicit and paid. An implementation WorkItem must record the cost
decision and cannot report a skipped gate as passing.

## Risks And Open Questions

- A future Provider may expose overlapping request, model, and aggregate observations. The initial
  conservative rule returns unknown instead of guessing a non-overlapping request tree.
- Exact-id queries avoid broad authority and directory scans but are less convenient than a
  portfolio query. A later operator-surface proposal may add authorized listing and pagination.
- `generated_at` makes report envelopes time-varying; the source digest and factual payload must
  remain independently reproducible.
- A later comparison stage can still be misread as causal and must keep confounders and sample
  counts visible.
- Local filesystem reads are sufficient for the private package but may need indexing after hosted
  scale, retention, and tenancy boundaries are accepted.

## Non-Goals

- Versioned pricing snapshots or monetary cost normalization.
- Billing, chargeback, quota, budget, or automatic cancellation.
- A dashboard, UI, public API, CLI, scheduled report, or external telemetry exporter.
- Cross-ChangeSet cohort comparison, ranking, recommendation, or causal analysis.
- Global directory scanning or an authoritative portfolio analytics database.
- Automatic Agent Profile, Provider, model, Harness, context, or routing optimization.
- A universal quality or effectiveness score.
- Feeding historical audit data into ordinary Agent context.
- Persisting mutable counters, rollups, rankings, or comparison conclusions.
- Reading raw transcripts, source, diffs, prompts, or Harness bodies by default.
- Delivery, Linear, another Provider, remote workers, or hosted multi-tenancy.

## Documentation Impact

- Acceptance records one decision for read-only derived audit authority and metric semantics,
  extends `SPEC.md`, and adds the query isolation and validation contracts.
- Implementation still requires exactly one separately confirmed Development WorkItem.
