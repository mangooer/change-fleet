---
artifact_type: development_work_item
id: WI-0008
status: done
title: Implement exact GitHub pull-request delivery
source: 'User request: "接受 Proposal 0013。然后实现"'
confirmed_by: user
confirmed_at: 2026-08-03
started_by: user
started_at: 2026-08-03
review_ready_at: 2026-08-03
completed_by: user
completed_at: 2026-08-03
standing_policy:
design_proposal: docs/proposals/0013-exact-github-pull-request-delivery.md
accepted_decisions:
  - docs/decisions/0015-exact-github-pull-request-delivery.md
---

# WI-0008: Implement Exact GitHub Pull-Request Delivery

## Objective

Implement the sole GitHub-first delivery vertical slice accepted by Proposal 0013: bind registered
Repositories explicitly to GitHub destinations, publish exact accepted Candidates through
deterministic non-force branches and idempotent pull requests, reconcile human merge outcomes, and
derive multi-Repository completion through shared application and experimental CLI operations.

## Scope

- Add a human-confirmed revisioned GitHub delivery binding with no persisted credentials.
- Add bounded durable delivery requests, immutable observation references, exact result identity,
  per-Repository states, and restart reconciliation.
- Add target-sensitive destination locking and exact target/head movement checks.
- Push one exact Candidate SHA through ordinary Git without force.
- Add one narrow authenticated `gh` pull-request adapter with structured arguments and bounded JSON
  normalization.
- Add configure, publish, read, and refresh application operations to the explicit operator
  allowlist and experimental CLI.
- Derive bounded delivery facts without admitting them to Runtime context.
- Cover idempotency, restart ambiguity, single- and multi-Repository delivery, partial merge,
  target movement, head divergence, closed PR, and typed provider failure.
- Add Simplified Chinese intent comments to every new production module and non-obvious changed
  boundary.
- Keep deterministic GitHub fixtures under test support only; remove every temporary executable or
  production fake before review.

## Non-Goals

- GitLab, a generic source-control provider framework, or remotely materialized repositories.
- Automatic merge, merge queue, source-branch deletion, deployment, rollback, or compensation
  execution.
- GitHub App, OAuth, stored token, webhook, daemon, background poller, or hosted multi-tenancy.
- Browser or desktop UI, HTTP API, App Server, generated client, or stable CLI compatibility.
- PR comments, issue synchronization, Linear projection, or Agent-controlled external delivery.
- Real GitHub external writes without separately confirmed repository and cleanup authority.

## Acceptance Criteria

- Only an accepted current Bundle can be published through an explicit operator request and
  confirmed GitHub binding.
- One stable request binds exact Bundle, Repository, Candidate, target, binding, branch, and PR
  identities and survives restart without duplicate external creation.
- Target movement and PR-head divergence fail closed without force push or silent evidence reuse.
- Merge, squash, and rebase preserve distinct Candidate and external result SHAs.
- Closed-unmerged, transient failure, partial merge, and external divergence remain distinct.
- ChangeSet reaches `done` only when every selected exact Candidate has a matching merged result.
- GitHub credentials and payload bodies remain outside aggregate state, artifacts exposed by
  default, command output, fixtures, and Runtime context.
- CLI routes delegate unchanged requests to shared application operations; Git and `gh` helpers are
  not operator commands.
- No deferred merge, UI, service, webhook, provider framework, or production fake enters the diff.

## Validation Selection

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Delivery domain/application unit tests | identity, state, authorization, idempotency, exact-subject rules | Required | Direct pure and shared-operation coverage |
| Deterministic GitHub adapter fixture | safe argv, bounded JSON, typed process/provider failure | Required | Repeatable provider coverage without external writes |
| Real-Git integration tests | fetch, exact-SHA push, non-force conflict, target movement, destination lock | Required | Delivery mutates Git refs and crosses the Git boundary |
| Store/restart integration tests | durable request, ambiguous external write recovery, no duplicate PR | Required | The slice adds persisted recovery semantics |
| Single-Repository acceptance | accepted Bundle to open PR, merged refresh, and `done` | Required | Proves the complete first product path |
| Multi-Repository acceptance | independent PRs, partial merge, retry, aggregate completion | Required | Preserves ChangeFleet's defining Bundle boundary |
| Existing deterministic `npm run check` | all unit, integration, and acceptance suites | Required | Final diff crosses model, store, Git, application, CLI, and acceptance tiers |
| Real GitHub external write | actual branch and PR | Excluded unless separately authorized | Current request authorizes implementation, not external GitHub mutation |
| Real Codex Provider | Provider execution and cost | Excluded | Delivery does not change Runtime invocation |
| Documentation and boundary audit | links, eager sizes, comments, fakes, commands, deferred surfaces | Required | Maintains Harness and executable policies |

Every changed test file must execute. Final selection will be reassessed against the stable diff.

## Current Projection

- Current subject: WI-0008 is accepted and lands as the exact GitHub pull-request delivery slice.
- Last verified state: the final Node.js 24 full check passed 47 unit, 42 integration, and 6
  acceptance tests, including the exact GitHub delivery slice.
- Next step: discuss a separate Proposal for the smallest local UI and transport boundary.
- Active blocker or decision: real GitHub validation remains excluded without explicit external
  write and cleanup authority; no blocker remains for deterministic review.

## Implementation Evidence

### Delivered subject

- Added schema v4 delivery bindings and bounded, restart-safe `DeliveryRequest` persistence with
  deterministic request and branch identities.
