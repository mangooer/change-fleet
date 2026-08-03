# ChangeFleet Product Specification

Status: Initial accepted product contract

ChangeFleet coordinates one confirmed software intent across one or more Git repositories and
produces an exact, reviewable `CandidateBundle`.

This specification defines the product boundary. `docs/current-state.md` records implementation
status and open questions. `docs/architecture.md` describes the target component model. Decisions
record durable rationale, while proposals preserve chronological design changes.

## 1. Problem

General-purpose coding Agents can increasingly:

- inspect unfamiliar repositories;
- plan implementation;
- create subagents;
- use repository-native skills and tools;
- edit code and run tests;
- create branches and Git worktrees.

The remaining hard problem is not how an Agent writes code. It is how one business intent remains
coherent when it affects multiple repositories, branches, Agents, attempts, checks, and human
decisions.

Without an external control plane:

- a one-line request may begin implementation before its true repository scope is understood;
- front-end, back-end, contract, and shared-library changes may become unrelated tasks;
- plan changes may force duplicate tasks or erase why an earlier attempt was abandoned;
- parallel changes can validate against stale target branches;
- checks may be attributed to a different SHA than the reviewed result;
- a partial multi-repository result may be presented as complete;
- process loss may erase the durable relationship between work, evidence, and decisions;
- "rollback" may be promised where only discard, revert, or business compensation is possible.

ChangeFleet provides the deterministic control boundary around autonomous Agent execution.

## 2. Product Outcome

Given a confirmed change intent and an explicitly registered Project, ChangeFleet should:

1. let an Agent inspect only authorized repositories;
2. normalize the intent and propose a versioned, code-informed ChangePlan;
3. route low-risk plans automatically and high-risk or expanded scope to human confirmation;
4. execute repository-scoped WorkUnits in isolated Git workspaces;
5. preserve plan revisions and abandoned attempts without duplicating the ChangeSet;
6. publish exact repository Candidates;
7. bind repository and combined validation evidence to those Candidates;
8. present one exact CandidateBundle for review;
9. retain durable recovery and audit evidence;
10. prepare explicit DeliveryTargets without claiming universal atomic merge or rollback.

The primary product subject is the ChangeSet. A Run, Agent session, WorkUnit, Candidate, PR, or
branch is evidence or execution detail within that subject.

## 3. Goals

- Support one ChangeSet spanning one or more registered Git repositories.
- Keep Project configuration minimal and human-reviewable.
- Accept both discussed design intent and terse one-line requests through one intake pipeline.
- Make intent normalization, impact analysis, planning, and plan revision explicit.
- Allow Agent-native subagents, tools, skills, code discovery, and reasoning.
- Freeze repository scope, target refs, base SHAs, and Candidate identity.
- Support safe parallel WorkUnit execution and target-specific integration serialization.
- Review one exact CandidateBundle with a complete validation matrix.
- Preserve state across Runtime or controller restart.
- Make uncertainty, missing checks, partial failure, and stale Candidates visible.
- Keep repository-specific intelligence in repository-native Harness and Agent Runtimes.

## 4. Non-Goals

The initial product does not:

- implement a generic multi-agent graph framework;
- centrally install or manage Agent skills, MCP servers, credentials, or models;
- build a semantic code index or service graph as control authority;
- infer every framework, module, service relationship, or test command in Core;
- copy repository Harness content into a central template;
- implicitly create, repair, or update Harness in a registered repository;
- scan or authorize arbitrary local directories;
- silently include dirty local files in a task base;
- provide a universal cross-repository Git transaction;
- promise universal rollback after merge, deployment, database mutation, or external side effects;
- automatically merge, deploy, or mutate production systems in the first vertical slice;
- support remote workers, hosted multi-tenancy, or organization-wide policy in the first slice;
- preserve compatibility with Conductor's single-repository WorkItem schema.

## 5. Ownership Boundaries

| Plane | Owns | Does not own |
| --- | --- | --- |
| Project repositories | source, repository Harness, skills, build configuration, Git history | ChangeSet lifecycle or cross-repository decisions |
| ChangeFleet control plane | catalog, ChangeIntent, plan revisions, WorkUnits, scheduling, exact subjects, evidence, human commands | semantic code understanding or provider reasoning |
| Agent Runtime | reasoning, native context, code discovery, subagents, tools, implementation, check selection | repository authorization, canonical lifecycle, acceptance |
| Delivery systems | PR state, CI state, merge controls, deployment state | ChangeFleet intent or private Agent reasoning |
| Human operator | scope approval, unresolved product decisions, final review, risky delivery authorization | low-level execution bookkeeping |

