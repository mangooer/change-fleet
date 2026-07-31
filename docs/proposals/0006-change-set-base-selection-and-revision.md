# 0006: ChangeSet Base Selection And Revision

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-07-30

Depends on: Decisions 0002, 0003, 0005, and 0007, accepted

Accepted: 2026-07-30

Decision: [Decision 0008](../decisions/0008-change-set-repository-selection.md)

Implementation tracking:
[WI-0002](../work-items/WI-0002-change-set-repository-selection.md), `done`

## Context

WI-0001 freezes each Repository's configured `default_target_ref` at planning time and uses its
current commit as the WorkUnit base SHA. That proves exact-base execution, but it assumes the
requested change always starts from the current default ref.

Real changes may need to start from a release branch, tag, or historical commit. The selected base
also determines repository Harness discovery, planning input, workspace content, Candidate
ancestry, validation identity, and recovery. It therefore belongs to ChangeFleet control authority,
not an Agent-selected implementation detail.

## Options Considered

### Option A: Always use the Repository default ref

Keep WI-0001 behavior. This is simple but cannot represent a historical fix or a release-specific
change.

### Option B: Let the Runtime return `base_sha` in its plan

This is flexible but grants the Agent authority to change what code it is allowed to inspect and
modify. A plan would become an implicit scope grant. Reject this option.

### Option C: Freeze an explicit ChangeSet BaseSelectionRevision before planning

The caller may select a ref or exact commit for any Repository. Unspecified Repositories inherit
the registered default. ChangeFleet resolves every effective selector to an exact commit, persists
the result as a revision, and only then invokes planning. The Runtime may request a later revision
but cannot approve or apply it. Recommend this option.

## Proposed Decision

### 1. Separate repository defaults, base selection, and delivery target

Repository registration keeps an optional `default_target_ref` as a default, not mandatory
ChangeSet authority.

Each effective Repository entry for a ChangeSet records:

```text
repository_id
base_selector.kind       ref | commit
base_selector.value
resolved_base_sha
target_ref
selection_source         repository_default | caller
resolved_at
```

`base_selector` answers “which source version was selected.” `resolved_base_sha` is the immutable
Git subject actually used. `target_ref` answers “which destination may eventually receive the
Candidate.” Base and target normally match but are not required to.

Tags are represented as ref selectors. ChangeFleet resolves refs and commits using the registered
Repository locator and rejects a selector that does not resolve to a commit.

### 2. Persist one effective BaseSelectionRevision before planning

A ChangeSet owns an ordered history of BaseSelectionRevisions and one
`current_base_selection_revision`. The effective revision contains the resolved selection for every
Repository made available to the planning operation.

If the caller supplies no override, ChangeFleet derives the effective selection from each
Repository's registered default and records `selection_source: repository_default`. This preserves
the simple WI-0001 path while making its assumption explicit and auditable.

If the caller supplies a selector or a target different from the registered default, that exact
input is confirmed authority for the revision. Planning cannot start until every available
Repository has a resolved base SHA.

Resolution occurs once when the revision is created. If a selected ref moves afterward, planning,
Harness discovery, execution, recovery, and validation continue to use the persisted SHA.

### 3. Keep Agent requests typed and non-authoritative

The Control Contract and planning projection include the current BaseSelectionRevision. The
Runtime must not return or override `base_sha` as ordinary plan data.

If analysis shows that another base is needed, the Runtime may return a typed
`BaseRevisionChangeRequest` containing:

```text
repository_id
requested_selector
requested_target_ref
rationale
```

This request does not mutate authorization. A caller must confirm it through a ChangeFleet command.

### 4. Revise the same ChangeSet

Confirming a changed base creates the next BaseSelectionRevision in the same ChangeSet. Any current
PlanRevision and pending WorkUnits based on the prior selection become superseded. Existing Runs,
Candidates, Evidence, and decisions remain historical records.

The ChangeSet then returns to planning. A changed base SHA, target ref, or authorization revision
requires a new Run and context-admission decision. Existing Candidate or Bundle approval cannot be
reused.

### 5. Keep Candidate identity unchanged

Candidate identity already includes:

```text
repository_id
target_ref
base_sha
candidate_sha
```

No workspace path or symbolic base selector enters Candidate identity. The BaseSelectionRevision
explains how ChangeFleet obtained the exact `base_sha`; the Candidate continues to bind the exact
result.

## Stage Placement

This is the next deterministic control-kernel stage after landed WI-0001 and before the first real
Provider adapter. A real Agent must not be connected while base authority is still implicitly tied
to the current default-ref tip.

If accepted, create one Development WorkItem for this boundary. Do not combine it with Provider,
telemetry, UI, delivery, or remote-repository implementation.

## Acceptance Evidence

- The existing default-ref flow remains valid but persists an explicit BaseSelectionRevision.
- A caller can select a non-default branch/tag ref and ChangeFleet freezes its exact commit before
  planning.
- A caller can select an exact historical commit.
- Moving a selected ref after freeze does not change planning, Harness discovery, workspace, or
  Candidate base identity.
- An invalid or non-commit selector fails before Runtime invocation.
- Runtime plan output cannot replace a control-owned base or target.
- A confirmed base change supersedes the current plan and continues the same ChangeSet with history
  preserved.
