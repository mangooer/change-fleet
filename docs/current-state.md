# Current State

Updated: 2026-08-11

This project's accepted direction, implementation, active gaps, and the next task. `SPEC.md` owns
the contract; Decisions own rationale; WorkItems and Git own implementation evidence.

## Current Baseline

- This history includes completed WI-0022 through
  [WI-0035](work-items/WI-0035-optional-project-semantic-checks.md): private
  compatibility debt is removed, Proposal 0026's internal split is complete, verification verdicts
  match their strict Runtime contract, exact clean execution retry survives controller restart, and
  disposable reviews use path-safe identities. Agents apply only project-owned repository-native
  requirements; ChangeFleet Core neither defines nor parses target-project Harness formats.
- Structural preflight is mandatory. Project semantic commands are optional Plan selections;
  commandless validation records real attempts without fake command metadata.
- Agent Runtimes own semantic work. ChangeFleet owns cross-repository authorization, revisions,
  scheduling, exact Git and Bundle subjects, evidence, recovery, and human gates.

## Branch-Local Work

- Completed [WI-0036](work-items/WI-0036-candidate-bound-feedback-repair.md) makes selected-check
  timing explicit and preserves the current checkpoint/workspace through Bundle feedback.

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
- A foreground loopback console exposes bounded ChangeSet discovery, exact Bundle decisions, and
  delivery actions through shared operations without invoking the CLI.
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
  passed selected project command. Repository and Candidate-set structural preflight is always
  required; a Plan may explicitly omit an inapplicable semantic command with a rationale. Decision
  0025 models actionable review as Feedback: the WorkUnit returns to execution, another exact
  checkpoint returns it to verification, and Gates or Blockers remain separate from lifecycle
  phase.
- Decision 0026 defines Plan-confirmed Agentic supervision: the
  deterministic kernel offers exact authorized actions, forced actions avoid a model call, and a
  read-only Supervisor Agent selects only when bounded semantic alternatives remain.
- Decision 0027 adds optional Plan-confirmed Bundle quality review. One exact read-only Review Run
  may recommend passage, route bounded Feedback, or request a Gate; human Bundle acceptance remains
  explicit.

## Accepted Decisions

- The [Decision Index](decisions/README.md) owns rationale. Decision 0028 records the internal
  orchestration boundary. Decision 0029 separates mandatory structural preflight from optional
  project-selected semantic commands without changing Decision 0025's lifecycle or Decision 0027's
  review.

## Repository Design Proposals

- The [Proposal Index](proposals/INDEX.md) owns chronology; Decisions retain superseded, rejected,
  and deferred boundaries.
- Accepted Proposals through 0025 are landed through WI-0021. Accepted
  [0026](proposals/0026-shared-application-orchestration-boundary.md) is recorded by Decision 0028;
  its implementation is complete through WI-0029 in this history.
- Accepted [0027](proposals/0027-optional-project-semantic-checks.md) is recorded by Decision 0029
  and implemented by completed WI-0035 in this history.

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
- Target repositories without their own deterministic Harness checks continue to rely on Agent
  semantic review. ChangeFleet does not invent a checker or project convention for them.

## Next Recommended Task

After WI-0036 adoption, consider one smaller real Provider trial; do not repeat the 732,091-token
failed trial merely to duplicate deterministic evidence.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep accepted baseline, branch-local work, open gaps, and one next task distinct;
- put detailed evidence in the active WorkItem and Git rather than this projection.
