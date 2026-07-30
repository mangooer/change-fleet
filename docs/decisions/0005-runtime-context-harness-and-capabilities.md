# 0005: Runtime Context, Harness Ownership, And Capability Dispatch

Status: Accepted

Date: 2026-07-30

Source: Repository Design Proposal 0003

## Decision

ChangeFleet dispatches Agent work through four separate layers:

1. a compact, versioned Control Contract;
2. a generated current Run Context Projection;
3. repository-native Harness reachable from the exact frozen Git base;
4. optional Runtime-native, operation-scoped Skills.

The Control Contract and current projection must be sufficient when repository Harness and optional
Skills are absent. Complete plan, attempt, transcript, and evidence history remains durable but is
loaded only by reference when needed.

ChangeFleet never implicitly creates, copies, repairs, or updates Harness in a registered
repository. A future explicit bootstrap tool would be a separate operator action and proposal.

An `AgentProfile` selects a Runtime adapter and provider-native model, reasoning, capability, and
optional Skill settings. The ChangeSet aggregate does not contain a universal provider model field.

Default capabilities are operation-scoped:

- planning receives read-only access to explicitly authorized repository bases;
- WorkUnit execution receives read/write access only to its isolated repository workspace;
- review receives read-only access to exact CandidateBundle subjects and evidence;
- control changes cross typed ChangeFleet commands rather than raw store or filesystem access.

Tracker systems such as Linear may be intake and projection surfaces. They are not authority for
plan confirmation, repository scope, Candidate identity, or Bundle acceptance.

The initial context target is at most 70 percent usage with at least 30 percent headroom. Evidence
is classified as `enforced`, `estimated`, or `unknown`. This is an initial admission policy unless
an adapter proves observation or control at every later model-request boundary.

## Deferred Implementation

The following are explicitly deferred beyond the deterministic first slice:

- packaging and distributing the optional Runtime Skill Kit;
- a real Codex, Claude, or other production provider adapter;
- Linear or another tracker integration;
- a universal continuous context-usage guarantee.

Proposal 0001 must prove the Control Contract, planning and execution projections, scoped
capabilities, restart reconstruction, and initial context-evidence vocabulary using a deterministic
fake Runtime with the optional Skill Kit disabled.

## Rationale

Current projection plus external durable history preserves auditability without replaying all
history into every prompt. Operation-scoped capabilities keep authorization outside semantic Agent
reasoning. Repository-native Harness avoids a second, stale project authority. Provider-specific
selection stays adaptable without polluting ChangeSet identity.

## Consequences

- Runtime compaction may help execution but is not lifecycle authority.
- A model, Skill identity, base SHA, plan revision, or authorization change creates a new Run
  attempt and context-budget decision.
- Missing repository Harness is permitted and explicit.
- Agents may request scope or plan changes but cannot approve them.
- Core does not install Skills or maintain a universal model catalog.
- Detailed history uses structured records and linked artifacts rather than one prompt document per
  event.
