---
artifact_type: development_work_item
id: WI-0047
status: done
title: Task-scoped Agent Sessions and exact integration grants
source: User accepted Proposal 0033 and explicitly requested implementation on 2026-08-17
confirmed_by: user
confirmed_at: 2026-08-17
standing_policy:
design_proposal: docs/proposals/0033-task-scoped-agent-sessions-and-exact-integration-action-grants.md
---

# WI-0047: Task-Scoped Agent Sessions And Exact Integration Grants

## Objective

Implement the accepted Decision 0035 vertical slice from exact Bundle acceptance through a
task-scoped AgentSession, one human ActionGrant, independently observed exact Git publication or
fast-forward integration, and truthful terminal completion with or without managed integration.

## Context

- WI-0046 produced an accepted exact Bundle that could not become terminal because its GitLab-backed
  Repository had no supported Delivery binding.
- Decision 0035 keeps ChangeSet and TaskWorkspace authoritative, adds logical AgentSession and
  integration Run records, and permits only exact closed ActionGrant actions with independent
  result observation.
- The landed GitHub pull-request path remains unchanged.

## Scope

- Add normalized persisted AgentSession, ActionGrant, integration Run, integration evidence, and
  integration disposition contracts.
- Compile exact post-acceptance action envelopes and require one immutable human grant.
- Dispatch granted exact Git actions through the configured Runtime boundary.
- Support non-force exact Candidate publication and exact base-to-Candidate target fast-forward.
- Revalidate workspace, Bundle, Candidate, destination, permission, attempts, and expiry before
  dispatch and result admission.
- Independently observe remote refs and preserve success, divergence, interruption, retry, and
  partial multi-Repository facts.
- Support complete_without_managed_integration with terminal reason
  accepted_without_managed_integration.
- Add the minimum shared-operation, CLI/HTTP, task projection, audit, and existing-console exposure.
- Update SPEC, architecture, current-state, Decisions, and repository tests.

## Non-Goals

- No Candidate lanes, Agent graph, multi-writer scheduling, generic external-write tool, or
  Provider-native session continuation requirement.
- No GitLab merge-request adapter, merge commit, squash, rebase, force push, automatic merge,
  deployment, cleanup, rollback engine, remote worker, or hosted service.
- No new console page, timeline redesign, audit dashboard, pricing view, or Harness-overlay feature.
- No real GitHub or GitLab write without a separate exact external-write authorization.

## Acceptance Criteria

- One ChangeSet owns task-scoped logical AgentSessions without adding another task lifecycle.
- Every integration Run binds a current exact human ActionGrant and stops closed when any subject
  changes.
- Agent output alone cannot satisfy integration; independent Git observation binds the result.
- Exact publication and exact fast-forward are non-force, idempotent or recoverable, destination
  serialized, and fully evidenced.
- An accepted Bundle can reach terminal(done) without integration only through the explicit exact
  human disposition and preserves all unintegrated Candidate identities.
- Existing GitHub delivery, review, recovery, audit isolation, and six-state task projection remain
  valid.
- No excluded console, audit, overlay, generic Agent, or automatic integration feature lands.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Focused Node.js 24 unit tests | domain normalization, lifecycle, action envelopes, views | Required | Direct contract coverage during implementation |
| Focused Node.js 24 integration tests | store/restart, Runtime dispatch, exact Git observation, HTTP | Required | Covers every changed durable and mutation boundary |
| `npm run test:ui` | minimum existing-console grant and completion path | Required | The accepted slice changes an operator path |
| `npm run check` under Node.js 24 | shared schema, lifecycle, Runtime, Git, adapters, acceptance, UI | Required once | The final diff crosses several validation tiers |
| `npm run check:harness` and `git diff --check` | authority and patch hygiene | Required | Repository handoff contract |
| Real Provider and remote write | external paid or destructive interaction | Excluded | Requires separate exact repository, ref, credential, write, and cleanup authority |

## Current Projection

- Current subject: implementation landed on branch `main`, based on `f6cdbb7`.
- Last verified state: the landed implementation persists task-scoped AgentSessions, exact
  offers and ActionGrants, integration Runs/results/dispositions, and independently observed Git
  outcomes; the existing GitHub path remains green.
- Next step: separately authorize one exact real-remote non-target publication gate, or decide the
  remaining multi-Project Repository ownership question.
- Active blocker or decision: none.

## Implementation Evidence

- `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
  --test test/unit/agent-session.test.js test/unit/integration.test.js
  test/unit/runtime-context.test.js test/unit/runtime-evidence.test.js
  test/unit/operator-application.test.js` — exit `0`; 19 focused domain, Runtime schema/context, and
  shared-operation tests passed.
- `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
  --test test/integration/integration-action-flow.test.js
  test/integration/integration-git-adapter.test.js` — exit `0`; six focused real-Git fixture tests
  passed for exact publication, exact fast-forward, destination movement, independent observation,
  controller-loss recovery, and workspace-mutation failure closure.
- `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
  scripts/run-ui-tests.mjs` — exit `0`; the Chromium console displayed the exact action, captured a
  human grant, executed the background integration Run, projected the independently observed SHA,
  and retained the existing GitHub merge-refresh path.
- `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
  scripts/run-checks.mjs` — exit `0`; this is the Node.js 24 entrypoint behind `npm run check` and
  passed the Harness check, 119 unit tests, 126 integration tests, eight acceptance tests, and the
  Chromium UI test.
- `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
  scripts/check-harness.mjs` and `git diff --check` — exit `0`; repository Harness and patch hygiene
  passed before final WorkItem evidence maintenance and are rerun at handoff.
- Unverified boundary: no real GitHub, GitLab, or other external remote write ran. All exact Git
  mutation evidence uses temporary local bare remotes; credentials, real refs, and cleanup remain a
  separately authorized gate.

## Project Memory Impact

Current-state records the completed implementation as landed baseline. The next evidence-driven
task is a separately authorized real-remote non-target publication gate; otherwise the remaining
product decision is multi-Project Repository ownership.
