---
artifact_type: development_work_item
id: WI-0005
status: done
title: Implement read-only Runtime audit projections
source: "User request: continue the next recommended step after accepting Proposal 0010."
confirmed_by: user
confirmed_at: 2026-08-03
started_by: user
started_at: 2026-08-03
completed_by: user
completed_at: 2026-08-03
standing_policy:
design_proposal: docs/proposals/0010-read-only-runtime-audit-projections.md
accepted_decisions:
  - docs/decisions/0009-runtime-observability-evidence-boundary.md
  - docs/decisions/0012-read-only-runtime-audit-projections.md
---

# WI-0005: Implement Read-Only Runtime Audit Projections

## Objective

Implement the sole read-only audit vertical slice accepted by Proposal 0010: derive deterministic,
bounded Run and ChangeSet audit projections from existing immutable evidence without adding a
second authority, mutating repository or control state, or feeding audit history into Agent
context.

## Context

[Decision 0009](../decisions/0009-runtime-observability-evidence-boundary.md) owns immutable
Runtime invocation and usage evidence. [Decision
0012](../decisions/0012-read-only-runtime-audit-projections.md) owns canonical usage semantics,
outcome and clock separation, query isolation, report identity, and deferred comparison.

WI-0003 and WI-0004 already persist the first real Codex usage, context, Agent Profile, and Harness
identities. This WorkItem interprets that evidence through the existing private filesystem stores;
it does not add another Provider or analytics infrastructure.

## Scope

- Add versioned `RunAuditProjection` and `ChangeSetAuditProjection` contracts with exact source,
  query, payload, deterministic digest, and observation-time fields.
- Add a separate `RuntimeAuditQueryService` that depends only on read interfaces for existing
  Control, Run, Evidence, Bundle, and human-decision records.
- Select canonical usage conservatively, record the chosen observation and reason, preserve null
  and aggregate-only coverage, and return `ambiguous_observation_overlap` instead of guessing.
- Derive complete-set ChangeSet totals while paginating at most 100 detailed Run rows in stable
  order and referencing rather than embedding large artifacts.
- Keep Provider/Run work duration, validation duration, ChangeSet wall time, and human-gate time
  distinct; keep Runtime, planning, WorkUnit, validation, Bundle, review, and delivery outcomes
  distinct.
- Fail closed with stable localized diagnostics for broken required references, malformed evidence,
  identity mismatches, and invalid query bounds; keep unsupported optional observations explicit.
- Prove restart reproduction, zero persisted report state, zero control or repository mutation, and
  complete exclusion from ordinary planning and execution context.
- Add Simplified Chinese intent comments to every added or materially changed production boundary.
- Keep fixtures under test support and remove temporary production fake or compatibility paths
  before review.

## Non-Goals

- Cross-ChangeSet cohort comparison, ranking, recommendation, causal analysis, or portfolio scans.
- Pricing, monetary normalization, billing, chargeback, quota, budget, or automatic cancellation.
- Dashboard, UI, public API, CLI, scheduled report, exporter, telemetry backend, or database index.
- Persisted counters, materialized rollups, report artifacts, or lifecycle and recovery mutations.
- Feeding audit history into Agent context or automatically choosing a Profile, model, Harness, or
  route.
- Per-step token accounting when the Provider exposes only aggregate observations.
- Another Provider, Runtime Kit, App Server, Linear, delivery, remote workers, or hosted tenancy.

## Acceptance Criteria

- One exact Run query reproduces its immutable invocation identity, requested and observable
  Runtime settings, context and Harness identities, terminal outcome, clocks, raw usage rows, and
  canonical observed usage with a selection reason.
- One exact ChangeSet query reports complete referenced/observed/unknown Run counts, observed token
  totals, coverage and confidence breakdowns, distinct stage outcomes, and distinct clocks.
- Cached input and reasoning output subsets are not added twice; null is never converted to zero;
  overlapping observations produce an unknown canonical total.
- Aggregate-only Codex evidence remains Run-level and never creates invented per-step evidence.
- Equivalent source evidence and query parameters reproduce the same payload digest across restart;
  `generated_at` does not affect that digest.
- Detailed Run rows are stably ordered and limited to 100 per page while complete-set totals remain
  complete or identify why they are unknown.
- Broken required references or identity mismatches fail the affected query with a typed localized
  diagnostic rather than silently omitting unfavorable evidence.
- The query component has no Runtime, scheduler, `RepositoryWorker`, mutation-port, Git, or
  workspace dependency and writes no report or aggregate state.
- Audit fields remain absent from Control Contracts and ordinary planning and execution Context
  Projections.
- Existing lifecycle, Candidate, Harness, deterministic, acceptance, and real-Provider paths do not
  regress.
- No production fake evidence source, speculative analytics framework, comparison engine, or public
  query surface remains after review.

## Validation

