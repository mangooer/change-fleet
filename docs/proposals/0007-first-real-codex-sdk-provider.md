# 0007: First Real Codex SDK Provider

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-07-31

Depends on: Decisions 0005, 0008, and 0009, accepted

Accepted: 2026-07-31

Decision: [Decision 0010](../decisions/0010-first-real-codex-sdk-provider.md)

Implementation tracking:
[WI-0003](../work-items/WI-0003-first-real-codex-sdk-provider.md), `done`

## Context

WI-0001 proved the deterministic ChangeFleet control kernel with a scripted Runtime. WI-0002 then
made Repository selection, branch choice, exact base SHA, target ref, and later selection revision
explicit before any real Provider is authorized.

The next stage must prove that a real coding Agent can consume the compact Control Contract, inspect
only exact authorized source, produce typed planning and execution outcomes, modify only one
WorkUnit workspace, and return auditable Runtime evidence without turning ChangeFleet into a
Provider UI or generic Agent framework.

Connecting a real Provider exposes one correctness gap hidden by the scripted Runtime. A planning
projection may name an exact `resolved_base_sha`, but a real Agent that reads the registered
checkout can still observe another branch or dirty files. Exact planning source therefore requires
an isolated materialization boundary, not only metadata.

## Options Considered

### Option A: Codex App Server

App Server exposes a broad bidirectional Thread, Turn, item, approval, interrupt, model-catalog, and
session-management protocol. It is appropriate for deep interactive clients, but adopting that
surface now would add client lifecycle and experimental protocol work that the first one-shot
Provider stage does not need.

### Option B: Codex TypeScript SDK

The official `@openai/codex-sdk` package provides streamed events, strict structured output,
working-directory, model, reasoning, sandbox, approval, network, and additional-directory options,
plus turn usage. It fits the accepted Node.js ESM stack and leaves the Agent loop inside Codex.

### Option C: Claude Agent SDK

Claude Agent SDK provides a complete Agent loop, explicit permissions, sessions, subagents, and
fine-grained usage. It is a strong later conformance Provider, but choosing it first would
simultaneously introduce a second vendor's authentication, Harness-loading, session, and usage
semantics before the production Runtime port is proven once.

### Option D: Direct model API with a ChangeFleet-owned tool loop

This would make ChangeFleet responsible for tool selection, semantic iteration, context management,
and subagent behavior. It conflicts with Decision 0001 and is rejected.

## Accepted Design

### 1. Keep one narrow ChangeFleet Runtime boundary

Provider SDK types remain inside an adapter. The stable ChangeFleet exchange is:

```text
Run invocation
  exact operation and Run attempt
  Control Contract and current Run Context Projection
  exact planning roots or WorkUnit workspace
  Agent Profile and capability
  cancellation signal

Runtime result
  bounded normalized events
  one typed terminal outcome
  Provider locators
  usage and timing observations
  raw artifact references
```

ChangeFleet does not standardize every Provider tool, message, session, or subagent concept. A
Provider-specific evidence envelope may retain details that do not belong in the common domain.

### 2. Use Codex SDK with one fresh thread per Run attempt

The first adapter uses `@openai/codex-sdk` and starts one fresh Codex thread for each ChangeFleet Run
attempt. The adapter owns the local child process and does not share conversation state across
ChangeSets, plan revisions, WorkUnits, or retries.

One SDK query may perform as many model and tool steps as the native Agent loop requires. A Provider
thread id and child-process metadata are persisted only as locators and audit evidence.

The package and lock file pin one exact SDK version. Run evidence records every observable SDK, CLI,
Provider, requested model, effective model, and reasoning setting. The adapter fails honestly when
an unsupported configuration cannot be resolved; it does not maintain a universal model catalog.

Credentials enter through a controlled process environment or external credential locator. Raw
secrets are never written to ChangeSet, Run, WorkItem, log, or evidence payloads.

### 3. Materialize exact-base planning worktrees

Before planning dispatch, ChangeFleet materializes one detached planning worktree for each
Repository in the current planning-visible RepositorySelectionRevision:

```text
repository_id
resolved_base_sha
planning_workspace_id
planning_workspace_path
ownership
```

The Agent receives read-only access only to those roots. A one-Repository ChangeSet has one root; a
multi-Repository planning operation may receive several explicitly selected roots. It never
receives arbitrary Project or host-directory access.

Planning worktree identity and cleanup follow the same containment and ownership discipline as
execution workspaces. Dirty files from the registered checkout are absent. Harness discovery and
the Agent's filesystem view therefore refer to the same exact base.

Execution remains unchanged in authority: one WorkUnit, one Repository, one exact base, and one
isolated read/write workspace.

### 4. Keep Harness and context explicit

The adapter supplies:

1. the versioned ChangeFleet Control Contract;
2. the current Run Context Projection;
3. repository-native instructions reachable from the exact planning or execution workspace;
4. only Runtime Skills explicitly selected by the Agent Profile.

ChangeFleet does not copy a central Harness into registered repositories. Provider-global settings,
Skills, plugins, and local instruction sources are disabled or isolated when the supported SDK
surface permits it. Any remaining unobservable Provider input is recorded as a limitation and
prevents an `enforced` reproducibility or context claim.

