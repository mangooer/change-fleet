# 0005: Runtime Cost And Effectiveness Observability

Artifact type: Repository Design Proposal

Decision status: Proposed

Proposed: 2026-07-30

Depends on: Decision 0005 and Decision 0007, accepted

Implementation tracking: None until accepted.

## Context

ChangeFleet must eventually audit the cost and practical effectiveness of Agent Runtime
orchestration. Operators need to know the token use of every model request and the aggregated cost
of one Run, WorkUnit, ChangeSet, Agent Profile, model choice, context strategy, and retry path.
They also need outcome evidence that permits comparison of Agent configurations without confusing
raw activity with successful delivery.

The deterministic first slice records initial context-budget evidence, but its fake Runtime does
not expose real provider token usage, pricing, request identifiers, or quality telemetry. It must
not fabricate these facts.

## Requirement Placement

This proposal is a staged requirement container, not one implementation stage. Its contents enter
the product at different times:

| Requirement | Earliest appropriate stage | Why |
| --- | --- | --- |
| Exclude audit telemetry from ordinary Agent context | Current architecture constraint | Prevents future telemetry from silently becoming planning authority |
| Reject fake token, price, and effectiveness evidence | Deterministic fake Runtime stage | Prevents tests from being reported as Provider facts |
| Record immutable per-request Provider usage and timing | First real Provider adapter | These source facts cannot be reconstructed later |
| Calculate Run, WorkUnit, and ChangeSet totals | After one Provider reports trustworthy usage | Aggregation needs real source records and stable identity |
| Compare Agent Profiles, models, Harness, and context changes | After representative comparable samples exist | A comparison without controlled cohorts is misleading |
| Add dashboards, budget enforcement, quota, or chargeback | Later operator/product proposal | These are policy and user-surface decisions, not telemetry capture |

WI-0001 implements only the first two constraints. It does not persist Runtime usage or implement
cost/effectiveness aggregation. Before implementation of the first real Provider begins, the
per-request schema and Provider reporting contract in this proposal must be accepted as part of
that Provider stage's authority.

## Proposed Requirements

### 1. First Real Provider: Record Immutable Runtime Invocation Usage

Every real Runtime invocation emits a versioned usage record attached to its exact Run attempt.
It records provider-reported values when available:

```text
run_id
invocation_id
attempt
operation
provider
model
agent_profile_id
started_at
finished_at
duration_ms
input_tokens
cached_input_tokens
output_tokens
reasoning_tokens
total_tokens
provider_request_id
usage_confidence
raw_usage_reference
```

`usage_confidence` is one of `provider_reported`, `estimated`, or `unknown`. Missing provider
fields remain null; ChangeFleet must not infer token counts from characters and label them as exact.

The immutable record is evidence, not a mutable counter. A Run summary may contain derived totals
only when every contributing invocation is referenced.

This capture is part of first-Provider acceptance, not an optional observability follow-up. A
Provider adapter is incomplete if it silently discards usage that the Provider makes available.
If the Provider does not expose a field or hides nested subagent requests, the adapter records that
boundary as `unknown` instead of inventing coverage.

### 2. Post-Provider Derivation: Separate Token Usage From Monetary Cost

Token counts are durable provider observations. Monetary cost is a derived calculation using a
versioned, explicitly selected pricing snapshot:

```text
pricing_snapshot_id
currency
input_rate
cached_input_rate
output_rate
reasoning_rate
calculated_cost
calculation_version
```

This prevents a historical Run from silently changing cost merely because a provider later changes
public pricing. Unknown pricing yields `cost: null`, not a guessed number.

The first Provider stage may preserve a pricing-snapshot reference when one has been explicitly
approved, but monetary aggregation is not required to prove Provider execution. It begins only
after trustworthy usage records exist.

### 3. Representative-Sample Stage: Measure Effectiveness Without One Score

ChangeFleet records exact operational outcomes and enables later comparison. It does not claim to
measure code quality from one universal number.

The initial comparison dimensions are:

- completion: completed, failed, abandoned, blocked, or cancelled;
- exact terminal artifact: Candidate and Bundle availability, review decision, and delivery result
  when delivery exists;
