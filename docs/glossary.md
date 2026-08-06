# Glossary

## AgentProfile

A stable ChangeFleet reference that a Runtime adapter resolves into provider-native model,
reasoning, capability, and optional Skill settings. It is not a universal model catalog.

## Candidate

An immutable result in one repository, identified by Repository id, target ref, base SHA, and
candidate SHA.

## CandidateCheckpoint

The durable exact Git subject persisted after Provider completion and before repository validation.
It may resume exact validation but is not a Candidate, Bundle, review, delivery, or acceptance
authority.

## CandidateBundle

An immutable manifest of the exact repository Candidates, validation evidence, missing boundaries,
and plan revision reviewed as one ChangeSet result.

## ChangeIntent

The confirmed task-specific objective, constraints, acceptance criteria, decisions, and open
questions. It describes what and why, not the complete implementation method.

## ChangePlan

A versioned, code-informed proposal describing affected repositories, WorkUnits, dependencies,
validation, delivery, and risks.

## ChangeSet

The aggregate root for one coherent business change across planning, execution, review, and
delivery preparation.

## Control Contract

A compact, versioned machine contract for one managed Run defining authorization, exact identity,
allowed typed outcomes, evidence reporting, cancellation, and human gates.

## DeliveryTarget

The intended repository destination ref or external PR subject for one Candidate.

## DeliveryRequest

A stable ChangeFleet record binding one accepted exact Candidate, target ref, confirmed delivery
binding revision, deterministic remote branch, and GitHub pull-request identity.

## DeliveryResult

The exact observed external merge fact linking a reviewed Candidate SHA to GitHub's possibly
different merge, squash, or rebase result SHA, actor, time, and target evidence.

## Development WorkItem

A repository Harness artifact authorizing and tracking durable implementation work in the
ChangeFleet repository itself. It is not a product Runtime `WorkUnit`.

## Harness

Long-lived repository-native instructions, skills, architecture references, and verification
guidance used by an Agent Runtime. Harness is not per-task discussion history.

## Locator

A host-specific way to find or materialize a Repository. The first locator is a local filesystem
path. A Git URL may be added later.

## Portfolio

One ChangeFleet control environment containing registered Projects, Repositories, ChangeSets, Runs,
and decisions.

## Project

A logical product, business system, or bounded code domain containing explicitly registered
Repository bindings.

## Repository

A stable logical identity for one Git repository. It is not synonymous with Project.

## RepositoryHarnessSelectionRevision

The immutable ChangeSet input identifying exact-base Harness and any explicitly confirmed frozen
local overlay for one Repository and Provider family.

## RepositorySelectionRevision

The versioned ChangeSet authority defining which registered Repositories planning may inspect,
which branch and exact base SHA each uses, and which target ref applies. Revision 1 is created with
the ChangeSet before Runtime planning.

## RepositoryWorkspacePolicyRevision

Reusable confirmed Repository configuration selecting eligible local workspace input. The first
accepted purpose is immutable Repository Harness; the policy is not exact Run evidence or
writeback authority.

## Repository Design Proposal

A chronological design-governance artifact used to evolve the ChangeFleet repository. It is not a
ChangeFleet Runtime output and is not written into registered repositories.

## RepositoryWorker

The adapter that materializes one repository workspace, invokes an Agent Runtime for one WorkUnit,
and publishes one exact Candidate.

## Run

One bounded Agent Runtime invocation for `planning`, `execution`, or `verification`, with trigger,
continuation lineage, common terminal status, events, outcome, usage, and evidence. Deterministic
validation commands are ValidationAttempts rather than Runs.

## Run Context Projection

A rebuildable current view generated for one planning, execution, verification, or recovery operation. It
contains the relevant current plan slice and references durable history rather than replaying it.

## Scope Expansion

A typed proposal to add a Repository, target, or material responsibility not authorized by the
current ChangePlan.

## WorkUnit

One repository-scoped execution unit within a ChangeSet. Its phase is
`execution | verification | complete`, independently from its
`current | superseded | excluded` disposition.

## Feedback

Immutable bounded input from a human or semantic stage, bound to an exact current subject. It is a
claim for an Agent to assess, not controller-certified truth or an aggregate state.

## Gate

One exact human question with `open | resolved | withdrawn` lifecycle. Waiting is derived from an
open Gate rather than stored as a ChangeSet or WorkUnit state.

## ValidationAttempt

A bounded immutable reference to one repository, verifier-requested, or combined validation
execution and its exact subject, semantic check identity, requested and effective attempt budget,
observed environment, duration, outcome, and EvidenceStore record. Failed attempts remain history
when a later attempt passes.

## VerificationAdmissionDecision

The immutable `basic`, `deterministic`, or `independent_review` admission selected for one exact
CandidateCheckpoint from frozen typed authority and final deterministic facts. It is not review,
Bundle acceptance, or permission for a Runtime to edit code.

## VerificationReview

One bounded `triage` or `deep_review` result from a read-only Verification Runtime, bound to an
exact CandidateCheckpoint, admission decision, Run, and any Runner-executed additional checks. Its
verdict may permit Candidate creation, produce actionable Feedback, record non-blocking notes, or request a
human decision. It is not Bundle acceptance and cannot edit the reviewed Git subject.

A `changes_required` review records Feedback and returns the same WorkUnit to execution under the
confirmed Plan. The next execution Run has trigger `feedback` and records exact assessments. A later
ordinary VerificationReview may bind that feedback Run and receive prior-finding focus metadata,
while retaining the same verification lifecycle and the ability to inspect the full relevant diff.
