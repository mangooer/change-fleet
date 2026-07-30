# Current State

Updated: 2026-07-30

This document is the concise projection of ChangeFleet's accepted direction, current
implementation, active gaps, and next recommended work.

`SPEC.md` owns the accepted product contract. Decisions own durable rationale. Repository Design
Proposals preserve chronological changes to this repository. Development WorkItems and Git history
own repository implementation evidence.

## Current Baseline

- The canonical baseline remains the initial project Harness; WI-0001 is accepted complete but
  remains uncommitted and unlanded.
- The development Harness uses a compact root instruction file, this current projection, one active
  Development WorkItem or Repository Design Proposal, and targeted authority loading. `SPEC.md` is
  not read in full for every task.
- Repository Design Proposals and Development WorkItems are repository Harness artifacts. They are
  not ChangeFleet Runtime output; the product Runtime uses ChangeSets, plan revisions, WorkUnits,
  Runs, Candidates, and Bundle records.
- No landed or released product package, public CLI, state compatibility contract, API, or UI
  exists.
- The accepted first stack is one private Node.js 24 LTS ESM JavaScript package with a versioned
  filesystem store, built-in `node:test`, and a test-only application surface.
- Conductor commit `66faac3b16df8b287bae100ec5be82b79d32b872` is behavior reference evidence,
  not state, source, or compatibility authority; ChangeFleet uses a clean adapter.
- Agent Runtimes own semantic work. ChangeFleet owns cross-repository authorization, revisions,
  scheduling, exact Git and Bundle subjects, evidence, recovery, and human gates.

## Accepted Product Direction

- Managed Runs will receive a compact Control Contract and generated current Run Context Projection;
  complete history remains referenced durable state rather than default Agent context.
- ChangeFleet does not create or maintain Harness in registered repositories.
- Agent Profiles select provider-native Runtime, model, capability, and optional Skill settings.
- Planning is read-only; execution writes only to its isolated WorkUnit workspace.
- Initial context targets at most 70 percent usage and records `enforced | estimated | unknown`.
- Tracker integrations remain edge projections, not ChangeSet authority.
- A Project may bind one or more explicitly registered Repositories using minimal descriptions and
  locators. Relationships are hints, not control authority.
- A ChangePlan authorizes a non-empty subset of explicitly registered Project Repositories. A
  single-Repository CandidateBundle is valid; an unregistered Repository remains a typed scope
  expansion request.
- The first locator is a local path resolved to a Git root and exact clean base commit; dirty local
  files are never silently included.
- Terse and discussed requests share one ChangeIntent-to-ChangePlan pipeline. Multi-repository and
  other high-risk or expanded scopes require explicit confirmation by default.
- Replanning is a first-class continuation of the same ChangeSet. Earlier attempts remain evidence
  and may be superseded without creating a duplicate task.
- Repository execution produces exact Candidates. Human review applies to an immutable
  CandidateBundle.
- WorkUnits may execute in parallel. Delivery to the same `repository_id + target_ref` is
  serialized and revalidated when the destination moves.
- Cross-repository rollback is phase-specific and saga-like. The product does not promise a
  universal atomic transaction.
- The first combined check receives an immutable validation manifest through
  `CHANGEFLEET_VALIDATION_MANIFEST`; Bundle assembly follows finalized exact-subject evidence.
- ChangeFleet-generated diagnostics retain stable error codes and use `zh-CN` as the default
  localized display language, with `en` fallback. Raw external output remains evidence.

## Accepted Decisions

- [0001](decisions/0001-control-plane-boundary.md): keep semantic Agent work outside the
  deterministic control plane.
- [0002](decisions/0002-changeset-and-bundle-aggregate.md): make ChangeSet the aggregate root and
  CandidateBundle the review subject.
- [0003](decisions/0003-minimal-repository-catalog.md): begin with minimal Project descriptions
  and local-path Repository locators.
- [0004](decisions/0004-concurrency-delivery-and-compensation.md): separate parallel execution from
  destination serialization and use phase-specific compensation semantics.
- [0005](decisions/0005-runtime-context-harness-and-capabilities.md): use a Control Contract,
  current Run Context Projection, repository-native Harness, Agent Profiles, scoped capabilities,
  and honest initial context evidence.
- [0006](decisions/0006-first-vertical-slice-implementation-boundary.md): use Node.js 24 ESM
  JavaScript, a versioned filesystem store, test-only application and fake Runtime ports, a
  validation manifest, and a clean RepositoryWorker adapter for the first slice.
- [0007](decisions/0007-variable-scope-and-localized-diagnostics.md): distinguish Project catalog
  scope from exact ChangePlan scope, allow one or more WorkUnits, and localize
  ChangeFleet-generated diagnostics.

## Repository Design Proposals

- [Proposal 0001](proposals/0001-local-two-repository-vertical-slice.md) defines the first local
  two-repository vertical slice. It is accepted, and implementation is tracked by
  [WI-0001](work-items/WI-0001-local-two-repository-vertical-slice.md), currently `complete`.
- [Proposal 0003](proposals/0003-harness-ownership-and-runtime-context.md) preserves accepted
  Runtime context and Harness design history; Decision 0005 owns durable rationale.
- [Proposal 0002](proposals/0002-bounded-runtime-context-and-optional-workflow-skill.md) preserves
  the superseded single-Skill discussion and is not current design authority.
- [Proposal 0004](proposals/0004-variable-scope-and-localized-diagnostics.md) is accepted and
  recorded by Decision 0007. WI-0001's implementation of its variable-scope and
  localized-diagnostic requirements is complete and user-accepted but unlanded.
- [Proposal 0005](proposals/0005-runtime-cost-and-effectiveness-observability.md) is proposed. It
  stages audit requirements by prerequisite: current fake-data/context exclusions, immutable raw
  usage with the first real Provider, later aggregation, and effectiveness comparison only after
  representative samples. It is not implementation authority.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

This is deferred, not implicit implementation scope.

## Known Limitations

- WI-0001's accepted private package and versioned state remain uncommitted implementation
  evidence, not a landed or released compatibility contract.
- No Git URL materialization, remote worker, PR integration, automatic merge, deployment, browser
  UI, service graph, or stacked ChangeSet support is accepted.
- No shared Conductor extraction is planned; Decision 0006 requires a clean adapter.
- WI-0001 locally proves the Control Contract, current projections, scoped fake Runtime, and initial
  budget evidence; no production Provider proof exists.
- Runtime Skill Kit packaging, real Provider adapters, Linear integration, and continuous context
  enforcement are explicitly deferred beyond the deterministic first slice.

## Next Recommended Task

Land [WI-0001](work-items/WI-0001-local-two-repository-vertical-slice.md)'s exact accepted local
changes in Git without extending scope. Do not combine landing with any deferred Provider, Skill,
tracker, telemetry, CLI, UI, delivery, or database boundary.

## Maintenance Contract

Before reporting changes ready:

- follow the progressive-loading and size rules in `docs/harness.md`;
- update only current-state entries affected by the change;
- never describe proposed or branch-local behavior as implemented baseline;
- keep accepted work separate from open questions;
- move detailed evidence to Development WorkItems, proposals, and Git history;
- preserve a single explicit next recommended task.
