# 0010: First Real Provider Uses The Codex TypeScript SDK

Status: Accepted

Date: 2026-07-31

Source: Repository Design Proposal 0007

## Decision

ChangeFleet's first production Agent Runtime adapter uses the official
`@openai/codex-sdk` TypeScript package behind the existing narrow Runtime port.

Each Run attempt receives a fresh provider thread and owned local process. ChangeFleet supplies a
controlled environment, an explicit versioned Agent Profile, an operation-scoped capability, and a
strict JSON Schema for terminal output. Provider Thread or process identifiers are locators and
evidence, not durable ChangeFleet identity or lifecycle authority.

Planning uses separately owned detached Git worktrees materialized at every selected Repository's
persisted `resolved_base_sha`. Provider access is read-only and limited to those planning-visible
roots. Execution remains read/write only in the current WorkUnit's isolated workspace. Network is
off by default, Runtime-native subagents inherit the same or narrower boundary, and
`danger-full-access` is not a default mode.

ChangeFleet supplies the compact Control Contract and current Run Context Projection. It exposes
repository-native instructions from the exact base and only the optional Runtime Skills selected by
the Agent Profile. Unselected user-global Harness, Skills, settings, and secrets are not implicit
control inputs. Credentials are supplied outside persisted ChangeSet state.

The adapter maps provider events and final output into typed ChangeFleet outcomes and immutable
Runtime evidence. It does not let provider output directly mutate repository authorization,
selection, plan confirmation, Candidate review, or control state.

Controller loss abandons the unfinished attempt and preserves its evidence. The first adapter does
not blindly resume an incomplete Provider session; a retry receives a fresh thread and current
projection under the same ChangeSet.

## Rationale

The TypeScript SDK provides the smallest official surface needed for the first vertical slice:
streamed events, structured output, model and reasoning selection, working-directory and sandbox
controls, and turn-level usage. It fits the accepted Node.js ESM stack without requiring
ChangeFleet to implement the App Server's broader bidirectional client protocol.

The adapter remains provider-neutral at the ChangeFleet boundary. Choosing one real implementation
first proves the port and evidence model without building a speculative universal Agent framework.

## Consequences

- The exact SDK version is pinned in the package lock, and observable SDK or CLI runtime versions
  are recorded with Run evidence.
- Codex SDK aggregate usage is accepted with honest coverage; experimental or internal per-response
  events are not required.
- A later need for in-flight steering, durable Provider-session recovery, or bidirectional approval
  may justify replacing the Codex adapter internals with App Server.
- Claude Agent SDK is the preferred later conformance candidate when multi-Provider comparison is
  accepted, but it is not part of the first Provider WorkItem.
- Direct model API integration and a ChangeFleet-owned tool loop remain rejected for this stage.
- The production fake Runtime profile is removed once this adapter proves the production boundary;
  scripted Runtime behavior remains test-only.
