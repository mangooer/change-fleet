# 0023: Unified Stage And Run Lifecycle

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-06

Accepted: 2026-08-06

Supersedes in part: Decision 0024's dedicated correction lifecycle, bounded automatic correction
sequence, and focused re-review lifecycle; the conceptual flat ChangeSet state list in `SPEC.md`;
operation-specific recovery state in Decisions 0017 and 0024

Depends on: Decisions 0001, 0002, 0009, 0017, 0018, 0022, 0023, and 0024

Blocks: More verification-specific UI states, a shared human-resolution operation shaped around
those states, and further lifecycle features built on the current aggregate schema

Decision: [Decision 0025](../decisions/0025-unified-stage-and-run-lifecycle.md)

Implementation tracking: [WI-0019](../work-items/WI-0019-unified-stage-and-run-lifecycle.md),
`done`

## Context

ChangeFleet began with a small deterministic boundary around autonomous Agent Runtimes. Exact
repository authority, Git subjects, immutable evidence, human gates, and recovery remain necessary.
The current implementation has nevertheless encoded each new workflow step as a separate aggregate
state and recovery path.

The current ChangeSet and WorkUnit projections distinguish planning, execution, validation,
verification, correction, focused re-review, candidate review, delivery, several pending states,
several failure states, and several human-decision states. They also keep generic Run references
beside verification-specific and correction-specific Run references. Planning, ordinary execution,
correction, and verification each have separate interrupted-Run recovery logic.

This produces three structural problems:

1. business phase, current activity, and latest outcome are multiplied into flat state names such as
   `verification_changes_required` and `correction_pending`;
2. the same semantic action is modeled differently depending on feedback source: Bundle
   `request_revision` creates another execution attempt, while verifier feedback creates a distinct
   correction operation;
3. one accepted default verification workflow has become the only lifecycle the Core understands.

The resulting application service is difficult to reason about as one transition system. Adding
human-resolution UI over the current states would expose and stabilize accidental implementation
complexity. The project is still pre-release, so this proposal prefers one deliberate schema
replacement over incremental compatibility with every internal state name.

## Decision

Replace the flat, operation-specific state machine with three orthogonal concepts:

1. a small business lifecycle for the ChangeSet;
2. a small execution phase for each repository WorkUnit;
3. one generic Run lifecycle for every Agent invocation.

Feedback, blockers, human gates, validation attempts, checkpoints, and delivery observations remain
separate records. They never create compound lifecycle states.

### ChangeSet Lifecycle

A ChangeSet stores only its current coarse phase:

```text
planning | working | review | delivery | terminal
```

- `planning` owns intent clarification, planning conversation, and exact Plan confirmation.
- `working` means at least one current WorkUnit is executing or verifying. Different repositories
  may be in different WorkUnit phases concurrently.
- `review` means the exact current CandidateBundle is available for human review.
- `delivery` means an accepted Bundle is being published or reconciled with external destinations.
- `terminal` has one explicit outcome: `done` or `abandoned`.

Transient failure is not a ChangeSet terminal state. A failed or interrupted attempt remains a Run
fact. An unresolved blocker or human question remains a separate open record. The ChangeSet stays in
the phase where useful work may continue until a human abandons it or accepted delivery completes.

The normal forward path is:

```text
planning -> working -> review -> delivery -> terminal(done)
```

The only backward semantic routes are:

```text
review or verification -> working     when current feedback requires repository changes
working or review       -> planning    when an Agent identifies Plan invalidation
```

These routes do not imply that feedback is true. The handling Agent assesses it against confirmed
intent, exact Git state, and repository-native authority. Repository or target expansion still
requires the existing human authorization boundary, and a revised Plan still requires exact human
confirmation.

### WorkUnit Phase

Each current WorkUnit stores one phase:

```text
execution | verification | complete
```

It also stores one independent disposition:

```text
current | superseded | excluded
```

- `execution` permits a writable Agent Run in the assigned isolated repository workspace.
- exact publication of a non-empty CandidateCheckpoint advances the WorkUnit to `verification`;
- deterministic checks and any optional independent read-only Agent review occur while the WorkUnit
  remains in `verification`;
