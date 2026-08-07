---
artifact_type: development_work_item
id: WI-0020
status: done
title: Implement the first Plan-confirmed Agentic supervision vertical slice
source: User explicitly requested creation and confirmation of the single-Candidate autonomous vertical slice.
confirmed_by: user
confirmed_at: 2026-08-07
started_by: agent
started_at: 2026-08-07
review_ready_at: 2026-08-07
completed_by: user
completed_at: 2026-08-07
standing_policy:
design_proposal: docs/proposals/0024-policy-governed-agentic-supervision.md
accepted_decisions:
  - docs/decisions/0001-control-plane-boundary.md
  - docs/decisions/0002-changeset-and-bundle-aggregate.md
  - docs/decisions/0017-post-provider-candidate-finalization-and-recovery.md
  - docs/decisions/0024-risk-adaptive-candidate-verification.md
  - docs/decisions/0025-unified-stage-and-run-lifecycle.md
  - docs/decisions/0026-policy-governed-agentic-supervision.md
---

# WI-0020: Implement The First Plan-Confirmed Agentic Supervision Vertical Slice

## Objective

Let one exact confirmed Plan authorize ChangeFleet to advance a single Candidate route through
execution, exact checks, optional independent verification, Feedback repair, and CandidateBundle
assembly without intermediate operator continuation commands. Use deterministic action authority
for every mutation and a read-only Supervisor Agent only when a bounded semantic choice remains.

## Context

WI-0019 provides coarse phases, generic Runs, Feedback, Gates, exact validation, recovery, and
Bundle assembly, but the operator still drives ordinary continuation. Proposal 0024 and Decision
0026 accept a hybrid boundary: the kernel derives exact legal actions and executes forced actions;
a Supervisor Runtime selects only among offered actions when rules cannot safely choose.

This WorkItem proves that boundary with one route to Bundle review. It must reuse current services
instead of adding another workflow state machine or parallel quality-contract model.

## Scope

### Plan Authorization And Budgets

- Add a minimal Project supervision policy with bounded ceilings and a confirmed Plan projection
  that records the effective `manual | autonomous_until_review` mode.
- Bind effective execution-attempt, verification-attempt, Feedback-cycle, and elapsed-time limits to
  the exact Plan. Preserve honest usage enforcement when Provider token coverage is delayed,
  aggregate-only, estimated, or unknown.
- Migrate existing persisted Plans to `manual`; never silently activate autonomous work.

### Deterministic Action Authority

- Add one pure action-derivation module that receives the current exact ChangeSet projection and
  returns typed, stable action envelopes with current revisions, subject ids, targets,
  preconditions, budget identity, and idempotency identity.
- Cover the first route's actions: dispatch eligible execution, run or resume exact repository and
  combined validation, start required verification, submit exact Feedback, retry an eligible
  attempt, assemble the Bundle, open a Gate, and stop or pause supervision.
- Execute a uniquely forced action without calling a Supervisor model. Revalidate the full envelope
  immediately before every mutation; stale or unauthorized actions fail without partial work.
- Preserve existing dependency scheduling and permit independent WorkUnits to progress concurrently
  without allowing two writable Runs for one WorkUnit.

### Bounded Supervisor Runtime

- Add `supervision` as a ChangeSet-scoped, read-only purpose using the common Run lifecycle and
  generic recovery path; do not add a ChangeSet or WorkUnit phase.
- Build a compact supervision projection containing the exact Plan and selection identities,
  current WorkUnit/Candidate state, relevant bounded Evidence, open Feedback/Gates/holds, remaining
  budget, and exact offered action envelopes. Exclude transcripts, full logs, full diffs, and audit
  totals by default.
- Require a structured `SupervisorDecisionProposal` that selects one offered action or requests a
  human Gate with bounded rationale, evidence references, and expected result.
- Give the Supervisor only typed ChangeFleet operations. It receives no repository-write, ambient
  shell, Control Store, Git, permission, credential, budget-raising, Bundle-acceptance, or delivery
  capability.
- Prove at least one genuine semantic branch, such as classifying an exact failed check as
  implementation Feedback, eligible retry, or human Gate. Invalid, stale, invented, or over-budget
  proposals are rejected and auditable.

### Autonomous Progress And Recovery

- Add shared start, pause, resume, and read-only progress operations. UI/HTTP and CLI adapters may
  call the same application boundary but never drive each other.
- After exact Plan confirmation with `autonomous_until_review`, continue ordinary work until an
  exact Bundle reaches `review`, a Gate or hold opens, the Plan or authority becomes stale, budget
  is exhausted, the operator interrupts, or the ChangeSet becomes terminal.
