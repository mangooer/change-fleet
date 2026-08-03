---
artifact_type: development_work_item
id: WI-0004
status: done
title: Implement exact Repository Harness snapshots and local overlays
source: "User request: accept Proposal 0009 current version and create the sole WI-0004."
confirmed_by: user
confirmed_at: 2026-07-31
started_by: user
started_at: 2026-07-31
completed_by: user
completed_at: 2026-08-03
standing_policy:
design_proposal: docs/proposals/0009-exact-repository-harness-snapshots-and-local-overlays.md
accepted_decisions:
  - docs/decisions/0011-exact-repository-harness-snapshots-and-local-overlays.md
---

# WI-0004: Implement Exact Repository Harness Snapshots And Local Overlays

## Objective

Implement the sole Codex local-overlay vertical slice accepted by Proposal 0009: preserve
exact-base Harness by default, optionally freeze explicitly authorized ignored Codex Harness at
ChangeSet creation, reconstruct it identically in owned workspaces, and prevent it from becoming a
mutable or deliverable non-Git surface.

## Context

[Decision 0011](../decisions/0011-exact-repository-harness-snapshots-and-local-overlays.md)
owns the policy, snapshot, materialization, context, evidence, Candidate, and no-writeback
boundaries. [Decision 0008](../decisions/0008-change-set-repository-selection.md) owns exact branch
and base selection. [Decision 0010](../decisions/0010-first-real-codex-sdk-provider.md) owns the
first Codex Runtime and exact-base local worktrees.

This is exactly one implementation stage. It extends the landed WI-0003 Provider path without
creating a ChangeFleet-owned Skill or a general workspace initialization framework.

## Scope

- Add an optional revisioned `RepositoryWorkspacePolicyRevision` for
  `purpose = repository_harness`, selecting explicit Git-ignore-style patterns or an explicitly
  authorized tracked exact-base `.worktreeinclude`.
- At ChangeSet creation and Harness revision, resolve and persist an immutable
  `RepositoryHarnessSelectionRevision` bound to the selected Repository and base SHA.
- Snapshot only contained, regular, Git-ignored Codex resources under `AGENTS.override.md` or
  `.agents/skills/**`; enforce collision, link, file-count, per-file, and total-byte boundaries.
- Materialize the frozen selection in exact-base planning worktrees and WorkUnit execution
  workspaces without rereading the registered checkout during Run, retry, or recovery.
- Record bounded exact-base, overlay, and Provider-discovery evidence outside ordinary Runtime
  context.
- Treat overlay content as immutable, verify and remove it before Candidate publication, and prove
  Candidate exclusion.
- Add stable localized diagnostics including `HARNESS_OVERLAY_MODIFIED` and
  `NON_GIT_HARNESS_CHANGE_UNSUPPORTED`.
- Preserve no-overlay, single-Repository, multi-Repository, recovery, and real Codex behavior.
- Add Simplified Chinese intent comments to every added or materially changed production boundary.
- Remove temporary production scaffolding and retain only test fixtures with distinct
  deterministic coverage before review.

## Non-Goals

- ChangeFleet-owned Runtime Skills or automatic repository Harness creation, repair, or conversion.
- Generic `workspace_seed`, dependencies, caches, certificates, environment files, setup, run,
  archive, or root-checkout synchronization.
- Provider settings, hooks, MCP configuration, credentials, permission rules, or home directories.
- Claude or another Provider, external Harness roots, Git URL materialization, or remote workers.
- Non-Git Harness editing, writeback, delivery, or a separate Harness change-proposal lifecycle.
- Linear, App Server, public CLI, UI, merge, deployment, pricing, effectiveness comparison, or
  continuous context enforcement.

## Acceptance Criteria

- Exact-base-only Repositories continue to work without policy or overlay state.
- A confirmed policy freezes eligible ignored Codex Harness before planning and makes the same
  bytes available in planning, execution, retry, and restart.
- Later changes or deletion in the registered checkout cannot alter a frozen selection.
- Unsupported, unconfirmed, non-ignored, escaping, colliding, oversized, or changed resources fail
  before successful Provider execution with stable typed diagnostics.
- Provider configuration, credentials, environment files, caches, and non-semantic
  `.worktreeinclude` matches are never admitted as Harness.
- An Agent cannot mutate an overlay and still publish a Candidate.
- No overlay path, parent artifact, Git index entry, or content enters a Candidate or registered
  checkout.
- Run evidence binds exact-base and overlay identities and reports Provider discovery with honest
  coverage while excluding snapshot bodies from default Agent context.
- A Repository policy is reusable while each ChangeSet owns an exact resolved inventory and digest.
- A durable private Harness edit fails with `NON_GIT_HARNESS_CHANGE_UNSUPPORTED`.
- Existing deterministic and real Codex flows remain passing.
- One explicit opt-in real Codex flow proves one frozen ignored instruction or Skill is available
  without live-checkout reads.

## Validation

