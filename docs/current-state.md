# Current State

Updated: 2026-08-04

This projects accepted direction, implementation, active gaps, and the next task. `SPEC.md` owns
the contract; Decisions own rationale; WorkItems and Git own implementation evidence.

## Current Baseline

- WI-0001 through WI-0008 and WI-0010 are accepted and landed. WI-0009 remains the active
  unfinished implementation WorkItem.
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
  [0016](decisions/0016-local-review-and-delivery-console.md) the local review console; and
  [0017](decisions/0017-post-provider-candidate-finalization-and-recovery.md) finalization recovery.

## Repository Design Proposals

- The [Proposal Index](proposals/INDEX.md) owns chronology. Accepted implementation through Proposal
  0013 is represented by landed WI-0001 through WI-0008; superseded, rejected, and deferred
  boundaries remain explicit there and in their Decisions.
- [0014](proposals/0014-local-review-and-delivery-console.md) is accepted. WI-0009 legacy recovery
  preserved exact commit `12a7036` as a Candidate without another Runtime Run, and repository
  validation passed, but its confirmed combined command failed before Bundle creation because it
  requires repository cwd instead of the specified control-owned validation directory.
  Accepted [0015](proposals/0015-post-provider-candidate-finalization-and-recovery.md) and landed
  WI-0010 now provide the checkpoint, exact resume, bounded feedback, and narrow shim prerequisite.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

## Known Limitations

- Landed private schema v5 has no compatibility promise. Deterministic GitHub PR delivery is
  landed, while its real gate is open.
- Git URLs, remote workers, automatic merge, deployment, service graph, and stacked ChangeSets
  remain deferred. The console exists only as unaccepted dogfood commit `12a7036`; review found
  security, strict-transport, reproducible-lockfile, and real-Chromium gate blockers.
- WI-0003 proved native-Windows local-ChatGPT single-Repository use. Other auth/hosts, hostile
  access, hard interruption, and paid multi-Repository work remain unverified.
- Codex SDK usage is aggregate-only; effective model and universal host read-denial remain unknown.
- WI-0009 has no exact Bundle: its current state is `failed`, its confirmed combined command cannot
  run from the specified validation directory, and the current public state machine has no
  pre-Bundle transition back to a human-confirmed revised plan. Validation evidence records the
  outer npm shim but not the nested Node 24 child locator enforced by the repository check.
- Native Windows needs a pre-provisioned elevated sandbox. The explicit administrator refresh
  necessarily raised UAC; the user still observed a consent prompt afterward, but its exact trigger
  was not captured. Recurring managed-Run prompts remain unresolved and grant no product authority.
- Local workspaces use the registered Git object database; Git URL and remote-worker work need new
  authority.
- Local ignored Codex Harness is proven; hosted retention, encryption, and actual-load evidence are
  deferred.
- Runtime Kit, Codex App Server, another Provider, Linear, pricing, dashboards, and continuous
  context enforcement are deferred.

## Next Recommended Task

Discuss a narrow Proposal 0016 for human-confirmed pre-Bundle plan correction after deterministic
validation failure. Preserve the exact Candidate, checkpoint, attempts, and zero-Runtime recovery;
never mutate the confirmed command or persisted state in place. GitHub publication remains a
separate gate.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep accepted baseline, branch-local work, open gaps, and one next task distinct;
- put detailed evidence in the active WorkItem and Git rather than this projection.
