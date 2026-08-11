---
artifact_type: development_work_item
id: WI-0001
status: done
title: Implement the deterministic local variable-repository vertical slice
source: "User request: 正式接受 Proposal 0001 当前版本，更新权威状态并创建唯一的 todo Development WorkItem"
confirmed_by: user
confirmed_at: 2026-07-30
completed_by: user
completed_at: 2026-07-30
standing_policy:
design_proposal: docs/proposals/0001-local-two-repository-vertical-slice.md
accepted_decision: docs/decisions/0006-first-vertical-slice-implementation-boundary.md
revised_by_decision: docs/decisions/0007-variable-scope-and-localized-diagnostics.md
---

# WI-0001: Implement The Deterministic Local Variable-Repository Vertical Slice

## Objective

Implement one restart-safe local ChangeFleet flow that turns a confirmed ChangeIntent into one
exact, human-decidable CandidateBundle spanning the current authorized non-empty Repository subset.

## Context

[Proposal 0001](../proposals/0001-local-two-repository-vertical-slice.md) and
[Decision 0006](../decisions/0006-first-vertical-slice-implementation-boundary.md) define the
accepted slice and technical boundary. [Decision 0005](../decisions/0005-runtime-context-harness-and-capabilities.md)
defines the fake Runtime context and capability proof required in this slice.

Implementation begins from a documentation-only repository. Conductor commit
`66faac3b16df8b287bae100ec5be82b79d32b872` is reference evidence for selected persistence, lock,
worktree, and Candidate behaviors, not a source dependency or compatibility contract.

## Scope

- Create one private Node.js 24 ESM JavaScript package with the accepted source and test layout.
- Implement the minimum Project, Repository, ChangeSet, revision, WorkUnit, Run reference,
  Candidate, CandidateBundle, evidence, and caller-idempotent human decision state.
- Implement the versioned filesystem store, atomic writes, ownership locks, bounded Run evidence,
  restart reconciliation, and duplicate-dispatch prevention.
- Implement explicit local Git registration and a clean RepositoryWorker adapter for isolated
  worktrees, exact-base publication, Candidate preflight, and safe ownership recovery.
- Implement one two-node dependency DAG, explicit multi-repository plan confirmation, repository
  checks, the combined-validation manifest contract, deterministic Bundle hashing, and Bundle
  decision commands.
- Implement the deterministic planning and execution Runtime fake with Control Contract, current
  projections, scoped capabilities, disabled Runtime Kit, and honest initial context evidence.
- Generalize Project registration and a ChangePlan from exactly two Repositories/WorkUnits to one
  or more explicitly registered Repositories and an explicitly authorized non-empty Project subset.
- Add ChangeFleet-owned localized diagnostics with stable error codes, `zh-CN` default, `en`
  fallback, and Simplified Chinese intent comments in all materially modified production source.

## Non-Goals

- Public CLI, HTTP API, browser UI, Git URL cloning, PR creation, merge, deployment, or rollback
  automation.
- Real Provider adapters, Runtime Skill Kit packaging, Linear or another tracker integration, or
  continuous context enforcement.
- SQLite, remote workers, hosted multi-tenancy, service-graph authority, stacked ChangeSets, more
  than two repositories in the acceptance fixture, or shared Conductor packages.

## Acceptance Criteria

- All 18 criteria in accepted Proposal 0001 are satisfied by observable tests.
- One serial acceptance flow registers two real local Git repositories, confirms one plan, executes
  both WorkUnits, validates exact Candidates, runs the manifest-driven combined check, assembles one
  deterministic CandidateBundle, records one caller-idempotent human decision, and reloads the same
  current state after restart.
- An interrupted Run and persisted dispatch ownership recover without duplicate execution.
- Dirty registered checkouts never leak uncommitted content into the frozen base or WorkUnit
  workspace.
- Partial failure, changed Candidate workspace, wrong SHA, missing evidence, unconfirmed plan, and
  unauthorized third-repository scope all prevent a complete actionable Bundle.
- Production source has no runtime dependency on Conductor modules, schemas, or workspace names.

## Validation

| Command or gate | Scope | Required |
| --- | --- | --- |
| `npm test` | Pure domain and application behavior | Yes |
| `npm run test:integration` | Filesystem, locks, recovery, Git workspaces, and Candidate identity | Yes |
| `npm run test:acceptance` | Serial real two-repository end-to-end flow | Yes |
| `npm run check` | Complete accepted suite on Node.js 24 | Yes |
| Targeted content and dependency inspection | Deferred capabilities and Conductor imports remain absent | Yes |

