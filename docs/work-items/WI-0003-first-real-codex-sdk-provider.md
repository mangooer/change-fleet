---
artifact_type: development_work_item
id: WI-0003
status: done
title: Implement the first real Codex SDK Provider vertical slice
source: "User request: the recommended design is sound; proceed accordingly."
confirmed_by: user
confirmed_at: 2026-07-31
started_by: user
started_at: 2026-07-31
completed_by: user
completed_at: 2026-07-31
standing_policy:
design_proposal: docs/proposals/0007-first-real-codex-sdk-provider.md
supporting_proposal: docs/proposals/0005-runtime-cost-and-effectiveness-observability.md
accepted_decisions:
  - docs/decisions/0009-runtime-observability-evidence-boundary.md
  - docs/decisions/0010-first-real-codex-sdk-provider.md
---

# WI-0003: Implement The First Real Codex SDK Provider Vertical Slice

## Objective

Connect one real Codex TypeScript SDK Agent Runtime to the deterministic ChangeFleet kernel and
prove exact-base planning, repository-scoped execution, structured outcomes, Candidate production,
and honest out-of-context Runtime evidence in one single-Repository end-to-end flow.

## Context

[Decision 0010](../decisions/0010-first-real-codex-sdk-provider.md) owns the Provider, planning
workspace, session, Harness, capability, structured-output, and recovery boundary.
[Decision 0009](../decisions/0009-runtime-observability-evidence-boundary.md) owns raw usage and
audit semantics. [Decision 0008](../decisions/0008-change-set-repository-selection.md) supplies the
exact Repository selection and base authority.

The exact starting implementation is commit
`907effe9f779fffde5c7e427c7cfa6069c337fa7`. Its scripted Runtime is valid test support but is not a
production Provider. Planning currently names frozen bases without materializing a matching
read-only filesystem view for a real Agent.

## Scope

- Pin one exact compatible `@openai/codex-sdk` dependency and record observable SDK or CLI runtime
  versions.
- Add a production Codex SDK adapter behind the existing narrow Runtime port without leaking vendor
  types into domain state.
- Require an explicit real Agent Profile and external credential environment; never persist
  secrets.
- Start a fresh Provider thread and owned process for every planning or execution Run attempt.
- Materialize owned detached planning worktrees at every selected `resolved_base_sha`, expose only
  those roots read-only, and implement containment, identity, cleanup, and restart handling.
- Keep execution write access limited to the current WorkUnit workspace, with network disabled by
  default and no `danger-full-access` fallback.
- Build strict planning and execution JSON Schemas and map validated terminal results to existing
  typed outcomes.
- Convert only already accepted Provider requests into typed ChangeFleet requests; reject
  unsupported interactive or authority-expanding behavior.
- Extend Run persistence with immutable Runtime invocation, Provider locator and version, timing,
  usage observations, confidence, coverage, Agent Profile, and context-projection identity.
- Keep telemetry and raw Provider traces out of ordinary Control Contracts and Run Context
  Projections; link bounded external artifacts when required.
- Preserve the current abandoned-attempt restart rule rather than resuming an unproven incomplete
  Provider session.
- Remove deterministic-fake defaults and fake production selection after the real adapter proves
  the boundary; retain scripted Runtime behavior only in test support.
- Add Simplified Chinese intent comments to every added or materially changed production boundary.

## Non-Goals

- Codex App Server, WebSocket transport, turn steering, or rich interactive Provider approvals.
- Claude Agent SDK, another real Provider, or generic provider routing.
- Direct model API integration or a ChangeFleet-owned Agent tool loop.
- Provider-session continuation across controller loss, plan revisions, WorkUnits, or retries.
- Runtime Skill Kit packaging or repository Harness creation.
- Continuous context-window enforcement beyond honest initial evidence.
- Pricing snapshots, normalized cost, billing, dashboards, budgets, or chargeback.
- Agent, model, Harness, or context effectiveness ranking.
- Linear, public CLI, API, browser UI, remote worker, Git URL, delivery, merge, or deployment.
- A paid real multi-Repository Provider flow in the normal fast test suite.