| Command or gate | Scope | Required |
| --- | --- | --- |
| `npm test` | Canonical usage, nulls, clocks, outcomes, report identity, pagination, diagnostics | Yes |
| `npm run test:integration` | Store references, retries, failures, restart reproduction, zero writes, context exclusion | Yes |
| `npm run test:acceptance` | Existing one- and multi-Repository lifecycle and Candidate regressions | Yes |
| `npm run check` under Node.js 24 | Complete deterministic package gate | Yes |
| `npm run test:provider:codex` with `CHANGEFLEET_RUN_REAL_CODEX=1` | One final real Run/ChangeSet source-to-projection agreement | Yes; explicit paid authorization required before execution |
| `git diff --check` and targeted boundary audit | Links, eager sizes, dependencies, writes, context, fakes, Chinese comments | Yes |

The real Provider gate is one explicitly authorized final verification, remains outside
`npm run check`, and is not repeated automatically. A skipped or unauthorized paid gate is not a
pass.

## Current Projection

- Current subject: WI-0005 is accepted as complete and landed; Git owns the implementation.
- Last verified state: Node.js 24 `npm run check` and the explicitly authorized real Codex
  source-to-projection gate pass with zero failures.
- Next step: no work remains inside WI-0005; later analytics stages require separate authority.
- Active blocker or decision: none; all required implementation gates have executed and passed.

## Implementation Evidence

Implementation was started by the user's 2026-08-03 request, `启动`.

The active working tree implements:

- pure canonical usage selection with null preservation, overlap ambiguity, bounded raw rows, and a
  deterministic report digest that excludes `generated_at`;
- an isolated `RuntimeAuditQueryService` over existing Store read methods, with no Runtime,
  scheduler, RepositoryWorker, filesystem-write, Git, or lifecycle-command dependency;
- exact Run, Runtime evidence, CandidateBundle, repository-validation, combined-validation, and
  human-decision identity checks that fail closed on missing or altered required evidence;
- bounded Run and ChangeSet projections for profile, context, Harness, usage, clocks, lifecycle
  outcomes, validation, Bundle review, diagnostics, and artifact references;
- test-only coverage for success, cancellation, controller interruption, abandoned retry, restart
  reproduction, evidence tampering, pagination, zero writes, and context exclusion;
- the existing opt-in Codex gate extended to compare its raw Run observations with the derived Run
  and ChangeSet totals when explicit paid execution is authorized.

Validation evidence on 2026-08-03:

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/unit/runtime-audit.test.js test/unit/diagnostics.test.js` | 0 | Canonical selection, unknown and overlap semantics, 100-row bound, deterministic digest, malformed evidence, and localized diagnostics passed | Store and Git boundaries require integration coverage |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/integration/runtime-audit-query.test.js` | 0 | Four tests passed for isolation, exact evidence, totals, pagination, cancellation, abandoned retry, restart, tamper failure, zero writes, and context exclusion | Uses test-only Runtime evidence rather than a paid Provider |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe C:\myData\nodejs\node_modules\npm\bin\npm-cli.js run check` | 0 | Final Node.js 24 gate passed: 29 unit, 32 integration, and two serial acceptance tests; zero failures | Real Provider remains outside this deterministic command |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test --test-concurrency=1 "test/provider/**/*.test.js"` | 0 | Provider module loaded and the one real test was skipped because opt-in was absent | A skip is not the required real Provider pass |
| `CHANGEFLEET_RUN_REAL_CODEX=1 C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe C:\myData\nodejs\node_modules\npm\bin\npm-cli.js run test:provider:codex` | 0 | One real planning Run and one execution Run passed; raw observations and derived Run/ChangeSet totals agreed exactly | Effective model, price, request tree, and actual Harness-load events remain unavailable |
| `git diff --check` plus changed-link, eager-size, dependency, production-fake, write-path, context, and Chinese-comment audits | 0 | Formatting and accepted isolation boundaries pass; no production fake or write dependency was found | Static inspection does not prove Provider behavior |

Explicit real-Provider evidence on 2026-08-03:

The user explicitly authorized this one paid gate with: `允许设置
CHANGEFLEET_RUN_REAL_CODEX=1，为 WI-0005 执行一次真实 Provider 验证。` The environment opt-in was
set only for that command.

| Run | Provider duration | Input | Cached input | Output | Reasoning output | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Planning | 19,727 ms | 10,949 | 0 | 305 | 37 | 11,254 |
| Execution | 41,232 ms | 48,926 | 35,328 | 331 | 0 | 49,257 |
| Invocation sum | 60,959 ms | 59,875 | 35,328 | 636 | 37 | 60,511 |

The real test took 77,546 ms wall time. `ChangeSetAuditProjection` reported two observed Runs, zero
unknown Runs, `observed_total_tokens = 60,511`, and Provider duration sum `60,959 ms`, exactly
matching the immutable source observations. Cached input and reasoning output remained subsets and
were not added again. Monetary cost and effective model remain null because the Provider did not
report authoritative values.

## Project Memory Impact

Proposal 0010 is implemented by this accepted and landed WorkItem. Git owns the exact implementation
history; comparison and other analytics stages remain separately deferred.
