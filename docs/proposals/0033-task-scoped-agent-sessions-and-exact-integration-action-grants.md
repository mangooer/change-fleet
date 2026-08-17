---
artifact_type: repository_design_proposal
id: 0033
status: accepted
title: Task-scoped Agent Sessions and exact integration action grants
proposed_at: 2026-08-17
accepted_at: 2026-08-17
confirmed_by: user
supersedes: none
depends_on: docs/work-items/WI-0046-second-scenario-validation.md
blocks: none
decision: docs/decisions/0035-task-scoped-agent-sessions-and-exact-integration-action-grants.md
implementation_tracking: docs/work-items/WI-0047-task-scoped-agent-sessions-and-exact-integration-grants.md
---

# 0033: Task-Scoped Agent Sessions And Exact Integration Action Grants

## Context

WI-0046 completed planning, execution, validation, Bundle review, and human acceptance against a
real GitLab-backed repository. The exact Candidate and review evidence remained valid, but the
ChangeSet could not leave review because no supported GitHub Delivery binding existed. The user
intentionally declined manual delivery for that test, yet the product had no truthful terminal rule
for an accepted result that would not be integrated by ChangeFleet.

The same evidence and subsequent operator use exposed a broader boundary question. The current task
experience presents one conversation but routes work through a fixed Planner, Executor, Verifier,
Reviewer, Supervisor, and GitHub Delivery pipeline. Agent Runtimes increasingly provide their own
durable conversations, tools, subagents, and provider-specific integration abilities. Adding one
ChangeFleet adapter and one fixed stage for every new provider would grow the replaceable part of
the product, while giving an Agent ambient external-write authority would weaken ChangeFleet's
reason for existing.

The selected direction is the middle boundary:

- keep ChangeSet, TaskWorkspace, exact Git subjects, CandidateBundle, evidence, and human decisions
  in the deterministic Core;
- make logical Agent Sessions task-scoped control records rather than another task lifecycle;
- let a human grant one exact, bounded, independently verifiable action to one Agent Session;
- allow an accepted task to finish explicitly without managed integration while preserving the
  fact that its Candidates were not integrated;
- defer Candidate competition, generic tool orchestration, and provider-frontend expansion.

This proposal changes accepted product boundaries. It does not itself authorize implementation.

## Decision

### Preserve One ChangeSet And One TaskWorkspace

One business change remains one ChangeSet with one persistent logical TaskWorkspace. Repository
selection, WorkUnits, repository workspaces, exact bases and targets, Plans, Candidates, Bundle
identity, evidence, budgets, Gates, human review, and terminal outcome remain owned by that
aggregate and its linked stores.

An AgentSession is a durable logical participant inside one TaskWorkspace. It records a stable
logical id, its revisioned AgentProfile and allowed Run purposes, current or closed status, Run
references, and optional Provider-session locators. It does not own a second Plan, lifecycle,
workspace, Candidate, Bundle, budget, or authority model.

One AgentSession may produce several fresh or continued Runs. Provider thread and session ids are
replaceable locators and optimization hints, never durable task authority. A fresh Provider session
reconstructs current context from exact ChangeFleet records. Runtime-native subagents remain
internal to their parent Run and do not become ChangeFleet AgentSessions.

The ordinary human surface remains one ChangeSet conversation. AgentSession identity may explain
who is acting and preserve bounded continuity, but it does not create separate user chat histories
or require the operator to manage Provider threads.

### Decouple Run Routing From A Fixed Role Pipeline

Planning, execution, verification, supervision, and review remain typed Run purposes with their
existing authority boundaries. Core schedules an eligible Run to an AgentSession whose current
profile and purpose set permit it; a fixed named role is no longer the only routing identity.

Add integration as a Run purpose for one post-review action performed under an exact ActionGrant.
It uses the common queued, running, completed, failed, interrupted, and cancelled Run lifecycle and
adds no ChangeSet or WorkUnit phase. Plan-confirmed autonomous authority still ends at Bundle
review. An integration Run exists only after a separate human grant.

This decoupling does not introduce an Agent graph. Dependencies continue to come from current Core
facts and offered actions, not an Agent-authored workflow topology. Candidate lanes, competing
implementations, multi-writer workspaces, and consensus routing remain outside this proposal.

### Introduce Exact Human ActionGrant Records

An ActionGrant is an immutable human authority record created only from an exact action envelope
offered by Core. At minimum it binds:

- ChangeSet, TaskWorkspace, accepted CandidateBundle revision and hash;
- Repository, Candidate base and head SHA, destination ref, and the latest observed destination
  SHA when applicable;
