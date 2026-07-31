# ChangeFleet

ChangeFleet coordinates one auditable software change across multiple Git repositories.

An Agent Runtime may analyze code, create subagents, select skills, and implement repository
changes. ChangeFleet owns the durable control facts around that work: confirmed intent, repository
scope, plan revisions, isolated WorkUnits, exact Git Candidates, combined validation evidence,
human decisions, and delivery targets.

The product is neither a generic multi-agent framework nor merely a way to move a coding Agent into
a service or web UI. Its durable value is keeping one business change coherent when planning,
execution, retries, evidence, and review span multiple repositories. Its primary result is a
reviewable `CandidateBundle` representing one exact cross-repository outcome.

## Current Status

This repository contains the initial spec-first project Harness and the user-accepted WI-0001
private package. The implementation is not released and exposes no public CLI contract.

The first accepted vertical slice, tracked by
[`WI-0001`](docs/work-items/WI-0001-local-two-repository-vertical-slice.md), is:

```text
confirmed intent
  -> inspect one or more explicitly registered local Git repositories
  -> produce and confirm a ChangePlan for an authorized non-empty Repository subset
  -> execute isolated repository WorkUnits
  -> publish exact per-repository Candidates
  -> run repository and combined validation
  -> review one CandidateBundle
```

Automatic merge, deployment, remote workers, and Git-URL materialization are outside that first
slice.

## Start Here

For human orientation:

1. [`docs/current-state.md`](docs/current-state.md) — current facts, open questions, and next work.
2. [`SPEC.md`](SPEC.md) — accepted product contract; use headings to navigate.
3. [`docs/architecture.md`](docs/architecture.md) — target components and ownership.
4. [`docs/proposals/INDEX.md`](docs/proposals/INDEX.md) — Repository Design Proposals.

For an Agent task, do not read that entire list. Apply [`AGENTS.md`](AGENTS.md), read current state
and the active Development WorkItem or Repository Design Proposal, inspect the Git diff, then load
only relevant specification, architecture, decision, and evidence sections.

## Harness Structure

[`docs/harness.md`](docs/harness.md) defines the repository's progressive-disclosure Harness:

```text
always applicable
  AGENTS.md

task startup
  docs/current-state.md
  active Development WorkItem or Repository Design Proposal
  Git status and diff

on demand
  relevant SPEC sections
  relevant architecture and accepted decisions
  historical proposals and execution evidence
```

Current truth is maintained as a projection; historical proposals and detailed evidence remain
available without being loaded into every task. The accepted boundary for user repository Harness
ownership, current Run projections, Agent Profiles, operation-scoped Skills, and honest
context-budget evidence is [`Decision 0005`](docs/decisions/0005-runtime-context-harness-and-capabilities.md);
[`Proposal 0003`](docs/proposals/0003-harness-ownership-and-runtime-context.md) preserves its design
history.

Repository Design Proposals and Development WorkItems govern this repository. They are not
ChangeFleet Runtime outputs. Runtime coordination uses ChangeSet, ChangePlanRevision, WorkUnit,
Run, Candidate, and CandidateBundle records.

## Product Vocabulary

- **Project**: a logical product, business system, or bounded code domain.
- **Repository**: one registered Git repository belonging to a Project.
- **ChangeIntent**: the confirmed desired outcome, constraints, and acceptance criteria.
- **ChangePlan**: a versioned, code-informed proposal for repositories, ordering, and checks.
- **WorkUnit**: one repository-scoped execution unit within a ChangeSet.
- **Candidate**: one immutable repository result identified by base and candidate SHAs.
- **CandidateBundle**: the exact set of Candidates reviewed as one coherent change.
- **DeliveryTarget**: the repository branch or integration destination for one Candidate.

See [`docs/glossary.md`](docs/glossary.md) for the complete vocabulary.

## Development

[`Decision 0006`](docs/decisions/0006-first-vertical-slice-implementation-boundary.md) accepts one
private Node.js 24 LTS ESM JavaScript package and a versioned filesystem store. WI-0001 and WI-0002
implement the deterministic control kernel. The accepted WI-0003 implementation adds the pinned
Codex SDK production adapter; scripted Runtime behavior remains test support only.

The accepted package exposes:

```sh
npm test
npm run test:integration
npm run test:acceptance
npm run test:provider:codex
npm run check
```

The real Provider command is opt-in and runs only when `CHANGEFLEET_RUN_REAL_CODEX=1`; it requires
external Codex credentials and is intentionally excluded from `npm run check`.

Report every command actually executed and never claim an unexecuted check passed.