- exact passing evidence creates the Candidate and advances the WorkUnit to `complete`;
- actionable feedback returns the same current WorkUnit to `execution` while preserving every prior
  checkpoint, review, validation attempt, and Run as immutable lineage;
- Plan replacement creates new current WorkUnits and marks replaced WorkUnits `superseded`.

`pending`, `running`, `failed`, `blocked`, `validation_pending`, `verifying`,
`verification_changes_required`, `correction_pending`, `correcting`, `correction_failed`,
`verification_human_decision_required`, and `verification_passed` cease to be WorkUnit states.
Their useful meaning is derived from phase, Runs, open gates, blockers, and exact artifacts.

### Generic Run Lifecycle

Every Agent invocation uses the same operation set:

```text
planning | execution | verification
```

Every Run uses the same status set:

```text
queued | running | completed | failed | interrupted | cancelled
```

A Run records:

```text
run_id
operation
ChangeSet, Plan, WorkUnit, and exact-subject references where applicable
trigger: initial | feedback | retry | recovery
continuation_of_run_id when applicable
AgentProfile and capability boundary
status and typed terminal outcome
Runtime invocation, usage, timing, and artifact references
```

`completed` means that the Runtime returned a valid typed outcome. It does not mean that the phase,
WorkUnit, ChangeSet, validation, review, or delivery succeeded. `failed` means that one invocation
failed. `interrupted` means that the controller or operator stopped or lost that invocation. Both
remain retryable facts unless an independent authority boundary prevents another Run.

Continuing after feedback, failure, interruption, or an ordinary completed turn creates another Run
for the same phase. A Provider adapter may reuse a native session when it can prove the required
identity, but Provider session continuity is only an optimization. The new Run links its predecessor
and receives only current bounded feedback and authority.

There is no `correction` operation. A correction is an `execution` Run with `trigger: feedback` and
an exact source-feedback reference. There is no focused-review lifecycle. A focused recheck is a
`verification` Run whose context carries exact prior finding and changed-subject references.

The aggregate stores one ordered `run_references` collection. Operation, trigger, subject, and
lineage distinguish Runs. Verification-specific and correction-specific reference arrays are
removed.

### Feedback And Agent Assessment

Feedback is immutable input, not a state transition and not controller-certified truth. One
`Feedback` record contains:

```text
feedback_id
source: human | planning | validation | verification | review | delivery
target phase, WorkUnit, Run, checkpoint, Candidate, or Bundle where applicable
bounded content or artifact reference
created_at
```

The Agent Run that handles feedback returns bounded `FeedbackAssessment` entries with the existing
`adopt | adapt | decline` meaning and may return one typed route request:

```text
continue_current_phase
return_to_execution
plan_invalidation_required
human_input_required
```

Core validates that the route is authorized and that referenced feedback and subjects are exact. It
does not decide whether semantic feedback is correct. A route request cannot expand repositories,
change targets, confirm a Plan, accept a Bundle, or waive required evidence.

Feedback may be recorded while a Run is active or after it ends. Recording feedback does not
silently cancel the active Run. An operator may separately interrupt it. A Provider with safe live
steering may receive the feedback during the current invocation; otherwise the next Run receives
it. Both cases retain exact delivery evidence.

### Human Gates And Blockers

A human question is an open `Gate`, not `decision_required` embedded in ChangeSet or WorkUnit state.
A Gate binds the exact phase and subject, presents bounded options, and has the generic lifecycle:

```text
open | resolved | withdrawn
```

A semantic or environmental blocker is a `Blocker` record, not a WorkUnit state. Resolution,
supersession, or abandonment is recorded separately. UI status such as `waiting for you` or
`blocked` is derived from open Gates and Blockers.

Plan confirmation, Bundle acceptance, repository-scope authorization, ChangeSet abandonment, and
external delivery authority remain distinct typed human operations. The generic Gate representation
does not collapse their different authorization rules into one untyped decision command.

### Verification Without A Fixed Correction Chain

Decision 0024's Candidate-bound admission, deterministic check evidence, optional read-only
Verification Runtime, verdict boundaries, and independent cost attribution remain accepted.

The following control behavior changes:

- verification admission selects required evidence and whether an independent verification Run is
  required; it does not create a dedicated verification lifecycle state;