An Agent may propose a scope, plan, check, or delivery action. It may not silently turn that proposal
into expanded repository authority or final human acceptance.

### Runtime Dispatch Context

Every managed Agent operation receives four separately owned context layers:

1. a compact, versioned ChangeFleet Control Contract;
2. a generated current Run Context Projection;
3. repository-native Harness from the exact frozen base plus any confirmed frozen overlay;
4. optional Runtime-native, operation-scoped Skills.

The Control Contract owns authorization, exact identity, allowed typed outcomes, evidence reporting,
cancellation, and human gates. The current projection supplies only the confirmed intent summary,
current plan and relevant WorkUnit slice, authorized repositories and SHAs, workspace capability,
current blockers and decisions, required evidence, and references needed by that operation.

Superseded plans, unrelated WorkUnits, complete transcripts, diffs, logs, and private Agent
reasoning are not default context. They remain durable structured records or linked artifacts. A
fresh Agent session reconstructs current context from those records rather than treating provider
conversation memory as lifecycle authority.

Repository Harness is optional semantic input. ChangeFleet records exact-base and explicitly frozen
overlay resources plus what the Provider reports as discovered or loaded. Registration and
execution do not create or write `AGENTS.md`, `WORKFLOW.md`, `.changefleet`, Skills, architecture,
or test policy in a registered repository. Non-Git Harness overlays are immutable Run inputs and
never become a writeback or delivery surface.

### Agent Profiles And Capabilities

A stable `AgentProfile` selects a Runtime adapter and provider-native model, reasoning, capability,
and optional Skill settings. Provider model names and Skill catalogs do not become fields in the
ChangeSet aggregate.

Default capabilities are operation-scoped:

| Operation | Default capability |
| --- | --- |
| Planning | Read-only access to explicitly authorized frozen repository bases |
| WorkUnit execution | Read/write access only to that WorkUnit's isolated repository workspace |
| Bundle review | Read-only access to exact CandidateBundle subjects and evidence |
| Control decision | Typed ChangeFleet command; no raw control-store or arbitrary filesystem access |

Runtime-native subagents remain inside the capability boundary of their parent operation. They
cannot expand repository scope or authorize control transitions.

Task trackers such as Linear may provide intake, links, status, or generated progress projections.
Tracker state is not authority for plan confirmation, repository authorization, Candidate identity,
or CandidateBundle acceptance.

### Context Admission

The accepted initial target is:

```text
maximum_initial_context_ratio = 0.70
minimum_initial_headroom_ratio = 0.30
```

Context evidence is classified as:

- `enforced` when the adapter observes the effective context window and every component required for
  the initial admission decision and can fail before crossing the limit;
- `estimated` when ChangeFleet can bound its own material but some Runtime components are hidden;
- `unknown` when the denominator or material components are unavailable.

No adapter may claim a continuous context guarantee unless it observes or controls every relevant
model-request boundary. The first deterministic slice does not require a Runtime Skill Kit, real
Provider adapter, tracker integration, or continuous enforcement.

## 6. Core Model

### Portfolio

A Portfolio is one ChangeFleet control environment. It contains explicitly registered Projects and
Repositories plus durable ChangeSet state.

The Portfolio control root is not Candidate Git content. Registered repositories do not receive
copied control state.

### Project

A Project is a logical product, business system, or bounded code domain. It has:

- a stable id;
- a human-readable name;
- a free-form description;
- an explicit set of Repository bindings.

A Project is not required to match one Git repository. Shared repositories may eventually
participate in more than one Project, but the first slice may reject ambiguous registration until a
clear authorization rule is accepted.

### Repository

A Repository is a stable logical identity for one Git repository. Initial configuration includes:

- a Repository id;
- exactly one locator;
- an optional description;
- an optional default target ref;
- an optional confirmed `RepositoryWorkspacePolicyRevision`;
- mutation authorization.

The first vertical slice supports a local-path locator. The path is host-local configuration, not
durable cross-host identity. ChangeFleet resolves and records the Git root and canonical remote
when available. Repository defaults are navigation defaults, not ChangeSet base authority.

### ChangeIntent

`ChangeIntent` is the confirmed task-scoped statement of:

- objective and desired behavior;
- business or user rationale when relevant;
- constraints and non-goals;
- acceptance criteria;
- resolved design decisions;
- open questions;
- source and confirmation evidence.

A conversation transcript is not the ChangeIntent. Discussion may produce an editable intent, but
only explicit confirmation makes it executable.

Repository Harness is long-lived project knowledge. ChangeIntent is task-specific. Task discussion
must not be appended to repository Harness unless the accepted change establishes a durable project
fact.

### RepositorySelectionRevision

Creating a ChangeSet establishes the planning-visible Repository set and branch selection before
Runtime planning. The set is a non-empty subset of the Project catalog and defaults to all
registered Repositories.

For every visible Repository, the caller may select a branch and target ref. An omitted branch is
the local checkout's current symbolic branch observed at ChangeSet creation. Detached HEAD without
an explicit branch is rejected. ChangeFleet resolves the branch once and persists its exact base
SHA; dirty checkout files are excluded.

RepositorySelectionRevision preserves this authority as versioned ChangeSet history. Runtime output
may request but cannot apply a later selection. A confirmed revision supersedes current planning
authority and returns the same ChangeSet to planning while preserving prior evidence.

### RepositoryHarnessSelectionRevision

Every planning-visible Repository has a frozen Harness selection no later than ChangeSet creation.
The default is `exact_base_only`. An optional confirmed Repository workspace policy may select
contained Git-ignored Provider-native semantic resources through explicit patterns or an explicitly
authorized tracked exact-base `.worktreeinclude`.

An `exact_base_plus_overlay` selection binds the Repository id, resolved base SHA, Provider family,
workspace-policy revision, selector digest, canonical relative paths, content digest, immutable
artifact reference, and confirmation. Retry and recovery reconstruct this exact snapshot instead
of rereading the registered checkout. A confirmed selection revision invalidates the current plan,
rebuilds current Run context, and preserves prior attempts.

### ChangePlan

`ChangePlan` is a versioned, code-informed execution proposal containing:

- the ChangeIntent revision it implements;
- selected repositories and components;
- reason each repository is in scope;
- the current RepositorySelectionRevision and its control-owned target refs and frozen base SHAs;
- WorkUnits and dependency ordering;
- expected file, API, schema, or behavior boundaries;
- repository and combined validation;
- delivery order;
- discard, revert, rollout, or compensation expectations;
- unresolved risks and required decisions.

A ChangePlan is not proof that the impact analysis is complete. Unknown or unverified impact must
remain explicit.

### ChangeSet

A ChangeSet is the aggregate root for one confirmed intent. It owns:

- ChangeIntent revisions;
- RepositorySelectionRevisions;
- RepositoryHarnessSelectionRevisions;
- ChangePlan revisions;
- WorkUnits and their dependencies;
- execution attempts;
- repository Candidates;
- CandidateBundle revisions;
- validation evidence;
- scope decisions;
- human review and delivery decisions.

Replanning continues the same ChangeSet. A new ChangeSet is created only for a distinct business
intent, not merely because an earlier plan was wrong.

### WorkUnit

A WorkUnit is one repository-scoped unit of execution. It records:

- ChangeSet and plan revision;
- Repository id;
- target ref and base SHA;
- workspace identity;
- dependency WorkUnits;
- Agent assignment and Run references;
- current state;
- resulting Candidate, blocker, or supersession.

One Agent Run may use native subagents internally. ChangeFleet does not model those subagents as
WorkUnits unless they correspond to independently controlled repository execution.

### Candidate

A Candidate is one immutable repository result:

```text
repository_id
target_ref
base_sha
candidate_sha
workspace ownership
changed paths and Git evidence
Candidate-bound verification observations
```

Changing the commit, rebasing, merging, or applying the patch to another base creates a new
Candidate identity.

### CandidateBundle

A CandidateBundle is an immutable, versioned manifest containing the exact Candidates reviewed as
one coherent ChangeSet result.

It also records:

- ChangeIntent and ChangePlan revisions;
- expected WorkUnits;
- missing, blocked, superseded, or excluded WorkUnits;
- repository validation;
- combined validation;
- unverified risks;
- bundle hash and creation evidence.

Human review and acceptance bind to the complete bundle manifest, not merely one repository SHA.

### Initial Combined Validation Invocation

In the first slice, a confirmed ChangePlan defines one combined validation command using a stable
command id, executable, argument array, and timeout. ChangeFleet invokes it directly without a
shell from a control-owned validation directory and supplies one immutable JSON manifest through
`CHANGEFLEET_VALIDATION_MANIFEST`.