For every command, record the exact underlying invocation, exit code, concise observation, and
unverified boundary. Do not report a command until the package manifest actually defines it.

## Current Projection

- Current subject: user-accepted complete implementation for Decisions 0005 through 0007,
  still uncommitted and unlanded.
- Last verified state: Node.js `v24.18.1` passed 23 tests: 12 unit, 9 integration, and 2 serial
  acceptance flows covering both one-Repository and two-Repository subjects.
- Next step: land the exact accepted local changes in Git without extending implementation scope.
- Active blocker or decision: no implementation blocker; completion was accepted by the user on
  2026-07-30 but has not been committed or landed.

Replace this projection as work advances. Do not append one entry per Agent turn.

## Implementation Evidence

Implementation was authorized and started by the user's 2026-07-30 request, `启动 WI-0001`.

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `npm test` | 1 | Initial unit run: 7 passed and 1 failed only because `0.30000000000000004` was compared exactly with `0.3`; assertion corrected to an epsilon comparison | Superseded by passing unit and full-suite runs |
| `npm test` | 0 | Final unit scope: 8 passed; normalization, DAGs, exact hashes, required evidence, caller fingerprints, context classification, and 70-percent admission | Runtime behavior remains deterministic fake only |
| `npm run test:integration` | 0 | Final integration scope: 9 passed; filesystem state, locks, bounded evidence, real Git, failure paths, replanning, and restart recovery | Remote workers and Git URLs are deferred |
| `npm run test:acceptance` | 0 | One serial real two-repository flow passed through exact Bundle decision and restart | No real Provider, CLI, UI, delivery, or tracker |
| `npm run check` | 0 | Package command contract passed all 18 tests under the host Node.js `v22.19.0` as a compatibility observation | Accepted engine is Node.js 24 |
| `npx -y -p node@24 -p npm@11 -c "node --version"` | 0 | Resolved accepted runtime `v24.18.1` | Runtime supplied ephemerally by npm |
| `npx -y -p node@24 -p npm@11 -c "npm run check"` | 0 | Accepted Node.js 24 gate passed all 18 tests | Production Provider conformance is deferred |
| `npm ls --omit=dev --depth=0` | 0 | Production dependency tree is empty | npm itself is development tooling |
| PowerShell `rg` forbidden-production-dependency audit over `src` and `package.json` | 0 | Zero Conductor, `node:sqlite`, Linear, Codex, Claude, Express, or Fastify matches | This is content inspection, not runtime sandbox proof |
| `npm test` | 0 | Revised unit scope: 12 passed; variable Repository scope, stable localized diagnostics, exact identities, DAGs, idempotency, and context admission | Real Provider behavior remains deferred |
| `npm run test:integration` | 0 | Revised integration scope: 9 passed; filesystem, locks, recovery, Git workspaces, failure paths, and exact Candidate identity | Remote workers and Git URLs remain deferred |
| `npm run test:acceptance` | 0 | Two serial real-Git flows passed: one-Repository Project/ChangeSet and exact two-Repository Bundle through restart | No real Provider, delivery, CLI, UI, or tracker |
| `npx -y -p node@24 -p npm@11 -c "node --version; npm run check"` | 1 | Invocation did not enter tests because `npx -c` passed the semicolon as part of the Node option | Superseded by two correctly separated Node 24 commands |
| `npx -y -p node@24 -p npm@11 -c "node --version"` | 0 | Resolved accepted runtime `v24.18.1` | Runtime supplied ephemerally by npm |
| `npx -y -p node@24 -p npm@11 -c "npm run check"` | 0 | Final exact-source gate passed all 23 tests after Chinese intent comments were added to every production module | Production Provider conformance and audit telemetry remain deferred |
| `npm ls --omit=dev --depth=0` | 0 | Production dependency tree remains empty | npm itself is development tooling |
| `git diff --check` plus targeted `rg` audits | 0 | No whitespace errors; all 15 production modules contain Chinese intent comments; zero deferred/forbidden production dependency matches | Comment quality remains a human review concern |

## Project Memory Impact

Proposal 0001 plus accepted Decision 0007 now have a user-accepted complete local implementation.
`docs/current-state.md` routes the next task to landing while keeping the canonical/released
baseline distinct from these uncommitted changes. Proposal 0005 remains proposed and staged by
data prerequisite; no Provider telemetry or fake audit evidence was added to WI-0001.