- deterministic validation attempts are evidence inside the WorkUnit's `verification` phase, not
  Agent Runs and not aggregate states;
- `changes_required` creates Feedback and returns the WorkUnit to `execution`; it does not create a
  Correction entity or operation;
- after another exact checkpoint, the WorkUnit naturally re-enters `verification`;
- a verifier may focus on prior findings, inspect the entire relevant diff, pass, add notes, return
  actionable feedback, or request a human decision; the Core does not enforce exactly one focused
  review or exactly one automatic correction;
- Project attempt and cost limits may stop automatic dispatch and open a human Gate, but limits are
  resource policy rather than new lifecycle states.

This retains the safety boundary while allowing an Agent to determine whether feedback is valid,
what checks are relevant, and whether another semantic review is useful.

### Derived Presentation State

Normal UI and CLI views compose, but do not persist, a presentation state:

```text
phase + activity
```

The bounded activity vocabulary is:

```text
ready | running | waiting | blocked | complete
```

Examples are `planning / running`, `execution / waiting`, and `verification / complete`. The view
derives activity in this order from terminal outcome, active Run, open Gate, open Blocker, and
available exact artifact. It never exposes compound internal names such as
`verification_human_decision_required`.

### Generic Recovery

Replace planning-, execution-, correction-, and verification-specific recovery state machines with
one Run reconciler:

1. enumerate every persisted `running` Run;
2. determine whether the Provider invocation is provably live;
3. otherwise mark the Run `interrupted` with immutable recovery evidence;
4. verify its recorded capability, workspace ownership, expected Git subject, and current authority;
5. retain the owning ChangeSet and WorkUnit phase;
6. either reuse exact completed artifacts, dispatch a new same-phase Run, or open a Gate when exact
   preflight cannot prove safety.

Operation-specific adapters may perform planning-workspace cleanup, writable execution-workspace
preflight, or disposable verification-workspace cleanup. They do not mutate separate aggregate
states or implement separate retry state machines.

Completed checkpoints, validation attempts, Candidates, Bundles, human decisions, and delivery
observations remain immutable and are never reconstructed from Agent prose.

## Boundaries

- ChangeFleet still owns authorization, exact bases and subjects, capability grants, immutable
  evidence, Run persistence, human gates, recovery, Bundle identity, and delivery authority.
- Agent Runtimes still own semantic analysis, implementation strategy, feedback assessment, test
  selection, optional skills and subagents, and typed route recommendations.
- Repository-native Harness remains optional semantic authority and is not written or interpreted as
  lifecycle state by Core.
- The model is explicit rather than configurable. This proposal does not add a workflow DSL, generic
  Agent graph, plugin system, or public lifecycle extension API.
- Multi-repository WorkUnits may be in execution and verification concurrently. The ChangeSet stays
  in `working` until every current non-excluded WorkUnit is complete.
- A Run cannot grant authority, confirm a Plan, accept a Bundle, merge, or waive exact evidence.
- Feedback and Agent recommendations are auditable claims, not automatic truth.
- Audit and cost data remain outside normal Runtime context and are derived from the unified Run
  collection.

## Migration And Removal

Because ChangeFleet is pre-release, implementation performs one schema cutover rather than
maintaining both lifecycle models.

The migration derives new phase from exact current artifacts, Runs, gates, and decisions rather
than trusting the old flat state alone. Its required mapping includes:

| Old representation | New representation |
| --- | --- |
| `analyzing`, `awaiting_plan_confirmation`, `replanning` | ChangeSet `planning` |
| current repository work before Bundle | ChangeSet `working` |
| `candidate_review` | ChangeSet `review` |
| `delivery_ready`, `delivering` | ChangeSet `delivery` |
| `done`, `abandoned` | ChangeSet `terminal` plus exact outcome |
| WorkUnit `pending`, `running`, `failed`, `blocked` | WorkUnit `execution`; Run, Gate, or Blocker carries activity |
| validation and verification states | WorkUnit `verification` |
| correction states | WorkUnit `execution` plus feedback-triggered execution Run |
| `candidate_ready` | WorkUnit `complete` with exact current Candidate |
| verification and correction Run-reference arrays | one ordered generic Run-reference collection |
| `correction` Run operation | normalized execution lineage with feedback trigger |
| focused review state | verification Run focus metadata |

