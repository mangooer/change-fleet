# Current State

Updated: 2026-07-31

This document is the concise projection of ChangeFleet's accepted direction, current
implementation, active gaps, and next recommended work.

`SPEC.md` owns the product contract, Decisions own rationale, proposals preserve design history, and
Development WorkItems plus Git own implementation evidence.

## Current Baseline

- WI-0001 through WI-0003 are accepted and landed; Git history owns their exact implementation
  commits.
- The development Harness uses a compact root instruction file, this current projection, one active
  Development WorkItem or Repository Design Proposal, and targeted authority loading. `SPEC.md` is
  not read in full for every task.
- No released product package, public CLI, state compatibility contract, API, or UI exists.
- The accepted stack is one private Node.js 24 LTS ESM package with a versioned filesystem store,
  built-in `node:test`, pinned `@openai/codex-sdk@0.146.0`, a real Codex Runtime adapter, and
  scripted Runtime support reachable only from tests.
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
- A Project binds one or more explicitly registered Repositories. A ChangePlan selects a non-empty
  subset; single-Repository work is valid and scope expansion remains typed.
- ChangeSet creation freezes the planning-visible set, branches, exact base SHAs, and targets.
  Dirty checkout files are excluded and an Agent cannot replace this authority.
- Replanning continues the same ChangeSet with superseded attempts preserved. Execution produces
  exact Candidates, immutable Bundle review subjects, and exact-subject validation evidence.
- WorkUnits may run in parallel; delivery to one `repository_id + target_ref` is serialized, and
  cross-repository compensation never promises universal atomic rollback.
- The WI-0003 implementation records every real Runtime call's immutable invocation identity,
  timing, available Provider
  usage, honest confidence and coverage, profile and projection identity, and bounded raw
  references outside ordinary Agent context.
- The accepted first production Provider uses the pinned Codex TypeScript SDK behind the narrow
  Runtime port, one fresh Provider thread per Run attempt, strict structured outcomes, exact-base
  read-only planning worktrees, and WorkUnit-scoped execution access.
- Controller loss abandons the first Provider's incomplete attempt; blind Provider-session resume,
  App Server, a second Provider, pricing, effectiveness comparison, and continuous context
  enforcement remain deferred.

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
- [0008](decisions/0008-change-set-repository-selection.md): select Repository branches when a
  ChangeSet is created, freeze exact bases before planning, and revise selection in the same
  aggregate.
- [0009](decisions/0009-runtime-observability-evidence-boundary.md): keep Runtime audit data out of
  default Agent context and record immutable usage observations with honest coverage.
- [0010](decisions/0010-first-real-codex-sdk-provider.md): use Codex TypeScript SDK for the first
  real Provider with fresh Run threads and exact-base planning worktrees.

## Repository Design Proposals

- Proposals [0001](proposals/0001-local-two-repository-vertical-slice.md),
  [0004](proposals/0004-variable-scope-and-localized-diagnostics.md), and
  [0006](proposals/0006-change-set-base-selection-and-revision.md) are accepted and implemented by
  landed WI-0001 and WI-0002.
- [Proposal 0005](proposals/0005-runtime-cost-and-effectiveness-observability.md) is accepted only
  for raw first-Provider evidence and audit isolation. Pricing, aggregation, retention, dashboards,
  budgets, and effectiveness comparison have no implementation authority.
- [Proposal 0007](proposals/0007-first-real-codex-sdk-provider.md) is accepted and tracked by
  [WI-0003](work-items/WI-0003-first-real-codex-sdk-provider.md), `done`.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

## Known Limitations

- WI-0002's private schema v2 is landed but remains outside any released compatibility contract.
- No Git URL materialization, remote worker, PR integration, automatic merge, deployment, browser
  UI, service graph, or stacked ChangeSet support is accepted.
- WI-0003 has one real native-Windows, local-ChatGPT, single-Repository Provider proof. API-key
  authentication, non-Windows sandboxing, malicious out-of-scope access, real cancellation, hard
  process death, and paid multi-Repository execution remain unverified.
- Codex SDK usage is aggregate-only and the observable effective model remains unknown. The stable
  SDK read-only sandbox proves no writes to the exact planning worktrees, but does not establish a
  universal deny-read boundary against every other host-readable path.
- Native Windows execution requires a pre-provisioned elevated Codex sandbox; isolated attempts
  copy only its startup state and fail closed without it.
- The accepted local workspaces use the registered Repository's Git object database. A
  ChangeFleet-owned object store and clone-versus-worktree materialization policy remain deferred;
  they require a proposal before Git URL or remote-worker implementation.
- Runtime Skill Kit packaging, App Server, a second Provider, Linear, pricing/effectiveness
  analysis, derived cost totals, and continuous context enforcement remain deferred.

## Next Recommended Task

Discuss and select the next independently bounded vertical slice before creating another Repository
Design Proposal or Development WorkItem. No later implementation stage is currently authorized.

## Maintenance Contract

Before reporting changes ready:

- follow the progressive-loading and size rules in `docs/harness.md`;
- update only current-state entries affected by the change;
- never describe proposed or branch-local behavior as implemented baseline;
- keep accepted work separate from open questions;
- move detailed evidence to Development WorkItems, proposals, and Git history;
- preserve a single explicit next recommended task.