The manifest contains the ChangeSet and plan revision, exact Candidate identities, host workspace
locators, and a canonical validation-subject hash. The subject hash excludes host paths and binds
the sorted Candidate identities plus required check definition. The manifest bytes receive their
own evidence hash.

ChangeFleet mechanically revalidates each Candidate workspace before and after the command. A
passing combined result requires exit code zero, clean workspaces, and unchanged exact Candidate
SHAs. CandidateBundle assembly occurs only after bounded command evidence is finalized, so Bundle
identity includes validation evidence without circularly requiring a Bundle hash before execution.

### DeliveryTarget

A DeliveryTarget maps a Candidate to a repository destination ref or external PR subject. The
destination may move after Candidate creation.

Publication or integration against a moved target requires new integration evidence and may require
a new CandidateBundle. Evidence for the old Candidate never silently transfers to a changed SHA.

## 7. Intake And Planning

ChangeFleet supports two input shapes:

1. a discussed and confirmed design intent;
2. a terse request whose intent must be elaborated.

They use one pipeline:

```text
raw request or discussion draft
  -> normalized ChangeIntent
  -> confirmed Repository selection and exact branch freeze
  -> authorized repository discovery
  -> ChangePlan
  -> risk and scope decision
  -> execution
```

The difference is input completeness, not lifecycle authority.

### Risk Routing

Project policy may pre-authorize low-risk execution. A plan normally requires explicit confirmation
when it includes:

- more than one repository;
- public API, event, or schema changes;
- database migration;
- authentication, authorization, secrets, payment, or security behavior;
- external writes or irreversible side effects;
- a target ref other than the configured default;
- repository scope expansion;
- unresolved product choices;
- rollback or compatibility uncertainty.

An Agent's confidence score may inform a decision but is not the only gate. Deterministic risk
triggers and standing human policy own authorization.

## 8. Execution And Replanning

A WorkUnit executes only after its repository, target ref, base SHA, and plan revision are frozen.

During execution:

- implementation-detail changes may continue without human interruption;
- repository scope expansion produces a typed decision request;
- branch, target, or planning-visibility changes produce a typed Repository selection request;
- invalidated design assumptions produce a new plan revision;
- existing useful changes may be reused when their exact identity remains valid;
- abandoned attempts remain immutable history;
- a blocker pauses the ChangeSet without manufacturing terminal failure.

The lifecycle must distinguish:

```text
analyzing
plan_ready
awaiting_plan_confirmation
executing
decision_required
replanning
validating
candidate_review
delivery_ready
done
canceled
failed
```

This list is conceptual until the first state-schema proposal is accepted. Implementation must not
persist it prematurely as a compatibility contract.

## 9. Parallel Work And Branches

WorkUnits may execute concurrently in isolated workspaces.

Execution generally does not require an exclusive repository lock. Integration or publication to a
mutable destination is serialized by:

```text
destination_key = repository_id + target_ref
```

Two ChangeSets may produce Candidates from the same base in parallel. When one result moves the
target ref, the other becomes integration-stale. It must be refreshed, produce a new exact subject,
and rerun the checks affected by the new base before delivery.

Different target refs are independent delivery destinations.

An implicit dependency created by starting from another task's mutable branch is invalid. A
dependent or stacked ChangeSet must reference an exact upstream CandidateBundle revision. Stacked
ChangeSets are outside the first vertical slice.

## 10. Repository Configuration And Materialization

The initial human-authored configuration should contain only stable control facts:

```yaml
projects:
  commerce:
    description: |
      Customer web calls the order API. Public contract changes must remain backward compatible.
    repositories:
      customer-web:
        source:
          path: D:/workspace/customer-web
        description: Customer-facing web application
      order-api:
        source:
          path: D:/workspace/order-api
        description: Order and fulfillment service
```

Relationships and service descriptions are navigation hints. Agents must verify them against
current repository code and Harness.

Registration resolves a local locator through read-only Git inspection:

```text
configured path
  -> Git top-level
  -> Git common directory
  -> canonical remote when available
  -> default ref
  -> readiness and authorization evidence
```

Task execution freezes a commit SHA and creates an isolated workspace. Dirty files in the
registered checkout are never silently copied. The only initial exception is a confirmed
Repository Harness policy resolved and snapshotted no later than ChangeSet creation. It may admit
contained Git-ignored semantic resources, never ordinary untracked files or Provider settings,
credentials, environment files, caches, or general workspace seeds.

