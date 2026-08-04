# Current State

Updated: 2026-08-04

This projects accepted direction, implementation, active gaps, and the next task. `SPEC.md` owns
the contract; Decisions own rationale; WorkItems and Git own implementation evidence.

## Current Baseline

- WI-0001 through WI-0008 and WI-0010 through WI-0013 are landed. WI-0009-v3 remains unplanned and
  paused with external AgentProfile revision 2 `host_user` selected.
- Agent Runtimes own semantic work. ChangeFleet owns cross-repository authorization, revisions,
  scheduling, exact Git and Bundle subjects, evidence, recovery, and human gates.

## Accepted Product Direction

- Managed Runs receive compact current control facts; referenced history stays out of default
  context. ChangeFleet does not maintain registered-repository Harness.
- Agent Profiles select explicit host-user or constrained Runtime permissions. Planning writes are
  non-authoritative; execution accepts only its isolated WorkUnit workspace Git subject.
- Initial context targets at most 70 percent usage and records `enforced | estimated | unknown`.
- Tracker integrations remain edge projections, not ChangeSet authority.
- A Project binds registered Repositories. A ChangePlan selects a non-empty subset;
  single-Repository work is valid and scope expansion remains typed.
- ChangeSet creation freezes visible Repositories, branches, base SHAs, and targets. Agents cannot
  replace them and dirty checkout files are excluded.
- Optional confirmed Repository Harness policies may freeze contained Git-ignored Codex resources
  as immutable ChangeSet input; they are never reread live, written back, or delivered.
- Replanning continues the same ChangeSet with superseded attempts preserved. Post-Provider
  checkpoints preserve exact Git subjects before validation; exact resume never repeats Runtime
  work, and bounded revision feedback is current context.
- WorkUnits may run in parallel; delivery to one `repository_id + target_ref` is serialized, and
  cross-repository compensation never promises universal atomic rollback.
- Accepted GitHub-first delivery publishes exact Candidates to PRs, leaves merge to humans, and
  records exact external results through UI-ready shared application operations.
- The accepted next surface is a foreground loopback review and delivery console with bounded
  ChangeSet discovery, exact Bundle decisions, delivery actions, and no CLI invocation.
- Landed slices record Runtime evidence, derive audit views, and expose shared operations through
  one experimental CLI with isolated read-only debug audit.
- The first production Provider uses the pinned Codex SDK, a narrow Runtime port, one fresh thread
  per attempt, structured outcomes, exact-base planning worktrees, and WorkUnit-scoped writes.
- Controller loss abandons incomplete attempts; blind session resume remains deferred.
- Human closure and ordinary later task creation are separate; generic restart and fork are deferred.
- Decision 0020 supersedes ChangeFleet-owned Provider Home copying. Local configuration explicitly
  selects an operator-prepared Codex environment; ChangeFleet neither manages its files nor
  overrides its native Windows Sandbox implementation. Clean exact-base retry remains accepted.
- Decision 0021 restores the Conductor-style layer boundary: worktrees isolate development state,
  while an explicit AgentProfile selects Provider-owned host or constrained permissions.
- Execution may report a strict blocked result. Base-equal or empty implementation output is not a
  CandidateCheckpoint and cannot enter validation or review.

## Accepted Decisions

- [0001](decisions/0001-control-plane-boundary.md) sets the control-plane boundary;
  [0002](decisions/0002-changeset-and-bundle-aggregate.md) the aggregate and Bundle;
  [0003](decisions/0003-minimal-repository-catalog.md) the catalog; and
  [0004](decisions/0004-concurrency-delivery-and-compensation.md) concurrency and compensation.
- [0005](decisions/0005-runtime-context-harness-and-capabilities.md) governs context and Harness;
  [0006](decisions/0006-first-vertical-slice-implementation-boundary.md) the first stack;
  [0007](decisions/0007-variable-scope-and-localized-diagnostics.md) variable scope; and
  [0008](decisions/0008-change-set-repository-selection.md) exact base selection.
- [0009](decisions/0009-runtime-observability-evidence-boundary.md) governs Runtime evidence;
  [0010](decisions/0010-first-real-codex-sdk-provider.md) the Codex Provider;
  [0011](decisions/0011-exact-repository-harness-snapshots-and-local-overlays.md) local Harness; and
  [0012](decisions/0012-read-only-runtime-audit-projections.md) audit projections.
- [0013](decisions/0013-local-read-only-audit-entry-point.md) exposes exact audit reads;
  [0014](decisions/0014-shared-application-commands-and-unified-local-cli.md) shared operations;
  [0015](decisions/0015-exact-github-pull-request-delivery.md) GitHub delivery; and
  [0016](decisions/0016-local-review-and-delivery-console.md) the local review console;
  [0017](decisions/0017-post-provider-candidate-finalization-and-recovery.md) finalization recovery;
  [0018](decisions/0018-explicit-changeset-closure.md) explicit closure;
  [0019](decisions/0019-durable-codex-runtime-home-and-pre-candidate-retry.md) clean pre-Candidate
  retry; [0020](decisions/0020-provider-environment-ownership-boundary.md) external Provider
  environment ownership; and [0021](decisions/0021-provider-owned-host-permissions-and-multi-repository-workspaces.md)
  Provider-owned host permissions.

## Repository Design Proposals

- The [Proposal Index](proposals/INDEX.md) owns chronology; Decisions retain superseded, rejected,
  and deferred boundaries.
- Accepted [0014](proposals/0014-local-review-and-delivery-console.md) restarts independently; old
  Candidate `12a7036` remains history. Landed WI-0011 implements Proposal 0016 human closure.
- Accepted [0018](proposals/0018-provider-environment-ownership-and-pre-candidate-retry-correction.md)
  supersedes Proposal 0017's Provider Home mechanism. Landed WI-0012 removes that code while
  retaining blocked, empty-result, and exact retry semantics. V2 closed on its obsolete base; v3
  started from the accepted WI-0012 baseline.
- Accepted [0019](proposals/0019-provider-owned-host-permissions-and-multi-repository-workspaces.md)
  distinguishes development worktrees from OS security. Landed WI-0013 adds explicit trusted-local
  `host_user`; mandatory strong Sandbox enforcement is no longer a first-version prerequisite.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

## Known Limitations

- Git URLs, remote workers, merge, deployment, service graph, and stacked ChangeSets are deferred.
  Console commit `12a7036` has security, lockfile, and real-Chromium blockers.
- Native-Windows single-Repository use passed; other hosts and paid multi-Repository work are unverified.
- Codex SDK usage is aggregate-only; effective model and universal host read-denial remain unknown.
- The old WI-0009 attempt has no Bundle; its invalid command and review remain history. V2 closed
  with a clean base-equal workspace and no Candidate or Bundle.
- V3 planning failed under historical revision 1 `operation_scoped` before producing a Plan.
  Revision 2 `host_user` is selected, but no real retry has verified UAC absence.
- Runtime Kit, Codex App Server, another Provider, Linear, pricing, dashboards, and continuous
  context enforcement are deferred.

## Next Recommended Task

Revise WI-0009-v3's unplanned Repository selection to the latest accepted baseline before one
planning retry. Do not reuse its obsolete `f0dbe4f` base.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep accepted baseline, branch-local work, open gaps, and one next task distinct;
- put detailed evidence in the active WorkItem and Git rather than this projection.
