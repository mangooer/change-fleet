# Current State

Updated: 2026-08-12

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
- Structural preflight is mandatory. Project semantic commands remain optional Plan selections, and
  commandless validation records real attempts without fake command metadata.
- Agent Runtimes own semantic work. ChangeFleet owns cross-repository authorization, revisions,
  exact Git and Bundle subjects, evidence, recovery, and human gates.

## Branch-Local Work

- Completed [WI-0040](work-items/WI-0040-unified-task-control-local-vertical-slice.md) implements
  accepted Proposal 0030 and Decision 0032 on `codex/wi-0040-unified-task-control`; it replaces the
  operation-oriented local route with one task-first controller flow and awaits review and merge.

## Current Implementation Focus

- Managed Runs receive compact current control facts instead of default history replay.
- Planning remains non-authoritative; execution accepts Git changes only from the assigned WorkUnit
  workspace subject.
- ChangeSet creation freezes visible repositories, branches, base SHAs, and targets; optional
  confirmed Repository Harness overlays stay immutable input only.
- Verification and review bind exact Candidates, selected checks, and separate Runtime usage.
- The branch-local operator route uses one bounded conversation, joint Intent-and-Plan
  confirmation, one Task Controller, sanitized SSE activity, and on-demand audit detail.
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
choose between a defect-fix WorkItem and the next Proposal; do not preemptively add tracker
routing, Runtime role catalogs, or Candidate comparison.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` loading and size rules;
- keep baseline, branch-local work, open gaps, and one next task distinct;
- route rationale to the Decision Index and chronology to the Proposal Index instead of repeating
  them here;
- put detailed evidence in the active WorkItem and Git rather than this projection.