## Acceptance Criteria

- A real planning Run reads source and repository-native instructions from an owned read-only
  planning worktree whose HEAD equals the current selection's exact `resolved_base_sha`.
- Changing the registered checkout branch or dirty files after selection cannot change what the
  real planning Agent sees.
- A real planning result must satisfy the strict ChangePlan schema and cannot replace control-owned
  Repository ids, branches, targets, base SHAs, or confirmation.
- A real execution Run can modify only its WorkUnit workspace and produces an exact Candidate that
  passes the existing repository validation and Bundle path.
- Single-Repository scope is fully valid; the implementation does not assume that every Project or
  ChangeSet is multi-Repository.
- Every real Provider invocation persists its Run attempt, profile and projection identity,
  Provider locator and observable versions, requested and observable effective model, timestamps,
  duration, terminal outcome, and available usage with explicit confidence and coverage.
- Missing request, model, cache, reasoning, subagent, or cost data remains null or unknown rather
  than estimated as provider-reported fact.
- Provider usage, traces, historical scorecards, and cost data are absent from normal planning and
  execution context.
- Invalid structured output, attempted unauthorized access, process failure, cancellation, and
  controller restart produce deterministic terminal evidence without silently expanding authority.
- A retry uses a fresh Provider thread and the current exact ChangeFleet projection.
- Production construction has no deterministic-fake default or selectable fake Provider; scripted
  behavior remains reachable only from test support.
- Existing deterministic unit, integration, single-Repository, and two-Repository acceptance
  behavior remains passing.
- One explicit opt-in real Codex Provider acceptance flow succeeds and records its unverified
  external boundaries.

## Validation

| Command or gate | Scope | Required |
| --- | --- | --- |
| `npm test` | Runtime evidence normalization, profiles, schemas, capability and context exclusion | Yes |
| `npm run test:integration` | Planning worktrees, SDK protocol fixtures, persistence, cancellation, failure, and recovery | Yes |
| `npm run test:acceptance` | Existing deterministic one- and two-Repository end-to-end regression | Yes |
| Add and run `npm run test:provider:codex` explicitly | One real single-Repository planning, execution, Candidate, and usage flow | Yes |
| `npm run check` under Node.js 24 | Complete deterministic package gate | Yes |
| `git diff --check` and targeted dependency, fake-path, secret, context, and Chinese-comment audit | Repository hygiene and deferred-boundary exclusion | Yes |

The real Provider command must be opt-in and must not run in the ordinary fast suite without an
explicit credential and cost decision. For every executed check record the exact command, exit
code, concise observation, and remaining unverified boundary.

## Current Projection

- Current subject: the first real Codex SDK Provider vertical slice is accepted as complete.
- Last verified state: the branch pins `@openai/codex-sdk@0.146.0`, passes all deterministic gates,
  and passes one opt-in real `gpt-5.4` single-Repository planning-to-Bundle flow.
- Next step: no work remains inside WI-0003; every later stage requires separately accepted
  authority.
- Active blocker or decision: none. Stable SDK read-confinement and effective-model observability
  remain explicitly unverified rather than silently claimed.

## Implementation Evidence

Implementation was started by the user's 2026-07-31 request, `启动`.

The branch now:

- pins `@openai/codex-sdk` and its CLI package at `0.146.0`;
- requires an explicit versioned Agent Profile and has no production deterministic-fake default;
- starts one fresh Codex process and thread for every Run attempt with strict operation output
  schemas, `approvalPolicy: never`, disabled web/network access for Agent commands, read-only
  planning, and workspace-write execution;
- creates and cleans owned detached planning worktrees at each persisted `resolved_base_sha`, and
  projects only those paths rather than registered checkouts;
- keeps an isolated one-attempt `CODEX_HOME`; for native Windows it copies only external
  credentials and pre-provisioned elevated-sandbox state, not user config, global AGENTS, Skills,
  MCP configuration, or sessions;
