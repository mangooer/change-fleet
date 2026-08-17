# ChangeFleet Architecture

Status: Accepted target architecture

This document describes accepted component boundaries. `docs/current-state.md` distinguishes the
landed baseline from branch-local implementation.

## Architectural Thesis

ChangeFleet should become smaller as Agent Runtimes become more capable.

The control plane should not duplicate semantic planning, code indexing, subagent orchestration,
skill management, or repository-specific verification intelligence. Its durable purpose is to turn
Agent work into authorized, recoverable, exact, and human-reviewable change transactions.

```text
Agent Runtime owns how code work is performed.
ChangeFleet owns which repositories may participate, which exact result exists,
which evidence belongs to it, how partial work continues, and what a human accepted.
A Supervisor Agent may choose only among exact actions offered by the deterministic kernel.
```

## Logical Layers

```text
Application adapters
  experimental CLI / future API, App Server, UI, and tracker adapters
  task intake and human decisions

Application operations
  typed commands and queries
  authorization, idempotency, exact message approval, action envelopes, human gates, durable results

Change Control
  ChangeIntent and ChangePlan revisions
  RepositorySelectionRevision history
  ChangeSet lifecycle
  Core-compiled WorkUnit scheduler
  CandidateBundle and validation matrix
  GitHub delivery requests, reconciliation, and aggregate completion
  task-scoped AgentSessions, exact ActionGrants, integration results, and dispositions

Repository Execution
  RepositoryLocator resolution
  workspace materialization
  current Run Context Projection
  AgentProfile and capability dispatch
  Agent Runtime invocation
  repository Candidate publication
  exact repository validation evidence

Infrastructure
  durable stores and locks
  Run events and artifacts
  Git process execution
  credentials and provider adapters
```

Dependencies point downward. Git, provider, TaskSource, CLI, or UI implementations must not become
imports inside the pure ChangeSet decision model.

## Proposed Components

### PortfolioRuntime

The composition root for one local ChangeFleet control environment. It resolves:

- CatalogStore;
- ChangeSetStore;
- RunStore;
- RepositoryLocator registry;
- RepositoryWorker;
- Agent Runtime adapter;
- scheduler ownership;
- application services.

