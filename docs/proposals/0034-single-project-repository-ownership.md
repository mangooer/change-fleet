---
artifact_type: repository_design_proposal
id: 0034
status: accepted
title: Single-Project ownership for each registered local Git repository
proposed_at: 2026-08-18
accepted_at: 2026-08-18
confirmed_by: user
supersedes: none
depends_on: none
blocks: none
decision: docs/decisions/0036-single-project-repository-ownership.md
implementation_tracking: docs/work-items/WI-0049-common-git-directory-project-ownership.md
---

# 0034: Single-Project Ownership For Each Registered Local Git Repository

## Context

ChangeFleet currently stores Repository bindings under a Project. Each binding owns the local
locator, default target, workspace-policy revisions, delivery-binding revisions, and mutation
authority used by later ChangeSets. One Project may already contain one or many Repositories.

`SPEC.md` left open whether one Repository might eventually participate in several Projects. The
initial implementation rejects a second Project that resolves to an already registered Git root
with `AMBIGUOUS_SHARED_REPOSITORY`, but the product contract did not make that ownership rule
durable.

Allowing shared registration now would create two authorities for the same repository state:

- Project-local defaults and policy revisions could diverge;
- delivery bindings and target assumptions could disagree;
- Repository ids, destination locks, and workspace generations could describe one underlying Git
  store as unrelated subjects;
- a later Project could appear to broaden access without revising the original owner's authority.

There is also one implementation distinction that the accepted contract must state precisely. A
linked Git worktree has its own resolved top-level path but shares a `common_git_dir` with the main
worktree. Comparing only `resolved_git_root` does not reject that alias. Conversely, two independent
clones may share a canonical remote while remaining separate explicitly registered local stores.
Canonical remote is mutable locator evidence, not durable Repository identity.

The user accepted the recommendation to keep single-Project ownership and requested Decision 0036.

## Decision

Within one Portfolio, each registered local Git repository store belongs to exactly one Project.
Admission identity for this rule is the resolved `common_git_dir`:

- one Project may bind any non-empty set of distinct Repository stores;
- one `common_git_dir` may appear in exactly one Repository binding in the Portfolio, including
  within the same Project;
- registering the main worktree, a linked worktree, a nested path, or another alias of the same
  common Git store must not create a second binding;
- Project membership is frozen in catalog authority and cannot be expanded by an Agent, Runtime,
  ChangeSet, Repository selection, or ActionGrant.

The durable Repository id remains a stable logical id scoped by its owning Project. Host paths,
resolved roots, common Git directory paths, and canonical remotes remain locators or admission
evidence, not durable cross-host identity.

Distinct clones are not automatically deduplicated merely because they report the same canonical
remote. ChangeFleet does not infer that URL aliases, mirrors, forks, or independently configured
clones are one authority. Operators remain responsible for registering only the intended local
store. A later cross-host or shared-Project design requires an explicit Portfolio-level Repository
registry and a new boundary proposal.

No transfer, membership table, alias graph, or shared policy overlay is introduced. If a business
change spans several repositories, model them in one owning Project and let one ChangeSet select the
required subset.

## Existing Implementation And Gap

The current registration path already rejects a directly repeated `resolved_git_root` across
Projects. That preserves the ordinary-checkout case but is narrower than this accepted boundary:

- it does not compare `common_git_dir`;
- it does not reject two aliases of the same Git store inside one new Project;
- no dedicated regression test currently freezes the cross-Project rejection contract.

A separately confirmed WorkItem should change admission to compare normalized common Git-directory
locators across both existing and newly submitted bindings, retain the stable
`AMBIGUOUS_SHARED_REPOSITORY` diagnostic, and add real-Git tests for direct, nested, linked-worktree,
same-Project, and distinct-clone cases. This proposal does not self-confirm that implementation.

## Alternatives

### Allow One Repository In Several Projects

Rejected for the initial product. It would require explicit membership, policy precedence,
cross-Project scheduling, delivery ownership, and transfer semantics before it could be safe.

### Add A Portfolio-Level Repository Registry Now

Deferred. It is the likely shape if real shared ownership appears, but current scenarios need only
one owner and do not justify another authoritative aggregate.

### Deduplicate By Canonical Remote

Rejected. Remote URLs can be absent, mutable, credential-shaped, aliased across protocols, or shared
by intentionally independent clones. They are useful observation evidence but insufficient durable
identity.

### Keep Only The Existing Resolved-Root Check

Rejected as the accepted contract. It misses linked-worktree aliases that share refs and object
storage, so it cannot support truthful per-Repository scheduling and mutation ownership.

## Consequences

- Project registration remains minimal and human-reviewable.
- A Project may contain multiple Repositories; a Repository store has only one Project owner.
- Project-local workspace and delivery policies have one unambiguous owner.
- ChangeSet and ActionGrant authority cannot bridge Project membership.
- Linked-worktree aliases must fail closed after the follow-up implementation lands.
- Distinct clones and remote aliases remain an explicit operator/configuration boundary.
- Repository transfer, shared membership, hosted registry, and cross-Portfolio identity remain
  outside the accepted product.
- Decision 0034's console, audit, and Harness-overlay freezes remain unchanged.

## Documentation Impact

- `SPEC.md`: replace the open shared-Repository possibility with single-Project ownership and
  common-Git-directory admission identity.
- `docs/architecture.md`: make CatalogStore ownership and locator-versus-identity semantics explicit.
- `docs/current-state.md`: close the ownership question and expose the linked-worktree enforcement
  gap as the next bounded task.
- `docs/proposals/INDEX.md` and `docs/decisions/README.md`: add Proposal 0034 and Decision 0036.

## Revision History

- 2026-08-18: Proposed and accepted by the user after WI-0048. The selected boundary preserves one
  owning Project per registered common Git store, defers a global Repository registry, and records
  the existing resolved-root guard as partial rather than complete implementation.
- 2026-08-18: The user confirmed WI-0049 to implement common-Git-directory admission and real-Git
  alias regression coverage.
- 2026-08-18: WI-0049 completed the accepted boundary with transaction-local common-directory
  ownership checks and real-Git coverage for aliases and independent clones.
