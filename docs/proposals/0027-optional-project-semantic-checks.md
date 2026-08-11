---
artifact_type: repository_design_proposal
id: 0027
status: accepted
title: Optional project semantic checks with mandatory structural preflight
proposed_at: 2026-08-11
accepted_at: 2026-08-11
confirmed_by: user
decision: docs/decisions/0029-optional-project-semantic-checks.md
implementation_tracking: docs/work-items/WI-0035-optional-project-semantic-checks.md
---

# 0027: Optional Project Semantic Checks With Mandatory Structural Preflight

## Context

The first multi-Repository slice required exactly one repository command for every WorkUnit and one
combined command for every Candidate set. That fixed shape proved exact command execution,
Candidate binding, recovery, and Bundle evidence, but it also turned a fixture-level validation
topology into a universal Plan requirement.

Projects do not all have the same useful command topology. A documentation-only or narrowly scoped
change may have no applicable repository command. A single-Repository change usually has no
cross-Repository invariant. Conversely, some changes need an independent verifier or an additional
focused check selected from the exact Candidate. ChangeFleet must preserve structural authority
without inventing semantic commands or forcing no-op evidence.

## Decision

Separate deterministic structural preflight from project semantic checks:

- ChangeFleet always verifies the exact Candidate or Candidate set before promotion: authorized
  repository identity, base and head identity, ancestry, workspace ownership and containment,
  cleanliness, changed paths, Harness-overlay exclusion, and complete Bundle membership.
- A Plan may select one repository semantic command for a WorkUnit or explicitly select none. It
  records a concise selection rationale in either case.
- A Plan may select one combined semantic command for the exact Candidate set or explicitly select
  none. It records why a cross-Repository command is selected or not applicable.
- When a semantic command exists, the Runner executes it against the exact subject and preserves
  the existing command identity, attempt budget, immutable evidence, and recovery rules.
- When no semantic command exists, ChangeFleet still records immutable structural-preflight
  evidence and a real bounded validation attempt with no command identity or process budget. It
  never substitutes an invented or no-op command.
- An independent Verification Runtime may still request bounded additional checks. Its prose is not
  evidence; the Runner executes accepted requests against the exact subject.
- Residual risk belongs in `unverified_boundaries`. Project-owned policy or confirmed Plan
  expectations may require stronger verification, but ChangeFleet Core does not infer a test
  command from file type, language, Harness format, or repository contents.

The initial implementation deliberately keeps the existing zero-or-one Plan command slot instead
of adding command arrays. Bounded verifier-requested checks already cover exact-Candidate follow-up,
and a future demonstrated need may generalize Plan command multiplicity without adding states.

## Evidence And Identity

Repository and combined evidence retain their exact Candidate subjects. Evidence distinguishes a
selected semantic command from structural-only validation and binds the explicit selection
rationale. A combined validation subject binds the exact sorted Candidate set plus the optional
semantic-check selection. CandidateBundle identity continues to include the resulting repository
and Candidate-set evidence references.

No new ChangeSet, WorkUnit, Run, Gate, Feedback, or review state is introduced.

## Consequences

- Single-Repository, documentation-only, or otherwise commandless work can produce an auditable
  CandidateBundle without fake validation.
- Existing Plans with commands retain their execution and evidence behavior after adding explicit
  selection rationales.
- Absence of a command does not mean absence of validation: structural preflight remains mandatory.
- Absence also does not prove semantic correctness. Applicable residual uncertainty must remain
  visible or cause stronger verification under the existing admission policy.
- Multiple baseline Plan commands and language/framework detection remain deferred.

## Supersession

This decision revises Decision 0006 only where its first vertical slice required one repository
command per Candidate and one combined command per Candidate set. Exact-subject invocation,
manifest binding, evidence, recovery, and CandidateBundle authority remain accepted.
