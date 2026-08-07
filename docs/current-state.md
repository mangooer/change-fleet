# Current State

Updated: 2026-08-07

This projects accepted direction, implementation, active gaps, and the next task. `SPEC.md` owns
the contract; Decisions own rationale; WorkItems and Git own implementation evidence.

## Current Baseline

- WI-0001 through WI-0018 are complete. Abandoned predecessor attempts remain audit history rather
  than current authority.
- WI-0019 entered local `main` at `bde27ff`; Decision 0025 replaces operation-specific repair states
  with coarse phases, generic Runs, Feedback, Gates, and one recovery path.
- WI-0020 entered local `main` at `3da554f`; its Node 24 deterministic and real Codex gates pass.
- WI-0021 is accepted and branch-locally complete on
  `codex/proposal-0025-bundle-quality-review`; its Node 24 deterministic and real Codex gates pass,
  but it is not a landed baseline.
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
- Exact approval of a planning message creates a Plan revision. Ordinary feedback handling stays
  under it; feedback is assessed, and only contract invalidation returns to planning.
- WorkUnits may run in parallel; delivery to one `repository_id + target_ref` is serialized, and
  cross-repository compensation never promises universal atomic rollback.
- GitHub delivery publishes exact Candidates to human-merged PRs and records bounded results.
- The accepted next surface is a foreground loopback review and delivery console with bounded
  ChangeSet discovery, exact Bundle decisions, delivery actions, and no CLI invocation.
- Landed slices expose shared operations through one experimental CLI and isolated debug audit.
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
- Candidate verification freezes policy and exact-checkpoint admission. Its optional read-only
  Runtime binds requested-check evidence and separate usage, and can retry without repeating a
  passed repository check. Decision 0025 models actionable review as Feedback: the WorkUnit returns
  to execution, another exact checkpoint returns it to verification, and Gates or Blockers remain
  separate from lifecycle phase.
- Decision 0026 defines Plan-confirmed Agentic supervision: the
  deterministic kernel offers exact authorized actions, forced actions avoid a model call, and a
  read-only Supervisor Agent selects only when bounded semantic alternatives remain.
- Decision 0027 adds optional Plan-confirmed Bundle quality review. One exact read-only Review Run
  may recommend passage, route bounded Feedback, or request a Gate; human Bundle acceptance remains
  explicit.

## Accepted Decisions

- The [Decision Index](decisions/README.md) owns the complete rationale map. Latest accepted
  Decision 0027 adds Bundle-level independent quality review without changing Decision 0025's
  coarse phases or common Run status lifecycle.

## Repository Design Proposals

- The [Proposal Index](proposals/INDEX.md) owns chronology; Decisions retain superseded, rejected,
  and deferred boundaries.
- Accepted Proposals through 0021 are landed through WI-0015. Accepted
  [0022](proposals/0022-risk-adaptive-candidate-verification.md) is recorded by Decision 0024 and
  has its first three slices completed through WI-0016, WI-0017, and WI-0018.
- Accepted [0023](proposals/0023-unified-stage-and-run-lifecycle.md) is recorded by Decision 0025.
  Atomic replacement [WI-0019](work-items/WI-0019-unified-stage-and-run-lifecycle.md) is landed.
- Accepted [0024](proposals/0024-policy-governed-agentic-supervision.md) is recorded by Decision
  0026. Its first single-Candidate autonomous vertical slice is confirmed as
  [WI-0020](work-items/WI-0020-plan-confirmed-agentic-supervision-vertical-slice.md), `done`.
- Accepted [0025](proposals/0025-bundle-level-independent-quality-review.md) is recorded by Decision
  0027. Its unique implementation slice is confirmed as
  [WI-0021](work-items/WI-0021-bundle-level-independent-quality-review.md), `done` on its branch.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

## Known Limitations

- Git URLs, remote workers, merge, deployment, service graph, and stacked ChangeSets are deferred.
- Native-Windows single-Repository use passed; other hosts and paid multi-Repository work are unverified.
- Codex SDK usage is aggregate-only; effective model and universal host read-denial remain unknown.
- Bundle-level independent quality review currently supports one selected reviewer and bounded
  repair. Multiple reviewers, Candidate comparison, normalized scoring, and automatic model routing
  remain deferred. Local UI support for arbitrary Feedback and Gate resolution stays intentionally
  minimal; transport operations already share the same application boundary.
- Provider-native live feedback steering and durable session continuation remain optimizations;
  current feedback is queued for another same-phase Run.
- Simultaneous independent WorkUnit Provider dispatch remains unproven; the foreground scheduler
  still advances exact eligible units serially.
- Runtime Kit, Codex App Server, another Provider, Linear, pricing, dashboards, and continuous
  context enforcement are deferred.

## Next Recommended Task

Integrate WI-0021's accepted exact branch commit before selecting another product slice from the
new landed baseline.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep accepted baseline, branch-local work, open gaps, and one next task distinct;
- put detailed evidence in the active WorkItem and Git rather than this projection.
