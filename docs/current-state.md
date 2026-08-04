# Current State

Updated: 2026-08-04

This projects accepted direction, implementation, active gaps, and the next task. `SPEC.md` owns
the contract; Decisions own rationale; WorkItems and Git own implementation evidence.

## Current Baseline

- WI-0001 through WI-0008 and WI-0010 through WI-0012 are accepted and landed. WI-0009 remains
  unfinished; its old Runtime ChangeSet is abandoned and `changefleet-wi-0009-v2` is newly created.
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
- Replanning continues the same ChangeSet with superseded attempts preserved. Post-Provider
  checkpoints preserve exact Git subjects before validation; exact resume never repeats Runtime
  work, and bounded revision feedback is current context.
- WorkUnits may run in parallel; delivery to one `repository_id + target_ref` is serialized, and
  cross-repository compensation never promises universal atomic rollback.
- Accepted GitHub-first delivery publishes exact Candidates to PRs, leaves merge to humans, and
  records exact external results through UI-ready shared application operations.
- The accepted next surface is a foreground loopback review and delivery console with bounded
  ChangeSet discovery, exact Bundle decisions, delivery actions, and no CLI invocation.
- WI-0003 records Runtime evidence; WI-0005 derives audit views; WI-0007 exposes shared operations
  through one experimental CLI with read-only debug audit.
- The first production Provider uses the pinned Codex SDK, a narrow Runtime port, one fresh thread
  per attempt, structured outcomes, exact-base planning worktrees, and WorkUnit-scoped writes.
- Controller loss abandons an incomplete attempt; blind session resume and continuous context
  enforcement remain deferred.
- Closing an unfinished quiescent pre-delivery task and ordinarily creating a later exact-base task
  are separate actions; generic resume, rewind, restart, and fork remain deferred.
- Decision 0020 supersedes ChangeFleet-owned Provider Home copying. Local configuration explicitly
  selects an operator-prepared Codex environment; ChangeFleet never manages its files. Clean
  exact-base pre-Candidate retry remains accepted.
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
  retry; and [0020](decisions/0020-provider-environment-ownership-boundary.md) external Provider
  environment ownership.

## Repository Design Proposals

- The [Proposal Index](proposals/INDEX.md) owns chronology. Accepted implementation through Proposal
  0013 is represented by landed WI-0001 through WI-0008; superseded, rejected, and deferred
  boundaries remain explicit there and in their Decisions.
- Accepted [0014](proposals/0014-local-review-and-delivery-console.md) is restarting in a fresh
  ChangeSet. The old attempt and exact Candidate `12a7036` remain immutable history rather than
  input to the new task. Accepted
  [0016](proposals/0016-explicit-changeset-closure.md) is implemented by landed WI-0011, adding
  human closure before the user creates a fresh task.
- Accepted [0018](proposals/0018-provider-environment-ownership-and-pre-candidate-retry-correction.md)
  supersedes Proposal 0017's Provider Home mechanism. Landed WI-0012 removes that code while
  retaining blocked, empty-result, and exact retry semantics. WI-0009-v2 remains blocked.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

## Known Limitations

- Git URLs, remote workers, automatic merge, deployment, service graph, and stacked ChangeSets
  remain deferred. The console exists only as unaccepted dogfood commit `12a7036`; review found
  security, strict-transport, reproducible-lockfile, and real-Chromium gate blockers.
- WI-0003 proved native-Windows local-ChatGPT single-Repository use. Other auth/hosts, hostile
  access, hard interruption, and paid multi-Repository work remain unverified.
- Codex SDK usage is aggregate-only; effective model and universal host read-denial remain unknown.
- The abandoned WI-0009 attempt has no exact Bundle. Its invalid combined command and review
  findings remain historical evidence. The new ChangeSet has a confirmed plan but its first
  execution produced no Candidate or code change.
- WI-0009-v2 proved that a partial Codex Home can retrigger elevated setup and yield an empty
  checkpoint. Copied Sandbox state was incompatible and lacked protected ACL lifecycle. Decision
  0020 returns all Provider host state to the Harness or operator; no later retry ran.
- Runtime Kit, Codex App Server, another Provider, Linear, pricing, dashboards, and continuous
  context enforcement are deferred.

## Next Recommended Task

After the selected Codex environment is healthy, explicitly retry the clean exact-base WI-0009-v2
WorkUnit under Node.js 24. Do not resume its historical empty checkpoint.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep accepted baseline, branch-local work, open gaps, and one next task distinct;
- put detailed evidence in the active WorkItem and Git rather than this projection.
