# Current State

Updated: 2026-08-14

This document is the current implementation projection, not a progress log. `SPEC.md` owns the
accepted product contract, Decisions own durable rationale, and Git plus linked artifacts own exact
implementation history.

## Current Baseline

- The deterministic kernel preserves authorized repository scope, exact base and Candidate Git
  identities, Candidate-bound validation and feedback, restart recovery, and human decisions.
- [WI-0037](work-items/WI-0037-persistent-task-workspaces-and-semantic-plans.md) established one
  persistent logical TaskWorkspace per ChangeSet, with one or more repository workspaces and a
  semantic Agent Plan.
- [WI-0040](work-items/WI-0040-unified-task-control-local-vertical-slice.md) through
  [WI-0043](work-items/WI-0043-live-run-time-anchors-and-browser-refresh.md) provide the current
  asynchronous task controller, conversational local console, autonomous repair path, chronological
  audit ledger, and live Run timing.
- [WI-0044](work-items/WI-0044-runtime-cost-attribution-and-context-deduplication.md) is landed. It
  removes duplicated semantic Plan text from execution context and reports observed token traffic
  without presenting it as monetary cost.
- [Proposal 0032](proposals/0032-freeze-operator-surface-and-validate-second-scenario.md) is accepted
  as Decision 0034. Console, audit-presentation, and Harness-overlay feature work remains frozen
  until an accepted boundary proposal lifts that freeze.
- [WI-0046](work-items/WI-0046-second-scenario-validation.md) is done. A real non-self ChangeSet
  completed planning, execution, validation, Bundle review, and human acceptance against the
  GitLab-backed `yszt` repository. It remained in review because no supported delivery binding
  existed.

## Branch-Local Work

No implementation WorkItem or unlanded product change is active.

## Current Product Shape

- One ChangeSet represents one business change and owns one persistent TaskWorkspace.
- A Project may contain one repository or multiple repositories. Each selected repository keeps its
  own exact base, target, worktree, WorkUnit, Candidate, evidence, and delivery result.
- Agent Runtimes own semantic analysis, planning, implementation, subagents, skills, and
  task-specific check selection.
- ChangeFleet owns repository authorization, exact Git subjects, durable Runs and evidence, budgets,
  gates, recovery, Bundle identity, and delivery observation.
- Planning is semantically read-only. Execution accepts Git changes only from assigned isolated
  repository workspaces.
- Structural Git preflight is mandatory. Repository-native semantic commands are optional Plan
  selections; ChangeFleet does not invent a checker for repositories that lack one.
- Verification and independent review bind exact Candidates and record separate Runtime usage.
- The ordinary local flow accepts a task objective, automatically activates an eligible Plan,
  advances authorized work in the background, and stops for human input or Bundle review.
- Ordinary task views derive six operator states. Detailed usage, retries, checks, evidence, and
  artifacts remain audit-only and are excluded from later Agent context by default.
- GitHub is the only implemented delivery provider. ChangeFleet publishes exact accepted
  Candidates through ready pull requests and observes human merge results.

## Observed Gaps

The second-scenario validation and subsequent operator use exposed these concrete gaps:

- no terminal rule for an accepted task without a supported delivery binding;
- GitHub-only delivery for a real GitLab-backed repository;
- empty module-level repository-Harness discovery when no root instruction file exists;
- dependence on vendor-specific semantic commands when a target repository has no deterministic
  project check;
- a fixed role and delivery pipeline that may be too rigid for a multi-Agent session console;
- no human-authorized path that delegates an exact integration action to an Agent while Core retains
  scope enforcement and result verification.

The last two items are current design questions, not accepted implementation behavior.

## Known Limitations

- Git URL materialization, remote workers, deployment, merge queues, automatic merge, service
  graphs, stacked ChangeSets, and hosted multi-tenancy are not implemented.
- The Codex SDK is the only real Runtime adapter. Provider-native streaming, durable Provider
  session continuation, and a second Provider remain deferred.
- Codex usage is aggregate-only; universal host read-denial and effective model pricing remain
  unknown.
- Independent Bundle review supports one selected reviewer and bounded repair. Multiple reviewers,
  Candidate comparison, normalized scoring, and automatic model routing are not implemented.
- Simultaneous Provider dispatch across independent WorkUnits remains unproven; the foreground
  scheduler still advances eligible units serially.
- Native-Windows single-repository use and one real GitLab-backed scenario have been exercised;
  other hosts and paid multi-repository execution remain unverified.
- The unreleased local prototype accepts only its current exact filesystem storage schema.

## Open Questions

1. Whether ChangeFleet should replace its fixed role pipeline with first-class persistent Agent
   Sessions and optional Candidate lanes while keeping Runtime-native subagents internal.
2. Whether a human decision should grant an exact, bounded integration capability that an Agent may
   execute, rather than requiring an external human merge as a universal rule.
3. Whether one registered Repository may initially belong to multiple Projects.

## Next Recommended Task

Discuss one product-boundary Proposal using WI-0046 and current operator evidence before starting
more feature implementation. It should decide the session/workspace model, Agent action grants,
integration responsibility, and which exact Git/evidence invariants remain in Core. It must also
state whether and how Decision 0034's feature freeze is lifted.

Do not implement another console or Delivery patch before that boundary is accepted.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` for loading and maintenance rules;
- follow `docs/validation.md` for check selection and evidence;
- keep baseline, branch-local work, open gaps, and one next task distinct;
- route rationale to Decisions and chronology to Proposals instead of duplicating them here;
- keep detailed command output and execution evidence in WorkItems, Git, or linked artifacts.
