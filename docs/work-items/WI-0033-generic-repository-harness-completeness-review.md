---
artifact_type: development_work_item
id: WI-0033
status: in_progress
title: Generic Repository Harness completeness review
source: User-confirmed follow-up after landing WI-0032
confirmed_by: user
confirmed_at: 2026-08-10
standing_policy:
design_proposal:
---

# WI-0033: Generic Repository Harness Completeness Review

## Objective

Require planning, execution, Candidate verification, and Bundle review Agents to assess applicable
repository-native delivery obligations without teaching ChangeFleet Core any project-specific
Harness artifact or status format.

## Context

The first bounded self-iteration trial produced valid code and tests but omitted tracked project
maintenance required by the repository's own instructions. The independent verifier and Bundle
reviewer also missed that omission. ChangeFleet already supplies exact-base or exact-Candidate
Harness resources to each semantic Runtime; the Provider prompt did not state the generic
completeness obligation precisely enough.

## Scope

- Tell planning to include applicable tracked repository-maintenance obligations in the same
  Repository WorkUnit and its completion evidence.
- Tell execution to satisfy applicable repository-native delivery obligations in the same
  Candidate before reporting completion.
- Tell independent verification and Bundle review to treat a proven missing required obligation as
  blocking while keeping absent, optional, stylistic, or format-specific conventions non-blocking.
- Add deterministic Codex SDK prompt/protocol coverage for all four semantic operations.
- Run one bounded real self-iteration ChangeSet from the committed WI-0033 Candidate baseline.

## Non-Goals

- No Core parser or schema for WorkItems, Proposals, status files, changelogs, or another project
  Harness convention.
- No mandatory Harness, generated project artifacts, writeback outside Git, or additional context
  discovery.
- No lifecycle state, Gate, Feedback, review disposition, budget, or authorization change.
- No automatic Bundle acceptance, delivery, merge, or scoring/model-routing work.

## Acceptance Criteria

- Planning, execution, verification, and Bundle-review prompts express the same generic boundary in
  operation-appropriate language.
- Prompts distinguish required tracked delivery maintenance from absent or optional conventions and
  never name a ChangeFleet-specific artifact as universal.
- Existing structured outcomes and deterministic Core authority remain unchanged.
- A bounded real self-iteration reaches Bundle review with code, tests, and this repository's
  applicable tracked Harness maintenance in one exact Candidate, or yields bounded evidence of the
  remaining failure.
- Selected tests pass and `git diff --check` exits 0.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npx --yes node@24 --test test/integration/codex-sdk-runtime.test.js` | four operation prompts and unchanged Runtime protocol | Required | Direct owner of the changed Provider boundary |
| `npx --yes node@24 --test --test-concurrency=1 test/integration/repository-harness-overlay.test.js` | exact-base and exact-Candidate Harness availability | Required | Proves the instructions referenced by the prompt remain frozen and scoped |
| Bounded real self-iteration ChangeSet | real planning, execution, verification, and Bundle review | Required | The change affects real Agent semantic behavior |
| `git diff --check` | repository quality | Required | Source, tests, and Harness edits |
| `npm run check` | all deterministic scopes | Excluded unless final diff expands | One Provider prompt module and its owning suites bound the change |
| GitHub delivery | external write | Excluded | The trial stops at Bundle review and performs no delivery |

## Current Projection

- Current subject: branch `codex/wi-0033-repository-harness-completeness` from `main` at `aa930c9`.
- Last verified state: prompt implementation and deterministic gates pass; the required bounded
  real self-iteration remains pending.
- Next step: commit this exact in-progress baseline and let the real ChangeSet independently review,
  correct if necessary, and complete the repository-native Harness in its Candidate.

## Implementation Evidence

- `CodexSdkRuntime` now gives planning, execution, verification, and Bundle review one
  operation-specific expression of the same generic completeness obligation. It distinguishes
  proven required tracked maintenance from absent, optional, stylistic, or unknown conventions.
- The change adds no structured outcome, context field, Core parser, lifecycle state, or project-
  specific artifact name.
- `npx --yes node@24 --test test/integration/codex-sdk-runtime.test.js` exited 0 in 0.1 seconds:
  11 protocol scenarios passed, including exact prompt assertions for all four semantic stages.
- `npx --yes node@24 --test --test-concurrency=1 test/integration/repository-harness-overlay.test.js`
  exited 0 in 51.8 seconds: 8 real-Git Harness scenarios passed, covering frozen discovery,
  operation access, restart, mutation rejection, cleanup, and Candidate exclusion.
- The bounded real self-iteration and final `git diff --check` remain pending at this baseline.

## Project Memory Impact

This is a confirmed corrective slice inside the accepted boundary that repository-native Harness
is Agent semantic input rather than ChangeFleet Core authority. Local `main` includes WI-0032 at
`aa930c9`; canonical remote state remains separate until explicitly pushed.