Frozen Harness overlays are restored only inside ChangeFleet-owned planning and WorkUnit
workspaces. They are immutable, verified and removed before Candidate publication, and excluded
from Git identity. ChangeFleet never writes them back to the registered checkout. Overlay mutation
fails with `HARNESS_OVERLAY_MODIFIED`; a requested durable private Harness change fails with
`NON_GIT_HARNESS_CHANGE_UNSUPPORTED`.

A future Git URL locator may materialize through a local mirror or clone, but must produce the same
resolved Repository and WorkUnit contracts.

## 11. Validation And Review

Validation has two levels:

- repository validation for each exact Candidate;
- combined validation for the exact CandidateBundle.

Combined validation may include:

- contract compatibility;
- generated-client consistency;
- cross-repository builds;
- integration tests;
- end-to-end behavior;
- rollout compatibility checks.

Core records structure, identity, command, exit status, evidence reference, and unverified
boundaries. Agent Runtimes and repository Harness select semantically appropriate checks.

A successful command is evidence only for the exact subject and behavior it exercised.

Review receives:

- confirmed intent;
- current plan revision;
- complete CandidateBundle manifest;
- exact repository diffs;
- repository and combined check evidence;
- superseded or missing WorkUnits;
- unverified risks;
- proposed delivery order and compensation boundaries.

Review does not inherit private execute reasoning as authority.

## 12. Recovery, Audit, And Rollback

ChangeFleet persists enough control state to recover after controller or Runtime process loss:

- current ChangeSet and plan revision;
- current WorkUnits and dependencies;
- workspace ownership;
- exact Runs, Candidates, and Bundle revisions;
- pending human decisions;
- durable blockers and dispatch holds.

Audit records must answer:

- what intent was confirmed;
- which repositories were authorized;
- why scope changed;
- what plan and code snapshot were used;
- what each Agent produced;
- what checks ran against which exact subject;
- what the human reviewed and decided;
- what was delivered or left unresolved.

### Runtime Invocation Evidence

Every real Agent Runtime call records one immutable `RuntimeInvocation` against its exact Run
attempt. It preserves operation, Agent Profile and context-projection identity, requested and
observable effective Runtime settings, Provider locators and versions, start and finish time,
duration, terminal outcome, and raw evidence references.

Provider usage is stored as zero or more `UsageObservation` records at the finest scope the
supported interface exposes:

```text
scope             request | step | model | aggregate
confidence        provider_reported | estimated | unknown
coverage          complete | partial | aggregate_only | unknown
```

Missing token, cache, reasoning, model, request, or subagent detail remains unknown. ChangeFleet
does not infer exact values or complete coverage from partial Provider output. Provider-reported
monetary values are labeled estimates; normalized cost requires separately accepted versioned
pricing authority.

Runtime usage, cost, retry, effectiveness, and Provider traces are audit/debug evidence. Ordinary
Control Contracts and current Run Context Projections exclude them.

Private, versioned `RunAuditProjection` and `ChangeSetAuditProjection` views may be derived on
demand from immutable ChangeSet, Run, evidence, Bundle, and human-decision records. The isolated
query component is read-only: it does not persist a rollup, mutate lifecycle or recovery state,
invoke an Agent, touch a workspace or Git, or affect routing and authority.

One package-private local command may inspect either projection for one explicit control root and
exact Run or ChangeSet id. It emits the unchanged projection as JSON on stdout and typed localized
failure as JSON on stderr. It does not initialize or repair a store, discover subjects, invoke
lifecycle commands, access registered repositories, or establish a public CLI contract.

Usage summaries identify the chosen source observation and selection reason. Exactly one valid
Provider aggregate is preferred; one otherwise-unambiguous observation may be used; potentially
overlapping observations produce an unknown total. Cached input and reasoning output are not added
again when defined as subsets, null remains unknown, and aggregate-only evidence never implies
per-step coverage. Reports keep Runtime, validation, wall, and human-gate clocks separate and keep
Runtime, planning, WorkUnit, validation, Bundle, review, and delivery outcomes separate.

Each bounded report binds its schema, exact source identity, query, and factual payload with a
deterministic digest that excludes observation time. Broken required references fail closed;
optional unsupported Provider values remain explicit unknowns. Large artifacts remain linked by
reference. Cross-ChangeSet comparison, rankings, pricing, dashboards, exports, and automatic
optimization require later accepted authority.

