# 0031: Local ChangeSet Intake And Conversational Planning

Status: Accepted

Date: 2026-08-12

Source: Repository Design Proposal 0029

## Decision

Extend the foreground, single-user, loopback console with a minimal intake and conversational
planning path over existing shared application operations. An operator selects an existing
Project and a non-empty Repository subset, supplies bounded intent and optional refs, creates one
ChangeSet and persistent TaskWorkspace, exchanges planning messages, and approves one exact
Plan-bearing response.

Creation and initial planning remain separate idempotent operations even when the UI presents them
as one continuous interaction. A planning failure preserves the created ChangeSet for retry. Plan
confirmation continues to bind the exact assistant message and Core-produced workspace-control
digest, after which existing manual or autonomous supervision policy applies.

The local read surface exposes only bounded, non-secret intake choices and recent planning turns.
Each new Planner Run receives the current user message and the immediately preceding assistant
planning message, including a question that contains no Plan. Full conversation history, Run
records, logs, and provider payloads remain linked audit data outside ordinary Runtime context.

All existing loopback, Host, same-origin, CSRF, body-size, route-allowlist, safe-error, and
foreground-process boundaries remain mandatory. The browser never selects raw operations,
filesystem paths, executables, provider options, or credentials.

## Rationale

Core already owns task creation, exact workspace preparation, planning, confirmation, execution,
review, and delivery. Requiring CLI JSON before using the console is an adapter gap and prevents
the local product surface from proving the ordinary end-to-end task experience. Reusing shared
operations keeps CLI, UI, and future intake adapters aligned without another task or lifecycle.

Projecting only the adjacent assistant message preserves genuine question-and-answer continuity
without replaying an ever-growing transcript into each fresh Agent attempt. A bounded human view
can still reconstruct recent turns from immutable linked evidence.

## Consequences

- One existing-Project task can begin and reach Plan confirmation entirely in the local console.
- Intake options, ChangeSet creation, and planning use explicit query and mutation routes rather
  than CLI execution or a generic operation endpoint.
- The console displays effective task configuration but does not edit Projects, AgentProfiles,
  Harness, policy, credentials, or delivery bindings.
- Provider or controller failure after creation leaves one recoverable planning task.
- Existing ChangeSet, TaskWorkspace, Plan, WorkUnit, CandidateBundle, supervision, review, and
  delivery authority is unchanged.
- Linear, GitHub Issue intake, SourceBinding routing, streaming transport, remote access, project
  administration, model comparison, Candidate lanes, deployment, and automatic merge remain
  deferred.
