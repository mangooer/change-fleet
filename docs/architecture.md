# ChangeFleet Architecture

Status: Initial target architecture

This document describes the intended component boundaries. It does not claim that these components
are implemented.

## Architectural Thesis

ChangeFleet should become smaller as Agent Runtimes become more capable.

The control plane should not duplicate semantic planning, code indexing, subagent orchestration,
skill management, or repository-specific verification intelligence. Its durable purpose is to turn
Agent work into authorized, recoverable, exact, and human-reviewable change transactions.

```text
Agent Runtime owns how code work is performed.
ChangeFleet owns which repositories may participate, which exact result exists,
which evidence belongs to it, how partial work continues, and what a human accepted.
```

## Logical Layers

```text
Application
  CLI / API / future UI
  task intake and human decisions

Change Control
  ChangeIntent and ChangePlan revisions
  ChangeSet lifecycle
  WorkUnit DAG scheduler
  CandidateBundle and validation matrix
  delivery readiness

Repository Execution
  RepositoryLocator resolution
  workspace materialization
  current Run Context Projection
  AgentProfile and capability dispatch
  Agent Runtime invocation
  repository Candidate publication
  repository check evidence

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

It replaces the single-repository assumption of Conductor's `ProjectRuntime`.

### CatalogStore

Owns explicitly confirmed:

- Projects;
- Repository bindings;
- local-path locators;
- descriptions;
- optional default refs;
- mutation authorization.

Catalog data is control-plane state. Repository-native Harness remains in the repository.

### ChangeSetStore

Owns current aggregate state and references to immutable evidence:

- ChangeIntent and ChangePlan revisions;
- WorkUnit state;
- scope decisions;
- active or superseded CandidateBundle revision;
- human decisions;
- recovery markers.

It should not embed complete logs, diffs, or large Agent output.

### RunStore

Owns immutable or append-only operational evidence:

- Run snapshots;
- structured events;
- large output artifacts;
- Agent outcomes;
- repository Candidate evidence;
- validation results;
- review reports.

### Initial Local Implementation Boundary

The first slice is one private Node.js 24 LTS ESM JavaScript package. It uses a ChangeFleet-owned
versioned filesystem store with atomic snapshot replacement, ownership locks, append-only or
immutable evidence, and restart reconciliation. Its only application surface is an in-process
service exercised through deterministic tests, and its only Runtime implementation is a scripted
fake behind the AgentRuntimeAdapter port.

The combined validation adapter invokes an executable and argument array without a shell. It passes
one immutable validation manifest by `CHANGEFLEET_VALIDATION_MANIFEST`, binds evidence to the exact
Candidate set, and repeats Candidate preflight before CandidateBundle assembly.

### Planner

The Planner is an Agent Runtime purpose, not a deterministic Core reasoning engine.

It receives:

- confirmed or draft intent;
- authorized Repository catalog;
- read-only repository access;
- repository-native Harness;
- current plan or decision feedback.

It returns typed proposals:

- normalized ChangeIntent;
- ChangePlan;
- repository scope expansion;
- decision request;
- plan revision;
- explicit blocker.

Core validates identity and policy, not whether the semantic plan is clever.

### RunContextAssembler

Builds a disposable current projection for one planning, execution, review, or recovery operation
from durable ChangeSet and Run state. It includes:

- exact operation, ChangeSet, plan, WorkUnit, repository, base, and workspace identity;
- confirmed intent summary and the relevant current plan slice;
- capability boundary, blockers, decisions, gates, and typed outcomes;
- required evidence and progressive resource references;
- initial context-budget components and classification.

It does not replay complete revision, attempt, transcript, diff, or log history. The projection is a
rebuildable view, not an aggregate or recovery authority.

### AgentRuntimeAdapter

Resolves an `AgentProfile` into provider-native Runtime, model, reasoning, permission, and optional
Skill settings. It:

- binds the versioned Control Contract and current Run Context Projection;
- creates the operation capability boundary;
- exposes exact-base repository Harness progressively when supported;
- records requested and observable effective Runtime settings;
- maps provider events and terminal output into typed Run outcomes;
- reports initial context evidence as `enforced`, `estimated`, or `unknown`.

The adapter does not authorize repositories, accept plans or Bundles, install repository Harness,
or maintain a universal model and Skill catalog.

### WorkUnitScheduler

The scheduler:

- evaluates explicit dependency edges;
- enforces project and repository concurrency;
- dispatches ready WorkUnits;
- persists holds, cancellation, and recovery facts;
- never infers semantic dependencies from prose;
- never lets an Agent directly authorize the next repository.

Execution capacity and destination serialization are separate concerns.

### RepositoryWorker

`RepositoryWorker` is a ChangeFleet-owned adapter informed by selected Conductor behavior, not a
Conductor extraction or compatibility layer in the first slice.

Conceptual interface:

```text
prepare(repository, target_ref, base_sha, work_unit)
execute(work_unit, workspace, intent, plan)
publish(workspace, exact_expected_head)
inspect(candidate)
cleanup(workspace, policy)
```

It owns one repository operation at a time. It does not own the multi-repository ChangeSet state or
human Bundle review. Its initial implementation uses explicit repository id, registered Git root,
target ref, base SHA, workspace id, and workspace root inputs and must not import Conductor state
types, workspace names, review lifecycle, or `ProjectRuntime`.

### BundleAssembler

Builds an immutable CandidateBundle from:

- the exact plan revision;
- expected WorkUnits;
- exact repository Candidates;
- repository checks;
- combined validation;
- missing, blocked, excluded, or superseded units.

A bundle hash changes whenever any subject or required evidence identity changes.

### BundleReviewer

Runs an optional independent Agent review or presents direct human review for one exact
CandidateBundle.

Review may request:

- repository-local rework;
- combined rework;
- scope or plan revision;
- missing verification;
- human decision;
- delivery readiness.

### DeliveryCoordinator

The first slice only prepares DeliveryTargets and detects target movement.

Future PR, merge, and rollout capabilities require separate accepted proposals. Delivery actions
must remain distinct from Candidate acceptance.

## Context And Capability Model

```text
Control Contract
  authorization, identity, outcomes, gates

