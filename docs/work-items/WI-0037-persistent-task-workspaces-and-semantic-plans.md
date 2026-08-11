---
artifact_type: development_work_item
id: WI-0037
status: done
title: Persistent task workspaces and semantic Plans
source: Repository Design Proposal 0028 and Decision 0030
confirmed_by: user
confirmed_at: 2026-08-11
standing_policy:
design_proposal: 0028
---

# WI-0037: Persistent Task Workspaces And Semantic Plans

## Objective

Atomically replace the Planner-authored execution schema and per-operation workspace center with
one ChangeSet-owned TaskWorkspace that links the explicitly selected Repository workspaces from
planning through Bundle review.

## Scope

- Add a stable one-to-one TaskWorkspace identity and linked RepositoryWorkspace records before the
  first planning Run.
- Materialize the explicitly selected exact-base Repository branches/worktrees before planning;
  keep planning semantically read-only and execution writes exact-assignment scoped.
- Replace Planner-authored WorkUnits and control configuration with a concise semantic Markdown
  Plan and a minimal typed planning outcome.
- Present and bind a separate deterministic workspace-control summary at Plan confirmation.
- Create Repository-scoped WorkUnits from confirmed workspace participation.
- Let one execution attempt read every linked RepositoryWorkspace but write only its assigned one,
  deriving Candidate checkpoints and evidence from that exact Repository.
- Retain TaskWorkspace resources through verification, Feedback, Bundle review, and delivery;
  release eligible physical resources only after terminal delivery or explicit abandonment.
- Replace affected SPEC, architecture, prompts, schemas, stores, adapters, fixtures, and tests;
  delete superseded compatibility paths instead of maintaining two contracts.

## Non-Goals

- No Linear, GitHub webhook, tracker projection, or automatic intake adapter.
- No workspace-template catalog, lazy Repository linkage, or scope-expansion redesign.
- No Candidate lanes, model-result ranking, normalized scoring, or automatic model selection.
- No concurrent writers in one RepositoryWorkspace, remote workers, hosted sandbox, deployment, or
  automatic merge.
- No target-Repository Harness installation or ChangeFleet-owned semantic command discovery.

## Acceptance Criteria

- Single- and two-Repository ChangeSets own stable TaskWorkspaces before planning and retain them
  through exact Bundle review.
- Independent ChangeSets selecting the same Repository get different writable worktrees and branch
  subjects.
- Planner output contains semantic implementation guidance without WorkUnit ids, SHAs, refs,
  AgentProfile ids, budgets, attempt limits, supervision, reviewer, or delivery fields.
- Plan approval binds the exact semantic message and a Core-owned control digest, then creates
  WorkUnits from the confirmed participating Repositories.
- An execution Agent can read all linked Repositories and write only exact assigned workspaces;
  Core derives one exact Candidate lineage and evidence subject per changed Repository.
- Existing verification, Feedback, Bundle review, human acceptance, and delivery authority remain
  exact and restart-safe.
- Execution completion does not release workspace resources; terminal delivery or abandonment does
  so without deleting durable ChangeSet, Run, evidence, cost, or delivery history.
- Old Planner schema, prompt helpers, per-WorkUnit workspace assumptions, fixtures, and private
  compatibility branches are removed when their replacements pass.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Affected domain and application unit tests under Node.js 24 | TaskWorkspace identity, Plan normalization, WorkUnit derivation | Required | Shared domain contract replacement |
| Affected deterministic integration tests under Node.js 24 | workspace materialization, restart, execution, verification, Feedback, cleanup | Required | Store and real-Git workspace changes |
| Multi-Repository acceptance fixture under Node.js 24 | complete planning-to-Bundle vertical slice and independent-task isolation | Required | Accepted multi-Repository orchestration boundary |
| `npm run check` under Node.js 24 | all deterministic accepted scopes | Required | Shared schemas, lifecycle, workspaces, Runtime, and acceptance are crossed |
| `npm run check:harness` under Node.js 24 | ChangeFleet repository Harness | Required | WorkItem and current-state projections change |
| `git diff --check` over branch base through `HEAD` and working tree | complete replacement diff | Required | Formatting and exact handoff hygiene |
| Real Provider gate | external-cost Provider path | Conditional | Run one bounded trial only if the final diff changes Provider invocation rather than only its contract |
| Real GitHub gate | external delivery write | Excluded | Delivery semantics are preserved and fixture coverage is sufficient |

## Current Projection

- Current subject: branch `codex/wi-0037-persistent-task-workspaces` from `6a394ea`.
- Last verified state: the atomic replacement passed all selected deterministic gates and was
  accepted by the user on 2026-08-11.
- Next step: land the exact commit, then run one bounded real self-iteration from the new baseline.
- Active blocker or decision: none.

## Implementation Evidence

- Each ChangeSet now creates one stable TaskWorkspace and independent branch-backed
  RepositoryWorkspaces before planning. Planning reuses them read-only; one execution Run can read
  every linked Repository but write only its assigned RepositoryWorkspace. Terminal delivery or
  explicit abandonment releases only that task's physical worktrees.
- Planner output is now a bounded semantic Plan containing summary, steps, validation intent,
  risks, assumptions, and feedback assessments. Core separately binds a workspace-control digest
  and derives Repository WorkUnits, exact Git authority, policies, and Runtime configuration after
  confirmation. The old Planner WorkUnit, dependency DAG, command, budget, supervision, reviewer,
  and delivery fields were deleted rather than translated.
- `TaskWorkspaceManager` owns atomic physical preparation, read-only before/after comparison, and
  terminal cleanup. `RepositoryWorker` remains the Git adapter, while the ChangeSet service remains
  the lifecycle and authority composition root. Verification and Bundle review keep disposable
  exact-Candidate worktrees.
- Direct Node.js 24 tests proved planning mutation rejection even when the Provider first throws,
  persistent restart reuse, Repository-selection generation replacement, and isolation of two
  concurrent tasks selecting the same Repository. Closing one task removed only its worktree.
- The first full-gate invocation stopped before tests because this WorkItem used unsupported status
  `doing`. It was corrected to `in_progress`; this was Harness metadata, not product behavior.
- Final `$env:PATH='<Node24>;' + $env:PATH; npm.cmd run check` exited 0 in 411.8 seconds with Node.js
  24.14.0: the Harness reported 3 eager files and 37 WorkItems; 92 unit, 115 integration, and 8
  acceptance tests passed, followed by the Chromium console path.
- Final `node.exe scripts/check-harness.mjs` and `git diff --check` both exited 0 after status and
  evidence projection updates. The Provider test module loaded with its one paid scenario skipped;
  that skip is not reported as Provider validation.
- The real Provider gate was not selected because production Provider invocation, credentials, and
  process ownership did not change; this replacement changes its semantic contract and deterministic
  workspace boundary. Real GitHub writes were also outside scope.
- The user accepted WI-0037 on 2026-08-11 before the exact implementation commit.

## Project Memory Impact

This WorkItem implements Decision 0030 without introducing tracker integration, Candidate
comparison, or a target-Repository Harness format. The next useful proof is one bounded real
self-iteration after this branch lands.
