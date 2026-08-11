---
artifact_type: repository_design_proposal
id: 0028
status: accepted
title: Persistent task workspaces and linked repository workspaces
proposed_at: 2026-08-11
revised_at: 2026-08-11
accepted_at: 2026-08-11
decision: 0030
---

# 0028: Persistent Task Workspaces And Linked Repository Workspaces

## Context

ChangeFleet currently makes the confirmed `ChangePlan` reproduce both project semantics and most
execution configuration. It also materializes planning and execution primarily around individual
Repositories and WorkUnits. That makes the Planner describe stable ids, exact Git authority,
profiles, budgets, review policy, attempts, and other control facts that are already selected by
the task or owned by Core.

This is the wrong center of gravity. A user experiences one continuing task: discuss a frontend and
backend change, inspect a Plan, let Agents implement and verify it, respond to feedback, review the
combined result, and deliver it. Repository branches and WorkUnits are internal control subjects
inside that task. They should not fragment the user-visible work or inflate the semantic Plan.

The design must also support two independent features running concurrently against the same
Repositories. They must never share writable checkouts, process namespaces, or delivery state.

## Decision

Adopt this boundary:

> One ChangeSet is one business task and owns one persistent logical TaskWorkspace. The
> TaskWorkspace links one or more isolated RepositoryWorkspaces for the complete planning,
> execution, verification, review, and delivery flow. Plan content remains semantic guidance;
> task configuration and exact control authority remain outside it.

`ChangeSet` remains the only user-visible business aggregate. `TaskWorkspace` is its one-to-one
operational container, not another task lifecycle or another source of product truth. A stable
workspace id survives replacement of physical directories, Provider sessions, and processes.

### Workspace Structure

A `TaskWorkspace` groups these ChangeSet-authoritative references and operational resources:

- one ChangeSet identity and current intent;
- zero or more external `SourceBinding` records;
- the selected task configuration revision;
- one or more linked `RepositoryWorkspace` records;
- planning, execution, verification, supervision, and review Runs;
- the current semantic Plan and internal WorkUnits owned by the ChangeSet;
- Candidate and Bundle identities; and
- active, archived, or released resource projection.

Each `RepositoryWorkspace` binds one exact:

- authorized Repository id;
- base SHA and target ref;
- local branch or equivalent Candidate ref;
- owned worktree locator;
- workspace-Harness snapshot selection; and
- write-lease and cleanup state.

Repositories remain independent Git histories. A shared task name may produce corresponding branch
names, but every Repository is committed, pushed, reviewed, and delivered separately. A
CandidateBundle groups their exact results without claiming a universal cross-Repository atomic
merge.

Paths, branch names, and Provider session ids remain replaceable locators. They are not durable
TaskWorkspace identity.

### Creation Before Agent Work

ChangeFleet creates the logical TaskWorkspace before starting a planning Agent. Explicit task
creation or an intake adapter supplies task configuration, including:

- the Project and authorized Repository pool;
- initial linked Repositories and their branch/base choices;
- planning, execution, verification, supervision, and review AgentProfiles;
- permission mode, budgets, attempt limits, and elapsed-time limits; and
- review and delivery policy.

Known task Repositories may be materialized eagerly. A typical full-stack task can therefore begin
with separate frontend and backend worktrees and branches already linked into one TaskWorkspace.
Planning is read-only over those exact subjects. Planning writes never become Candidates.

The initial Repository set need not predict every implementation detail. During planning an Agent
may propose the bounded Core operation `link_repository` for another Repository already inside the
authorized Project scope. Core revalidates authority and freezes its exact base before exposing it.
Anything outside the authorized pool remains an explicit scope-expansion decision. Repository
linkage is TaskWorkspace control state, not prose or a required field inside the semantic Plan.

### Semantic Plan And Internal WorkUnits

The Planner returns a concise Markdown Plan that another Agent can understand. It may describe:

- the intended behavior and relevant components;
- the implementation approach and important ordering;
- project-specific validation that appears necessary;
- meaningful risks, assumptions, or human decisions; and
- the expected completion result.

The Planner does not echo stable WorkUnit ids, SHAs, refs, AgentProfile ids, timeouts, budgets,
attempt ceilings, supervision mode, reviewer identity, evidence identity, or delivery bindings.
Those values remain task and workspace configuration.

Before confirmation, the UI shows the semantic Plan beside a compact, Core-produced workspace
summary: participating Repositories, exact bases and targets, effective profiles, permissions,
budgets, and review policy. Human confirmation binds the Plan message and that exact control
summary without pretending that the Planner authored the control facts.