- Added exact-SHA non-force Git publication, target and remote checks, destination locking, and
  credential-safe Git failure normalization.
- Added one narrow host-authenticated `gh` pull-request adapter, ambiguous-create recovery, bounded
  observations, exact Candidate/head checks, and human-merge reconciliation.
- Added shared configure, publish, read, and refresh application operations plus experimental CLI
  routes; no merge operation, provider framework, HTTP service, or UI was added.
- Added bounded read-only delivery audit facts while keeping delivery state and GitHub payloads out
  of Runtime invocations.
- Added deterministic test-only GitHub support and real local-Git coverage; no production fake or
  temporary executable was added.

### Executed validation

| Exact command | Exit | Scope and concise observation | Unverified boundary |
| --- | ---: | --- | --- |
| `node --test test/unit/github-delivery.test.js test/unit/gh-pull-request-adapter.test.js test/unit/operator-application.test.js test/unit/local-cli.test.js test/unit/diagnostics.test.js` | 0 | 22 focused unit tests passed. | External GitHub behavior. |
| `node --test test/integration/delivery-git-adapter.test.js test/integration/control-store-v4-migration.test.js` | 0 | 3 focused real-Git/store tests passed. | GitHub API and hosted branch policies. |
| `node --test --test-concurrency=1 test/acceptance/github-delivery-flow.test.js` | 0 | The initial 3 delivery acceptance tests passed in about 104.3 seconds; the later final full check supersedes this result for the final file revision. | Real GitHub writes. |
| `npm test` | 0 | The then-current 47-test unit suite passed. | Integration and acceptance tiers. |
| `node --test test/integration/control-store-v4-migration.test.js test/integration/delivery-git-adapter.test.js test/integration/filesystem-store.test.js test/integration/local-cli.test.js test/integration/restart-recovery.test.js test/integration/runtime-audit-query.test.js` | 0 | 18 selected integration tests passed in about 49.2 seconds. | Remaining tiers; covered later by the full check. |
| `node --version; npm run check` | 1 | Environment guard stopped before all suites: PATH resolved Node.js `22.19.0`, while the repository requires Node.js 24. | Product behavior was not exercised. |
| `$env:PATH="C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"; $taskOutput = & npm run check 2>&1` | 1 | PowerShell's system `npm.ps1` wrapper truncated the captured command to `pm`; no suite ran. | Product behavior was not exercised. |
| `& "C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "C:\myData\nodejs\node_modules\npm\bin\npm-cli.js" run check` | 1 | npm used Node.js 24, but its package-script child still resolved bare `node` to 22.19.0; the version guard stopped before suites. | Product behavior was not exercised. |
| `$env:PATH="C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"; & "C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "C:\myData\nodejs\node_modules\npm\bin\npm-cli.js" run check` | 0 | The production revision and then-current tests passed 47 unit, 42 integration, and 6 acceptance tests; outer wall time was 330.7 seconds. | Real GitHub external writes and real Codex Provider execution were intentionally excluded. |
| `& 'C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-concurrency=1 test/acceptance/github-delivery-flow.test.js` | 0 | After adding the plaintext-PR-body exclusion assertion, all 3 affected delivery acceptance tests passed in 103.9 seconds. | Real GitHub writes. |

### Final documentation and boundary audit

| Exact command or gate | Exit | Concise observation | Unverified boundary |
| --- | ---: | --- | --- |
| `git diff --check` | 0 | No whitespace errors. | Semantic correctness is covered by the tests and review, not this check. |
| Strict PowerShell relative-link audit over changed Markdown from `git status --porcelain`, with `$ErrorActionPreference='Stop'` and root-level parent normalized to `.` | 0 | Checked 74 relative links across 13 changed Markdown files; none were missing. | External links were not live-probed during implementation. |
| PowerShell byte-limit audit for `AGENTS.md`, `WORKFLOW.md`, and `docs/current-state.md` | 0 | Sizes were 5,781/6,144, 1,264/2,048, and 7,910/8,192 bytes respectively. | Byte limits do not prove a provider token ratio. |
| `rg -n -i "fake|mock|fixture|temporary|todo|fixme" src/adapters/git/delivery-git-adapter.js src/adapters/github src/application/github-delivery-service.js src/domain/github-delivery.js bin scripts package.json` | 1 | No production scaffold marker matched; exit 1 is ripgrep's expected no-match result. | Maintained test support intentionally contains a scripted GitHub fixture. |
| Chinese-line audit over the four new production modules | 0 | Each module contains Chinese intent or non-obvious-boundary comments; counts were 2, 3, 2, and 3 lines. | Review still decides whether any individual line needs more explanation. |

An earlier relative-link audit returned exit 0 while emitting non-terminating `Join-Path` errors for
root-level Markdown. It was rejected as evidence; the strict corrected audit above is authoritative.
Manual secret-boundary inspection confirmed that Git and `gh` error bodies become only digest and
byte-count facts before persistence. The acceptance rerun also proves a unique PR-body sentinel is
absent from persisted ChangeSet state, returned delivery projection, and Runtime context.

## Acceptance Review

Accepted by the user on 2026-08-03 with the request to update authoritative state and commit the
complete WI-0008 implementation. Real GitHub validation remains a separately authorized external
write gate.

## Project Memory Impact

WI-0008 is accepted and landed with private schema v4, deterministic exact-Candidate GitHub
pull-request publication, human-controlled merge reconciliation, shared delivery operations, and
bounded delivery audit. Real GitHub writes, automatic merge, service transport, and UI remain
outside this WorkItem.
