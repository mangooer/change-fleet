# 0001: Control Plane Boundary

Status: Accepted for initial project bootstrap

Date: 2026-07-29

## Decision

ChangeFleet is a deterministic control plane around autonomous Agent Runtimes.

Agent Runtimes own:

- semantic repository analysis;
- implementation planning details;
- provider-native context;
- subagents;
- skills and tools;
- code changes;
- task-specific check selection.

ChangeFleet owns:

- confirmed intent;
- repository authorization;
- plan and scope revisions;
- WorkUnit scheduling;
- workspace and Git subject identity;
- evidence linkage;
- recovery and cancellation;
- exact human decisions.

Core must not become a generic Agent graph, semantic code index, Harness generator, skill manager,
or project-specific test engine.

## Rationale

Agent capabilities are improving quickly and already absorb planning, tool use, subagent
coordination, code discovery, and worktree operations. A product built around duplicating those
capabilities will lose value as Runtime platforms improve.

Durable authorization, identity, evidence, partial-failure handling, and human accountability must
remain outside the Agent that performs the work.

## Consequences

- Agent-native subagents remain invisible to the ChangeSet state model.
- A semantic Agent proposal cannot silently expand repository authority.
- Repository-specific knowledge stays in repository-native Harness.
- Provider abstractions remain thin and are added only for proven Runtimes.
- Product value is measured by reduced supervision and reliable delivery evidence, not the number
  of Agent roles.