Confirmation creates one internal WorkUnit for each Repository selected for controlled execution.
WorkUnits remain Repository-scoped identities for write ownership, Candidate production,
verification evidence, recovery, and delivery. They are not Planner-authored steps and are not the
user's task source.

An execution Run receives one confirmed WorkUnit in the first slice. It may read every linked
RepositoryWorkspace but Core grants write access only to the assigned RepositoryWorkspace and
verifies the non-assigned Git subjects. The Agent owns implementation order, native subagents,
project tools, and ordinary same-Plan correction. Its terminal semantic outcome stays small:
completed, blocked, or a bounded request for authority. Core derives Candidate checkpoints and
evidence from exact workspace state rather than requiring the Agent to reproduce them.

### Continuity, Review, And Release

Planner, Executor, verification Agent, Bundle Reviewer, and later correction Runs remain attached
to the same logical TaskWorkspace. They may be separate Provider sessions or models. Complete
transcripts and large artifacts remain linked audit data rather than default context.

An Executor reporting completion does not release the TaskWorkspace. Exact checks, review,
feedback repair, PR creation, and delivery continue inside it. The TaskWorkspace is eligible for
archive only after all deliveries finish or an authorized human abandons the ChangeSet.

Archive releases replaceable resources such as worktrees, processes, temporary directories,
ports, disposable Runtime sessions, and project-specific ephemeral resources. Control Store facts,
source bindings, exact Git subjects, Plan, evidence summaries, cost envelopes, and delivery results
remain readable. Restoration recreates physical resources from exact Git authority; it does not
depend on an old host path still existing.

### Independent Tasks And Candidate Comparison

Two independent features always use two TaskWorkspaces, even when they select the same
Repositories and base SHAs. Each gets independent branches, worktrees, process namespaces, Runs,
Bundles, and delivery state. Mutable delivery destinations remain serialized by
`repository_id + target_ref`; ordinary Git integration staleness and conflict handling still
apply.

Within one TaskWorkspace, a RepositoryWorkspace has at most one active writer lease. Multiple
Agents may collaborate through separate sessions, but concurrent writers must use disjoint
RepositoryWorkspaces.

Future comparison of several Agent or model results for the same business task should use isolated
Candidate lanes beneath one TaskWorkspace. Every lane owns separate writable RepositoryWorkspaces
and cost evidence. Candidate lanes, normalized scoring, and automatic winner selection are
reserved by this model but deferred from the first implementation slice.

### External Intake And Routing

Linear, GitHub Issues, or another source provides intent and discussion context; it does not own
the ChangeSet lifecycle. An issue description must not contain a ChangeFleet workspace id as the
normal routing mechanism.

An intake adapter instead creates an idempotent `SourceBinding` from a stable external source key
to one TaskWorkspace. Routing selects a confirmed workspace template or explicit task
configuration using structured facts such as source Repository, Linear team or project, labels,
and operator policy. Repeated events and comments resume the same active TaskWorkspace. Ambiguous
routing produces an intake decision instead of silently selecting a Repository.

A source-native Repository may map to a template that includes related Repositories. For example,
a backend GitHub Issue can select a full-stack template that links the authorized frontend and
backend Repositories. Status, Bundle, PR, and workspace links may be projected back to the source;
external tracker status never becomes ChangeSet authority.

The first implementation does not add Linear or webhook adapters. It establishes the shared task
creation operation and binding boundary they will later call.

## Comparison Evidence

Current Conductor documentation keeps one Project to one Repository and one Workspace to one
branch/worktree. For cross-Repository work it creates a Workspace for each directory and links
them with `/add-dir`, so one Agent can access the related code. Its Linear deep link resolves the
Repository and resumes or creates the Workspace internally rather than requiring an internal id in
issue prose. Its API recommends separate Workspaces for independently delivered multi-PR pieces.

Sources accessed 2026-08-11:

- <https://www.conductor.build/docs/concepts/workspaces-and-branches>
- <https://www.conductor.build/docs/guides/repositories/linking-multiple-directories>
- <https://www.conductor.build/docs/reference/deep-links>
- <https://www.conductor.build/docs/api>

Ona documents multiple Repositories in one development environment while commits and pushes remain
separate per Repository. Coder separates persistent chat/control identity from replaceable
workspace infrastructure and selects workspace templates before tool execution. These are
comparison evidence, not ChangeFleet authority:

