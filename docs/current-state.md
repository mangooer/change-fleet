# Current State

Updated: 2026-08-03

This projects accepted direction, implementation, active gaps, and the next task. `SPEC.md` owns
the contract; Decisions own rationale; WorkItems and Git own implementation evidence.

## Current Baseline

- WI-0001 through WI-0006 are accepted and landed.
- The Harness loads root rules, this projection, one active artifact, and targeted authority.
- No released package, public CLI, compatibility contract, API, or UI exists.
- The accepted private Node.js 24 ESM package uses a versioned filesystem store, `node:test`,
  pinned `@openai/codex-sdk@0.146.0`, one real Codex adapter, and test-only scripted Runtime.
- Agent Runtimes own semantic work. ChangeFleet owns cross-repository authorization, revisions,
  scheduling, exact Git and Bundle subjects, evidence, recovery, and human gates.

## Accepted Product Direction

- Managed Runs receive a compact Control Contract and current projection; complete history remains
  durable by reference rather than default Agent context.
- ChangeFleet does not create or maintain registered-repository Harness.
- Agent Profiles select provider-native Runtime, model, capability, and optional Skill settings.
- Planning is read-only; execution writes only to its isolated WorkUnit workspace.
- Initial context targets at most 70 percent usage and records `enforced | estimated | unknown`.
- Tracker integrations remain edge projections, not ChangeSet authority.
- A Project binds registered Repositories. A ChangePlan selects a non-empty subset;
  single-Repository work is valid and scope expansion remains typed.
- ChangeSet creation freezes visible Repositories, branches, base SHAs, and targets. Agents cannot
  replace them and dirty checkout files are excluded.
- Optional confirmed Repository Harness policies may freeze contained Git-ignored Codex resources
  as immutable ChangeSet input; they are never reread live, written back, or delivered.
- Replanning continues the same ChangeSet with superseded attempts preserved. Execution produces
  exact Candidates, immutable Bundle review subjects, and exact-subject validation evidence.
- WorkUnits may run in parallel; delivery to one `repository_id + target_ref` is serialized, and
  cross-repository compensation never promises universal atomic rollback.
- WI-0003 records Runtime identity, timing, usage, profile, context, and Harness evidence; WI-0005
  derives bounded audit projections; WI-0006 exposes exact-id local JSON inspection outside Agent
  context.
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
- [0011](decisions/0011-exact-repository-harness-snapshots-and-local-overlays.md): default to
  exact-base Harness and permit only explicit immutable local overlays with no non-Git writeback.
- [0012](decisions/0012-read-only-runtime-audit-projections.md): derive isolated, read-only Run and
  ChangeSet audit views from immutable evidence.
- [0013](decisions/0013-local-read-only-audit-entry-point.md): expose exact-id projections through
  one package-private, explicitly rooted, zero-write local command.

## Repository Design Proposals

- Proposals [0001](proposals/0001-local-two-repository-vertical-slice.md),
  [0004](proposals/0004-variable-scope-and-localized-diagnostics.md), and
  [0006](proposals/0006-change-set-base-selection-and-revision.md) landed through WI-0001/2;
  [0007](proposals/0007-first-real-codex-sdk-provider.md) and
  [0009](proposals/0009-exact-repository-harness-snapshots-and-local-overlays.md) through WI-0003/4.
- [0005](proposals/0005-runtime-cost-and-effectiveness-observability.md) accepts raw audit evidence;
  [0010](proposals/0010-read-only-runtime-audit-projections.md) accepts read-only projections by
  Decision 0012 and is implemented by landed WI-0005; comparison is deferred.
- [0011](proposals/0011-local-read-only-audit-entry-point.md) accepts package-private exact-id
  inspection and is implemented by landed WI-0006.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

## Known Limitations

- WI-0004's private schema v3 is landed but remains outside any released compatibility contract.
- Git URLs, remote workers, PRs, merge, deployment, UI, service graph, and stacked ChangeSets are
  not accepted.
- WI-0003 proved native-Windows local-ChatGPT single-Repository use. Other auth/hosts, hostile
  access, hard interruption, and paid multi-Repository work remain unverified.
- Codex SDK usage is aggregate-only; effective model and universal host read-denial remain unknown.
- Native Windows execution requires a pre-provisioned elevated Codex sandbox and fails closed
  without it.
- Local workspaces use the registered Git object database; Git URL and remote-worker work need new
  authority.
- Local ignored Codex Harness is proven; hosted retention, encryption, and actual-load evidence are
  deferred.
- Runtime Kit, App Server, another Provider, Linear, pricing, dashboards, and continuous context
  enforcement are deferred.

## Next Recommended Task

Discuss and select the next independently bounded vertical slice. No later analytics or public
operator surface is authorized.

## Maintenance Contract

Before reporting changes ready:

- follow the progressive-loading and size rules in `docs/harness.md`;
- update only current-state entries affected by the change;
- never describe proposed or branch-local behavior as implemented baseline;
- keep accepted work separate from open questions;
- move detailed evidence to Development WorkItems, proposals, and Git history;
- preserve a single explicit next recommended task.