Existing immutable Run, evidence, checkpoint, Candidate, Bundle, and delivery artifact bytes remain
preserved. One migration evidence record explains normalized legacy operation names and references.
After successful migration, production code writes and evaluates only the new schema. Legacy state
branches, constants, operation prompts, duplicated reference arrays, recovery methods, and their
ordinary behavior tests are deleted. Only explicit migration fixtures may contain old state names.

Experimental CLI and local UI payloads may break during this pre-release cutover. Exact Git and
artifact identities, accepted Plan and Bundle decisions, and delivery evidence do not change.

## Application Structure

The current lifecycle service becomes a thin operation facade. Responsibility is split without
introducing a generic framework:

- pure `ChangeSetLifecycle` and `WorkUnitLifecycle` modules validate the small transition tables;
- one `RunCoordinator` dispatches, completes, interrupts, continues, and reconciles all Agent Runs;
- one `FeedbackService` records exact feedback and validates handling assessments;
- `VerificationService` owns admission, deterministic attempts, review evidence, and Candidate
  readiness without owning execution correction;
- existing repository workspace, Bundle, audit, and delivery services retain their bounded roles;
- UI and CLI call the same typed application operations and consume derived presentation views.

No single application module should simultaneously invoke Providers, mutate repository workspaces,
run validation commands, reconcile interrupted Runs, assemble Bundles, and record human decisions.

The operator surface should converge on stage-neutral interactions:

- submit feedback to an exact current subject;
- start or continue eligible work;
- interrupt an active Run;
- confirm an exact Plan message;
- decide an exact Bundle;
- abandon a quiescent ChangeSet;
- publish or refresh exact delivery.

Existing specific commands may be mapped or removed during the cutover. Transport adapters do not
own transition logic.

## Alternatives

### Continue Adding Operation-Specific States

This is locally incremental but repeats state, recovery, audit, and UI branches for every new Agent
role. Rejected because it makes workflow policy part of Core identity.

### Keep Flat States But Rename Them

Names such as `executing`, `correcting`, and `verifying` would remain mutually exclusive and still
combine phase, activity, and outcome. Rejected because renaming does not remove the cross-product.

### Introduce A Generic Workflow Engine

A configurable graph could express every path, but it would turn ChangeFleet into the generic Agent
orchestration framework excluded by Decision 0001. Rejected. The accepted business stages and
authority transitions remain explicit and small.

### Make The Agent Own All Lifecycle Decisions

This would simplify controller code but allow semantic output to grant scope, waive evidence, or
accept delivery. Rejected. Agents recommend semantic routes; deterministic Core retains authority.

### Recommended

Use coarse ChangeSet and WorkUnit phases, one generic Run state machine, separate feedback and Gate
records, and derived presentation state. Preserve exact authority and evidence while deleting fixed
correction and focused-review control chains.

## Implementation Slices

Implement this as one atomic replacement WorkItem on one branch. Internal commits may use the
following slices, but no dual-state intermediate becomes the accepted `main` baseline:

1. Add the new domain schema, transition tables, derived presentation projection, and one-way
   migration with exhaustive old-state fixtures.
2. Move planning, execution, feedback-triggered re-execution, deterministic validation, optional
   verification, Bundle review, and delivery to the new lifecycle; replace operation-specific Run
   recovery with the generic reconciler.
3. Migrate audit, CLI, local UI, context projection, and Runtime prompts; delete legacy state names,
   correction operation code, duplicate Run references, operation-specific recovery branches, and
   superseded tests and documentation.
4. Run the selected affected suites and the full repository gate once the replacement stabilizes;
   inspect migrated real local state without invoking a Provider or mutating external delivery.

The WorkItem must name deletion as acceptance scope. Temporary adapters or dual projections are not
retained for a later cleanup task.

## Acceptance Criteria

- ChangeSet persistent phase is limited to `planning | working | review | delivery | terminal`.
- Current WorkUnit phase is limited to `execution | verification | complete`, independently from
  `current | superseded | excluded` disposition.
