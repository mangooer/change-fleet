# 0019: Provider-Owned Host Permissions And Multi-Repository Workspaces

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-04

Accepted: 2026-08-04

Supersedes in part: Decision 0010 mandatory operation-scoped host enforcement

Depends on: Decisions 0001, 0005, 0009, 0010, and 0020

Blocks: A UAC-free WI-0009-v3 planning retry

Decision: [Decision 0021](../decisions/0021-provider-owned-host-permissions-and-multi-repository-workspaces.md)

Implementation tracking: [WI-0013](../work-items/WI-0013-provider-owned-host-permissions-and-multi-repository-workspaces.md), `done`

## Context

ChangeFleet is the workspace and change-control layer outside Agent Runtimes. Codex, Claude Code,
and later Runtimes own their agent loop, tools, internal subagents, native context, and host
execution. ChangeFleet adds one coherent ChangeSet across one or more Repositories, exact bases,
WorkUnits, Candidates, combined evidence, Bundle review, recovery, and delivery.

The first Codex adapter conflated two kinds of isolation. A Git worktree isolates development state
between tasks; it is not an operating-system security boundary. ChangeFleet nevertheless required
Codex `read-only` or `workspace-write` native Sandbox enforcement, disabled network and native
subagents, filtered the host environment, and selected non-interactive approvals. Native Windows
then required elevated Sandbox provisioning and repeatedly blocked WI-0009 with UAC.

Conductor's useful reference boundary is narrower: it orchestrates branches, worktrees, sessions,
terminals, diffs, checks, PRs, and archive or discard while the selected Harness runs with the
operator's local permissions. ChangeFleet should retain its stronger multi-Repository Git and
evidence control without making host Sandbox provisioning a product prerequisite.

## Decision

Repository and WorkUnit scope define what ChangeFleet may accept, validate, review, and deliver.
They do not claim that the Runtime process is unable to access other host resources.

AgentProfile gains one explicit `host_user` permission mode for trusted local execution. The Codex
adapter maps it to `danger-full-access`, inherits the host environment, and does not override native
Windows Sandbox, network, Web Search, history persistence, or internal multi-agent settings. The
current non-interactive controller continues to set `approvalPolicy=never` so a Run terminates
rather than waiting on an approval surface ChangeFleet does not implement.

The existing `operation_scoped` mode remains an explicit optional capability and historical
compatibility path. It retains planning `read-only`, execution `workspace-write`, disabled network,
and controlled environment behavior. It is not the required local default and must never be a
silent fallback from `host_user`.

`host_user` requires `network_access: true`; `operation_scoped` requires `network_access: false`.
These values are durable audit facts from the confirmed AgentProfile, not independent firewall
attestation. No new permission hierarchy or Provider-neutral policy language is added.

## Boundaries

- ChangeFleet creates and owns planning and execution workspaces but not a host security sandbox.
- A planning scope remains semantically read-only: planning writes never become Candidates.
- Execution publishes only the exact assigned WorkUnit workspace Git subject.
- Host-user mode may access anything the local account can access. The UI, audit, and documentation
  must state that no OS confinement was enforced.
- Provider-native tools, subagents, history, Web settings, setup, and credentials remain outside
  ChangeFleet control and aggregate state.
- AgentProfile model, reasoning, explicit permission mode, and logical credential id remain durable
  non-secret Run identity.
- ChangeFleet never silently changes permission mode after a Provider failure.
- Historical Runs retain their original `operation_scoped` profile without migration.

## Alternatives

### Keep Mandatory Native Sandbox Enforcement

Rejected for the local first product. It provides a stronger host guarantee but makes ChangeFleet
availability depend on Provider-specific OS provisioning that Conductor-style orchestration does
not own.

### Omit Permission Mode And Use Provider Defaults

Rejected. It would hide whether a Run used host-user or constrained execution and would make cost,
failure, and safety audits ambiguous.

### Build Containers Or A General Permission Framework

Deferred. Containers, WSL, remote workers, managed Runtimes, policy hierarchies, and per-tool grants
are broader deployment features. The current need is one explicit truthful local mode.

## Implementation Slices

1. Accept `host_user` in AgentProfile and validate its matching network fact.
2. Map Codex host-user Runs to full local permissions while preserving exact workspace identity and
   non-interactive termination.
3. Retain and directly test `operation_scoped` as an explicit optional mode.
4. Update the WI-0009 dogfood configuration only after the implementation lands; then revise its
   unplanned Repository selection before a single real planning retry.

## Acceptance Criteria

- A host-user planning or execution invocation sends `danger-full-access` and `approvalPolicy=never`.
- Host-user invocation inherits ordinary host environment values and still selects explicit
  `CODEX_HOME`; secrets are not persisted or copied into Runtime context or evidence.
- It sends no SDK config overrides for native Windows Sandbox, history, subagents, network, or Web
  Search.
- Operation-scoped planning and execution retain their prior constrained thread and environment
  behavior only when explicitly selected.
- The AgentProfile and audit projection distinguish the two modes without adding transcript or
  host-environment content.
- WorkUnit Candidate and exact Git acceptance semantics are unchanged.

## Validation

- AgentProfile unit tests for exact mode and network combinations.
- Codex adapter integration tests for both permission modes, inherited versus filtered environment,
  and absent Provider-native config overrides.
- Runtime evidence and context regression proving permission identity without environment content.
- Strict local config tests for accepted and rejected profiles.
- One real WI-0009-v3 planning retry only after deterministic acceptance and exact base revision;
  any UAC or Provider failure stops the flow without automatic retry.
- `git diff --check` and eager Harness size inspection.

## Risks And Open Questions

- Host-user mode intentionally gives the Agent local account permissions; malicious or mistaken
  commands can affect files outside the workspace.
- ChangeFleet cannot attest Provider-native tool or network behavior from the AgentProfile alone.
- A future hosted or enterprise deployment will need explicit enforced isolation capabilities.

## Non-Goals

- Container, VM, WSL, remote-worker, or managed Sandbox provisioning.
- Interactive approval UI, per-tool grants, policy inheritance, or enterprise enforcement.
- Changing Candidate, Bundle, delivery, recovery, or cross-Repository compensation semantics.
- Modifying the operator's global Codex configuration.

## Documentation Impact

Update SPEC section 14, AGENTS, Harness guidance, Decision 0020 clarification, Runtime configuration,
current state, Proposal index, Decision index, and WI-0009 evidence.