- Candidate and Bundle identities change when their exact base or target subject changes.
- Single-Repository and multi-Repository fixtures both pass.

## Non-Goals

- Automatically choosing the “best” branch or commit.
- Allowing the Agent to approve a base change.
- Fetching missing refs, cloning Git URLs, or materializing remote repositories.
- Delivery, rebasing, merging, or resolving divergence between base and target.
- Public CLI or UI design for browsing branches and commits.
- Provider, token-cost telemetry, or Agent-effectiveness comparison.

## Recommendation

Accept Option C. Then create WI-0002 for the smallest end-to-end base-selection and revision slice,
complete it, and remove any superseded default-tip assumptions before authorizing a real Provider
WorkItem.

## Discussion Update: Select Branches At ChangeSet Creation

Discussed: 2026-07-30

The user clarified that branch selection belongs to task creation. In product terms, creating a
ChangeSet must establish the complete initial Repository selection before any Runtime planning
invocation.

This update is the current recommendation and supersedes the earlier initial-revision timing and
name where they differ.

### Rename The Revision

Use `RepositorySelectionRevision`, not `BaseSelectionRevision`. The revision owns three related but
separate control facts:

- which explicitly registered Repositories planning may inspect;
- the selected branch and resolved base SHA for each visible Repository;
- the target ref associated with a future Candidate.

The current ChangePlan may create WorkUnits for any non-empty subset of that planning-visible
Repository set. Planning visibility is therefore not the same as final execution scope.

### Create Revision 1 Atomically With The ChangeSet

`createChangeSet` accepts an optional planning Repository id set and optional per-Repository branch
selections. The planning set defaults to every Repository registered in the Project. An explicit
set must be a non-empty subset of the Project catalog; adding another Repository later remains a
typed scope expansion. Before it persists a usable ChangeSet, ChangeFleet resolves the complete
effective selection:

```text
explicit branch supplied
  -> normalize the branch ref
  -> resolve it to an exact commit
  -> record selection_source = caller

no branch supplied
  -> re-read the registered local checkout's current symbolic branch
  -> resolve that branch to an exact commit
  -> record selection_source = current_checkout
```

The “current branch” is observed at ChangeSet creation, not copied from registration-time state.
Dirty or untracked checkout files remain excluded; the base is the selected branch tip commit.

If a checkout is in detached-HEAD state, there is no current branch. ChangeFleet returns a typed
`REPOSITORY_BRANCH_SELECTION_REQUIRED` result and requires an explicit branch. It must not silently
turn detached HEAD into a target branch or guess from a remote default.

Revision 1 and the initial ChangeSet state are persisted as one application command result. A
partial Repository resolution failure prevents creation of an actionable ChangeSet. Caller
idempotency fingerprints the caller's requested Repository ids, branches, and targets. A replay of
the same completed command returns the persisted revision without re-resolving branches that may
have moved. Resolved SHAs belong to the command result and ChangeSet state, not the replay
fingerprint.

### Current Revision Shape

```text
RepositorySelectionRevision
  revision
  status
  confirmed_at
  repositories[]
    repository_id
    branch_ref
    resolved_base_sha
    target_ref
    selection_source       caller | current_checkout
    resolved_at
```

The initial slice accepts branch refs rather than a generic caller-facing ref/commit selector.
Exact historical commit selection remains a likely follow-up, but it must not weaken the rule that
the user selects a branch and target when the ChangeSet begins. Internally, execution continues to
use only `resolved_base_sha`.

By default `target_ref` equals `branch_ref`. A caller may explicitly choose a different target at
ChangeSet creation; both values are then frozen in RepositorySelectionRevision 1 and require the
same human authority to revise.

### Revision State Rules

A later selection change is allowed only while the ChangeSet can legitimately return to planning:

- `analyzing`;
- `awaiting_plan_confirmation`;
- `replanning`;
- after a Bundle `request_revision` decision has returned it to `replanning`.

At `candidate_review`, the reviewer must first request revision; branch selection cannot silently
invalidate the current review subject. At `delivery_ready`, `done`, or after any future delivery
has begun, changing the branch requires a new ChangeSet.

Confirming RepositorySelectionRevision N+1:

- supersedes the prior current selection revision;
- supersedes the current PlanRevision and its non-terminal WorkUnits;
- preserves all prior Runs, Candidates, Evidence, Bundles, and decisions;
- returns the same ChangeSet to planning;
- requires new context admission, planning, plan confirmation, Candidates, validation, and Bundle.

### Revised Stage Acceptance

WI-0002, if authorized, must prove:

- explicit branch selection at ChangeSet creation;
- defaulting to each local checkout's current symbolic branch at that exact time;
- typed rejection of detached HEAD without an explicit branch;
- exclusion of dirty checkout files;
- frozen SHA stability when the selected branch moves after creation;
- planning visibility over the selected Repository set and WorkUnits over a non-empty subset;
- revision only in the allowed states;
- preservation and supersession behavior in the same ChangeSet.

## Acceptance

Accepted: 2026-07-30

The user accepted Proposal 0006 with its discussion update and requested exactly one `todo`
Development WorkItem. Decision 0008 owns the current durable contract. The accepted initial
implementation supports branch selection, not arbitrary historical commit selection.
