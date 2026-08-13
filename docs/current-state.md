# Current State

Updated: 2026-08-13

This project's current implementation projection, active gaps, and next task. `SPEC.md` owns the
accepted contract; decisions own rationale; WorkItems and Git own execution evidence.

## Current Baseline

- Completed WI-0022 through [WI-0036](work-items/WI-0036-candidate-bound-feedback-repair.md) leave
  no compatibility path: verification and feedback bind exact Candidates, clean retry survives
  restart, and Core does not parse target-project Harness formats.
- Completed [WI-0037](work-items/WI-0037-persistent-task-workspaces-and-semantic-plans.md)
  implements accepted Proposal 0028 and Decision 0030 as one persistent task workspace plus
  semantic Plan contract replacement.
- Completed
  [WI-0038](work-items/WI-0038-active-supervision-time-and-effective-feedback-budget.md)
  corrects autonomous elapsed-time accounting and exposes effective Feedback capacity under the
  total execution-Run ceiling.
- Merged [WI-0040](work-items/WI-0040-unified-task-control-local-vertical-slice.md) through
  [WI-0043](work-items/WI-0043-live-run-time-anchors-and-browser-refresh.md) provide the current
  task-first local console, autonomous repair, chronological audit ledger, and live Run timing.
- Structural preflight is mandatory. Project semantic commands remain optional Plan selections, and
  commandless validation records real attempts without fake command metadata.
- Agent Runtimes own semantic work. ChangeFleet owns cross-repository authorization, revisions,
  exact Git and Bundle subjects, evidence, recovery, and human gates.

## Branch-Local Work

- Completed
  [WI-0044](work-items/WI-0044-runtime-cost-attribution-and-context-deduplication.md) on
  `codex/wi-0044-runtime-cost-clarity` removes duplicated execution Plan text from Runtime context
  and replaces the console's ambiguous token total with honest observed usage dimensions.

## Current Implementation Focus

- Managed Runs receive compact current control facts instead of default history replay.
- Planning remains non-authoritative; execution accepts Git changes only from the assigned WorkUnit
  workspace subject.
- ChangeSet creation freezes visible repositories, branches, base SHAs, and targets; optional
  confirmed Repository Harness overlays stay immutable input only.
- Verification and review bind exact Candidates, selected checks, and separate Runtime usage.
- The branch-local operator route durably accepts commands, automatically binds ready Plans, stops
  for human input, uses one safe conversation over separate internal Runs, and advances through
  review and authorized Delivery without routine operation clicks. Clear review findings return to
  execution automatically until their existing budget is exhausted.
- The task page prioritizes current progress and safe live activity over the immutable Plan
  reference. Stable Agent summaries enter the ordinary conversation, while per-Run and project
  check results, timing, Runtime identity, and token observations remain audit-only.
- Execution context now carries semantic work once in `current_plan`; projected WorkUnit control
  identity no longer repeats the same compiled task text.
- Ordinary usage display separates non-cached input and output. Exact audit labels aggregate token
  traffic as non-monetary, preserves unknown coverage, and keeps Provider pricing out of context.
- Running-task projections now expose Run start and recent-activity anchors for browser-local
  relative-time refresh without writing new business state or Agent context.
- Default views expose only six operator states with deterministic reasons; exact lifecycle, Run,
  Candidate, Bundle, delivery, and audit facts remain separate authority.
- Authority chronology stays in the [Decision Index](decisions/README.md) and
  [Proposal Index](proposals/INDEX.md) rather than this projection.

## Open Questions

1. Whether shared repositories may initially belong to multiple Projects. This remains deferred
   outside the accepted two-repository fixture.

## Known Limitations

- Git URLs, remote workers, merge, deployment, service graph, and stacked ChangeSets are deferred.
- Native-Windows single-Repository use passed; other hosts and paid multi-Repository work are
  unverified.
- Codex SDK usage is aggregate-only; effective model and universal host read-denial remain unknown.
- Bundle-level independent quality review supports one selected reviewer and bounded repair.
  Multiple reviewers, Candidate comparison, normalized scoring, and automatic model routing remain
  deferred.
- Provider-native text streaming, live feedback steering, and durable Provider-session continuation
  remain optimizations. The persisted task timeline contains safe completed messages and status
  events; SSE streams sanitized activity, not raw reasoning or provider-thread control.
- Simultaneous independent WorkUnit Provider dispatch remains unproven; the foreground scheduler
  still advances exact eligible units serially.
- Runtime Kit, Codex App Server, another Provider, Linear, pricing, dashboards, and continuous
  context enforcement are deferred.
- Target repositories without their own deterministic Harness checks continue to rely on Agent
  semantic review. ChangeFleet does not invent a checker or project convention for them.

## Next Recommended Task

Merge WI-0044, then use one explicitly bounded real self-iteration to compare non-cached input,
output, command activity, Provider duration, and repair count against the preserved WI-0041 audit.
Only propose a new Runtime resource-budget boundary if the remaining measured loop cost justifies
it; do not infer monetary cost from token traffic.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep baseline, branch-local work, open gaps, and one next task distinct;
- route rationale to the Decision Index and chronology to the Proposal Index instead of repeating
  them here;
- put detailed evidence in the active WorkItem and Git rather than this projection.