- Convert routable failed-check evidence and actionable verifier findings into bounded Feedback,
  return the affected WorkUnit to execution, reuse the same authorized workspace where current
  preflight permits, and revalidate only the resulting exact subject and required combined scope.
- Persist autonomous authorization and counters. After controller loss, reconcile incomplete Runs
  first, retain passed exact evidence, and resume only when the same Plan authorization remains
  current and no Gate or hold prevents dispatch.
- Stop before Bundle acceptance, external publication, merge, deployment, or any irreversible
  action.

### Audit And Presentation

- Record each supervision Run's AgentProfile, projection digest, offered action ids, proposal,
  deterministic disposition, executed action or rejection, timing, usage, and stop reason.
- Include supervision Runs in existing per-Run and ChangeSet audit totals while keeping detailed
  decision output and cost outside ordinary Runtime context.
- Present one understandable autonomous activity and final stop reason rather than operation-
  specific correction, retry, verification, or waiting states.

## Non-Goals

- Alternative Candidate generation, multiple implementation Agents competing for one WorkUnit,
  blind judging, automatic model routing, learned model selection, or normalized pricing.
- A generic Agent graph, workflow DSL, plugin system, hosted scheduler, remote worker, or durable
  Provider-session continuation.
- Automatic Plan replacement, authority expansion, Bundle acceptance, PR publication, merge,
  deployment, or production mutation.
- Replacing repository-native Harness, adding a parallel QualityContract aggregate, or treating
  Agent, verifier, or Supervisor findings as control-certified truth.
- Inventing a second state machine or retaining temporary compatibility states after the schema
  change stabilizes.

## Acceptance Criteria

- A confirmed `autonomous_until_review` Plan needs no ordinary continuation command before one exact
  CandidateBundle is ready for final review.
- The no-failure route reaches review without invoking a Supervisor model for forced actions.
- At least one bounded semantic branch invokes a read-only supervision Run, accepts only an offered
  current action, and continues or opens the correct Gate.
- A repository-check or verification finding can automatically produce Feedback, reuse the current
  WorkUnit route, publish a new exact checkpoint, revalidate it, and reach Bundle review within
  budget.
- Stale Plan, selection, Candidate, Evidence, action, workspace, or budget identity fails closed
  before mutation.
- Pause, interruption, and controller restart cannot duplicate completed Provider work, passed
  checks, Feedback actions, or Bundle assembly.
- Budget exhaustion and unbounded semantic uncertainty create an auditable Gate or stop reason, not
  a new lifecycle state or infinite loop.
- Single- and multi-Repository existing behavior remains valid; the slice produces only one current
  Candidate per WorkUnit and performs no Candidate competition.
- Supervisor usage, duration, rejected proposals, retries, Feedback cycles, and total ChangeSet cost
  remain queryable but absent from ordinary Agent context.

## Validation Selection

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Action-policy and budget unit tests | Exact envelopes, forced/choice derivation, ceilings, stop rules | Required | Deterministic authority is the new safety kernel |
| Runtime schema and context tests | `supervision` Run and compact projection | Required | New Agent purpose must remain read-only and bounded |
| Store migration and restart integration | Manual default, authorization, counters, interrupted Runs | Required | Autonomous recovery must not duplicate work |
| Real-Git autonomous integration | Execution, failed check/Feedback, checkpoint, revalidation, Bundle | Required | Proves the end-to-end single-Candidate route |
| Two-Repository acceptance | Dependencies, concurrency, combined validation, exact Bundle | Required | Multi-Repository control remains a product boundary |
| Audit and isolation tests | Per-Run/total cost, decisions, context exclusion | Required | Supervisor cost must be comparable but not eager context |
| Shared operation, HTTP, CLI, and browser tests | Start, pause, resume, progress, Gate, final review | Required when affected | All surfaces must use one application boundary |
| Node.js 24 `npm run check` | Complete changed dependency surface | Required once stable | Plan, store, Runtime, scheduler, recovery, audit, and UI change |
| Real Codex Provider flow | Forced path plus one semantic Supervisor branch | Required once stable | First real `supervision` protocol and unattended loop |
| Real GitHub external write | Delivery | Excluded | Autonomous authority stops before delivery |
| Documentation, links, diff, and eager-size audit | Accepted authority and Harness | Required | Proposal, Decision, SPEC, architecture, and current state change |

## Current Projection

