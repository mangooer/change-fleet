# ChangeFleet Agent Instructions

ChangeFleet is a spec-first control plane for coordinated, auditable changes across multiple Git
repositories. Keep its deterministic kernel small as Agent Runtime capabilities grow.

## Start With Current Authority

For every task:

1. Read `docs/current-state.md`.
2. Read the active Development WorkItem or current Repository Design Proposal for the task.
3. Inspect Git status and the current diff; preserve unrelated user changes.
4. Read only the relevant sections of `SPEC.md`, `docs/architecture.md`, decisions, protocols, and
   evidence.

Do not read the complete `SPEC.md`, all proposals, or all WorkItems by default. Do not reconstruct
current truth by replaying history.

Authority is divided deliberately:

- `SPEC.md`: accepted product contract;
- `docs/current-state.md`: concise current implementation projection, gaps, and next task;
- decisions: durable accepted rationale;
- Repository Design Proposals: chronological changes to this repository's product or architecture;
- Development WorkItems: confirmed repository implementation demand and concise evidence;
- Git and linked artifacts: exact implementation and operational history.

Design Proposals and Development WorkItems are Harness artifacts, not Runtime output. Runtime uses
ChangeSet, ChangePlanRevision, WorkUnit, Run, and CandidateBundle records.

See `docs/harness.md` for the loading map, size guardrails, and maintenance rules.

## Product Boundary

- ChangeFleet is a change control plane, not a hosted Agent frontend or generic multi-agent
  framework.
- Agent Runtimes own semantic analysis, implementation planning, internal subagents, skills, tools,
  code changes, native context, compaction, and task-specific check selection.
- ChangeFleet owns confirmed intent, repository authorization, plan and scope revisions, scheduling,
  workspace identity, exact Git subjects, evidence linkage, human gates, and durable recovery.
- One business change is a `ChangeSet`; repository execution uses `WorkUnit`; review binds to one
  exact `CandidateBundle`.
- Agent proposals never grant repository access, confirm a plan, or accept a Bundle by themselves.
- Replanning continues the same ChangeSet. Preserve superseded plans and attempts as history, but
  expose only the current exact subject as actionable.
- Evidence belongs to exact base and candidate SHAs. A changed SHA creates new evidence identity.
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
- Planning access is read-only across explicitly authorized repositories.
- Execution write access is scoped to the assigned isolated repository workspace.
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

Durable implementation requires a confirmed `todo` Development WorkItem; explanation, review,
proposal work, and small explicit maintenance do not. An Agent may draft a WorkItem. Only an
unambiguous user implementation request or named standing policy may confirm it without another
user round trip. Never self-confirm inferred scope, architecture, or high-risk work.

Prefer one end-to-end vertical slice over broad scaffolding. Do not add speculative provider,
TaskSource, database, UI, PR, deployment, compatibility, or framework-detection abstractions.

Use stable logical ids in persisted state. Host paths and provider session ids are locators, not
durable identity. Keep complete logs, diffs, transcripts, and large Agent output in linked
artifacts, not aggregate state or startup documents.

When proposal status changes, update its metadata, `docs/proposals/INDEX.md`, and
`docs/current-state.md`. Preserve proposal chronology rather than rewriting earlier reasoning as if
it never happened.

## Validation And Project Memory

Follow `docs/validation.md`. Documentation-only work currently requires:

```sh
git diff --check
```

Also inspect affected links, authority projections, and eager Harness file sizes. Never report a
nonexistent or unexecuted command as passed.

For every executed check report the exact command, exit code, scope, concise observation, and
relevant unverified boundary. Do not paste full output into project memory.

Update `docs/current-state.md` only when a change alters:

- a current implemented fact;
- accepted unfinished work;
- an open question or limitation;
- the single next recommended task.

Do not promote an unaccepted proposal or unlanded branch into the canonical baseline.

## Language

Use English for stable machine contracts, source, schemas, architecture, and repository engineering
documents. Use Simplified Chinese for user-facing plans, progress, review conclusions, and delivery
summaries unless requested otherwise.

Preserve commands, output, identifiers, paths, payloads, and quoted evidence verbatim.