- retries and attempts: planning attempts, execution attempts, replans, and recovery events;
- validation: repository and combined-check pass/fail, failure code, and duration;
- elapsed time: queue, Runtime, Git, validation, human-gate, and end-to-end durations;
- change shape: changed-path count and diff-stat evidence, treated as descriptive rather than a
  quality score;
- human outcome: accepted, rejected, requested revision, or absent.

Comparisons must be segmented by comparable task class, Repository Harness revision, intent/plan
scope, base state, Agent Profile, model, and validation contract. Averages across unrelated tasks
are not valid evidence that one Agent is better.

A comparison feature is not ready merely because two Runs exist. Its WorkItem must define the
minimum cohort, controlled variables, excluded samples, and decision that the comparison is meant
to inform. Until then ChangeFleet stores operational outcomes but does not rank Agents.

### 4. Preserve privacy and bounded evidence

Prompt and completion transcripts remain optional external artifacts under existing bounding and
retention rules. Default telemetry stores counts, durations, stable identifiers, outcome codes, and
artifact references; it does not duplicate full source, prompt, or output text into aggregate
state.

Runtime cost, effectiveness, retry, and comparative telemetry is audit/debug data. It is excluded
from the default Control Contract and current Run Context Projection. An Agent may receive a
minimal, explicit diagnostic request only when a human-authorized debugging operation requires it;
ordinary planning and execution never receive prior token totals, scorecards, or Provider traces.

## Stage Exit Conditions And Fake Lifecycle

Every implementation stage must define its accepted boundary, completion evidence, deferred
boundary, and exit condition before it begins. Once the evidence satisfies that stage's acceptance
criteria, work moves to review or the next accepted stage; speculative optimization of the completed
stage requires a new concrete defect, metric, or proposal rather than indefinite iteration.

A fake Runtime or mock is permitted only to prove the currently accepted port and deterministic
control behavior. It is not a product capability. When a real implementation proves the same
boundary, the fake must be removed from production paths, retained only as a named test fixture,
or deleted if it no longer exercises unique failure behavior. No fake provider result, token count,
cost, or quality metric may enter production evidence as if it were observed fact.

The stages exit as follows:

- deterministic kernel exits when its state, Git, evidence, recovery, context, and human-gate
  acceptance tests pass; it does not wait for Provider telemetry;
- first Provider exits only when real invocation identity, available usage, duration, and unknown
  coverage are persisted against exact Runs;
- aggregation exits when totals are reproducible solely from immutable invocation references and
  an explicit pricing snapshot where cost is shown;
- effectiveness comparison exits only when a declared comparable cohort and interpretation limits
  are tested and visible.

## Questions To Resolve Before Acceptance

- Which Provider adapters can report usage at every model-request boundary, including subagents?
- Does a Runtime report one aggregate invocation or a tree of child model requests?
- Who supplies and approves pricing snapshots, and what currency/rounding policy applies?
- Which metrics can be exposed to a user versus restricted to an operator due to cost or privacy?
- What is the retention policy for raw provider identifiers and optional transcript artifacts?
- How should externally managed Agent sessions with partial telemetry be represented?

## Non-Goals

- Estimating exact token counts for a Provider that does not report them.
- Declaring a universal Agent “quality score”.
- Billing, quotas, chargeback, or budget enforcement.
- Requiring a real Provider, database, UI dashboard, or tracker integration in WI-0001.
- Persisting unbounded transcripts or source snapshots in ChangeSet aggregate state.
- Feeding audit telemetry into ordinary Agent context or using it as hidden planning authority.
- Leaving superseded fake implementations reachable through production Runtime selection.

## Recommendation

Do not implement this proposal as one monolithic WorkItem. WI-0001 is landed, and base-selection
authority must be resolved before the first real Provider. Before that Provider WorkItem is
authorized, accept only the raw invocation-usage and timing portion needed by the Provider. Create
later, separate implementation stages for aggregation and effectiveness comparison when their data
prerequisites exist. Derived reports remain queries over evidence and never become ChangeSet
lifecycle authority or default Agent context.
