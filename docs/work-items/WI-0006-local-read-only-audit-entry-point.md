---
artifact_type: development_work_item
id: WI-0006
status: done
title: Implement local read-only audit entry point
source: 'User request: "接受 Proposal 0011，并实现"'
confirmed_by: user
confirmed_at: 2026-08-03
started_by: user
started_at: 2026-08-03
completed_by: user
completed_at: 2026-08-03
standing_policy:
design_proposal: docs/proposals/0011-local-read-only-audit-entry-point.md
accepted_decisions:
  - docs/decisions/0012-read-only-runtime-audit-projections.md
  - docs/decisions/0013-local-read-only-audit-entry-point.md
---

# WI-0006: Implement Local Read-Only Audit Entry Point

## Objective

Implement the sole operator slice accepted by Proposal 0011: inspect one exact Run or ChangeSet
from one explicit local control root through a package-private JSON command without initializing,
mutating, discovering, or feeding audit output into Agent context.

## Context

[Decision 0012](../decisions/0012-read-only-runtime-audit-projections.md) owns the immutable-source
projection semantics. [Decision 0013](../decisions/0013-local-read-only-audit-entry-point.md) owns
the narrow local process boundary and its explicit non-goals. WI-0005 already implemented and
verified the query service, including one paid real-Provider source-to-projection gate.

## Scope

- Add one dependency-free package-private Node.js entry point with only `run` and `changeset`
  subcommands.
- Require an explicit control root and exact subject id; support only locale and bounded ChangeSet
  pagination options.
- Serialize the existing projection as the sole stdout JSON document and emit one typed localized
  error JSON document on stderr.
- Distinguish success, invalid invocation, and query or local-read failure through accepted exit
  statuses.
- Construct filesystem stores without initialization and pass only bound reader capabilities to
  `RuntimeAuditQueryService`.
- Prove zero writes for successful, missing, malformed, and invalid invocations, including that a
  missing control root remains absent.
- Add Simplified Chinese intent comments to every added production module or non-obvious boundary.
- Document concise local usage without presenting the package as released.

## Non-Goals

- Public CLI compatibility, a generic command framework, API, server, UI, or dashboard.
- Subject discovery, listing, wildcards, portfolio scans, saved reports, or scheduled exports.
- Lifecycle commands, Agent execution, Git, workspace, registered Repository, or delivery access.
- Comparison, pricing, quality scores, budgets, automatic optimization, or Linear.
- Provider changes, another paid Provider run, new projection fields, or persisted audit rollups.
- Production mocks, fake stores, fake evidence sources, or compatibility shims.

## Acceptance Criteria

- `run` and `changeset` return exactly one existing versioned projection JSON document for one
  explicit control root and exact id.
- Stable typed JSON diagnostics are written only to stderr and honor `zh-CN` or `en` presentation.
- Exit status is `0` for success, `2` for invalid invocation, and `1` for query or local-read
  failure.
- Unknown or duplicate flags, unsupported locales, invalid ids, and invalid page values fail before
  source reads.
- The command never calls store initialization or the lifecycle service and never receives write,
  Runtime, scheduler, RepositoryWorker, Git, workspace, or Repository capabilities.
- Missing roots are not created; representative success and failure leave an existing control root
  byte-identical.
- Pagination remains bounded to 100 rows and direct-query and command payload digests agree.
- Audit output remains absent from ordinary Runtime context and existing package checks do not
  regress.
- No production fake or speculative CLI abstraction remains after review.

## Validation

| Command or gate | Scope | Required |
| --- | --- | --- |
| `npm test` | Argument grammar, ids, locale, pagination, diagnostics | Yes |
| `npm run test:integration` | Child process, real filesystem readers, stdout/stderr/status, zero writes | Yes |
| `npm run test:acceptance` | Existing lifecycle and Candidate regression | Yes |
| `npm run check` under Node.js 24 | Complete deterministic package gate | Yes |
| `git diff --check` and targeted boundary audit | Links, eager sizes, dependencies, writes, context, fakes, Chinese comments | Yes |

The paid real Codex gate is not required because this WorkItem changes neither Provider execution
nor evidence capture and WI-0005 already verified the unchanged query service against real
evidence.

## Current Projection

