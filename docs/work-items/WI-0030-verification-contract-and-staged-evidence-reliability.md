---
artifact_type: development_work_item
id: WI-0030
status: done
title: Verification contract and staged evidence reliability
source: User-confirmed follow-up to the 2026-08-10 alternative-AgentProfile trial
confirmed_by: user
confirmed_at: 2026-08-10
standing_policy:
design_proposal:
---

# WI-0030: Verification Contract And Staged Evidence Reliability

## Objective

Make independent verification outcomes structurally consistent with domain verdict semantics and
prevent a verifier from blocking on a Plan check that the controller intentionally runs later.

## Context

The first real alternative-AgentProfile trial exposed two implementation defects inside accepted
verification semantics. Three reasonable `pass_with_notes` results passed the Runtime JSON Schema
but failed domain normalization because they also contained non-blocking `findings`. A separate
review treated the not-yet-run combined check as missing required evidence even though combined
validation can only run after repository Candidates are complete.

## Scope

- Make the Codex verification output Schema encode verdict-specific findings, notes, human
  decision, and requested-check constraints already enforced by the domain.
- State explicitly that every verification `finding` is blocking and that positive observations or
  residual non-blocking risks belong in the summary or notes.
- Project the confirmed combined check as controller-scheduled later evidence and prevent its
  absence during Candidate verification from becoming a blocking finding.
- Preserve a bounded machine-safe rejection rule when post-Provider outcome normalization fails,
  without copying the rejected output or Provider transcript into aggregate state.
- Add direct Runtime, domain, verification-orchestration, and audit regression coverage.

## Non-Goals

- No new verdict, phase, Run status, retry state, or public operation.
- No change to Candidate, Bundle, validation, human authority, or persisted schema semantics.
- No Controller-restart retry repair; that independently proven recovery defect remains the next
  bounded task.
- No normalized model scoring, pricing, automatic routing, or comparison UI.

## Acceptance Criteria

- `pass` and `pass_with_notes` cannot carry `findings`; `changes_required` must carry at least one
  finding; `human_decision_required` must carry one bounded decision.
- A valid non-blocking verification result is accepted on the first attempt rather than converted
  into `INVALID_VERIFICATION_OUTCOME`.
- Candidate verification distinguishes completed repository evidence from the confirmed combined
  check that the controller will run before Bundle assembly.
- Invalid post-Provider normalization records only a bounded stable rule or stage for audit and
  supervision diagnostics.
- Selected unit and integration tests pass; `git diff --check` exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `node --test test/unit/errors.test.js test/unit/verification.test.js test/unit/runtime-evidence.test.js` | verdict normalization and bounded evidence | Required | Direct domain contract and failure-evidence coverage |
| `node --test test/integration/codex-sdk-runtime.test.js` | Codex prompt and output Schema | Required | Direct Runtime protocol coverage |
| `node --test test/integration/candidate-checkpoint-recovery.test.js test/integration/runtime-audit-query.test.js` | staged verification and audit diagnostics | Required | Exact checkpoint flow and bounded audit projection |
| `node --test test/integration/autonomous-supervision.test.js` | automatic passage and failure routing | Conditional | Run when final diff changes supervision-visible failure facts |
| `npx --yes node@24 scripts/run-checks.mjs` | all deterministic accepted scopes under Node.js 24 | Required | Runtime Schema, application verification, evidence, and audit tiers are crossed |
| `git diff --check` | repository quality | Required | Source and Harness edits |
| Real Codex Provider | external nondeterministic Provider | Excluded | Deterministic schema and captured real trial outputs cover this repair; rerun follows after landing |

## Current Projection

- Current subject: branch `codex/wi-0030-verification-contract` from `main` at `a8266b3`.
- Last verified state: implementation complete; verdict-specific output, staged combined-check
  context, bounded failure diagnostics, and deterministic regressions pass.
- Next step: user review and landing; controller-restart execution retry remains the next separate
  implementation demand.

## Implementation Evidence

- `VERIFICATION_OUTCOME_SCHEMA` now keeps a strict root object but places verdict-specific fields in
  one nested `assessment` union. The Runtime adapter flattens a valid branch before domain
  normalization, so persisted VerificationReview semantics remain unchanged.
- `pass` and `pass_with_notes` cannot carry findings; positive observations belong in the summary,
  residual non-blocking risks belong in notes, and every finding remains a blocking claim.
- Candidate verification projects the confirmed combined command as a
  `candidate_bundle_assembly` check with status `scheduled`; the prompt states that its absence from
  current completed evidence cannot block Candidate review.
- Verification normalization failures add only bounded `stage` and `rule` values to the failed Run
  outcome. Provider output, transcript, stack, and arbitrary error details remain excluded.
- `node --test test/unit/errors.test.js test/unit/verification.test.js test/unit/runtime-evidence.test.js`
  exited 0: 16 tests passed for bounded errors, verification semantics, and strict Runtime schemas.
- `node --test test/integration/codex-sdk-runtime.test.js` exited 0: 11 tests passed for prompts,
  schema flattening, invalid pass-with-findings rejection, permissions, and usage evidence.
- `node --test --test-concurrency=1 test/integration/candidate-checkpoint-recovery.test.js`
  exited 0 in 148.3 seconds: 13 real-Git scenarios passed, including scheduled combined evidence
  and bounded rejected-outcome audit reproduction.
- `node --test test/unit/runtime-context.test.js test/integration/runtime-audit-query.test.js`
  exited 0: 14 tests passed for context exclusion and read-only audit reproduction.
- `node --test --test-concurrency=1 test/integration/autonomous-supervision.test.js` exited 0 in
  160.8 seconds: 15 supervision, Feedback, Gate, and Bundle routes passed without new lifecycle
  behavior.
- `npx --yes node@24 scripts/run-checks.mjs` exited 0 in 373.8 seconds under Node.js 24.18.1: all
  deterministic unit, integration, acceptance, and Chromium UI scopes passed.
- A real Codex Provider run remains intentionally unexecuted. The next real ChangeSet will verify
  that the live Provider follows the stricter nested assessment Schema without another repair.

## Project Memory Impact

This is a branch-local corrective slice inside accepted verification semantics. Canonical `main`
remains complete through WI-0029 until this Candidate is reviewed and landed.