- one closed action kind and canonical input digest;
- the AgentSession and AgentProfile permitted to execute it;
- Runtime permission mode, maximum attempts, expiry, and idempotency identity;
- required preflight, independent result observer, accepted result schema, and recovery boundary;
- granting actor, time, and exact human decision.

An Agent may request that a currently offered grant be shown to a human, but it cannot create,
broaden, renew, or accept a grant. It cannot change the Bundle, Repository, destination, action
kind, permission mode, budget, attempts, verifier, or success criteria. Core revalidates the full
envelope immediately before dispatch and again before admitting the result.

A changed Plan, Bundle, Candidate SHA, Repository binding, destination ref, observed destination
SHA, profile authorization, or expired attempt invalidates the grant. Retry reuses the same stable
grant and idempotency identity only while every bound subject remains current.

### Admit Only Closed And Independently Verifiable Actions

ActionGrant is not permission for arbitrary shell execution or generic external writes. Every
supported action kind must define:

- exact inputs and mutation scope;
- deterministic admission and preflight;
- an idempotent or explicitly recoverable execution contract;
- a result observer independent of Agent prose;
- exact success, divergence, partial-success, and failure outcomes;
- any supported discard, revert, rollout, or compensation.

The initial boundary admits only exact Git actions whose postcondition can be observed:

1. publish one accepted Candidate SHA to one named non-target remote ref without force; and
2. fast-forward one named target ref from the grant's observed base SHA to that exact Candidate SHA
   without force, when a human explicitly grants direct integration.

Remote movement, a different remote head, a non-fast-forward result, a changed Candidate, or an
unobservable outcome fails closed. Merge commits, squash, rebase, force push, arbitrary branch
selection, generic provider commands, deployment, and destructive cleanup are not initial action
kinds. A later action kind may be added inside this boundary only when it supplies equally precise
admission, observation, recovery, and evidence; otherwise it requires another boundary proposal.

The existing GitHub pull-request path remains valid. Its Core-owned publication adapter and
external human merge do not require an Agent ActionGrant. A one-shot human-granted fast-forward is
not automatic merge: it is a separate exact decision against one current Bundle and destination.

### Keep Permission Enforcement Claims Honest

ChangeFleet enforces which exact result may become authoritative. It freezes the action subject,
revalidates the workspace and destination, compares assigned and non-assigned Git subjects, and
independently observes the remote result before recording success.

In operation-scoped Runtime mode, the Provider may additionally confine the action. In host-user
mode, worktrees still isolate development state but do not confine the Agent process or its ambient
host and network access. The Runtime profile and operator own that permission boundary.
ChangeFleet records the effective mode and does not claim that postflight verification prevented
unrelated host side effects.

Credentials remain host-managed. Tokens, cookies, SSH material, and provider secrets never become
ActionGrant fields, aggregate state, normal evidence payloads, command output, or later-Agent
context.

### Separate Bundle Acceptance, Integration, And Task Completion

Bundle acceptance remains an exact human or previously accepted policy decision over one immutable
CandidateBundle. It does not itself prove publication or integration.

After acceptance, Core derives one exact integration disposition:

- managed_integration_required: the task remains nonterminal until every required Repository has
  exact successful Delivery or ActionGrant integration evidence; or
- complete_without_managed_integration: a separate human decision ends ChangeFleet responsibility
  without claiming that any Candidate was published or merged.

The second disposition binds the current accepted Bundle revision and hash and records the
unintegrated Candidate subjects. It moves the ChangeSet to terminal(done) with reason
accepted_without_managed_integration. The operator projection may display complete only together
with that reason. It must never label the result delivered, merged, or integrated.

A human statement that integration happened elsewhere is review input, not integration fact.
ChangeFleet records external integration only when a supported observer binds the exact Candidate,
destination, and result identity. Explicit abandonment remains distinct and must not be used for a
valid accepted result merely because ChangeFleet did not deliver it.

### Preserve Exact Core Invariants

The following remain non-negotiable:

- one business change is one ChangeSet and one review subject is one exact CandidateBundle;
- repository scope, bases, targets, workspaces, write assignments, and Candidate SHAs are Core
  authority;
- Agents propose semantic work and offered actions but never grant access, accept evidence or
  Bundles, raise budgets, or declare their own external result authoritative;
- a changed Candidate or integration subject creates new evidence identity and invalidates stale
  review or grant bindings;
- publication and integration against one Repository and target ref are serialized;
- partial multi-Repository success remains durable fact and uses precise compensation language;
- complete logs and large Agent output remain linked artifacts rather than aggregate or default
  context;