Every attempt starts with a fresh session so superseded plans and prior telemetry do not accumulate
as implicit context. Initial context admission remains `enforced | estimated | unknown`; continuous
request-by-request enforcement stays deferred.

### 5. Map permissions from the ChangeFleet operation

The Agent Profile selects provider-native model, reasoning, and optional Runtime capability
settings, but it cannot expand ChangeFleet authorization.

| Operation | Provider boundary |
| --- | --- |
| Planning | Read-only selected exact-base planning worktrees |
| WorkUnit execution | Workspace-write only for the current WorkUnit workspace |
| Network | Disabled unless an accepted profile or typed decision explicitly enables it |
| Runtime subagents | Same or narrower roots and network policy as the parent Run |

`danger-full-access` is not a default or fallback. A Provider approval request cannot silently grant
new filesystem, Repository, network, or control authority.

### 6. Require structured terminal outcomes

Planning and execution use strict JSON Schema output. Natural-language stream items are progress or
linked evidence, not lifecycle authority.

The adapter validates the terminal payload before returning it to the application service.
ChangeFleet then applies its own current-revision, exact-subject, allowed-outcome, and human-gate
checks. Provider output may request a typed plan, Repository selection, scope, or human decision
transition; it cannot execute that transition directly.

Unsupported interactive Provider requests fail or become an already accepted typed ChangeFleet
request. The first stage does not build a parallel Provider-owned approval history.

### 7. Preserve deterministic failure and recovery

Explicit cancellation terminates the owned Provider operation and records its terminal evidence.
Controller or child-process loss marks an unfinished attempt abandoned according to the existing
Run recovery contract. A retry receives a fresh thread and rebuilt current projection.

The first stage does not resume an incomplete Provider session after process loss. Provider-native
session recovery may be reconsidered only after exact ChangeFleet revision, workspace, event, and
context identity can be proven.

### 8. Capture raw observability without adding an analytics product

Decision 0009 applies to every real Provider call. The adapter records:

- Runtime invocation and attempt identity;
- Agent Profile and context-projection identifiers;
- Provider, SDK or CLI version, requested model, and observable effective model;
- start, finish, duration, terminal outcome, and Provider locator;
- every usage observation exposed by the supported SDK surface;
- confidence, coverage, and raw evidence reference.

Codex SDK turn usage may be recorded as `aggregate_only`. ChangeFleet does not depend on internal or
experimental per-response events and does not invent hidden subagent coverage.

Provider monetary values, when present, are estimates. Pricing snapshots, normalized cost,
dashboards, budgets, chargeback, and Agent effectiveness comparisons remain later proposals or
implementation stages.

Telemetry is audit/debug evidence and is excluded from ordinary Control Contracts and current Run
Context Projections.

### 9. Remove fake production selection at stage exit

Scripted Runtime behavior remains available under test support for deterministic success, failure,
replanning, selection request, cancellation, and recovery cases. It is not a production Provider.

When the Codex adapter passes the accepted real flow, production construction requires an explicit
real Agent Profile and real Runtime adapter. Any deterministic-fake default or production-selectable
fake profile is removed.

## First Implementation Stage

Create exactly one Development WorkItem for a one-Repository real Provider vertical slice. The
implementation may preserve deterministic one- and two-Repository regression fixtures, but it does
not require a paid, nondeterministic multi-Repository Provider flow in the normal fast suite.

The stage exits only when it proves:

- exact-base read-only planning materialization;
- real Codex planning with strict structured output;
- one WorkUnit execution in an isolated write workspace;
- exact Candidate capture and existing validation and review continuation;
- honest Run, Provider, timing, usage, and coverage evidence;
- deterministic invalid-output, access, failure, cancellation, and restart behavior;
- removal of fake production selection;
- one explicit opt-in real Provider acceptance flow.

## Non-Goals

- Codex App Server, WebSocket transport, in-flight steering, or rich Provider UI.
- Claude Agent SDK or simultaneous multi-Provider implementation.
- A universal Provider, model, tool, Skill, or session framework.
- Direct model API integration or a ChangeFleet-owned Agent loop.
- Provider-session resume after controller loss.
- Runtime Skill Kit packaging or installation into registered repositories.
- Continuous context-window enforcement.
- Pricing snapshots, normalized monetary cost, billing, budgets, or chargeback.
- Effectiveness ranking, dashboards, or automatic Agent selection.
- Linear or another tracker integration.
- Git URL materialization, remote workers, delivery, merge, or deployment.
- A required real multi-Repository Provider test in the normal fast suite.

## Acceptance

Accepted: 2026-07-31

The user accepted the recommended option set and requested that the project proceed accordingly.
Decision 0010 owns the durable Provider boundary. WI-0003 is the only authorized implementation
WorkItem and was started by the user's 2026-07-31 request.

## Implementation Completion

Completed and accepted: 2026-07-31

WI-0003 proved the accepted first-Provider boundary and records the exact validation evidence and
remaining external enforcement limits. Its registered-Repository worktrees are the accepted local
first-slice implementation, not a final decision for Git URL or remote-worker materialization.
Before either later stage begins, a separate proposal must decide Git object ownership, frozen-base
retention, disposable workspace materialization, Candidate publication, and recovery.
