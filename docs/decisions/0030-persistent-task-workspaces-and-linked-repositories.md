# 0030: Persistent Task Workspaces And Linked Repository Workspaces

Status: Accepted

Date: 2026-08-11

Source: Repository Design Proposal 0028

## Decision

One ChangeSet remains the sole business-task aggregate and owns one persistent logical
TaskWorkspace for planning, execution, verification, review, correction, and delivery. The
TaskWorkspace links one or more independently identified RepositoryWorkspaces, each bound to its
own exact base, target, branch, worktree, Harness selection, write ownership, Candidate, evidence,
and delivery result.

Task and workspace configuration owns Repository authority, AgentProfiles, permissions, budgets,
attempt limits, review policy, and delivery bindings. The Agent-authored Plan is concise semantic
guidance for later Agents and does not reproduce those control facts. Confirming a Plan binds its
exact message together with a separate Core-produced workspace-control summary and creates
Repository-scoped WorkUnits from confirmed Repository participation.

Independent business changes always use independent TaskWorkspaces and writable worktrees. An
execution Run may control one or more WorkUnits within one TaskWorkspace, but Core enforces exact
per-Repository write assignments and Candidate identity. Execution completion retains the
workspace for verification, feedback, review, and delivery. Completed delivery or explicit
abandonment releases replaceable physical resources while durable audit facts remain readable.

External trackers remain intake and projection surfaces. Stable SourceBindings and structured
routing associate an external issue with a TaskWorkspace; issue prose does not carry internal
workspace ids as the normal routing contract.

## Rationale

The user experiences one continuing change, not a Planner schema followed by unrelated
Repository-level tasks. Making the workspace the operational center lets Agents work in the actual
multi-Repository environment while keeping Git and evidence exact per Repository. Separating
semantic Plan content from task configuration reduces prompt size and removes Agent responsibility
for facts already owned by Core.

This follows the useful part of Conductor's workspace model—isolated branch/worktree streams and
linked directories—while retaining ChangeFleet's cross-Repository Bundle, evidence, recovery, and
human-delivery authority.

## Consequences

- `ChangeSet` and `TaskWorkspace` are one-to-one; no second user-visible task lifecycle is added.
- Planning and later Runs share one logical workspace while keeping operation-specific permissions.
- WorkUnits remain internal Repository control records and are no longer Planner-authored steps.
- Several independent features can run concurrently against the same Repositories without sharing
  writable worktrees or process namespaces.
- Physical workspaces are replaceable locators and may be released after the task is delivered or
  abandoned without deleting durable audit history.
- Linear, GitHub webhook intake, workspace templates, lazy linkage, Candidate lanes, multi-writer
  scheduling, remote workers, automatic merge, and deployment remain deferred from WI-0037.
