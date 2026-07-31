# 0009: Runtime Observability Evidence Boundary

Status: Accepted

Date: 2026-07-31

Source: Repository Design Proposal 0005

## Decision

The first real Provider stage records immutable Runtime invocation identity, timing, available
provider usage, and honest coverage against the exact ChangeFleet Run attempt.

ChangeFleet distinguishes:

```text
RuntimeInvocation
  one ChangeFleet call to an Agent Runtime

UsageObservation
  one provider-visible request, step, model total, or aggregate total
```

Every observation declares its provider-native scope, `provider_reported | estimated | unknown`
confidence, and `complete | partial | aggregate_only | unknown` coverage. Missing values remain
unknown. ChangeFleet never manufactures exact token counts or complete subagent coverage.

Run evidence records the Agent Profile revision, requested and observable effective model and
Runtime settings, context-projection version or digest, timestamps, terminal outcome, and raw
artifact references needed for later comparison. Full transcripts, source snapshots, Provider
traces, aggregate scorecards, and historical cost data remain outside ordinary Agent context.

Provider-reported monetary values may be preserved only as explicitly labeled estimates. Normalized
monetary cost requires a separately accepted versioned pricing snapshot and calculation contract.

Fake or scripted Runtime values are test evidence only. Once a real Provider proves the production
boundary, fake selection is removed from production paths and retained only under named test
support when it provides unique deterministic coverage.

## Rationale

Raw Provider observations cannot be reconstructed reliably after a Run. Recording identity, time,
usage, coverage, and experimental dimensions at the first real adapter prevents later audit gaps
without prematurely building pricing, dashboards, or an Agent-ranking system.

Keeping telemetry outside default Runtime context prevents audit data from becoming hidden planning
authority or consuming the bounded context reserved for the current operation.

## Consequences

- The first real Provider is incomplete if it discards usage that its supported interface exposes.
- A Provider with only aggregate usage remains valid when it records `aggregate_only` rather than
  pretending to expose a complete request tree.
- Run, WorkUnit, and ChangeSet totals are later derived queries over immutable references, not
  mutable lifecycle authority.
- Pricing, billing, budget enforcement, dashboards, retention policy, and effectiveness comparison
  remain deferred.
- Representative-sample comparison must later define controlled cohorts and cannot infer one
  universal Agent quality score.