Run Context Projection
  current operation and plan slice

Repository-native Harness
  exact-base semantic guidance, optional

Operation-scoped Runtime Skill
  optional execution method
```

Planning receives read-only access to authorized repository bases. WorkUnit execution receives write
access only to its isolated workspace. Review is read-only over exact Bundle subjects and evidence.
Control mutations use typed application commands.

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
  isolated checkout for one WorkUnit
  Agent changes
  repository Candidate
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
  parallel when WorkUnit dependencies and configured capacity permit

Bundle assembly:
  only from terminal or explicitly excluded WorkUnits for the current plan

Delivery:
  serialized by repository_id + target_ref
```

Two parallel Candidates from the same base remain valid review subjects. If their common target
moves, integration readiness becomes stale, not historical Candidate evidence.

## Recovery Model

On restart:

1. acquire one Portfolio scheduler ownership record;
2. inspect persisted non-terminal Runs;
3. classify proven-live, abandoned, resumable, or blocked operations;
4. verify workspace ownership and exact Git heads;
5. never overwrite a completed Candidate or human decision;
6. resume only from the current ChangeSet and plan revision.

Provider-native context may optimize continuation but is not lifecycle authority.

## First Extraction Boundary

Do not port the complete Conductor application.

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

## Deferred Architecture

The following remain proposal-only until the local two-repository slice proves demand:

- Git URL mirrors and clone workers;
- remote workers;
- shared organization catalog;
- authoritative service graph;
- provider routing;
- production Runtime Skill packaging;
- a real Provider adapter;
- Linear or another tracker integration;
- continuous context enforcement;
- stacked ChangeSets;
- PR creation and CI subscription;
- automatic merge;
- deployment and production rollback;
- hosted multi-tenancy.
