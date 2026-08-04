# 0019: Durable Codex Runtime Home And Pre-Candidate Retry

Status: Accepted

Superseded in part by: Decision 0020 for Provider Runtime Home creation, copying, and ownership

Date: 2026-08-04

Source: Repository Design Proposal 0017

## Decision

Use one versioned, durable, isolated Provider Runtime Home per local Codex credential profile instead
of a new partial `CODEX_HOME` for every invocation. The home contains only the authentication and
native sandbox state needed by the pinned Codex SDK/CLI. It excludes user configuration,
instructions, Skills, plugins, MCP data, sessions, history, Repository Harness, and Runtime Kit
content, and it never enters ChangeFleet control state or Agent context.

Accept `implementation_blocked` as a strict execution outcome. Reject completed implementation
output when exact Git publication is base-equal or empty, and do not create a current checkpoint or
run validation for it.

A new explicit execution command may create a fresh Run in the same ChangeSet after a pre-Candidate
failure only when the owned workspace is clean at the unchanged exact base. It preserves prior
attempts and may detach a historical base-equal checkpoint from current authority without deleting
it. It never resets or adopts partial work, never discards a real Candidate, and never changes the
confirmed plan or Repository and Harness selections.

The dogfood retry must launch under Node.js 24. ChangeFleet does not reinterpret arbitrary
repository `node` commands as its own process executable.

## Rationale

The WI-0009-v2 execution proved that partial temporary Codex Homes can repeatedly trigger elevated
Windows sandbox setup and that a strict schema forcing `implementation_completed` can convert tool
failure into an empty checkpoint. A durable minimal home fixes Provider operational continuity
without inheriting ambient user Harness. Clean-base-only retry provides the continuation already
required by the accepted fresh-thread attempt model without adding destructive recovery or an
automatic paid retry policy.

## Consequences

- WI-0012 implements the corrective vertical slice before WI-0009-v2 is retried.
- Runtime Home files are host-local operational state and require an explicit protected root.
- Prior failed Runs and empty checkpoints remain cost and failure evidence but cease to be current
  validation authority.
- A dirty or moved failed workspace requires later human recovery, replanning, closure, or a new
  task; this decision adds no reset operation.
- Unelevated sandbox, full access, global Codex Home reuse, Provider-session resume, automatic retry,
  general toolchain management, and UI recovery remain deferred.
