---
artifact_type: development_work_item
id: WI-0034
status: done
title: Repository-owned Harness boundary and ChangeFleet self-check
source: User-confirmed correction after the WI-0033 real self-iteration audit
confirmed_by: user
confirmed_at: 2026-08-11
standing_policy:
design_proposal:
---

# WI-0034: Repository-Owned Harness Boundary And ChangeFleet Self-Check

## Objective

Remove ChangeFleet-owned guesses about target-project Harness artifact categories while adding a
small deterministic Harness check owned only by this repository.

## Context

WI-0033 correctly kept target Repository Harness optional, but its Codex Runtime wording enumerated
maintenance, governance, documentation, and status artifacts. Even though conditional, that list
can become a ChangeFleet-owned project convention. The real trial also exposed one local historical
WorkItem status outside this repository's accepted enum, with no deterministic local check to catch
it.

## Scope

- Replace the four operation-specific category lists with generic instructions to read and apply
  applicable repository-native requirements.
- Preserve the rule that proven repository-requirement violations may block while absent or
  unsupported conventions must not be invented.
- Add a permanent ChangeFleet repository command that validates this repository's WorkItem
  frontmatter contract and eager Harness size limits.
- Repair local Harness records that the new check proves invalid.
- Document when this repository runs the command and add bounded behavioral tests.

## Non-Goals

- No requirement that a registered repository contain Harness or expose a validation command.
- No Core parser for target-project WorkItems, statuses, governance files, or test policy.
- No copying, creating, repairing, or writing back target-project Harness.
- No change to mandatory Plan repository or combined validation slots in this WorkItem.
- No new lifecycle state, Runtime outcome, Gate, Feedback, Provider, or overlay root.

## Acceptance Criteria

- Planning, execution, verification, and Bundle review tell the Agent to follow only applicable
  repository-native requirements and do not enumerate project artifact categories.
- Existing harnessless-repository behavior remains valid.
- `npm run check:harness` deterministically rejects unsupported WorkItem status, missing required
  frontmatter, id/filename mismatch, and eager Harness size overflow.
- The check is documented as ChangeFleet repository tooling, not a ChangeFleet product CLI or a
  registered-repository contract.
- Selected tests and `git diff --check` pass.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `npx --yes node@24 --test test/integration/codex-sdk-runtime.test.js` | generic four-stage Runtime wording and unchanged structured protocol | Required | Direct production Runtime boundary changed |
| `npx --yes node@24 --test test/unit/harness-check.test.js` | local frontmatter and eager-size failure behavior | Required | Direct owner of the new repository tool |
| `npm run check:harness` under Node.js 24 | exact ChangeFleet repository Harness | Required | Proves current repository memory satisfies its own rules |
| `git diff --check` | complete branch diff | Required | Source, test, package, and Harness quality |
| Harness eager-size inspection | `AGENTS.md`, `WORKFLOW.md`, `docs/current-state.md` | Required | Existing repository policy |
| `npm run check` under Node.js 24 | all deterministic accepted scopes | Required | The permanent self-check is now part of the repository check runner |
| Real Provider gate | nondeterministic external-cost path | Excluded | No Provider invocation, schema, evidence, or host boundary changes |

## Current Projection

- Current subject: branch `codex/wi-0034-repository-harness-boundary` from `main` at `f9e5a25`.
- Last verified state: the prompt correction, permanent local check, historical status repair,
  documentation, and selected gates are complete.
- Next step: review and adopt this exact branch. The separate mandatory repository/combined-check
  question remains outside WI-0034.

## Implementation Evidence

- `CodexSdkRuntime` now tells every semantic operation to apply only repository-evidenced
  project-owned requirements. It no longer enumerates maintenance, governance, documentation, or
  status artifacts, and it still forbids invented requirements, commands, formats, or Harness.
- `scripts/check-harness.mjs` is a repository-rooted development command with no registered-
  repository input. It checks this repository's WorkItem ids, statuses, required top-level
  metadata, non-draft confirmation, and eager Harness size limits. It deliberately ignores nested
  YAML rather than implementing a partial general parser.
- The check found and repaired the historical `WI-0001` status `complete` to the current accepted
  value `done`; no synthetic production fixture or compatibility exception remains.
- `npx --yes --package node@24 -- node --test test/integration/codex-sdk-runtime.test.js` exited 0
  in 0.08 seconds with 11 protocol scenarios passed.
- `npx --yes --package node@24 -- node --test test/unit/harness-check.test.js` exited 0 in 0.10
  seconds with 4 local-contract scenarios passed, including a valid unconfirmed draft.
- `npx --yes --package node@24 -- npm run check:harness` exited 0: 3 eager files and 34 WorkItems
  passed the exact repository check.
- `npx --yes --package node@24 -- npm run check` exited 0 on the final 198-line checker in 375
  seconds. Every configured
  deterministic scope completed, including Harness, unit, integration, acceptance, and Chromium
  UI gates.
- After the completion projection, `git diff --check` exited 0 and the Harness check again passed
  all 3 eager files and 34 WorkItems; `docs/current-state.md` remained 7,377 bytes.

## Project Memory Impact

This completed maintenance keeps Repository Harness optional and project-owned. The new executable
belongs only to ChangeFleet repository development and does not change product authority, target
repository contracts, Runtime outcomes, or Core state.