- persists immutable Runtime invocation evidence with profile and context identity, Provider and
  thread locators, observable SDK/CLI versions, timing, terminal result, aggregate-only
  Provider-reported token usage, and null unknowns;
- keeps Provider step status plus command/output sizes and fingerprints, usage, and bounded event
  metadata in Run audit storage and out of ordinary Runtime context; command, output, and reasoning
  bodies are not persisted;
- abandons interrupted planning and execution attempts, cleans planning worktrees, preserves
  evidence, and uses a fresh attempt on retry;
- retains `ScriptedRuntime` only under `test/support`.

Validation evidence:

| Command or gate | Exit | Observation | Remaining unverified boundary |
| --- | ---: | --- | --- |
| `npm test` | 0 | 19 unit tests passed for profiles, schemas, usage normalization, context, diagnostics, and domain identity | No real Provider process |
| `npm run test:integration` | 0 | 20 integration tests passed for exact-base worktrees, SDK event fixtures, invalid output, cancellation, persistence, failure, and restart recovery | Provider fixtures do not prove external service behavior |
| `npm run test:acceptance` | 0 | Existing single- and two-Repository deterministic flows passed, 2 tests total | Scripted Runtime only |
| `$env:CHANGEFLEET_RUN_REAL_CODEX='1'; npm.cmd run test:provider:codex` | 0 | One real `gpt-5.4`, medium-reasoning single-Repository flow passed in 82.1 seconds through exact-base planning, execution, repository check, combined check, Candidate, Bundle, and nonzero aggregate usage assertions | Native Windows and selected local ChatGPT credentials only; paid/external service is nondeterministic |
| `npm run check` under Node.js `24.14.0` | 0 | Full deterministic package gate passed: 19 unit, 20 integration, and 2 acceptance tests | Opt-in real Provider test is intentionally excluded |
| `git diff --check` plus targeted fake, secret, telemetry-context, dependency, and comment inspection | 0 | No whitespace errors, production fake default, persisted secret value, or telemetry projection found | Manual inspection cannot prove hostile Provider behavior |

Observed limitations and honest coverage:

- Codex SDK `0.146.0` reports one turn aggregate. Usage is therefore
  `provider_reported + aggregate_only`; request tree, subagent split, price, and normalized cost are
  null or deferred.
- The stable SDK does not report the effective model, so evidence preserves requested model and
  records observable effective model as null.
- Planning reads the correct detached worktree and excludes moved branches and dirty checkout
  files. The stable SDK's `read-only` sandbox does not by itself prove deny-read confinement against
  every other readable host path; this remains an external enforcement gap, not a claimed pass.
- Native Windows real execution requires an already provisioned elevated Codex sandbox. The adapter
  fails closed when the selected external credential profile lacks its required setup state and
  never falls back to `danger-full-access`.
- Real cancellation, hard process death, non-Windows sandboxing, API-key authentication, malicious
  out-of-scope access, and multi-Repository paid execution remain unverified.

## Acceptance Review

Accepted by the user on 2026-07-31.

The registered-Repository worktree implementation is accepted for this local first-Provider slice.
It proves exact-base materialization efficiently and keeps Candidate creation in the registered
Repository's Git object database. It is not accepted as ChangeFleet's final workspace architecture.

A later Git URL or remote-worker stage should first propose the Git object-ownership boundary.
The preferred direction to evaluate is a ChangeFleet-owned bare object store with disposable Run
workspaces, using either worktrees or independent clones according to the required isolation. That
proposal must define frozen-base retention, workspace lifecycle, Candidate import or publication,
and recovery. A direct clone of a registered checkout is not authorized by this review note, and
neither clone nor worktree replaces operating-system sandbox enforcement for a highly privileged
Agent.

## Project Memory Impact

Proposal 0005's raw observability slice and Proposal 0007's first Provider boundary are accepted as
implemented. `docs/current-state.md` must promote WI-0003 into the accepted baseline, preserve its
honest limitations, record the deferred Git object-ownership question, and avoid authorizing a
later implementation stage before a separate proposal is accepted.