Harness evidence separately identifies exact-base resources, frozen overlays, and
Provider-observable discovery. Snapshot bodies and detailed inventories remain linked artifacts
outside ordinary Runtime context. Missing actual-load observations remain unknown.

Rollback language is phase-specific:

| Phase | Supported semantic |
| --- | --- |
| Before merge | abandon Candidate, close proposed delivery, clean eligible workspace |
| Merged but not deployed | prepare or record exact revert |
| Deployed stateless code | use delivery-system rollback or feature flag when configured |
| Database or schema mutation | use accepted expand/contract or compensation plan |
| External business side effect | record explicit compensating action or human blocker |

Cross-repository recovery follows a saga model. Partial success is preserved as fact; it is never
rewritten as atomic success or silently erased.

## 13. Initial Vertical Slice

The first implementation should prove:

- one Portfolio control root;
- one Project;
- two explicitly registered local Git repositories;
- one terse or discussed ChangeIntent;
- read-only impact analysis;
- one multi-repository ChangePlan confirmation;
- two isolated WorkUnits;
- sequential or parallel execution according to a simple dependency DAG;
- exact repository Candidates;
- repository checks and one combined validation command;
- one CandidateBundle;
- one human review decision;
- process-restart-safe current state.

The first slice excludes:

- Git URL clone or mirror;
- automatic PR creation, merge, or deployment;
- stacked ChangeSets;
- service-graph authority;
- remote workers;
- a full browser UI;
- a production Runtime Skill Kit;
- a real Provider adapter;
- Linear or another tracker integration;
- continuous context enforcement;
- production database migration;
- backward compatibility with Conductor state.

Implementation begins only after the first vertical-slice proposal and implementation stack are
explicitly accepted.

## 14. First Real Provider Stage

After the deterministic kernel and Repository selection boundary, the accepted first real Agent
Runtime uses the official Codex TypeScript SDK behind the narrow `AgentRuntimeAdapter`.

Each Run attempt owns a fresh Provider thread and local process. Provider session identity is a
locator, not durable ChangeFleet authority. Controller loss abandons an unfinished attempt; retry
uses a fresh thread and rebuilt current projection rather than blindly resuming hidden Provider
context.

Before planning, ChangeFleet materializes each planning-visible Repository at its persisted
`resolved_base_sha` in an owned detached planning worktree. Planning receives read-only access only
to those roots. WorkUnit execution remains write-scoped to one isolated Repository workspace.
Dirty files and a later branch movement in the registered checkout cannot affect either view.

The adapter:

- supplies the Control Contract, current Run Context Projection, exact-base repository Harness, and
  only explicitly selected Runtime Skills;
- maps the Agent Profile to provider-native model, reasoning, environment, and capability settings;
- requires strict structured planning and execution outcomes;
- records bounded normalized events and Runtime invocation evidence;
- keeps Provider output subject to current-revision, authorization, exact-subject, and human-gate
  validation;
- disables network by default and never uses full host access as a fallback;
- keeps secrets outside persisted ChangeSet and Run payloads.

The first stage proves one real single-Repository planning-to-Candidate flow. App Server, a second
Provider, Provider-session recovery, Runtime Skill Kit packaging, continuous context enforcement,
pricing, effectiveness comparison, dashboards, Linear, remote workers, and delivery remain
deferred.

## 15. Exact Repository Harness Overlay Stage

The accepted next stage preserves exact-base Harness as the default and adds one optional Codex
local-overlay path. A confirmed, revisioned Repository policy selects explicit Git-ignore-style
patterns or an explicitly authorized tracked `.worktreeinclude`. ChangeSet creation freezes the
resolved paths and bytes against the selected base before any planning Run.

The first eligible Codex overlay roots are `AGENTS.override.md` and `.agents/skills/**`. Every
selected path must be contained, regular, Git-ignored, non-colliding, and within 128 files,
256 KiB per file, and 2 MiB total per Repository. Provider configuration and general workspace
initialization content are not Harness.

Planning, execution, retry, and recovery receive the same immutable snapshot. Candidate publication
fails if an overlay was changed and proves no overlay content entered Git. ChangeFleet records
bounded identity and discovery evidence without eagerly adding snapshot bodies to Agent context.

Generic `workspace_seed`, setup/run/archive behavior, Claude support, external Harness roots,
remote workspace materialization, non-Git Harness writeback, and a parallel Harness change review
lifecycle are outside this stage.