It supports one Project across one or more Repositories rather than adopting the one-Project,
one-Repository model documented by
[Melty Labs Conductor](https://www.conductor.build/docs/concepts/workspaces-and-branches).

### CatalogStore

Owns explicitly confirmed:

- Projects;
- Repository bindings;
- local-path locators;
- descriptions;
- optional default refs;
- optional confirmed Repository Harness workspace-policy revisions;
- optional confirmed GitHub delivery-binding revisions;
- mutation authorization.

Catalog policy is control-plane state. Repository-native Harness remains project-owned and is
normally read from Git; an explicitly selected local overlay is frozen as ChangeSet evidence, not
copied into catalog state.

### ChangeSetStore

Owns current aggregate state and references to immutable evidence:

- ChangeIntent, RepositorySelection, RepositoryHarnessSelection, and confirmed ChangePlan revisions;
- coarse ChangeSet phase and WorkUnit phase/disposition;
- current CandidateCheckpoint and validation-attempt references;
- scope decisions;
- active or superseded CandidateBundle revision;
- bounded current GitHub delivery requests and latest evidence references;
- task-scoped AgentSession lineage, exact integration offers and ActionGrants, independently
  observed integration results, and completion dispositions;
- human decisions;
- Plan-bound supervision authorization and exact Supervisor-decision references;
- exact Bundle review admission, current assessment, and Review Run references;
- recovery markers.

It should not embed complete logs, diffs, or large Agent output.

### RunStore

Owns immutable or append-only operational evidence:

- Run snapshots;
- structured events;
- large output artifacts;
- Agent outcomes;
- Supervisor action proposals, kernel dispositions, and usage;
- repository Candidate evidence;
- validation results;
- review reports.

### Lifecycle And Attempt Services

Pure lifecycle modules validate the small ChangeSet, WorkUnit, and Run transition tables and derive
presentation activity. They do not invoke Providers, Git, checks, or delivery.

`RunCoordinator` owns only live local Provider invocation and operator interruption.
`RunRecoveryService` is the single persisted-running-Run reconciler; planning, writable execution,
read-only verification, read-only supervision, and exact-Bundle review supply bounded resource
adapters rather than separate recovery state machines. `FeedbackService` records immutable exact
Feedback and its current pointer without deciding semantic truth.

`RepositoryValidator` and `CombinedValidator` own deterministic command execution and immutable
evidence for exact subjects. `BundleAssembler` freezes and writes an exact CandidateBundle without
changing lifecycle or granting human acceptance. The application facade coordinates these services
and retains authorization and idempotency; it does not reimplement their internal workflows.

### Initial Local Implementation Boundary

The first slice began as one private Node.js 24 LTS ESM JavaScript package. It uses a ChangeFleet-owned
versioned filesystem store with atomic snapshot replacement, ownership locks, append-only or
immutable evidence, and restart reconciliation. Its initial application surface was an in-process
service exercised through deterministic tests, and its initial Runtime implementation was a
scripted fake behind the AgentRuntimeAdapter port. Later accepted boundaries below add the real
Provider and experimental CLI without turning the test Runtime into a product selection.

The validation adapter accepts only an executable and argument array. It launches native
executables directly; on Windows only, an exactly resolved `.cmd` or `.bat` may use one reviewed
argv-preserving adapter. It records the requested and effective invocation, passes one immutable
validation manifest by `CHANGEFLEET_VALIDATION_MANIFEST`, binds evidence to the exact Candidate
subject, and repeats preflight before Candidate or CandidateBundle assembly.

### Planner

The Planner is an Agent Runtime purpose, not a deterministic Core reasoning engine.

It receives:

- confirmed or draft intent;
- authorized Repository catalog;
- read-only repository access;
- exact-base repository-native Harness plus any confirmed frozen overlay;
- current confirmed plan, current conversation input, or bounded current decision feedback.

It returns typed proposals:

- normalized ChangeIntent;
- conversation message with an optional concise semantic plan payload;
- repository scope expansion;
- decision request;
- typed requirement to replace an invalidated confirmed plan;
- explicit blocker.

Core validates the semantic payload and binds a separately generated workspace-control digest. It
creates WorkUnits and effective execution policy only after confirmation; it does not ask the
Planner to reproduce control configuration.

### Policy-Governed Agentic Supervisor

The Supervisor is an Agent Runtime purpose around, not inside, the deterministic authority kernel.
The application layer derives an exact action catalog from the current confirmed Plan, revisions,
WorkUnits, Runs, Evidence, Feedback, Gates, holds, and remaining budget.

- A forced action executes without a model call.
- If bounded semantic alternatives remain, one read-only `supervision` Run receives only the compact
  current projection and offered action envelopes.
- Its structured proposal may select one offered action or request a human Gate.
- The application operation revalidates the entire envelope before mutation and records acceptance,
  rejection, execution, usage, and stop reason.

The Supervisor cannot read or write the Control Store directly, mutate repository workspaces, grant
scope, raise ceilings, satisfy checks, accept a Bundle, or authorize delivery. Repository commands
remain behind evidence-producing validation operations. Project and task configuration supply the
mode and ceilings; Core binds their exact effective values to the confirmed Plan control digest.

Normal failed checks and material review findings may become Feedback and continue through the same
Plan. When the Plan requires independent Bundle quality review, its forced dispatch and bounded
same-Plan repairs remain inside the autonomous route. The loop stops with a current required passage
recommendation, a Gate, Plan invalidation, unbounded semantic routing, exhausted budget, operator
hold, abandonment, or terminal completion. None of these conditions adds a supervision- or review-
specific aggregate phase.

### RunContextAssembler

Builds a disposable current projection for one planning, execution, verification, supervision,
review, or recovery operation from durable ChangeSet and Run state. It includes:

- exact operation, ChangeSet, semantic Plan, WorkUnit, repository, base, and workspace identity;
- current Repository Harness selection identity and bounded discovery references;
- confirmed intent summary, the current semantic Plan, and separately projected control facts;
- capability boundary, blockers, decisions, gates, and typed outcomes;
- bounded current request-revision feedback when present;
- the current Plan's bounded per-finding feedback assessments after planning;
- for feedback-triggered execution, only the exact current findings, subject, and bounded passing
  evidence references;
- for a later verification Run, optional prior-finding assessments, old and new exact subjects, and
  actual changed delta;
- for a supervision Run, the exact offered action ids, relevant bounded evidence, remaining budget,
  and no repository-write capability;
- for a review Run, the exact Bundle manifest, all Candidate identities, relevant validation and
  verification evidence, unverified risks, and no mutation or acceptance capability;
- required evidence and progressive resource references;
- initial context-budget components and classification.

It does not replay complete revision, attempt, transcript, diff, or log history. The projection is a
rebuildable view, not an aggregate or recovery authority.

Revision feedback is evidence for semantic reconciliation, not controller-certified truth. The
handling Runtime compares every finding with confirmed intent, exact Git, and repository-native
authority, then returns one bounded `adopt | adapt | decline` assessment. The domain validates exact
coverage. Feedback handling remains under the confirmed Plan unless the outcome identifies a typed
contract invalidation; a new Plan exists only after exact approval of a later planning message.

### AgentRuntimeAdapter

Resolves an `AgentProfile` into provider-native Runtime, model, reasoning, permission, and optional
Skill settings. It:

- binds the versioned Control Contract and current Run Context Projection;
- creates the operation capability boundary;
- exposes exact-base and explicitly frozen overlay Harness progressively when supported;
- records requested and observable effective Runtime settings;
- maps provider events and terminal output into typed Run outcomes;
- persists immutable Runtime invocation identity, timing, available usage, confidence, coverage,
  Provider locators, and raw artifact references outside default Agent context;
- reports initial context evidence as `enforced`, `estimated`, or `unknown`.

The adapter does not authorize repositories, accept plans or Bundles, install repository Harness,
or maintain a universal model and Skill catalog.

AgentSession is the task-scoped routing identity above this adapter. Provider thread or session ids
are optional locators on that logical record, never aggregate identity or recovery authority. A
fresh Provider session reconstructs current context from exact ChangeFleet state.

### RuntimeAuditQueryService

Derives private, versioned `RunAuditProjection` and `ChangeSetAuditProjection` views from immutable
ControlStore, RunStore, EvidenceStore, exact Bundle, and human-decision records. It depends only on
read interfaces and has no Agent Runtime, scheduler, `RepositoryWorker`, lifecycle command, Git, or
workspace mutation dependency.

The service conservatively selects one canonical usage observation, preserves unknown and
aggregate-only coverage, separates duration clocks and lifecycle outcomes, and fails closed on a
broken required reference or identity mismatch. Reports bind exact source and query identity,
paginate detailed Run rows to at most 100 per page, and link rather than embed large artifacts.

Audit projections are operator/debug output. They are not persisted, do not enter the Control
Contract or Run Context Projection, and cannot drive authorization, scheduling, Profile selection,
Bundle decisions, or delivery. Cross-ChangeSet comparison and materialized analytics remain later
architecture boundaries.

### ApplicationOperationAdapters

WI-0007 implements the first lifecycle operator adapter as one experimental local `changefleet`
executable.
It maps an explicit command allowlist and structured requests to existing application operations;
it does not own normalization, authorization, state transitions, evidence semantics, or human-gate
decisions. Future API, App Server, UI, and tracker adapters reuse those application semantics but
may have different transport, streaming, progress, and presentation.

WI-0008 adds GitHub binding, delivery publish, bounded read, and explicit refresh through this same
allowlist. The CLI does not invoke Git or `gh` directly and a future UI must not invoke the CLI
parser; both delegate to the shared delivery application operations.

Product commands have explicit `experimental` or later `stable` maturity. Bounded debug commands
carry no public compatibility promise. Temporary development scripts remain outside the installed
command tree, contain no unique lifecycle logic, and are removed at their WorkItem boundary unless
a confirmed follow-up owns them. A generic command bus and public service graph remain deferred.

### LocalTaskConsole

Decisions 0016 and 0031 define one foreground local operator adapter. The experimental
`changefleet serve` command composes exactly one configured control root and production Agent
Runtime, binds only loopback, serves repository-owned HTML/CSS/browser modules, and exposes a small
explicit JSON route allowlist. It is not a daemon, Codex App Server, remote API, generic operation
bus, or second authority graph.

The adapter calls shared application operations for ChangeSet creation, planning turns, exact Plan
activation, Bundle decisions, GitHub publish/refresh, exact integration offers and grants, and
explicit completion without managed integration. Bounded queries provide the recent list,
exact current view, and safe existing-Project intake options. HTTP requests cannot select a control
root, raw operation, host path, AgentProfile, credential, executable, or unrestricted catalog
object. The adapter does not invoke the CLI parser or expose raw Store, Runtime, Git, workspace, or
provider helpers. The isolated audit CLI retains its stronger read-only process composition; an
audit view inside the lifecycle server does not claim that boundary.

Creation and initial planning remain separate idempotent kernel operations behind one browser
action. `TaskControlStore` keeps a durable local command queue, frozen local authorization,
operator hold, and append-only safe timeline outside the ChangeSet aggregate. The foreground
`AutonomousTaskController` holds one per-ChangeSet worker lease, recovers interrupted commands on
startup, and returns HTTP 202 after command acceptance. A successful creation survives a failed
Planner attempt as one visible retryable ChangeSet; persisted Core state remains domain authority.

The current view reads one stage-aware safe timeline while exact planning and Run artifacts remain
linked audit evidence. A fresh Planner receives the current draft and human input,
and immediately preceding assistant response; it does not receive a transcript replay. A bounded
SSE projection exposes sanitized current Run activity and Agent todo progress without logs, command
output, diffs, reasoning, or evidence bodies. Browser actions carry caller attempt identity and
exact Plan, Bundle, or delivery subjects; browser state never becomes lifecycle authority or Agent
context.

A Planner returns `ready | needs_input`. Ready output lets task policy activate the exact Plan and
invoke one deterministic Task Controller; needs-input output stops at one human request. The Task
Controller selects the existing exact execution path or configured Agentic supervision path. The
UI never asks an operator to choose between them or routinely confirm a Plan.
ChangeSet lifecycle is `planning | running | review | terminal`; delivery remains an attached
external process under review rather than a fifth task phase.
The operator projection is only `running | needs_feedback | needs_review | waiting_for_merge |
complete | cancelled` plus a deterministic reason.

The local trust boundary requires exact loopback and Host, same-origin requests, no CORS, an
in-memory session/CSRF nonce, bounded JSON mutations, restrictive security headers, safe errors,
and graceful shutdown. Remote access and another local-user security model require a later design.

Production stays on Node.js 24 ESM with centralized `node:http` and native browser modules. The
first slice adds no production web framework, frontend framework, bundler, CDN, or external assets.
An exact pinned Playwright development dependency and explicit Chromium installation provide a
selected browser gate for affected UI and transport changes.

### ReadOnlyAuditCliRoute

The unified CLI's debug audit route provides one process boundary over `RuntimeAuditQueryService`.
It accepts one explicit control-root locator and one exact Run or ChangeSet id, passes only bound
filesystem read capabilities to the query service, and emits the unchanged versioned projection as
JSON.

The command does not initialize stores, open the lifecycle application service, discover subjects,
invoke an Agent, or receive Git, workspace, registered Repository, scheduler, or mutation
capabilities. Stable typed errors are isolated on stderr. The root parser dynamically selects this
route without loading the lifecycle handler. The earlier standalone executable, npm alias, and
parser-only module are removed; the route is not a stable public CLI, server, API, dashboard, or
analytics interface.

### WorkUnitScheduler

The scheduler:

- enforces project and repository concurrency;
- dispatches ready WorkUnits;
- persists holds, cancellation, and recovery facts;
- leaves semantic implementation ordering to the Agent;
- never lets an Agent directly authorize the next repository.

Execution capacity and destination serialization are separate concerns.

### RepositoryWorker

`RepositoryWorker` is a ChangeFleet-owned adapter informed by separately verified Git behavior and
selected official Conductor.build reference evidence, not a Conductor extraction or compatibility
layer in the first slice.

Conceptual interface:

```text
inspect_current_branch(repository)
resolve_branch(repository, branch_ref)
resolve_harness(repository, base_sha, workspace_policy_revision)
prepare_task_repository(repository, target_ref, base_sha, task_workspace)
materialize_harness(workspace, harness_selection_revision)
inspect_task_repository(workspace)
prepare_verification(repository, candidate)
verify_and_remove_harness(workspace, harness_selection_revision)
publish(workspace, exact_expected_head)
inspect(candidate)
cleanup(workspace, policy)
```

It owns one repository operation at a time. It does not own the multi-repository ChangeSet state or
human Bundle review. Its initial implementation uses explicit repository id, registered Git root,
target ref, base SHA, workspace id, and workspace root inputs and must not import Conductor state
types, workspace names, review lifecycle, or `ProjectRuntime`.

`TaskWorkspaceManager` coordinates the atomic preparation, read-only snapshot comparison, and
terminal physical cleanup of the RepositoryWorker resources owned by one ChangeSet. It does not
create another lifecycle, interpret project semantics, dispatch Agents, or own Candidate authority.

### CandidateFinalizer

After Provider implementation completes, `CandidateFinalizer` removes and verifies frozen Harness
overlays, publishes the exact Git subject, and persists a CandidateCheckpoint before starting
repository validation. It records one immutable deterministic admission for that checkpoint from the
frozen Project and task policy bound to the confirmed Plan control digest, optional operator
elevation, and exact final
facts. `basic` or `deterministic` admission continues without another Runtime. For
`independent_review`, passing exact repository validation starts one separately recorded read-only
verification Run over a disposable exact-Candidate worktree. A bounded passing VerificationReview
and any requested Runner check evidence create the ordinary Candidate. `changes_required` records
Feedback and returns the same WorkUnit to execution. Every source finding receives an explicit
assessment; a changed result creates a descendant checkpoint and an assessed no-change result
preserves the existing checkpoint. Exact repository validation then precedes another ordinary
verification Run, which may receive prior-finding focus metadata without becoming a new lifecycle.
Mutation, malformed output, blocking findings, or an unresolved human decision fails closed. Each
validation attempt, checkpoint, review, Feedback record, and Run remains immutable history.

Resume is a deterministic application operation with a new caller idempotency key. It rechecks
current revisions, source Run, workspace ownership, clean exact HEAD, ancestry, and changed paths
before repository or combined validation. When the Plan selected a semantic command, resume also
requires its unchanged identity; a caller may change only an attempt timeout within the frozen
Project maximum. Requested and effective budgets remain immutable attempt evidence. Resume never
calls the Agent Runtime. Obsolete private pre-checkpoint records are not imported or rewritten by
the current baseline.

### BundleAssembler

Builds an immutable CandidateBundle from:

- the exact plan revision;
- expected WorkUnits;
- exact repository Candidates;
- exact repository validation evidence;
- exact Candidate-set validation evidence;
- missing, blocked, excluded, or superseded units.

A bundle hash changes whenever any subject or required evidence identity changes.

### BundleReviewer

Deterministically follows the confirmed Plan's `none | independent` admission for one exact
CandidateBundle. `none` presents direct human review without a model call. `independent` starts one
ChangeSet-scoped, read-only `review` Run bound to the exact Plan, Bundle hash, Candidate SHAs, and
required evidence.

The structured assessment is `pass | feedback | gate`. Passage is a recommendation rather than
Bundle acceptance. Valid blocking findings may target authorized WorkUnits through the existing
Feedback service; advisory findings remain audit-only. Ambiguous ownership, scope or Plan changes,
invalid output, failure, and exhausted attempts retry safely or open a Gate. Any changed Candidate
creates a new Bundle identity and requires a new assessment.

BundleReviewer owns neither repository validation nor arbitrary commands. It coordinates exact
read-only resources, preflight and postflight, Review Runtime dispatch, assessment validation, and
Feedback routing through existing services. It adds no aggregate phase or recovery workflow.

### DeliveryCoordinator

Owns one stable delivery request for every Candidate in the accepted current Bundle. It keeps
Bundle acceptance distinct from publication while allowing already frozen task policy to enqueue
publication automatically, freezes a confirmed GitHub binding revision, acquires
the `repository_id + target_ref` operation lease, verifies the exact target and Candidate, and
persists enough identity to recover ambiguous external writes after restart.

`DeliveryGitAdapter` reads the verified remote, publishes an exact SHA to a deterministic branch
without force, and checks final target reachability. `GitHubPullRequestAdapter` creates or reads one
exact head/base PR through host-managed authentication. Neither adapter owns ChangeSet transitions,
human decisions, multi-Repository completion, or credentials in persistent state.

Each refresh appends a bounded immutable observation linked as an evidence chain while aggregate
state keeps only the latest reference and count. PR head divergence, target staleness,
closed-unmerged state, provider failure, and exact merge result remain distinct. One human merges
in GitHub; automatic merge and deployment require later accepted proposals.

### IntegrationCoordinator

Owns the post-acceptance exact ActionGrant route without adding another aggregate phase. Core first
compiles an offer from the current accepted Bundle, exact Candidate, configured integration
AgentSession, remote, destination ref, latest observed remote SHA, non-force refspec, attempt and
expiry limits, preflight, result observer, accepted schema, and recovery boundary. A human grant
copies that full subject immutably; the Runtime cannot broaden or accept it.

`IntegrationGitAdapter` is deliberately read-only: it proves local commit presence and fast-forward
ancestry, reads the exact remote ref before dispatch, and independently observes the postcondition.
The configured Agent Runtime performs the one granted push. `TaskWorkspaceManager` snapshots every
linked RepositoryWorkspace around the Run so a remote-ref action cannot silently mutate assigned
or non-assigned task Git subjects. Result admission requires the observed destination to equal the
exact Candidate SHA.

Controller-loss recovery leaves the original Run interrupted and rechecks the remote before a
retry. Exact already-satisfied state is recorded as an observed result without rewriting that Run.
Multi-Repository partial success remains durable; terminal managed completion requires exact
integration or GitHub merge evidence for every Candidate. A separate human disposition may end an
accepted task with reason `accepted_without_managed_integration` while preserving all unintegrated
subjects and making no delivery claim.

## Context And Capability Model

```text
Control Contract
  authorization, identity, outcomes, gates

Run Context Projection
  current operation and plan slice

Repository-native Harness
  exact-base semantic guidance plus confirmed frozen overlay, optional

Operation-scoped Runtime Skill
  optional execution method
```

Planning receives read-only access to every linked TaskWorkspace repository. WorkUnit execution may
read all links but receives write authority for only its assigned RepositoryWorkspace; Core verifies
the remaining Git subjects did not change. Review is read-only over exact Bundle subjects and
evidence. Control mutations use typed application commands.

Complete history remains in ChangeSetStore, RunStore, Git, and linked artifacts. Provider context
and compaction may optimize a Run but never replace durable state.

The initial admission target is at most 70 percent context usage. Continuous enforcement is a later
adapter capability and must not be inferred from byte estimates or partial provider telemetry.

## Control And Workspace Separation

```text
Portfolio control root
  catalog
  ChangeSets
  Runs
  Bundle manifests
  decisions

Registered repository
  source and Harness
  Git history

Task workspace
  stable one-to-one ChangeSet operational identity
  linked RepositoryWorkspaces prepared before planning
  persistent planning, execution, feedback, review, and delivery context

RepositoryWorkspace
  exact base, target, local branch, and owned worktree
  immutable selected Harness overlay, removed before Candidate publication
  at most one assigned writer; other task Runs receive read-only context
  independently derived Candidate and delivery subject
```

Agents do not edit raw control state through repository workspaces. Typed outcomes cross the
boundary.

## Identity Model

Paths and provider session ids are locators. Durable identities should include:

```text
portfolio_id
project_id
repository_id
change_set_id
intent_revision
repository_selection_revision
repository_workspace_policy_revision
repository_harness_selection_revision
plan_revision
work_unit_id
run_id
candidate_id = repository_id + base_sha + candidate_sha
bundle_revision + bundle_hash
delivery_target_id = repository_id + target_ref
```

Do not key a durable Project by an absolute path. Do not key a Candidate by a branch name.

## Concurrency Model

```text
Planning:
  one current plan revision per ChangeSet

Execution:
  independently dispatchable by RepositoryWorkspace when configured capacity permits

Bundle assembly:
  only from terminal or explicitly excluded WorkUnits for the current plan

Delivery:
  serialized by repository_id + target_ref

Granted integration:
  serialized by repository_id + exact destination_ref
```

Two parallel Candidates from the same base remain valid review subjects. If their common target
moves, integration readiness becomes stale, not historical Candidate evidence.

## Recovery Model

On restart:

1. acquire one Portfolio scheduler ownership record;
2. inspect persisted non-terminal Runs;
3. classify proven-live, interrupted, resumable, or blocked Runs;
4. verify workspace ownership and exact Git heads;
5. never overwrite a completed Candidate or human decision;
6. resume only from the current ChangeSet and plan revision.

An exact current CandidateCheckpoint may resume repository validation, and an unchanged current
Candidate set may resume combined validation, without repeating execution. Interrupted verification
or Bundle review abandons its incomplete Run and disposable read-only resources, reuses matching
passed deterministic evidence, and starts one fresh same-purpose Run only for the unchanged exact
subject. Failed selected-command attempts remain immutable evidence. An operational retry may use a
different bounded timeout while preserving the same selected semantic check and exact subject.
Obsolete private pre-checkpoint records are not imported or rewritten by the current baseline.

One generic reconciler handles all persisted running Runs, including integration. It records an
unprovable invocation as `interrupted`, retains the owning ChangeSet and WorkUnit phase, then
applies the bounded workspace adapter for planning cleanup, writable execution preflight, or
disposable verification cleanup.
A new same-phase Run starts only after exact authority is re-established. Completed invocation,
checkpoint, and passing validation evidence is reused rather than repeated.

Provider-native context may optimize continuation but is not lifecycle authority.
The first real adapter abandons an incomplete Provider session after controller loss and starts a
fresh Provider thread for a retry. Durable Provider-session recovery requires later accepted proof
of exact revision, workspace, event, and context identity.

## First Extraction Boundary

Do not treat Conductor.build as a source dependency or port the complete historical local reference
application.

Candidate reuse should begin with implementation-independent behavior:

- process deadline and cancellation patterns;
- Run events and large-output artifact handling;
- Git worktree ownership and containment checks;
- exact Candidate preflight;
- structured Agent outcomes and check observations.

The following should be redesigned:

- ProjectRuntime;
- WorkItemStateStore;
- WorkItemRunner;
- single-Candidate review commands;
- project-local status and UI projections;
- initialization tied to one Git root.

## First Real Provider Boundary

The first production `AgentRuntimeAdapter` uses the official `@openai/codex-sdk` TypeScript package.
It is one adapter implementation, not a Provider framework.

Each Run attempt owns a fresh SDK thread and child process. Planning first materializes one owned
detached worktree at each selected Repository's persisted `resolved_base_sha`; planning writes are
non-authoritative. Execution publishes only the current WorkUnit workspace Git subject. Worktrees
isolate development state, not the Runtime process from the host.

An exact AgentProfile selects `host_user` or `operation_scoped`. The trusted-local mode maps to
Codex `danger-full-access`, inherits the host environment, and leaves native Sandbox, network, Web
Search, history, tools, and subagents to the selected Provider environment. The optional constrained
mode retains planning `read-only`, execution `workspace-write`, disabled network, and a controlled
environment. Verification is also `read-only`, uses a disposable detached worktree at the exact
Candidate SHA, and fails closed when Git state changes. The adapter never silently falls back
between modes. Provider setup and native Windows prompts remain external readiness concerns, not
ChangeSet gates.

The adapter uses strict JSON Schema terminal output and maps streamed items into bounded normalized
events. Provider types and full transcripts remain adapter evidence. Only validated typed outcomes
cross into the application service.

Run evidence separates one ChangeFleet Runtime invocation from provider-native request, step, model,
or aggregate usage observations. Every observation declares confidence and coverage. Codex
turn-level usage may be `aggregate_only`; internal or experimental per-response events are not a
production dependency.

The SDK dependency is pinned exactly. Secrets enter through a controlled external environment and
are not persisted. Provider-global Harness and settings are isolated when supported; any hidden
input prevents an `enforced` context or reproducibility claim.

## Exact Repository Harness Overlay Boundary

`RepositoryWorkspacePolicyRevision` is reusable Repository configuration. Its only accepted first
purpose is immutable Repository Harness, selected by explicit patterns or an explicitly authorized
tracked exact-base `.worktreeinclude`. `RepositoryHarnessSelectionRevision` is the exact
ChangeSet-bound input: base SHA, Provider family, policy and selector identity, resolved paths,
content digest, immutable artifact reference, and confirmation.

The first Codex snapshotter admits only contained regular Git-ignored files under
`AGENTS.override.md` and `.agents/skills/**`, within bounded file and byte limits. It excludes
ordinary untracked files, links that may escape, tracked collisions, Provider configuration,
credentials, environment files, caches, and general workspace seeds.

`RepositoryWorker` reconstructs the snapshot in owned RepositoryWorkspaces without
rereading the registered checkout. It verifies immutability, removes every overlay path before
Candidate publication, and fails closed on mutation or requested non-Git Harness delivery. It never
writes overlay content back to the registered checkout.

Run evidence records exact-base availability, overlay identity, and Provider-observable discovery
separately. Detailed inventories and bytes remain linked artifacts outside default Agent context.

## Explicit ChangeSet Closure Boundary

One shared human operation may close an unfinished quiescent pre-delivery ChangeSet as
`abandoned`. It appends a bounded decision, changes the aggregate's terminal projection, and then
idempotently releases only the task's owned replaceable worktrees. Existing Runs, evidence, usage,
repository authority, checkpoints, Candidates, Bundles, commands, decisions, and blockers remain
immutable history and exact reads continue to work.

Close does not invoke Runtime, validation, delivery, or another external adapter. It neither creates
nor links a successor. The user creates a later task through the
ordinary creation operation, which resolves and freezes its branch and base independently.

The initial operation rejects active lifecycle work and any begun delivery. Generic resume,
human-hold, retry policy, turn checkpoints, rewind, restart, fork, conversation deletion, and
retention remain deferred rather than hidden behind a broad lifecycle command.

## Deferred Architecture

The following remain outside the currently authorized implementation slice:

- Git URL mirrors and clone workers;
- remote workers;
- generic workspace seeds and setup, run, or archive lifecycle;
- shared organization catalog;
- authoritative service graph;
- provider routing;
- production Runtime Skill packaging;
- Codex App Server, in-flight steering, and durable Provider-session recovery;
- a second real Provider such as Claude Agent SDK;
- pricing, dashboards, budget enforcement, and cross-ChangeSet effectiveness comparison;
- Linear or another tracker integration;
- continuous context enforcement;
- stacked ChangeSets;
- GitHub webhooks, CI subscription, and non-GitHub delivery providers;
- automatic merge;
- deployment and production rollback;
- remote or multi-user UI, daemon service, desktop shell, and full lifecycle controls;
- hosted multi-tenancy.
