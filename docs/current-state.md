# Current State

Updated: 2026-08-12

This project's accepted direction, implementation, active gaps, and the next task. `SPEC.md` owns
the contract; Decisions own rationale; WorkItems and Git own implementation evidence.

## Current Baseline

- Completed WI-0022 through [WI-0036](work-items/WI-0036-candidate-bound-feedback-repair.md) leave no
  compatibility path: verification and feedback bind exact Candidates, clean retry survives restart,
  and Core does not parse target-project Harness formats.
- Completed [WI-0037](work-items/WI-0037-persistent-task-workspaces-and-semantic-plans.md) implements
  accepted Proposal 0028 and Decision 0030 as one atomic workspace and Planner-contract
  replacement.
- Completed [WI-0038](work-items/WI-0038-active-supervision-time-and-effective-feedback-budget.md)
  corrects autonomous elapsed-time accounting and exposes effective Feedback capacity under the
  total execution-Run ceiling.
- Structural preflight is mandatory. Project semantic commands are optional Plan selections;
  commandless validation records real attempts without fake command metadata.
- Agent Runtimes own semantic work. ChangeFleet owns cross-repository authorization, revisions,
  scheduling, exact Git and Bundle subjects, evidence, recovery, and human gates.

## Branch-Local Work

- Accepted [0030](proposals/0030-unified-task-control-and-conversational-operator-flow.md) is recorded
  by Decision 0032. Completed
  [WI-0040](work-items/WI-0040-unified-task-control-local-vertical-slice.md) atomically replaces the
  ordinary operation-oriented route on `codex/wi-0040-unified-task-control` and awaits review and
  merge.

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
- A loopback console and experimental CLI use shared operations. The branch-local console creates a
  task from one objective, maintains one bounded cross-stage conversation, confirms Intent and Plan
  together, starts one Task Controller by default, streams sanitized current activity, and keeps
  detailed audit on demand.
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
- Decision 0032 replaces premature executable Intent, user-visible manual/autonomous advancement,
  and the operation-oriented console with one Task Controller and conversation while retaining the
  exact kernel.

## Accepted Decisions

- The [Decision Index](decisions/README.md) owns rationale. Decision 0032 owns the current task
  authority, Controller, lifecycle, and operator route.

## Repository Design Proposals

- The [Proposal Index](proposals/INDEX.md) owns chronology; Decisions retain superseded, rejected,
  and deferred boundaries.
- Accepted Proposals through 0029 are implemented by completed WorkItems through WI-0039. Accepted
  Proposal 0030 is implemented branch-locally by completed WI-0040 and awaits review and merge.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

## Known Limitations

- Git URLs, remote workers, merge, deployment, service graph, and stacked ChangeSets are deferred.
- Native-Windows single-Repository use passed; other hosts and paid multi-Repository work are unverified.
- Codex SDK usage is aggregate-only; effective model and universal host read-denial remain unknown.
- Bundle-level independent quality review currently supports one selected reviewer and bounded
  repair. Multiple reviewers, Candidate comparison, normalized scoring, and automatic model routing
  remain deferred. The local UI routes ordinary planning, running, and review messages through one
  conversation and exposes exact Gate actions only when needed. Ambiguous idle multi-Repository
  feedback targeting remains deferred.
- Provider-native live feedback steering and durable session continuation remain optimizations;
  current feedback is queued for the same Plan's next Run. Current SSE streams sanitized activity,
  not model text deltas or provider-thread control.
- Simultaneous independent WorkUnit Provider dispatch remains unproven; the foreground scheduler
  still advances exact eligible units serially.
- Runtime Kit, Codex App Server, another Provider, Linear, pricing, dashboards, and continuous
  context enforcement are deferred.
- Target repositories without their own deterministic Harness checks continue to rely on Agent
  semantic review. ChangeFleet does not invent a checker or project convention for them.

## Next Recommended Task

Land WI-0040 and use the simplified console for one bounded real self-iteration. Let that evidence
choose between a defect-fix WorkItem and the next Proposal; do not preemptively add tracker routing,
Runtime role catalogs, or Candidate comparison.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep accepted baseline, branch-local work, open gaps, and one next task distinct;
- put detailed evidence in the active WorkItem and Git rather than this projection.
