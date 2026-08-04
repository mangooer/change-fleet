# 0021: Provider Owns Host Permissions Outside Multi-Repository Workspace Control

Status: Accepted

Date: 2026-08-04

Source: Repository Design Proposal 0019

Supersedes in part: Decision 0010 mandatory operation-scoped host enforcement

## Decision

ChangeFleet is the workspace and change-control layer outside Agent Runtimes. It owns coherent
multi-Repository ChangeSets, exact Git subjects, WorkUnits, evidence, Bundle review, recovery, and
delivery. It does not own or guarantee an operating-system security boundary around a local Agent.

Trusted local AgentProfiles may explicitly select `host_user`. The Codex adapter maps that mode to
`danger-full-access`, inherits the host environment, and leaves Provider-native Sandbox, network,
Web Search, history, tools, and internal subagents to the selected Runtime environment. The current
non-interactive controller sets `approvalPolicy=never` only to avoid an unsupported approval wait.

The existing `operation_scoped` mode remains an explicit optional constrained capability. It is not
a prerequisite for the local product and is never selected as a fallback. Audit preserves the
confirmed permission mode and network fact without persisting host environment values.

## Rationale

Worktrees prevent task checkouts from colliding but do not confine a process with OS permissions.
Conductor productively owns the former and delegates the latter to its Harness and operator.
ChangeFleet needs stronger cross-Repository Git authority and evidence, not mandatory Provider- and
OS-specific Sandbox provisioning.

## Consequences

- Repository authorization limits accepted and delivered Git subjects, not all host process access.
- Host-user mode is high risk and must be explicit and visible in audit.
- Planning writes remain non-authoritative; execution accepts only the assigned workspace subject.
- Strong Sandbox, container, WSL, remote-worker, and managed Runtime enforcement remain optional or
  deferred deployment capabilities.
- Historical Run profiles remain immutable.