- Git still provides no universal atomic transaction across repositories.

### Keep Decision 0034's General Freeze

Decision 0034's console, audit-presentation, and Harness-overlay freezes remain in force. If this
proposal is accepted, the only exception is the minimum kernel-driven projection needed to:

- show the current AgentSession and integration Run;
- request or decide one exact offered ActionGrant;
- show managed integration evidence or accepted_without_managed_integration.

This exception authorizes no new page, dashboard, timeline redesign, pricing view, audit feature,
Harness discovery mode, overlay file kind, or Provider-frontend emulation. Existing shared
operations, CLI, HTTP, and console surfaces may expose the new exact decisions with the smallest
consistent projection.

## Alternatives

### Add Only A No-Delivery Terminal Rule

Rejected. It would repair the immediate WI-0046 symptom but leave provider growth and the fixed
post-review pipeline unresolved. The terminal rule belongs with an explicit integration
responsibility model so complete cannot become an ambiguous escape hatch.

### Implement A GitLab Adapter Next

Rejected as the architectural answer. A GitLab adapter may become useful after real demand, but
adding one adapter per Provider would not define who holds authority when an Agent Runtime already
has an integration capability. Exact ActionGrant and observation rules are provider-neutral kernel
value.

### Keep Every External Mutation Inside Core Adapters

Rejected as a universal rule. It gives strong mediation but forces ChangeFleet to duplicate every
Runtime or provider integration. Core mediation remains appropriate for stable paths such as the
landed GitHub adapter; exact human grants cover bounded Runtime-native actions without weakening
authoritative result admission.

### Give An Agent A Generic External-Write Grant

Rejected. A repository name and natural-language instruction cannot bound branches, target
movement, retries, credentials, or success evidence. Only closed action kinds with exact subjects
and independent observation are admissible.

### Make Agent Sessions The New Aggregate

Rejected. It would split one business change across competing lifecycles and make Provider
conversation continuity authoritative. ChangeSet and TaskWorkspace remain the durable task and
workspace boundary.

### Add Candidate Lanes And Multi-Agent Competition Now

Rejected. No current evidence requires multiple competing Candidates, scoring, or consensus.
Runtime-native subagents already own internal collaboration. A later proposal must justify any
user-visible alternative-Candidate lifecycle.

## First Implementation Slice After Acceptance

One confirmed WorkItem should implement one end-to-end vertical slice:

1. persist task-scoped AgentSession, exact ActionGrant, integration Run, and integration disposition
   records with restart-safe state transitions;
2. derive and offer only eligible post-acceptance action envelopes;
3. dispatch one granted exact Git action through a configured AgentSession;
4. independently preflight and observe exact local and remote Git subjects;
5. preserve divergence, failure, interruption, retry, and partial-success evidence;
6. support explicit complete_without_managed_integration and its exact terminal reason;
7. project only the minimum shared-operation and existing-console controls required by the new
   kernel facts;
8. retain the current GitHub Delivery path unchanged.

Deterministic fixtures must cover both initial exact Git action kinds. A real remote write is a
separate external-write validation gate and is not authorized merely by accepting this proposal or
its WorkItem.

## Acceptance Criteria

- AgentSession is task-scoped routing and continuity state, not a second aggregate or Provider
  memory authority.
- The fixed named-role pipeline is no longer required for routing, while every Run keeps a typed
  purpose and exact capability boundary.
- Integration Runs cannot start without a current human ActionGrant and cannot outlive any bound
  subject.
- Agent output alone never satisfies publication or integration; a supported independent observer
  binds the exact result.
- No target ref is changed by the initial boundary except an exact, non-force, human-granted
  fast-forward from the observed base to the accepted Candidate.
- An accepted task may reach terminal(done) without managed integration only through a separate
  exact human disposition whose reason preserves all unintegrated Candidates.
- The landed GitHub path, exact Bundle review, multi-Repository partial-success facts, restart
  recovery, and credential boundary remain valid.
- No Candidate lanes, generic Agent graph, console redesign, audit feature, Harness-overlay feature,
  automatic merge, or deployment is introduced.

## Validation

Implementation check selection must follow docs/validation.md. At minimum the eventual WorkItem
must cover:

- domain normalization and lifecycle tests for AgentSession, ActionGrant, integration Run, grant
  invalidation, and both integration dispositions;
- filesystem-store, lease, idempotency, interruption, and restart integration tests;
- real-Git fixture tests for exact publication, exact fast-forward, target movement, divergence,
  non-force enforcement, non-assigned workspace mutation rejection, and remote observation;