| Command or gate | Scope | Required |
| --- | --- | --- |
| `npm test` | Policy selectors, `.worktreeinclude`, selection identity, diagnostics, projection | Yes |
| `npm run test:integration` | Containment, snapshots, mutation, restart, cleanup, Candidate exclusion | Yes |
| `npm run test:acceptance` | Existing no-overlay one- and multi-Repository regressions | Yes |
| `npm run test:provider:codex` with the explicit real-Provider opt-in | Native discovery of one frozen ignored Codex resource | Yes |
| `npm run check` under Node.js 24 | Complete deterministic package gate | Yes |
| `git diff --check` and targeted boundary audit | Links, settings, secrets, live reads, Candidate paths, context, comments | Yes |

The real Provider gate remains paid and nondeterministic. It requires the existing explicit
credential and cost decision and cannot be reported as passed unless actually executed.

## Current Projection

- Current subject: the Codex local Harness overlay vertical slice is accepted as complete.
- Last verified state: the Node.js 24 deterministic package gate and the explicit real Codex
  overlay gate pass with zero failures.
- Next step: no work remains inside WI-0004; any later stage requires separately accepted
  authority.
- Active blocker or decision: none.

## Implementation Evidence

Implementation was started by the user's 2026-07-31 request, `启动 WI-0004`.

The active working tree implements:

- revisioned Repository Harness policies and confirmed per-ChangeSet selection revisions;
- immutable content-addressed snapshot artifacts bound to exact Repository base SHAs;
- complete no-body exact-base and frozen-overlay inventories in linked Run evidence, with only
  bounded samples and an identity summary in Runtime context;
- planning, execution, retry, and restart materialization from snapshot artifacts only;
- mutation detection, exact overlay cleanup, Candidate exclusion, and no writeback;
- stable localized diagnostics, bounded skipped-resource summaries, and bounded evidence identity;
- honest Provider-discovery coverage recorded as `unavailable` when Codex exposes no load event;
- committed `AGENTS.md`, `AGENTS.override.md`, `WORKFLOW.md`, and `.agents/skills/**` discovery;
- explicit-pattern and tracked exact-base `.worktreeinclude` selection for ignored Codex Harness.

Validation evidence on 2026-07-31:

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe C:\myData\nodejs\node_modules\npm\bin\npm-cli.js run check` | 0 | Ran the package's exact `npm run check` script with Node.js 24: 23 unit, 28 integration, and two serial acceptance tests passed on the final source subject | Real Provider is intentionally outside this deterministic runner |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test --test-name-pattern="freezes ignored Harness" test/integration/repository-harness-overlay.test.js` | 0 | The final changed integration test passed: bounded context, linked Run observation, live mutation and deletion, restart, execution, cleanup, and Candidate exclusion | Provider-native load observation remains unavailable |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test --test-concurrency=1 "test/provider/**/*.test.js"` | 0 | Provider test module loaded; the sole real Codex test was skipped because explicit opt-in was absent | Native Codex discovery and paid execution remain unverified |
| `git diff --check` plus untracked-file whitespace, changed-link, eager-size, production-fake, and UTF-8 comment audits | 0 | Repository hygiene passed; `docs/current-state.md` remains below its 8 KiB eager limit and no production fake path was found | Static audit does not replace the real Provider gate |

Explicit real-Provider evidence on 2026-08-03:

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `CHANGEFLEET_RUN_REAL_CODEX=1 C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe C:\myData\nodejs\node_modules\npm\bin\npm-cli.js run test:provider:codex` | 0 | One real planning Run and one real execution Run used the frozen ignored `AGENTS.override.md`; live-checkout mutation did not alter behavior, the overlay was removed before Candidate publication, and the exact feature was produced | Codex exposes aggregate usage but no effective model, monetary cost, or structured actual-load event |

The real gate took 153,990 ms wall time. Provider evidence reported:

| Run | Provider duration | Input | Cached input | Output | Reasoning output | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Planning | 79,761 ms | 22,738 | 10,752 | 604 | 112 | 23,342 |
| Execution | 57,551 ms | 48,889 | 34,816 | 254 | 0 | 49,143 |
| Invocation sum | 137,312 ms | 71,627 | 45,568 | 858 | 112 | 72,485 |

`total_tokens` follows the Provider aggregate contract and equals input plus output; cached input is
reported as a subset rather than added again. Monetary cost remains `null` because the Provider did
not report pricing evidence.

The deterministic integration subject includes frozen-byte reuse after live-checkout mutation and
deletion, restart reconstruction, interrupted execution retry, selection revision, bounded context
and Run evidence, symlink and collision rejection, count and byte limits, overlay mutation,
cleanup, no writeback, and Candidate exclusion. Test-only `ScriptedRuntime` remains outside
production source; no temporary production mock or compatibility path was added.

## Project Memory Impact

Proposal 0009 is implemented by this accepted WorkItem. `docs/current-state.md` projects the
landed baseline and keeps later stages unauthorized until separately discussed and accepted.
