---
artifact_type: development_work_item
id: WI-0012
status: done
title: Implement Provider environment ownership and pre-Candidate retry
source: 'User request accepting the recommended corrective design and asking to implement it'
confirmed_by: user
confirmed_at: 2026-08-04
started_by: user
started_at: 2026-08-04
review_ready_at: 2026-08-04
completed_by: user
completed_at: 2026-08-04
standing_policy:
design_proposal: docs/proposals/0018-provider-environment-ownership-and-pre-candidate-retry-correction.md
accepted_decisions:
  - docs/decisions/0019-durable-codex-runtime-home-and-pre-candidate-retry.md
  - docs/decisions/0020-provider-environment-ownership-boundary.md
---

# WI-0012: Implement Provider Environment Ownership And Pre-Candidate Retry

## Objective

Remove ChangeFleet ownership of Codex host state and make a failed pre-Candidate WorkUnit safely
retryable in the same exact ChangeSet without validating an empty checkpoint or discarding partial
work.

## Scope

- Require an explicit already prepared `runtime.codex_home` in strict local configuration.
- Pass that locator to the SDK process without creating, copying, reading, locking, initializing,
  repairing, or deleting Provider Home files.
- Keep the locator and Provider state out of ChangeSet, Run, evidence, prompts, audit projections,
  Git, and registered repositories.
- Add strict `implementation_blocked` structured output and prompt guidance.
- Reject base-equal or empty implementation publication before checkpoint persistence or validation.
- Allow a new explicit execution command to retry only a failed or blocked pre-Candidate WorkUnit
  whose owned workspace remains clean at its exact confirmed base.
- Preserve and link prior Runs, usage, commands, blockers, validation attempts, and any historical
  empty checkpoint while creating a fresh Run and Provider thread.
- Preserve non-empty CandidateCheckpoint and combined-validation resume semantics unchanged.
- Use Node.js 24 first on `PATH` for deterministic validation and the later WI-0009-v2 dogfood
  retry; do not add a general repository toolchain policy.
- Add Simplified Chinese intent comments to every new production module and non-obvious changed
  boundary.
- Keep scripted Runtime behavior test-only and remove temporary Provider Home helpers and fake
  credential state before review.

## Non-Goals

- Automatic retry policy, retry budgets, paid retry loops, pricing, comparison, or dashboards.
- Dirty-workspace reset, stash, cleanup, deletion, import, merge, or arbitrary commit adoption.
- Provider-session resume, conversation replay, turn checkpoints, in-flight steering, or human
  feedback UI.
- Runtime Kit, App Server, another Provider, Linear, remote workers, hosted secrets, or deployment.
- Provider installation, login, Sandbox setup, ACL repair, UAC automation, silent fallback, WSL, or
  managed Runtime environments.
- General Node version management or rewriting confirmed validation commands.
- Implementing the WI-0009 console itself inside this WorkItem.

## Acceptance Criteria

- Two Runtime invocations use the exact explicitly configured Provider environment while each Run
  still starts a fresh Provider thread.
- No production or test code copies, initializes, locks, repairs, or deletes Provider Home state,
  and its locator enters no durable control or audit state.
- Blocked and base-equal outcomes cannot create current validation or review authority.
- A new execution key retries the same WorkUnit only after exact clean-base ownership preflight and
  adds a new immutable Run attempt.
- Existing empty-checkpoint failure state can retry without deleting its checkpoint, validation
  evidence, Run, usage, command, or blocker.
- Dirty, moved, stale, real-Candidate, and non-empty checkpoint states invoke no new Runtime.
- Existing exact checkpoint and combined-validation resume tests continue proving zero additional
  Runtime calls.
- All changed production boundaries have Chinese intent comments and all fake state remains under
  tests.
- Provider readiness remains external; WI-0012 does not invoke real Codex or claim that native
  Windows UAC cannot originate from the selected Harness.

## Validation Selection

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Runtime schema and diagnostic unit tests | blocked/empty contracts and stable codes | Required | New Runtime terminal semantics |
| Codex adapter integration | explicit Home selection, reuse, fresh threads, no file lifecycle | Required | Corrected Provider ownership boundary |
| Candidate recovery integration | empty checkpoint, clean retry, dirty/moved rejection, restart | Required | New lifecycle and recovery path |
| Existing checkpoint/combined resume | non-empty Candidate behavior and zero Runtime calls | Required | Must not regress Decision 0017 |
| Runtime context and audit regression | excluded locators/secrets and preserved attempts/cost | Required | Context and audit boundary |
| Changed test files | every modified test module | Required | Harness validation policy |
| Full deterministic `npm run check` under Node.js 24 | final cross-layer implementation | Required once | Adapter, schema, lifecycle, CLI config, and recovery are crossed |
| Real Windows Codex execution | Provider readiness and WI-0009-v2 retry | Excluded | Host environment remains unhealthy and is outside this corrective implementation |
| Browser and GitHub | WI-0009 product and external delivery | Excluded | Not part of this corrective slice |
| Documentation and boundary audit | links, status, sizes, comments, temporary/fake code | Required | Harness and stage discipline |

## Current Projection

- Current subject: accepted completion of the Decision 0020 correction and retained retry controls.
- Last verified state: Node.js 24 full validation and static boundary audits pass. No real Provider
  or WI-0009-v2 retry ran.
- Next step: land the accepted WorkItem in the requested precise commit.
- Active blocker or decision: none for WI-0012. WI-0009 remains operationally blocked until
  the explicitly selected Codex environment is healthy.

## Implementation Evidence

- Directed Node.js 24 command over nine affected unit and integration files exited `0` in 111.3 s:
  52 tests passed. It covered Provider environment selection, CLI composition, blocked/empty/retry,
  recovery, context, and audit without enabling real Codex.
- Node.js 24 `npm run check` exited `0` in 180.8 s: 54 unit, 61 integration, and 6 acceptance tests
  passed. The opt-in Provider gate remained disabled.
- `git diff --check` exited `0`; affected authority links exist; dogfood config parses with explicit
  `codex_home`; no Provider test process remains.
- Static inspection found no Runtime Home/Sandbox copy lifecycle identifiers in production or
  tests, no added production fake/mock, and no dependency diff. Eager files are 5872, 1264, and
  8115 bytes, within Harness soft limits.
- Historical real evidence remains negative: Codex displayed UAC after rejecting copied Sandbox
  credentials. The test homes were removed, the gate did not pass, and WI-0009-v2 was not retried.

## Acceptance Review

Accepted by the user on 2026-08-04. Every selected deterministic and static gate passed. Real
Windows execution remains outside WI-0012 acceptance under Decision 0020.

## Project Memory Impact

WI-0012 is accepted and complete under Decision 0020. WI-0009 and `changefleet-wi-0009-v2` remain
blocked and unchanged until the explicitly selected Codex environment is healthy.
