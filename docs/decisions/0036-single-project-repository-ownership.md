# 0036: Single-Project Repository Ownership

Status: Accepted

Date: 2026-08-18

Source: Repository Design Proposal 0034

Refines: Decisions 0006, 0007, and 0008

## Decision

Within one Portfolio, each registered local Git repository store belongs to exactly one Project.
One Project may contain multiple distinct Repositories, but one resolved `common_git_dir` may occur
in only one Repository binding, including across linked worktree or nested-path aliases and within
one registration request.

The Repository id remains durable logical identity under its owning Project. Configured paths,
resolved Git roots, common Git-directory paths, and canonical remotes are locators or admission
evidence, not durable cross-host identity. Canonical remote alone is not a uniqueness key: distinct
clones, URL aliases, mirrors, and forks are not automatically collapsed into one Repository.

Project membership cannot be created or broadened by an Agent, Runtime, ChangeSet, Repository
selection, or ActionGrant. Repository transfer, shared Project membership, and a Portfolio-level
Repository registry remain outside the initial boundary and require a later proposal.

The current direct-root duplicate guard implements the ordinary checkout case but does not yet
reject every `common_git_dir` alias. A separately confirmed WorkItem must close that implementation
gap and add real-Git regression evidence; this Decision does not treat partial enforcement as
complete.

## Rationale

Repository workspace policy, delivery binding, mutation authority, scheduling, Candidate identity,
and recovery currently derive through one Project-owned binding. Shared registration without a
global authority model would duplicate those facts and allow divergent or accidentally broadened
control over the same Git store. Single ownership keeps the current kernel small while preserving a
clear future path to an explicit Portfolio-level registry if real demand appears.

## Consequences

- Project registration stays minimal; one Project may still coordinate many Repositories.
- One common Git store has one Project owner and one policy/delivery authority.
- Linked-worktree and nested-path aliases must fail closed once the follow-up gap is implemented.
- Canonical remote evidence does not silently merge distinct local stores.
- Cross-Project sharing and transfer remain unimplemented and unauthorized.
- Decision 0034's console, audit, and Harness-overlay freezes remain in force.
