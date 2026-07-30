# 0007: Variable Repository Scope And Localized Diagnostics

Status: Accepted

Date: 2026-07-30

Source: Repository Design Proposal 0004

## Decision

A Project catalog contains one or more explicitly registered Repositories as its Repository
universe, not the mandatory scope
of every ChangeSet. A current ChangePlan must contain one or more WorkUnits and may use any
non-empty subset of that Project's registered Repositories. It may not add an unregistered
Repository; that remains a typed `SCOPE_EXPANSION_REQUIRED` transition requiring explicit human
authorization.

The deterministic first slice retains explicit confirmation for every PlanRevision, including a
single-Repository plan. CandidateBundle assembly and combined validation operate over the exact
current WorkUnit set, whether it contains one or several Candidates.

ChangeFleet-generated diagnostics use stable English error codes as the machine contract and a
small internal localization boundary for display messages. `zh-CN` is the default initial locale;
`en` is an included fallback locale. Error objects carry code, localized message, structured
details, and locale. Raw external command, Git, and provider output remains verbatim evidence and
is not translated.

New and materially modified production source includes Simplified Chinese comments where they
explain non-obvious ownership, authorization, identity, persistence, locking, recovery, Git
safety, and bounding decisions. Comments explain intent and invariants, not trivial syntax.

## Rationale

Project membership is an authorization ceiling. Requiring every registered Repository in every
ChangeSet confuses that ceiling with the actual business scope and makes ordinary one-repository
changes artificially cross-repository. Exact PlanRevision scope preserves explicit control without
requiring an oversized plan.

Stable codes make programmatic behavior and persisted evidence independent of human language.
Moving only ChangeFleet-owned messages behind a small catalog now avoids a broad future migration
while retaining raw diagnostic output needed for debugging.

## Consequences

- The exact-two-Repository and exact-two-WorkUnit assertions in the local slice must be removed or
  generalized; a Project may contain one or more Repositories.
- Tests must prove both one-Repository and multi-Repository ChangeSets.
- A single-Repository CandidateBundle is a valid review subject.
- WI-0001 is revised in place; no duplicate implementation WorkItem is created.
- Provider, UI, CLI, tracker, and full internationalization-platform work remain deferred.

## Accepted Correction

On 2026-07-30, the user clarified that a Project is not inherently multi-repository. This decision
therefore permits a single-Repository Project. The multi-Repository flow remains an acceptance
case, rather than a catalog cardinality requirement.
