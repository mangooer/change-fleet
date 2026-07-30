# 0002: ChangeSet And CandidateBundle Aggregate

Status: Accepted for initial project bootstrap

Date: 2026-07-29

## Decision

One coherent business intent is represented by one `ChangeSet`, even when it requires:

- multiple plan revisions;
- multiple repositories;
- multiple WorkUnits;
- multiple Agent Runs;
- abandoned implementation attempts;
- multiple repository Candidates.

The review subject is an immutable `CandidateBundle`, not an individual Run, workspace, branch, or
single candidate SHA.

Every CandidateBundle binds:

- ChangeIntent revision;
- ChangePlan revision;
- expected WorkUnits;
- exact repository Candidates;
- repository and combined validation;
- missing and unverified boundaries.

## Rationale

A cross-repository task loses meaning when front-end, back-end, and contract changes become
independent tasks with independent acceptance. Conversely, forcing a new task whenever a plan is
wrong destroys continuity and audit history.

Git provides immutable commits within repositories but no native multi-repository review subject.
The Bundle manifest supplies that identity without pretending to create an atomic Git transaction.

## Consequences

- Replanning continues the same ChangeSet.
- Superseded plans and attempts remain immutable evidence.
- Human decisions must name the exact Bundle revision and hash.
- Changing any Candidate SHA creates a new Bundle identity.
- Partial completion cannot be presented as a complete Bundle unless excluded WorkUnits and their
  consequences are explicit.
- Current Conductor WorkItem and single-Candidate state are not compatibility constraints.