- Review-ready on `codex/wi-0020-plan-confirmed-agentic-supervision`, based on local `main` at
  `bde27ff`; no acceptance or commit is implied.
- Schema v11 freezes Project ceilings, Plan mode and effective budgets; every migrated Plan remains
  `manual`.
- The pure policy derives exact stable actions. Forced routes avoid a model call; bounded semantic
  alternatives use a read-only `supervision` Run and fail closed on stale or invented proposals.
- Shared operations and CLI/HTTP/UI adapters expose start, pause, resume and progress. The loop
  stops at Bundle review, Gate/hold, interruption, stale authority, budget, or terminal state.
- Runtime usage and rejected proposals remain linked audit evidence and are excluded from ordinary
  Runtime projections.
- Active blocker or decision: none.
- Next step: human review and acceptance of this exact Candidate.

## Implementation Evidence

### Implemented Subject

- Added `src/domain/supervision.js` for strict policy normalization, durable-record-derived budgets,
  exact action envelopes, forced/choice derivation and structured proposal validation.
- Reused the common Run, Feedback, Gate, validation, Candidate and Bundle services. No aggregate or
  WorkUnit phase was added.
- Added schema v11 migration, generic supervision recovery, compact read-only Runtime projection,
  Codex protocol, audit attribution, localized diagnostics and shared local surfaces.
- Added Real-Git coverage for forced, repository-check, verifier-requested-check, invalid proposal,
  two-Repository, Gate/resume, operator interruption and controller-restart routes.
- Bounded integration test-file concurrency to four; this prevents Windows process-tree stop tests
  from being starved by unrestricted concurrent Git fixtures and does not change product dispatch.

### Executed Gates

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/integration/codex-sdk-runtime.test.js test/integration/control-store-v4-migration.test.js test/integration/local-console-server.test.js test/integration/runtime-audit-query.test.js` | 0 | Node 24; 27 Runtime protocol, migration, HTTP and audit tests passed in about 90 s | Real Provider excluded |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test --test-concurrency=4 'test/integration/**/*.test.js'` | 0 | 101/101 integration tests passed in 298.9 s, including all autonomous Real-Git and recovery routes | Browser and acceptance excluded |
| `$env:PATH='C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH; npm.cmd run check` | 0 | Node 24; 81 unit, 101 integration and 7 acceptance tests plus Chromium UI passed in 536.9 s | Real Provider and external GitHub write excluded |
| `$env:PATH='C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH; $env:CHANGEFLEET_RUN_REAL_CODEX='1'; npm.cmd run test:provider:codex` | 0 | Real Codex reached exact Bundle review with planning, two execution, two verification and one supervision Run in 274.1 s; no UAC appeared | Another Provider/model and hostile-host confinement unverified |
| `git diff --check` | 0 | Final source, test and Harness diff has no whitespace error | Semantic behavior covered by the gates above |
| Local Markdown-link and eager-size PowerShell audit | 0 | Affected local links resolve; `AGENTS.md` 6004 bytes, `WORKFLOW.md` 1264 bytes, `docs/current-state.md` 7305 bytes, all within soft limits | Does not measure Provider tokenization |
| `rg -n "ScriptedRuntime\|FakeRuntime\|MockRuntime" src package.json` | 1 (expected no match) | No deterministic test double is selectable from production source or package configuration | Test-support fixtures remain intentionally present under `test/` |

The passing real flow observed 479,094 total tokens and 245,450 ms of Provider duration. Its
read-only Supervisor Run accounted for 12,651 tokens and 19,310 ms. Codex usage remains
provider-reported aggregate-only and monetary cost remains unknown.

Three earlier real-Provider attempts failed and remain command history rather than passing evidence:
the first used a brittle deliberate-draft scenario and stopped after extra legitimate Feedback; the
second retained an obsolete planning-text assertion; the third completed the route but expected
verification-origin lineage for validation-origin Feedback. The final fixture removes those false
assumptions without weakening product gates.

One earlier unrestricted-concurrency `npm run check` was terminated after the Windows command-stop
fixture left an orphan process under concurrent Git load. The fixture passed alone; bounding
integration file concurrency to four then passed the complete integration set and final check.

Simultaneous Provider dispatch for independently ready WorkUnits is not newly proven; this vertical
slice preserves the existing foreground scheduler and exact dependency behavior. Alternative
Candidates, model routing, automatic Bundle acceptance and delivery remain deferred.

## Project Memory Impact

WI-0020 was explicitly accepted, completed, and committed as one implementation-branch change.
Policy-governed supervision becomes the landed baseline only after that exact change is integrated.
