---
artifact_type: development_work_item
id: WI-0013
status: done
title: Implement Provider-owned host permissions for local multi-Repository workspaces
source: 'User request: "按照你说的做" after accepting the Conductor-style workspace-layer correction'
confirmed_by: user
confirmed_at: 2026-08-04
started_by: user
started_at: 2026-08-04
review_ready_at: 2026-08-04
completed_by: user
completed_at: 2026-08-04
standing_policy:
design_proposal: docs/proposals/0019-provider-owned-host-permissions-and-multi-repository-workspaces.md
accepted_decisions:
  - docs/decisions/0021-provider-owned-host-permissions-and-multi-repository-workspaces.md
---

# WI-0013: Implement Provider-Owned Host Permissions For Local Multi-Repository Workspaces

## Objective

Restore ChangeFleet's Conductor-style product boundary by making trusted local host-user execution
an explicit AgentProfile choice while retaining exact multi-Repository workspace, Git, evidence,
review, and delivery authority.

## Scope

- Add exact `host_user` and retained `operation_scoped` AgentProfile modes.
- Require matching `network_access: true` and `false` facts respectively.
- Map Codex host-user Runs to `danger-full-access` and non-interactive termination.
- Inherit the host environment only for explicit host-user Runs while overriding `CODEX_HOME` with
  the selected Provider environment.
- Remove ChangeFleet overrides for native Sandbox, history, internal subagents, network, and Web
  Search from host-user Runs.
- Keep existing constrained behavior only for explicit operation-scoped Runs.
- Preserve exact workspace publication, evidence exclusion, and immutable historical profiles.
- Add Simplified Chinese intent comments to changed production boundaries.
- Update the external WI-0009 dogfood profile only after this WorkItem lands.

## Non-Goals

- General permission framework, interactive approvals, containers, WSL, remote workers, or managed
  Provider environments.
- Claiming worktree isolation is an OS security boundary.
- Changing Candidate, Bundle, review, delivery, recovery, or cost aggregation semantics.
- Modifying the operator's global Codex configuration.
- Running WI-0009 implementation before this WorkItem is accepted and landed.

## Acceptance Criteria

- Host-user mode passes `danger-full-access` and `approvalPolicy=never` for planning and execution.
- It inherits host environment variables without persisting them and sends no Provider-native
  configuration overrides.
- Operation-scoped mode retains the previous constrained thread and environment behavior.
- Invalid permission and network combinations fail deterministically.
- Runtime context and audit expose only the bounded AgentProfile facts.
- Exact WorkUnit workspace and Candidate acceptance logic is unchanged.

## Validation Selection

| Gate | Requirement | Reason |
| --- | --- | --- |
| AgentProfile and Runtime evidence unit tests | Required | New durable permission identity |
| Codex adapter integration | Required | Two exact Provider permission mappings |
| Strict local config unit and integration tests | Required | Operator-selected mode |
| Runtime context regression | Required | Host environment must not enter context |
| Full deterministic suite | Not required initially | Isolated profile and adapter boundary has direct coverage |
| Real Provider | Excluded until acceptance | WI-0009-v3 is a later operational retry |
| Documentation and size audit | Required | Product and Harness boundary correction |

Every changed test file must run. If final scope crosses shared persisted schemas or lifecycle,
reselect the full deterministic gate.

## Current Projection

- Current subject: accepted and completed Decision 0021 deterministic slice.
- Last verified state: both explicit modes pass the selected direct tests and the complete
  deterministic gate on base `7b62bf5225bdf32ba51bf29bb162ce0bf69dc9b4` plus this WorkItem diff.
- Next step: land this exact diff, then change WI-0009-v3 to the explicit trusted-local profile.
- Active blocker or decision: none. Real WI-0009 remains paused until that explicit configuration
  update and exact-base revision.

## Implementation Evidence

- Node.js 24 running `--test --test-concurrency=1 test/unit/runtime-evidence.test.js
  test/unit/local-cli.test.js test/unit/runtime-context.test.js
  test/integration/codex-sdk-runtime.test.js test/integration/local-cli.test.js` returned exit code
  `0` in 9.9 seconds: 30 tests passed. It directly covers permission/network normalization, strict
  local configuration, context exclusion, host environment inheritance without evidence leakage,
  omitted host-user Provider overrides, and retained explicit constrained behavior.
- Node.js 24 running `scripts/run-checks.mjs`, the exact implementation behind `npm run check`,
  returned exit code `0` in 178.4 seconds: 54 unit, 62 integration, and 6 acceptance tests passed.
  No real Provider, network call, or paid external gate is part of that command.
- Static inspection found host-user `danger-full-access` plus `approvalPolicy=never`, constrained
  `read-only | workspace-write` plus disabled network and Web Search, and no Codex factory config
  override for native Windows Sandbox, history, or internal subagents.
- `git diff --check` returned exit code `0`. Eager Harness files measured `6068`, `1264`, and `8100`
  bytes for `AGENTS.md`, `WORKFLOW.md`, and `docs/current-state.md`, within their soft limits.
- Real WI-0009-v3 Provider execution, UAC absence, other hosts and Runtimes, and enforced host
  confinement remain unverified. Host-user mode intentionally makes no confinement claim.

## Acceptance Review

Ready for user review. The diff implements only the two exact AgentProfile modes, preserves
Candidate and workspace acceptance semantics, and does not add a general permission framework or
modify external Provider configuration. The material tradeoff is explicit: `host_user` can access
everything available to the local account.

Accepted by the user on 2026-08-04 with an explicit instruction to land the implementation before
updating WI-0009-v3 to `host_user`.

## Project Memory Impact

WI-0013 is completed. WI-0009-v3 remains unplanned and paused until this WorkItem lands and its
external AgentProfile is explicitly revised.
