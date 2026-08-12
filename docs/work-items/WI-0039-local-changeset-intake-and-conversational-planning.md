---
artifact_type: development_work_item
id: WI-0039
status: done
title: Local ChangeSet intake and conversational planning
source: Accepted Proposal 0029 and Decision 0031; confirmed by user
confirmed_by: user
confirmed_at: 2026-08-12
standing_policy:
design_proposal: docs/proposals/0029-local-changeset-intake-and-conversational-planning.md
---

# WI-0039: Local ChangeSet Intake And Conversational Planning

## Objective

Let an operator create an existing-Project ChangeSet and conduct bounded conversational planning
from the local console, using the existing shared task and planning operations without adding
another lifecycle or configuration system.

## Context

Proposal 0029 and Decision 0031 accept the local adapter boundary. Core already creates the exact
TaskWorkspace before planning and already supports planning turns and exact Plan confirmation. The
console currently starts from an existing ChangeSet and therefore requires CLI JSON before the
ordinary browser flow can begin.

The current Planner projection also carries only the current approvable Plan response. When the
assistant asks a question without returning a Plan, its next fresh attempt does not receive that
question. This WorkItem carries the immediately preceding assistant planning message instead of
replaying the full transcript.

## Scope

- Add one bounded local intake-options projection for existing Projects, selectable Repositories,
  and compact effective task-policy summaries.
- Add explicit allowlisted local HTTP mutations for `changeset.create` and `changeset.plan` with
  narrow request normalization and shared application delegation.
- Keep creation and planning as separate idempotent operations; preserve a created planning task
  when the first Agent attempt fails.
- Project a bounded recent human-facing planning conversation from linked evidence without
  exposing raw Runs, logs, provider payloads, paths, credentials, or full transcripts.
- Supply each new planning Run with the current user message and immediately preceding assistant
  message even when that response contains no Plan.
- Add the existing-Project, Repository, intent, optional ref, create, retry, planning message, and
  exact approval browser flow.
- Update `SPEC.md`, architecture, README, current state, and this WorkItem with the landed boundary
  and concise evidence.

## Non-Goals

- No Project, Repository, AgentProfile, Harness, policy, credential, or delivery-binding editor.
- No Linear, GitHub Issue, SourceBinding, template, webhook, streaming, remote, or multi-user API.
- No new lifecycle phase, aggregate, composite `create_and_plan` Core operation, generic operation
  endpoint, task schema, Plan schema, or compatibility path.
- No Candidate comparison, model routing, pricing, deployment, automatic merge, or diff artifact
  browser.

## Acceptance Criteria

- The console creates a single-Repository or multi-Repository ChangeSet under one existing Project
  and shows the exact frozen task workspace after creation.
- Omitted refs retain current accepted defaults; supplied refs pass through existing Core
  validation and exact Git resolution.
- Creation success followed by planning failure leaves one retryable ChangeSet and cannot silently
  create a duplicate.
- The operator can exchange bounded planning messages and reconstruct a bounded recent view after
  page refresh.
- A Planner question without a Plan is present in the next planning context with the operator's
  answer; older transcript content is absent from ordinary Runtime context.
- Only the current exact Plan-bearing message can be approved, and existing post-confirmation
  supervision behavior remains unchanged.
- New reads and mutations preserve the console's explicit route, loopback, Host, same-origin,
  CSRF, body, diagnostic, and shutdown boundaries.
- No browser request can supply a control root, host path, executable, raw operation, raw
  AgentProfile, provider option, credential, or unrestricted catalog object.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Targeted unit tests for Runtime context and local query projection under Node.js 24 | adjacent planning message, output bounds, secret/path exclusion | Required during implementation | Direct pure projection boundaries |
| `node --test test/integration/application-boundaries.test.js` under Node.js 24 | planning question/answer continuity, stale approval, retry | Required | Existing planning application owner |
| `node --test test/integration/local-console-server.test.js` under Node.js 24 | explicit routes, delegation, security, idempotency, partial failure | Required | HTTP adapter owner |
| `npm run test:ui` under Node.js 24 | create, plan, refresh, exact approval browser path | Required | Browser assets and user flow change |
| `npm run check` under Node.js 24 | final stabilized Candidate | Required once | The slice crosses Runtime context, application query, HTTP, UI, and accepted contract boundaries |
| `npm run check:harness` under Node.js 24 | accepted Proposal, Decision, WorkItem, and current projection | Required | Repository Harness changes |
| `git diff --check` over branch base through working tree | complete WorkItem diff | Required | Formatting and handoff hygiene |
| Real Provider gate | paid Planner behavior | Excluded | Adjacent-turn projection and protocol behavior are deterministic; Runtime adapter is unchanged |
| Real GitHub gate | external delivery writes | Excluded | Delivery behavior is unchanged and outside this slice |

## Current Projection

- Current subject: branch `codex/proposal-0029-local-intake-planning`, based on `d29e6f4`.
- Last verified state: the implementation is complete branch-locally, the final Node.js 24
  repository gate passed, and the user accepted the exact Candidate for commit on 2026-08-12.
- Next step: none for this completed WorkItem; Git owns exact landing and delivery history.
- Active blocker or decision: none.

## Implementation Evidence

- `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
  --test test/unit/runtime-context.test.js test/unit/changeset-view-service.test.js` exited `0` in
  30.4 seconds. Ten unit tests covered adjacent Planner context, safe intake projection, and
  conversation turn/byte bounds.
- The same Node.js 24 executable with `--test test/integration/application-boundaries.test.js`
  exited `0` in 82.9 seconds. Six application-boundary tests included question/answer continuity
  without older transcript replay.
- The same Node.js 24 executable with `--test test/integration/local-console-server.test.js`
  exited `0` in 62.5 seconds. Five HTTP integration tests covered explicit intake/planning routes,
  shared-operation delegation, unsafe-field rejection, and existing security behavior.
- The same Node.js 24 executable with `scripts/run-ui-tests.mjs` exited `0` in 28.5 seconds. Chromium
  created a task, preserved it across an initial Planner failure, retried with the same attempt
  identity, refreshed the conversation, confirmed the exact Plan, and retained existing delivery
  behavior.
- The same Node.js 24 executable with `--test --test-name-pattern="composes the configured production
  Runtime" test/unit/local-cli.test.js` exited `0` in 0.5 seconds and proved `serve` receives the
  configured production Runtime. An earlier whole-file development invocation timed out after
  124 seconds because its local Proxy fixture accidentally presented a thenable; the fixture was
  corrected, and the selected test plus final repository gate passed.
- With the bundled Node.js directory prepended to `PATH`, `npm run check:harness` exited `0` in 0.9
  seconds and accepted three eager Harness files and 39 WorkItems.
- With the same Node.js 24.14.0 environment, `npm run check` exited `0` in 461.9 seconds. It passed
  the Harness check, 97 unit tests, 118 integration tests, eight acceptance tests, and the Chromium
  console path. A first launcher invocation used an insufficient five-second tool window and
  returned `124` without a usable test result; the complete invocation above is authoritative.
- `git diff --check` exited `0` over the complete branch-base-to-working-tree diff before the final
  evidence projection. The final Harness and diff checks are repeated after this status update.

Real Provider and GitHub gates remain intentionally unverified: the slice changes deterministic
Planner context, local transport, and UI behavior but not the Codex adapter or external delivery
semantics.

## Project Memory Impact

On completion, the landed SPEC and architecture will extend the local console to task intake and
planning while preserving the light Core, shared-operation, bounded-context, and loopback security
boundaries. Detailed conversation, logs, and provider data remain outside eager project memory.