- Current subject: WI-0006 is accepted as complete and landed; Git owns the implementation.
- Last verified state: Node.js 24 `npm run check` passes with 35 unit, 35 integration, and two
  serial acceptance tests; zero failures.
- Next step: no work remains inside WI-0006; later operator or analytics stages need new authority.
- Active blocker or decision: none.

## Implementation Evidence

Implementation was confirmed and started by the user's 2026-08-03 request: `接受 Proposal 0011，并实现`.

The active working tree implements:

- a dependency-free `changefleet-audit` process entry point with exact `run` and `changeset`
  grammar, explicit control-root selection, supported locale selection, and bounded pagination;
- reader-only composition over `ControlStore.readChangeSet`, `RunStore.read`, and
  `EvidenceStore.read`, without lifecycle service or store initialization;
- unchanged projection JSON on stdout and bounded typed localized JSON diagnostics on stderr;
- test-only deterministic fixtures for argument, success, missing-source, malformed-source,
  projection-equivalence, process-status, missing-root, and byte-identical zero-write coverage;
- concise private usage documentation and no public CLI or production fake path.

Validation evidence on 2026-08-03:

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/unit/local-audit-command.test.js test/unit/diagnostics.test.js` | 0 | Nine tests passed for grammar, ids, locale, page bounds, stdout isolation, and diagnostics | Filesystem and process behavior require integration coverage |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/integration/local-audit-command.test.js` | 1 | First run exposed a test-only mismatch: command locale `en` and direct-query locale `zh-CN` correctly produced different query digests | No product failure; comparison fixture needed matching query parameters |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/integration/local-audit-command.test.js` | 0 | Three tests passed for both subjects, direct projection equivalence, stdout/stderr/status, absent and malformed roots, zero writes, and forbidden dependencies | Uses deterministic test Runtime evidence |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe C:\myData\nodejs\node_modules\npm\bin\npm-cli.js run check` | 124 | Outer command timed out before a verdict; its inherited PATH selected Node.js 22 and the closed output pipe caused `EPIPE` | Not a product test result and not counted as pass or failure |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/unit/local-audit-command.test.js` | 1 | A test-only assertion incorrectly expected `assert.throws` to return the captured error | No product failure; the assertion callback needed to inspect the error |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/unit/local-audit-command.test.js` | 0 | Four tests passed after adding bounded caller-controlled diagnostic details | Filesystem behavior remains covered by integration tests |
| `$runtimeNodeRoot = 'C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'; $env:PATH = "$runtimeNodeRoot;$env:PATH"; & "$runtimeNodeRoot\node.exe" 'C:\myData\nodejs\node_modules\npm\bin\npm-cli.js' run check` | 0 | Final Node.js 24 gate passed: 35 unit, 35 integration, and two serial acceptance tests; zero failures | Real Provider remains intentionally unexecuted |
| `git diff --check` plus untracked-file whitespace, changed-link, eager-size, production-fake, command-dependency, and Chinese-comment audits | 0 | No whitespace or broken authority link was found; eager files remain below alarms; the command has no production fake or forbidden dependency and its intent comments are Chinese | Static inspection cannot prove behavior outside the tested local filesystem boundary |

Review follow-up validation for the explicitly requested Node.js fail-fast maintenance:

| Command | Expected exit | Observation |
| --- | ---: | --- |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/unit/node-version-guard.test.js` | 0 | Two tests passed for supported, older, newer, malformed, and package-engine alignment cases |
| `C:\myData\nodejs\node.exe scripts/run-checks.mjs` | 1 | Node.js 22.19.0 returned `UNSUPPORTED_NODE_VERSION` in 45 ms before test dispatch |
| `$node22Root = 'C:\myData\nodejs'; $env:PATH = "$node22Root;$env:PATH"; & "$node22Root\node.exe" "$node22Root\node_modules\npm\bin\npm-cli.js" run check` | 1 | The actual npm wrapper returned the same diagnostic in 266 ms before test dispatch |

The real Provider gate was not run. WI-0006 changes neither Provider behavior nor evidence capture,
and Decision 0013 explicitly excludes repeating that paid verification.

## Project Memory Impact

WI-0006 is accepted and landed with one package-private local audit entry point over WI-0005.
Public CLI compatibility, discovery, comparison, pricing, dashboards, Linear, and remote access
remain deferred; Git owns the exact implementation history.
