# 0004: Variable Repository Scope And Localized Diagnostics

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-07-30

Depends on: Decision 0006, accepted

Accepted: 2026-07-30

Decision: [Decision 0007](../decisions/0007-variable-scope-and-localized-diagnostics.md)

Implementation tracking: [WI-0001](../work-items/WI-0001-local-two-repository-vertical-slice.md), revised and `complete`.

## Context

The local vertical slice currently hard-codes two registered Repositories and requires every
ChangePlan to create exactly two WorkUnits. This proves a cross-repository Bundle, but it treats
the Project Repository catalog as mandatory execution scope. A real business change may affect
only one registered Repository while the Project still contains several repositories.

The current source also embeds English diagnostic text alongside stable error codes. That is
adequate for a private fixture but makes later language support expensive: messages are spread
across domain, application, filesystem, Git, and Runtime boundaries.

The repository's implementation source should also be readable to the project owner. New and
modified production code should explain non-obvious control, durability, security, and recovery
logic with Simplified Chinese comments. Comments must explain intent and invariants, not translate
obvious syntax line by line.

## Proposed Decision

### 1. Separate catalog scope from ChangeSet execution scope

A Project may register one or more Repositories. Registration remains explicit and does not grant
an Agent authority to use all of them automatically.

A proposed plan contains one or more WorkUnits. Its repository set must be a non-empty subset of
the Project's registered Repositories. The Runtime may not introduce an unregistered Repository;
that remains the typed `SCOPE_EXPANSION_REQUIRED` transition.

The Project catalog is therefore the maximum authorized universe. The confirmed PlanRevision is
the exact execution authorization for one ChangeSet.

For the revised first slice, acceptance tests must cover both:

- one single-repository ChangeSet within a single-Repository Project;
- one multi-repository ChangeSet that produces a Bundle spanning its planned Candidates.

CandidateBundle assembly requires one successful Candidate and repository Evidence for every
current WorkUnit, plus the confirmed combined validation Evidence. A single-repository Bundle is
valid; its combined validation still receives a manifest containing exactly that one Candidate.

Explicit plan confirmation remains required for every plan in this private first slice. A later
proposal may differentiate confirmation policy by risk or repository count; this proposal does
not create automatic single-repository execution.

### 2. Introduce localized diagnostics behind stable codes

`ChangeFleetError.code` remains the stable, machine-readable contract. Callers, persisted
evidence, tests, and future APIs must use the code rather than matching display text.

Add a small domain-owned diagnostics module with:

- a `locale` value of `zh-CN` or `en`;
- `zh-CN` as the default locale for the initial implementation;
- error-message templates indexed by stable error code;
- interpolation of structured details into a localized message;
- a deterministic English fallback for missing translations;
- an error object carrying `code`, localized `message`, `details`, and `locale`.

The first implementation need not translate arbitrary operating-system, Git, or child-process
output. Such raw output stays verbatim in Evidence. ChangeFleet-generated errors and user-facing
command results are localized; low-level causes remain structured details or Evidence references.

No external i18n dependency, user account preference, HTTP content negotiation, or pluralization
framework is introduced in this slice.

### 3. Chinese source-comment convention

New and materially modified production code must include Simplified Chinese comments at module,
function, and non-obvious branch boundaries where they explain:

- ownership or authorization checks;
- identity and hashing choices;
- atomic-write and lock ordering;
- crash recovery decisions;
- Git workspace and Candidate safety checks;
- why data is bounded, externalized, or deliberately omitted.

Do not require comments for self-evident assignments, standard language syntax, or every test
assertion. Existing files touched for this proposal receive comments around their non-obvious
logic; a later cleanup can improve untouched files without changing behavior.

## Consequences

- `Project.repositories.length === 2` and `plan.work_units.length === 2` cease to be valid
  product invariants.
- `INCOMPLETE_REPOSITORY_SCOPE` is replaced by validation that a plan has at least one WorkUnit and
  has no duplicate Repository WorkUnit; it no longer requires all registered Repositories.
- The current acceptance fixture must gain a single-repository flow while retaining a
  multi-repository flow.
- The current Bundle and validation-subject rules must be generalized from an exact pair to the
  exact current WorkUnit set.
- Existing English strings move behind the diagnostics boundary. Error codes do not change.
- The initial user-visible language is Chinese; English is an explicitly supported fallback
  catalog, not an unimplemented future promise.

## Non-Goals

- Dynamic discovery or automatic registration of repositories.
- Authorizing arbitrary repository scope from an Agent plan.
- Removing plan confirmation for low-risk or one-repository changes.
- Translating Git, Node.js, provider, shell, or test output.
- Public CLI/API localization contracts or persistent per-user preferences.
- A complete comment-only rewrite of every historical line of source code.

## Required Implementation Evidence

- Unit tests proving a one-WorkUnit plan is valid and an unregistered Repository still fails with
  `SCOPE_EXPANSION_REQUIRED`.
- Acceptance coverage for a single-repository ChangeSet and retained coverage for a
  multi-repository ChangeSet.
- Unit tests for Chinese default messages, explicit English messages, fallback behavior, and stable
  error codes/details.
- Targeted source review confirming Chinese intent comments in all newly modified production
  boundaries.
- Full existing unit, integration, and acceptance suites, updated to the revised behavior.

## Recommendation

Accept this proposal, then revise WI-0001 rather than creating a second competing implementation
WorkItem. Implement scope generalization and diagnostics before adding any Provider, Skill,
tracker, CLI, UI, or delivery boundary.

## Acceptance

Accepted: 2026-07-30

The user explicitly accepted Proposal 0004. Decision 0007 owns its durable rationale. WI-0001 is
revised in place to implement the accepted scope and diagnostics changes.

## Accepted Correction: Single-Repository Projects

Corrected and accepted: 2026-07-30

The user clarified that a Project itself is not necessarily multi-repository. A Project therefore
registers one or more explicit Repositories. The original multi-repository acceptance flow remains
required, but a single-Repository Project and a single-Repository ChangeSet are both valid.
