---
artifact_type: development_work_item
id: WI-0022
status: done
title: Control kernel debt cleanup
source: User-requested repository cleanup after the landed Bundle review slice
confirmed_by: user
confirmed_at: 2026-08-07
standing_policy:
design_proposal:
---

# WI-0022: Control Kernel Debt Cleanup

## Objective

Remove obsolete private compatibility and iteration residue, fix known control-contract defects,
and consolidate repeated orchestration mechanics without expanding product behavior or erasing
states reserved by the accepted unified lifecycle.

## Context

The landed kernel has coherent coarse phases and generic Runs, but application orchestration has
accumulated duplicated Run and Bundle mechanics. Private schema migrations and the explicit legacy
Candidate recovery surface remain even though ChangeFleet has no released compatibility promise.
The user explicitly requested a clean replacement and authorized removal of obsolete historical
runtime compatibility. Repository Proposal and WorkItem history remains design evidence and does
not require production compatibility code.

## Scope

- Align planning Control Contract outcomes with the structured Runtime schema.
- Make Bundle review Gate resolution and human Bundle decisions use one coherent option contract.
- Give derived read-only Agent Profiles collision-free stable identities.
- Consolidate repeated Bundle finalization and common Run-attempt persistence mechanics.
- Clean up owned supervision workspaces and preserve cleanup failures as bounded evidence.
- Remove private schema v4-v11 migration, legacy Candidate recovery, and old Run-record rewrite
  paths, including their production CLI, diagnostics, tests, and current documentation.
- Remove dead helpers that have no production consumer.
- Keep accepted current lifecycle reserves such as queued/recovery Run values, excluded WorkUnit
  disposition, and bounded Bundle completeness collections.

## Non-Goals

- New lifecycle phases, workflow DSLs, automatic acceptance, multi-reviewer policy, or model
  comparison.
- Deleting accepted Repository Design Proposals, Decisions, or completed WorkItems.
- Database, remote-worker, UI redesign, or provider-session changes.
- Supporting persisted Control Stores older than the current schema after this private cleanup.

## Acceptance Criteria

- Planning advertises only outcomes the current schema and handler accept.
- A Bundle review failure cannot be used to record a Gate option that was never offered.
- Derived supervisor and reviewer Profile identities cannot collide with a maximum-length base id.
- Manual and supervised paths use one Bundle finalization implementation.
- Common Run invocation and terminal evidence mechanics have one application boundary while
  operation-specific semantics remain explicit.
- No production `recover-legacy`, private schema migration chain, or startup rewrite of historical
  Run records remains.
- Current-schema stores fail clearly on unsupported schema input rather than mutating it.
- Owned temporary supervision workspaces are removed on success and failure; cleanup failure is
  observable without hiding the primary failure.
- Accepted current lifecycle reserve values remain represented and tested.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Changed unit tests | contracts, identities, lifecycle reserves | Required | Direct domain and schema coverage |
| Changed integration tests | store rejection, CLI removal, orchestration and cleanup | Required | Cross-component behavior changes |
| Node.js 24 `npm run check` | complete source and adapter surface | Required once stable | Shared schema, store, Runtime and CLI boundaries change |
| Real Codex Provider flow | planning and exact Bundle review contract | Required once stable | Production structured Runtime contract changes |
| Real GitHub write | delivery | Excluded | Delivery identity and publication are unchanged |
| `git diff --check` and Harness audit | repository quality and authority | Required | Source and WorkItem/current-state change |

Every changed test file must execute. The full gate is selected because this cleanup crosses shared
schemas, persistence, application orchestration, CLI, audit, and Runtime adapters.

## Current Projection

- Current subject: `codex/wi-0022-kernel-debt-cleanup` from `main` at `20b2b9c`.
- Last verified state: implementation and selected deterministic gates are complete. The real
  Codex gate reached the Provider but was rejected by the account usage limit before planning.
- Next step: user review and landing; rerun the real Provider gate after external capacity returns
  if fresh Provider evidence is required for release.
- Active blocker or decision: none.

## Implementation Evidence

- Planning now advertises only schema-supported outcomes. Bundle acceptance cannot reuse a review
  failure Gate as a different decision contract, and long base Profile ids derive collision-free
  stable supervisor and reviewer identities.
- Manual and supervised paths share one Bundle finalizer. `RunCoordinator` owns common invocation
  evidence and terminal persistence while operation-specific lifecycle choices stay explicit in
  the service.
- The current private store accepts schema 12 only. Startup migration, historical Run rewrite,
  `recover-legacy`, its CLI/operation/diagnostics, dead wrappers, and their compatibility tests are
  removed. Unsupported records fail without mutation.
- Current lifecycle reserves remain: generic queued/recovery Run values, excluded WorkUnit
  disposition, and bounded CandidateBundle completeness collections.
- Owned Supervisor workspaces are removed on success and failure. Secondary cleanup or audit
  failures remain attached to the primary failure rather than being swallowed.
- `docs/validation.md` now contains risk-based current policy instead of completed WorkItem and
  schema-migration checklists. Repository Proposal, Decision, and WorkItem chronology remains
  intact because it is on-demand rationale, not executable compatibility.
- Review follow-up removed the last obsolete Run-status acceptance: the Runtime audit identity
  validator no longer admits an `abandoned` terminal status that current evidence boundaries never
  produce, and a new audit integration test proves tampered obsolete evidence is rejected.
  SPEC.md section 18 and `docs/architecture.md` Recovery Model now describe only the current
  baseline, and Decision 0017 plus the Decision Index mark the legacy recovery surface as removed.
- `node --test "test/unit/**/*.test.js"` under Node.js 24 exited 0: 85 tests passed.
- `node --test test/integration/runtime-audit-query.test.js` under Node.js 24 exited 0: 8 tests
  passed, including the new obsolete-terminal rejection case.
- Focused current-store, Run-store, selection, closure, retry, and checkpoint integration first
  exited 1 with 30 of 31 passing because one Windows `git worktree add` returned
  `4294967295` without output. The exact failed test rerun exited 0; no code change was needed.
- Focused autonomous-supervision and application-boundary integration exited 0: 20 tests passed.
- Focused Codex adapter, filesystem, and RepositoryWorker integration exited 0: 17 tests passed.
- `npm run check` under Node.js 24 exited 1 after all unit, 103 integration, GitHub fixture, and 7
  acceptance tests passed; only the final browser wait used Playwright's default 30 seconds because
  the intended timeout occupied the argument slot. The corrected `npm run test:ui` exited 0 in
  31.6 seconds.
- `node --test --test-concurrency=1 test/integration/codex-sdk-runtime.test.js` exited 0 after the
  final evidence assertion: 10 tests passed, including manifest-derived SDK version and unknown CLI
  version.
- `CHANGEFLEET_RUN_REAL_CODEX=1 npm run test:provider:codex` exited 1 after 13.2 seconds. Codex
  returned `CODEX_PROVIDER_FAILED` with the explicit account usage-limit message and a retry time
  of `Aug 10th, 2026 9:59 AM`; no Provider outcome, Candidate, or external write was produced. This
  gate remains unverified rather than passed.
- `git diff --check` exited 0. Targeted relative-link inspection exited 0. Eager Harness sizes were
  `AGENTS.md` 6004 bytes, `WORKFLOW.md` 1264 bytes, and `docs/current-state.md` 7981 bytes, all at or
  below their soft limits.
- Real GitHub write remained excluded because delivery behavior and authority did not change.

## Project Memory Impact

Current authority describes one current-schema-only private baseline and the smaller orchestration
boundary. Accepted historical design records remain available on demand but do not impose
executable compatibility.
