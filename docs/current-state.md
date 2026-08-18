# Current State

Updated: 2026-08-18

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
- [Proposal 0033](proposals/0033-task-scoped-agent-sessions-and-exact-integration-action-grants.md)
  is accepted as
  [Decision 0035](decisions/0035-task-scoped-agent-sessions-and-exact-integration-action-grants.md),
  and [WI-0047](work-items/WI-0047-task-scoped-agent-sessions-and-exact-integration-grants.md) is
  landed. It adds task-scoped logical AgentSessions, exact human ActionGrants, Runtime-executed
  integration Runs, independent remote-ref observation, restart-safe observe-then-retry recovery,
  and explicit accepted completion without managed integration. Node.js 24 validation passed 119
  unit tests, 126 integration tests, eight acceptance tests, and the Chromium console path.
- [WI-0048](work-items/WI-0048-real-remote-exact-candidate-publication-validation.md) is landed. A
  one-attempt ActionGrant published exact Candidate `debf6c1e` to a named non-target ref on the real
  GitLab-backed `yszt` Repository, independently observed the exact SHA, preserved unchanged
  `develop`, and completed without claiming integration. The validation also bound attempt limits
  into the immutable digest and synchronized closed AgentSession Run lineage.
- [Proposal 0034](proposals/0034-single-project-repository-ownership.md) is accepted as
  [Decision 0036](decisions/0036-single-project-repository-ownership.md): one Project owner per
  common Git store; shared membership and a global registry remain deferred.
- [WI-0049](work-items/WI-0049-common-git-directory-project-ownership.md) is landed. Registration
  rejects existing and in-request `common_git_dir` aliases while allowing independent clones.
- [WI-0050](work-items/WI-0050-real-target-fast-forward-validation.md) is landed. Its exact 1/1
  ActionGrant fast-forwarded real GitLab `develop` from `55bdae47...` to Candidate `f2cf1820...`;
  independent observation matched and every AgentSession closed.

## Branch-Local Work

None.

## Current Product Shape

- One ChangeSet represents one business change and owns one persistent TaskWorkspace.
- One TaskWorkspace owns logical AgentSessions that bind exact AgentProfile revisions, allowed Run
  purposes, and Run lineage without creating another task lifecycle.
- A Project may contain one repository or multiple repositories, while each registered common Git
  store belongs to exactly one Project. Each selected repository keeps its own exact base, target,
  worktree, WorkUnit, Candidate, evidence, and delivery result.
- Agent Runtimes own semantic analysis, planning, implementation, subagents, skills, and
  task-specific check selection.
- ChangeFleet owns repository authorization, exact Git subjects, durable Runs and evidence, budgets,
  gates, recovery, Bundle identity, and delivery observation.
- Planning is semantically read-only. Execution accepts Git changes only from assigned isolated
  repository workspaces.
- Structural Git preflight is mandatory. Repository-native semantic commands are optional Plan
  selections; ChangeFleet does not invent a checker for repositories that lack one.
- Verification and independent review bind exact Candidates and record separate Runtime usage.
- Integration is a typed Run purpose that exists only after exact Bundle acceptance and a separate
  human ActionGrant. Initial actions are limited to non-force exact Candidate publication and exact
  base-to-Candidate target fast-forward; Core independently observes the resulting remote ref.
- The ordinary local flow accepts a task objective, automatically activates an eligible Plan,
  advances authorized work in the background, and stops for human input or Bundle review.
- Ordinary task views derive six operator states. Detailed usage, retries, checks, evidence, and
  artifacts remain audit-only and are excluded from later Agent context by default.
- GitHub is the only implemented delivery provider. ChangeFleet publishes exact accepted
  Candidates through ready pull requests and observes human merge results.
- An accepted Bundle may instead finish with exact reason
  `accepted_without_managed_integration`; this preserves unintegrated Candidate subjects and makes
  no delivery, merge, or integration claim.

## Observed Gaps

The second-scenario validation and subsequent implementation leave these concrete gaps:

- GitHub remains the only managed PR delivery provider; exact GitLab publication and target
  fast-forward are proven, while cleanup remains separately gated and unverified;
- empty module-level repository-Harness discovery when no root instruction file exists;
- dependence on vendor-specific semantic commands when a target repository has no deterministic
  project check;

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

None.

## Next Recommended Task

Decide whether to retain or separately authorize deletion of the WI-0048 remote evidence branch.
Decision 0034's feature freezes remain.

## Maintenance Contract

Before reporting changes ready:

- follow `docs/harness.md` for loading and maintenance rules;
- follow `docs/validation.md` for check selection and evidence;
- keep baseline, branch-local work, open gaps, and one next task distinct;
- route rationale to Decisions and chronology to Proposals instead of duplicating them here;
- keep detailed command output and execution evidence in WorkItems, Git, or linked artifacts.