- <https://ona.com/docs/ona/configuration/multi-repository>
- <https://coder.com/docs/ai-coder/agents>

## Considered Alternatives

### Put executable configuration in Plan

Reject. Base SHAs, refs, profiles, budgets, attempts, reviewer identity, and WorkUnit ids are task
configuration or Core-derived authority. Requiring the Planner to reproduce them increases context
and failure modes without adding semantic value.

### Create all physical workspaces only after planning

Reject as the default. It breaks task continuity, prevents code-informed planning in the actual
linked environment, and pushes Repository selection back into the Plan contract. Lazy linkage
inside an already-created logical TaskWorkspace remains allowed.

### Treat one multi-Repository directory as one Git workspace

Reject. A task may present one directory tree to an Agent, but each child remains an independently
identified Git worktree with its own base, branch, Candidate, evidence, and delivery.

### Encode workspace routing in Issue descriptions

Reject. Internal ids are brittle implementation details. SourceBinding and structured routing are
idempotent, auditable, and can survive physical workspace replacement.

### Keep one long-lived workspace for several unrelated features

Reject. It mixes branches, context, processes, cost, review, and delivery. One independently
reviewable business intent gets one TaskWorkspace.

### Compile Planner-authored WorkUnit schemas through MCP

Reject as the primary design. A Runtime tool may later expose bounded workspace operations such as
linking an authorized Repository, but a PlanCompiler would preserve the ownership mistake by
making the Agent author Core execution structure.

## First Implementation Slice

After acceptance, use one atomic replacement WorkItem to prove one explicit, single-candidate
TaskWorkspace flow:

1. create one stable TaskWorkspace with a ChangeSet before planning;
2. materialize the explicitly selected RepositoryWorkspaces and exact branches before the first
   Agent Run;
3. keep planning read-only while presenting all linked Repositories in one logical workspace;
4. replace the current large Planner contract with one semantic Markdown Plan plus a minimal typed
   planning outcome;
5. show Core-owned task configuration separately and bind its exact digest at confirmation;
6. create Repository-scoped WorkUnits from confirmed workspace participation rather than Planner
   output;
7. execute and inspect every writable RepositoryWorkspace through exact per-Repository subjects;
8. retain the TaskWorkspace through Bundle review and release it only after delivery or
   abandonment; and
9. remove the superseded Planner schema, prompt helpers, compatibility paths, and obsolete tests
   in the same replacement.

The first slice uses explicit task creation and the already selected Repository set. Lazy
Repository linkage, tracker adapters, workspace templates, remote workspace infrastructure,
Candidate lanes, multi-writer scheduling, automatic merge, and deployment remain deferred.

## Acceptance Criteria

- A single-Repository task and a two-Repository task both create their TaskWorkspace before
  planning and retain it through review.
- Two independent tasks against the same Repository use different branches and writable
  worktrees.
- Planner output contains semantic guidance and no Core-owned execution configuration.
- Core displays and binds exact workspace configuration without attributing it to the Planner.
- WorkUnits are created deterministically from confirmed Repository participation.
- An execution Agent can access all linked task Repositories while Core accepts changes only from
  its exact writable assignments.
- Exact Candidates, evidence, Bundle review, Feedback, and human delivery authority remain intact.
- Execution completion does not archive the task; delivery completion or abandonment releases
  physical resources while retaining durable audit facts.
- No Linear adapter, generic MCP suite, target-Repository installation, or Candidate comparison
  framework is introduced in the first slice.

## Supersession If Accepted

This proposal preserves the accepted small ChangeSet, WorkUnit, and Run lifecycle states, exact Git
and evidence identity, repository-native Harness ownership, human Plan confirmation, Bundle
acceptance, and human delivery authority. It revises the timing and ownership of workspaces,
Planner output, WorkUnit creation, and cleanup. Accepted SPEC and architecture text that models a
separate planning checkout per Repository or one task workspace per WorkUnit must be replaced in
the implementation Candidate rather than kept as a compatibility path.

## Revision History

- 2026-08-11: The initial unaccepted draft proposed a semantic `PlanProposal` plus deterministic
  `PlanCompiler` and Runtime tool. Discussion rejected that center because WorkUnits and execution
  configuration are task/workspace authority, not semantic Plan content.
- 2026-08-11: Revised before acceptance around one persistent TaskWorkspace with linked isolated
  RepositoryWorkspaces, semantic Plans, internal WorkUnits, source bindings, independent-task
  concurrency, and post-delivery resource release.
