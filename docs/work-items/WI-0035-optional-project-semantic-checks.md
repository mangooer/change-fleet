---
artifact_type: development_work_item
id: WI-0035
status: done
title: Optional project semantic checks with mandatory structural preflight
source: User accepted the recommended repository-check and combined-check boundary
confirmed_by: user
confirmed_at: 2026-08-11
standing_policy:
design_proposal: docs/proposals/0027-optional-project-semantic-checks.md
---

# WI-0035: Optional Project Semantic Checks With Mandatory Structural Preflight

## Objective

Allow a confirmed Plan to omit inapplicable repository or combined semantic commands while always
recording exact structural-preflight evidence before Candidate or Bundle promotion.

## Context

Proposal 0027 and Decision 0029 revise the first-slice fixed command topology without changing
exact Git authority, evidence binding, independent verification, or lifecycle states.

## Scope

- Make each existing Plan repository and combined command slot nullable with an explicit selection
  rationale.
- Run and record mandatory exact-subject structural preflight when a slot is empty.
- Preserve command identity, budgets, attempts, recovery, and additional verifier-requested checks
  when a semantic command exists.
- Keep audit and operator projections honest about command-backed versus structural-only evidence.
- Update the accepted product contract and direct behavioral tests.

## Non-Goals

- No arrays of baseline Plan checks, language or framework detection, or inferred test commands.
- No target-repository Harness parser or required Harness format.
- No new phase, Run state, Gate, Feedback, review verdict, Provider, UI workflow, or delivery rule.
- No automatic waiver of residual semantic risk.

## Acceptance Criteria

- A Plan rejects an absent semantic command unless its corresponding selection rationale is
  present, and accepts explicit commandless repository and combined selections.
- Exact Candidate and Candidate-set preflight runs and produces immutable evidence even without a
  semantic command; its real attempt has no fabricated command identity, process budget, or result.
- Existing command-backed paths retain attempt budgets, failure evidence, recovery, and exact
  identity.
- Verification context and audit views distinguish completed commands, scheduled commands, and
  structural-only validation without null dereferences.
- Existing multi-Repository command-backed acceptance behavior remains valid.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Changed unit test files under Node.js 24 | Plan normalization, evidence identity, audit projection | Required | Shared domain contract and projections change |
| Changed integration test files under Node.js 24 | commandless exact-Candidate and Bundle flow plus existing command-backed flow | Required | Direct validation and recovery boundaries change |
| `npm run check` under Node.js 24 | all deterministic scopes | Required | Persisted Plan and evidence contracts affect shared fixtures and acceptance |
| `npm run check:harness` under Node.js 24 | exact ChangeFleet repository Harness | Required | Proposal, Decision, WorkItem, and current-state memory change |
| `git diff --check` | complete branch diff | Required | Source and authority quality |
| Real Provider gate | nondeterministic external-cost path | Excluded | Runtime invocation protocol is not changed |

## Current Projection

- Current subject: implementation commit `ccfb022` on local `main`.
- Last verified state: the atomic contract replacement passed all selected deterministic checks and
  was accepted by the user on 2026-08-11.
- Next step: one bounded real self-iteration using the landed optional-check contract.
- Active blocker or decision: none.

## Implementation Evidence

- Plan normalization and the strict Runtime schema now require a selection rationale while allowing
  each existing repository or combined command slot to be `null`. Planning and execution prompts
  explicitly forbid commands invented merely to fill a slot.
- Repository and combined validators always run exact structural preflight. A commandless selection
  records `not_applicable` command evidence and one real validation attempt whose check identity and
  process-budget fields are `null`; selected commands retain their prior identities, budgets,
  execution, immutable evidence, and recovery behavior.
- Candidate, Bundle, verification, supervision, operator, and audit projections are null-safe.
  Audit rows identify `structural_preflight` separately from `project_command`, while both remain
  exact-subject evidence and consume bounded validation-attempt counts.
- The new real-Git structural-only scenario produced one repository and one combined validation
  attempt with no semantic command metadata, then formed an auditable CandidateBundle. Existing
  verifier-requested checks and the command-backed multi-Repository acceptance path still pass.
- During development, targeted checks exposed and fixed a missing test Plan revision and one absent
  selection-rationale fallback for verifier-requested commands. An initial full-check invocation was
  tool-terminated with exit 124 because its caller timeout was set too low; it is not acceptance
  evidence.
- `npx --yes --package node@24 -- node --test test/unit/model.test.js` exited 0 with all 12 domain
  model scenarios passed, including commandless subject identity and structural attempt metadata.
- `npx --yes --package node@24 -- node --test --test-name-pattern="records structural evidence"
  test/integration/candidate-checkpoint-recovery.test.js` exited 0 with the final structural-only
  CandidateBundle and audit scenario passed.
- `npx --yes --package node@24 -- npm run check` exited 0 in 424.7 seconds. The final shared Plan,
  evidence, Runtime, recovery, audit, acceptance, delivery, and Chromium UI scopes passed; the
  Harness gate reported 3 eager files and 35 WorkItems.
- `git diff --check` exited 0 for the complete branch diff. The final
  `npx --yes --package node@24 -- npm run check:harness` also exited 0 with the same 3 eager files
  and 35 WorkItems.
- Real Provider and real GitHub gates remain unexecuted because Provider invocation, credentials,
  remote delivery, and external writes are outside this schema-and-validation change.
- The user accepted WI-0035 on 2026-08-11; implementation commit `ccfb022` was then fast-forwarded
  into local `main` without rewriting its verified content.

## Project Memory Impact

This branch replaces the first-slice universal command requirement with mandatory structural
preflight plus optional project-selected semantic commands. It does not change Repository Harness
ownership, lifecycle states, or the lightweight control-plane boundary. After adoption, the next
recommended proof is one bounded real self-iteration whose single-Repository Plan selects only the
project checks it actually needs and explicitly omits an inapplicable combined command.