- Runtime protocol tests proving that an Agent proposes or executes only the granted action and
  cannot make its own result authoritative;
- audit and context tests proving that grants, evidence, credentials, and large output remain in
  their accepted stores and projections;
- targeted shared-operation, HTTP, and browser tests only for the minimum changed operator path;
- the full deterministic repository check if the final implementation crosses the persisted schema,
  lifecycle, Runtime, Git, and local adapter tiers as expected.

Real GitHub, GitLab, or another remote write remains separately authorized external evidence. A
fixture pass must not be reported as real-provider integration proof.

## Risks And Open Questions

- Host-user Agent execution can perform ambient side effects outside ChangeFleet observation.
  Mitigation: record the permission mode, require explicit human grant, admit only independently
  verified results, and make no confinement claim.
- AgentSession can become another Provider abstraction layer. Mitigation: persist only logical
  routing, profile, status, and Run lineage; keep Provider-specific conversation state as locators
  or artifacts.
- A generic grant framework can invite speculative action kinds. Mitigation: keep the catalog
  closed, implement only the two exact Git actions, and require a new boundary proposal when
  deterministic observation or recovery cannot be stated.
- terminal(done) may be misread as delivered. Mitigation: require and surface the exact
  accepted_without_managed_integration reason and preserve unintegrated Candidate identities.
- A direct fast-forward can still be consequential. Mitigation: require a separate human grant,
  exact current target, non-force semantics, destination serialization, and independent remote
  observation.

Whether one registered Repository may belong to multiple Projects remains open and outside this
proposal.

## Non-Goals

- No Candidate lanes, competing implementation Agents, normalized scoring, multi-reviewer
  consensus, or automatic model routing.
- No generic Agent graph, hosted Agent frontend, Runtime tool broker, or ChangeFleet-owned semantic
  planner.
- No requirement for Provider-native session continuation and no second Provider adapter.
- No GitLab-specific merge-request adapter in the first slice.
- No merge commit, squash, rebase, force push, automatic merge, deployment, rollback engine,
  remote workers, or hosted multi-tenancy.
- No new console page, presentation redesign, audit dashboard, pricing feature, or Harness-overlay
  capability.
- No multi-Project Repository ownership rule.

## Relationship To Prior Decisions

- Preserves Decisions 0001 through 0004: Core retains authority, exact Bundle identity,
  destination serialization, and partial-success facts.
- Extends Decision 0025's common Run lifecycle with the integration purpose without adding a phase.
- Preserves Decision 0026's rule that Plan-confirmed autonomous authority ends at Bundle review;
  integration requires separate exact human authority.
- Refines Decision 0030 by adding AgentSession inside, not beside, the one TaskWorkspace.
- Revises Decision 0033's fixed internal role routing and GitHub-only completion assumption while
  retaining one human task conversation and six operator states.
- Revises Decision 0015 only for separately granted exact Git integration; the existing exact
  GitHub pull-request and external human-merge path remains accepted.
- Makes one narrow kernel-projection exception to Decision 0034 while keeping its three general
  feature freezes.

Decision 0035 records this accepted boundary because it revises accepted Run, task-session,
integration-authority, and terminal-completion semantics.

## Documentation Impact

- SPEC.md: AgentSession, Run purpose, ActionGrant, integration disposition, exact action, and
  completion contracts after acceptance.
- docs/architecture.md: task-session routing, action-envelope compilation, integration dispatch,
  and independent result observation after acceptance.
- docs/current-state.md: proposed status now; accepted boundary and next WorkItem only after human
  acceptance.
- docs/proposals/INDEX.md: Proposal 0033 status and relationship.
- docs/decisions/: one durable Decision only after acceptance.
- README.md and README.en.md: only if later implementation changes the human-visible product shape.

## Revision History

- 2026-08-17: Proposed after WI-0046 and boundary discussion. The user selected the recommended
  TaskWorkspace-centered direction: logical Agent Sessions, exact human ActionGrants, independently
  verified integration, explicit completion without managed integration, no Candidate lanes, and
  no general lift of the console, audit, or Harness-overlay freezes.
- 2026-08-17: Accepted by the user as the authority for Decision 0035 and WI-0047.
- 2026-08-17: WI-0047 completed and landed the vertical slice with task-scoped AgentSessions,
  exact ActionGrants, both non-force Git action kinds, independent observation, restart recovery,
  truthful completion without managed integration, and the minimum existing-console projection.
  Real external remote validation remains separately gated.