- Every Agent invocation uses `planning | execution | verification` and one generic Run status
  lifecycle.
- Feedback may be recorded during or after any Agent stage, remains a claim, and can be handled by a
  same-stage continuation, return to execution, Plan invalidation, or human request without creating
  a new aggregate state name.
- Interruption and retry retain the same owning phase and create immutable Run lineage.
- Verifier-required changes use an ordinary feedback-triggered execution Run; Bundle revision
  feedback uses the same mechanism.
- Re-verification is another verification Run with optional focus metadata, not a focused-review
  state or mandatory one-pass chain.
- Validation attempts, Agent review, cost evidence, checkpoints, Candidates, Bundle decisions, and
  delivery observations retain exact identities and auditability.
- One generic reconciler handles interrupted planning, execution, and verification Runs with
  operation-specific preflight adapters but no operation-specific aggregate recovery state machine.
- Multi-repository execution proves that one WorkUnit may verify while another executes without
  misrepresenting the ChangeSet phase.
- Normal views use only derived `ready | running | waiting | blocked | complete` activity and expose
  detailed Run and evidence lineage only on demand.
- Production code and ordinary tests contain none of the removed state names, dedicated correction
  operation, or duplicate verification/correction Run-reference arrays.

## Validation

- Domain transition-table tests for every allowed and rejected ChangeSet and WorkUnit route.
- Generic Run tests for completion, failure, interruption, cancellation, continuation, feedback
  delivery, and idempotent terminal writes across all three operations.
- Migration tests covering every legacy ChangeSet and WorkUnit state, duplicated reference
  normalization, legacy correction Runs, focused reviews, open gates, and in-flight Runs.
- Integration tests for planning conversation, Plan confirmation, exact execution checkpoint,
  deterministic verification, optional read-only review, feedback-triggered re-execution,
  re-verification, Bundle decision, delivery, and abandonment.
- Multi-repository integration with concurrent WorkUnits in different phases.
- Restart tests proving one reconciler preserves exact checkpoints and evidence and never repeats a
  completed Runtime invocation.
- Runtime-context and audit tests proving only current feedback enters context while full lineage and
  cost remain queryable outside it.
- UI and operation-adapter tests for derived phase/activity, feedback, interrupt, continue, exact
  Plan confirmation, exact Bundle decision, and delivery.
- `npm run check` once after the shared schema, migration, application, adapters, and documentation
  stabilize; `git diff --check`, affected links, and eager Harness size inspection.

## Risks And Open Questions

- Provider-native live steering and session continuation vary by Provider. The first implementation
  may queue feedback for a new Run while preserving the same logical phase; this does not weaken the
  lifecycle model.
- A more flexible execution-verification loop can consume unbounded resources. Project policy may
  cap automatic Run count, time, or cost and open a Gate, but those limits must not create new state
  names or pretend to judge semantic correctness.
- One-way migration of an in-flight local store must fail closed when exact workspace or subject
  identity cannot be proven. It must preserve evidence and request operator action rather than guess.
- The exact operator request shape for feedback plus optional interrupt should be selected in the
  implementation WorkItem. Feedback recording and Run interruption must remain separate auditable
  actions even if one UI gesture requests both.

## Non-Goals

- A generic workflow language, arbitrary Agent graph, role registry, or plugin API.
- Letting Agent output grant Repository access, confirm Plans, accept Bundles, or authorize delivery.
- Provider-session resume as lifecycle authority.
- Replacing repository-native Harness with ChangeFleet Skills or scripts.
- Changing exact Candidate, Bundle, validation, GitHub delivery, or cost-evidence identity.
- Automatic merge, deployment, remote workers, another Provider, Linear, or a new UI feature set.
- Preserving experimental internal state names or payload compatibility at the cost of a permanent
  dual model.

## Documentation Impact

Acceptance requires a new Decision that revises Decision 0024's correction and focused-review
lifecycle while retaining its verification safety and evidence boundaries. Implementation must
replace the lifecycle and recovery sections of `SPEC.md`, simplify `docs/architecture.md`, update
Runtime context and validation documentation, revise CLI and local-console contracts, and replace
the current-state projection. Historical Proposals, Decisions, WorkItems, and Git evidence retain
their original terminology as chronological records.
