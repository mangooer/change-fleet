# ChangeFleet Agent Instructions

ChangeFleet is a spec-first control plane for coordinated, auditable Git changes. Keep its kernel
small as Agent Runtimes improve.

## Start With Current Authority

For every task, read `docs/current-state.md` and the active WorkItem or Proposal, inspect Git
status and the current diff, then load only the relevant sections of `SPEC.md`, architecture,
decisions, protocols, and evidence.

Do not read the complete `SPEC.md`, all proposals, or all WorkItems by default. Do not reconstruct
current truth by replaying history.

Authority is divided deliberately: `SPEC.md` owns the accepted product contract;
`docs/current-state.md` owns the current implementation projection, gaps, and next task; decisions
own durable accepted rationale; Repository Design Proposals and Development WorkItems own accepted
change history and concise execution evidence; Git and linked artifacts own exact implementation
history.

Design Proposals and WorkItems are repository Harness, not Runtime output. Runtime uses ChangeSet,
ChangePlanRevision, WorkUnit, Run, and CandidateBundle records.

See `docs/harness.md` for the loading map, size guardrails, and maintenance rules.

## Product Boundary

- ChangeFleet is a change control plane, not a hosted Agent frontend or generic multi-agent
  framework.
- Agent Runtimes own reasoning, subagents, skills, code changes, context, task checks.
- ChangeFleet owns intent, repository authority, scheduling, exact workspace/Git identity, evidence,
  gates, and recovery.
- One business change is a `ChangeSet`; repository execution uses `WorkUnit`; review binds to one
  exact `CandidateBundle`.
- Agents only propose kernel-offered actions; they never grant access, confirm Plans, accept
  evidence or delivery, or raise budgets. ChangeFleet revalidates and executes.
- Replanning keeps one ChangeSet and its history. Human feedback is review input, not fact; each
  revised Plan records the Agent's assessment before confirmation.
- Evidence belongs to exact base and candidate SHAs. A changed SHA creates new evidence identity.
- GitHub delivery requires a confirmed binding and exact Candidate head; humans merge, not Agents.
- Local UI/HTTP adapters use shared operations, never the CLI or internal control helpers.
- Git has no universal atomic transaction across repositories. Use precise discard, revert,
  rollout, and compensation language.

## Repository And Runtime Boundary

Keep initial Project and Repository configuration minimal; follow the accepted `SPEC.md` boundary.

- The first locator is a local path; freeze an exact commit before mutation.
- Never silently include dirty files or host-global instructions in a WorkUnit.
- Never scan or authorize arbitrary directories.
- Repository-native Harness remains semantic authority and may be absent.
- Do not create or copy `.changefleet`, `AGENTS.md`, `WORKFLOW.md`, Skills, architecture, or test
  policy into registered repositories.
- Planning is semantically read-only; its writes never become Candidates. Execution accepts Git
  changes only from the assigned isolated repository workspace.
- Worktrees isolate development state, not host processes. The Runtime profile and operator own OS
  permissions; ChangeFleet records the mode without claiming confinement it did not enforce.
- Provider model, reasoning, permission, and optional Skill selection belong to a Runtime
  `AgentProfile`, not the ChangeSet aggregate.
- Tracker integrations such as Linear are intake or projection surfaces, not ChangeSet authority.

## Architecture And Implementation

Create a proposal before changing product or architecture boundaries such as:

- ChangeSet, CandidateBundle, evidence, review, delivery, or recovery semantics;
- repository authorization or scope expansion;
- automatic merge, deployment, remote workers, or hosted multi-tenancy;
- an authoritative service graph;
- a public implementation stack when none is accepted.

Durable implementation requires a confirmed `todo` WorkItem; explanation, review, proposal work,
and small explicit maintenance do not. An Agent may draft one. Only an unambiguous user request or
named standing policy may confirm it without another user round trip. Never self-confirm inferred
scope, architecture, or high-risk work.

Prefer one end-to-end vertical slice over broad scaffolding. Do not add speculative provider,
TaskSource, database, UI, PR, deployment, compatibility, or framework-detection abstractions.

Freeze (Decision 0034): no new console, audit, or Harness-overlay feature WorkItems; new Decisions
only when a proposal revises an accepted boundary.

Use stable logical ids in persisted state. Host paths and provider session ids are locators, not
durable identity. Keep complete logs, diffs, transcripts, and large Agent output in linked
artifacts, not aggregate state or startup documents.

When proposal status changes, update its metadata, `docs/proposals/INDEX.md`, and
`docs/current-state.md`. Preserve proposal chronology rather than rewriting earlier reasoning as if
it never happened.

## Validation And Project Memory

Follow `docs/validation.md` for check selection and `docs/harness.md` for Harness maintenance
rules. Never report a nonexistent or unexecuted command as passed.

For every executed check report the exact command, exit code, scope, concise observation, and
relevant unverified boundary. Do not paste full output into project memory.

Complete branch-local WorkItem status and current-state projections with the implementation; human
review or merge must not require a follow-up Harness-status commit. Keep unlanded facts distinct
from canonical `main`.

## Language

Use English for stable machine contracts, source, schemas, architecture, and repository engineering
documents. Use Simplified Chinese for user-facing plans, progress, review conclusions, and delivery
summaries unless requested otherwise.

Preserve commands, output, identifiers, paths, payloads, and quoted evidence verbatim.
