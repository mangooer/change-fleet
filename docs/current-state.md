# Current State

Updated: 2026-08-03

This projects accepted direction, implementation, active gaps, and the next task. `SPEC.md` owns
the contract; Decisions own rationale; WorkItems and Git own implementation evidence.

## Current Baseline

- WI-0001 through WI-0008 are accepted and landed.
- The private Node.js 24 ESM package has a versioned filesystem store, `node:test`, pinned
  `@openai/codex-sdk@0.146.0`, one real Codex adapter, test-only scripted Runtime, and one
  experimental CLI; no released package, stable CLI, API, or UI exists.
- Agent Runtimes own semantic work. ChangeFleet owns cross-repository authorization, revisions,
  scheduling, exact Git and Bundle subjects, evidence, recovery, and human gates.

## Accepted Product Direction

- Managed Runs receive a compact Control Contract and current projection; referenced history stays
  out of default context. ChangeFleet neither creates nor maintains registered-repository Harness.
- Agent Profiles select Runtime settings. Planning is read-only; execution writes only to its
  isolated WorkUnit workspace.
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
- Accepted GitHub-first delivery publishes exact Candidates to PRs, leaves merge to humans, and
  records exact external results through UI-ready shared application operations.
- WI-0003 records Runtime evidence; WI-0005 derives audit views; WI-0007 exposes shared operations
  through one experimental CLI with read-only debug audit.
- The first production Provider uses the pinned Codex SDK, a narrow Runtime port, one fresh thread
  per attempt, structured outcomes, exact-base planning worktrees, and WorkUnit-scoped writes.
- Controller loss abandons an incomplete attempt; blind session resume and continuous context
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
- [0005](decisions/0005-runtime-context-harness-and-capabilities.md): use bounded projections,
  repository Harness, Agent Profiles, scoped capabilities, and honest context evidence.
- [0006](decisions/0006-first-vertical-slice-implementation-boundary.md): use Node.js 24 ESM, a
  versioned filesystem store, test-only fakes, validation manifest, and RepositoryWorker adapter.
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
- [0011](decisions/0011-exact-repository-harness-snapshots-and-local-overlays.md): use exact-base
  Harness and only explicit immutable local overlays with no non-Git writeback.
- [0012](decisions/0012-read-only-runtime-audit-projections.md) derives audit views;
  [0013](decisions/0013-local-read-only-audit-entry-point.md) exposes exact-id local inspection;
  [0014](decisions/0014-shared-application-commands-and-unified-local-cli.md) accepts shared
  application semantics and one experimental CLI; [0015](decisions/0015-exact-github-pull-request-delivery.md)
  accepts exact PR publication, human merge, and reconciliation.

## Repository Design Proposals

- Proposals [0001](proposals/0001-local-two-repository-vertical-slice.md),
  [0004](proposals/0004-variable-scope-and-localized-diagnostics.md), and
  [0006](proposals/0006-change-set-base-selection-and-revision.md) landed through WI-0001/2;
  [0007](proposals/0007-first-real-codex-sdk-provider.md) and
  [0009](proposals/0009-exact-repository-harness-snapshots-and-local-overlays.md) through WI-0003/4.
- [0005](proposals/0005-runtime-cost-and-effectiveness-observability.md) accepts raw audit evidence;
  [0010](proposals/0010-read-only-runtime-audit-projections.md) accepts read-only projections by
  Decision 0012 and is implemented by landed WI-0005; comparison is deferred.
- [0011](proposals/0011-local-read-only-audit-entry-point.md) is landed through WI-0006;
  [0012](proposals/0012-shared-application-commands-and-unified-local-cli.md) through WI-0007;
  [0013](proposals/0013-exact-github-pull-request-delivery.md) through WI-0008.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

## Known Limitations

- Private schema v4 has no compatibility promise. Deterministic GitHub PR delivery is landed, but
  a real GitHub external-write gate remains unverified.
- Git URLs, remote workers, automatic merge, deployment, UI, service graph, and stacked ChangeSets
  remain deferred.
- WI-0003 proved native-Windows local-ChatGPT single-Repository use. Other auth/hosts, hostile
  access, hard interruption, and paid multi-Repository work remain unverified.
- Codex SDK usage is aggregate-only; effective model and universal host read-denial remain unknown.
- Native Windows needs a pre-provisioned elevated sandbox; capture recurring setup prompts before
  changing the no-full-access-fallback policy.
- Local workspaces use the registered Git object database; Git URL and remote-worker work need new
  authority.
- Local ignored Codex Harness is proven; hosted retention, encryption, and actual-load evidence are
  deferred.
- Runtime Kit, App Server, another Provider, Linear, pricing, dashboards, and continuous context
  enforcement are deferred.

## Next Recommended Task

Discuss the smallest local UI and transport boundary as a new Repository Design Proposal, reusing
the landed shared application and delivery operations. Real GitHub smoke validation requires
separate repository, branch-namespace, and cleanup authority.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep accepted baseline, branch-local work, open gaps, and one next task distinct;
- put detailed evidence in the active WorkItem and Git rather than this projection.
