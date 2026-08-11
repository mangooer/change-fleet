# Current State

Updated: 2026-08-11

This project's accepted direction, implementation, active gaps, and the next task. `SPEC.md` owns
the contract; Decisions own rationale; WorkItems and Git own implementation evidence.

## Current Baseline

- Completed WI-0022 through [WI-0036](work-items/WI-0036-candidate-bound-feedback-repair.md) leave no
  compatibility path: verification and feedback bind exact Candidates, clean retry survives restart,
  and Core does not parse target-project Harness formats.
- Structural preflight is mandatory. Project semantic commands are optional Plan selections;
  commandless validation records real attempts without fake command metadata.
- Agent Runtimes own semantic work. ChangeFleet owns cross-repository authorization, revisions,
  scheduling, exact Git and Bundle subjects, evidence, recovery, and human gates.

## Branch-Local Work

- Completed [WI-0037](work-items/WI-0037-persistent-task-workspaces-and-semantic-plans.md) implements
  accepted Proposal 0028 and Decision 0030 on this branch as one atomic workspace and
  Planner-contract replacement; the user accepted it and the exact branch commit is ready to land.

## Accepted Product Direction

- Managed Runs receive compact current control facts; referenced history stays out of default
  context. ChangeFleet does not maintain registered-repository Harness.
- Agent Profiles select explicit host-user or constrained Runtime permissions. Planning writes are
  non-authoritative; execution accepts only its isolated WorkUnit workspace Git subject.
- Initial context targets at most 70 percent usage and records `enforced | estimated | unknown`.
- Tracker integrations remain edge projections, not ChangeSet authority.
- A Project binds registered Repositories. Task creation selects a non-empty subset before planning;
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
- A loopback console and experimental CLI expose the same shared operations; debug audit remains
  isolated and read-only.
- The first production Provider uses the pinned Codex SDK, a narrow Runtime port, one fresh thread
  per attempt, structured outcomes, persistent exact-base task worktrees, and WorkUnit-scoped writes.
- Controller loss abandons incomplete attempts; blind session resume remains deferred.
- Human closure and ordinary later task creation are separate; generic restart and fork are deferred.
- Decisions 0020 and 0021 keep Provider environments and OS permissions Provider-owned. Worktrees
  isolate development state; explicit AgentProfiles select host or constrained execution.
- Execution may report a strict blocked result. Base-equal or empty implementation output is not a
  CandidateCheckpoint and cannot enter validation or review.
- Candidate verification freezes exact-checkpoint admission, requested checks, and separate Runtime
  usage. Structural preflight is mandatory; project commands are optional. Actionable review becomes
  Feedback and returns through execution and verification without adding lifecycle phases.
- Decision 0026 defines task-configured Agentic supervision: the deterministic kernel offers exact
  authorized actions, forced actions avoid a model call, and a read-only Supervisor Agent selects
  only when bounded semantic alternatives remain.
- Decision 0027 adds optional task-configured Bundle quality review. One exact read-only Review Run
  may recommend passage, route bounded Feedback, or request a Gate; human Bundle acceptance remains
  explicit.
- Decision 0030 makes each ChangeSet own one persistent multi-Repository task workspace. Plans are
  semantic Agent guidance; exact execution configuration and WorkUnit creation remain Core-owned.

## Accepted Decisions

- The [Decision Index](decisions/README.md) owns rationale. Decision 0029 separates structural
  preflight from optional project checks. Decision 0030 owns the TaskWorkspace and semantic-Plan
  replacement completed branch-locally by WI-0037.

## Repository Design Proposals

- The [Proposal Index](proposals/INDEX.md) owns chronology; Decisions retain superseded, rejected,
  and deferred boundaries.
- Accepted Proposals through 0025 are landed through WI-0021. Accepted
  [0026](proposals/0026-shared-application-orchestration-boundary.md) is recorded by Decision 0028;
  its implementation is complete through WI-0029 in this history.
- Accepted [0027](proposals/0027-optional-project-semantic-checks.md) is recorded by Decision 0029
  and implemented by completed WI-0035 in this history.
- Accepted [0028](proposals/0028-persistent-task-workspaces-and-linked-repositories.md) is recorded by
  Decision 0030 and implemented branch-locally by completed WI-0037.

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

After WI-0037 lands, run one bounded real self-iteration using its semantic Plan and persistent
TaskWorkspace contract; tracker adapters, templates, and Candidate lanes remain deferred.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep accepted baseline, branch-local work, open gaps, and one next task distinct;
- put detailed evidence in the active WorkItem and Git rather than this projection.
