---
artifact_type: development_work_item
id: WI-0007
status: done
title: Implement shared application commands and unified local CLI
source: 'User request: "建并确认唯一的 WI-0007，并执行"'
confirmed_by: user
confirmed_at: 2026-08-03
started_by: user
started_at: 2026-08-03
review_ready_at: 2026-08-03
completed_by: user
completed_at: 2026-08-03
standing_policy:
design_proposal: docs/proposals/0012-shared-application-commands-and-unified-local-cli.md
accepted_decisions:
  - docs/decisions/0014-shared-application-commands-and-unified-local-cli.md
---

# WI-0007: Implement Shared Application Commands And Unified Local CLI

## Objective

Expose the currently accepted local Project and ChangeSet lifecycle through one experimental
`changefleet` executable that delegates to explicit typed application operations, migrate exact-id
audit beneath its debug namespace, and remove the obsolete standalone audit entry point without
creating a second lifecycle implementation.

## Context

[Proposal 0012](../proposals/0012-shared-application-commands-and-unified-local-cli.md) and
[Decision 0014](../decisions/0014-shared-application-commands-and-unified-local-cli.md) own the
shared-operation, command-maturity, and retirement boundaries. The existing application service,
Codex SDK Runtime, audit query service, filesystem stores, and deterministic lifecycle tests are
landed through WI-0001 through WI-0006.

## Scope

- Add one experimental `changefleet` root executable with the accepted Project, ChangeSet, and
  debug-audit command groups.
- Enforce an explicit allowlist over existing human/operator application operations; do not expose
  internal recovery, store, Runtime, Git, workspace, validation, or failure helpers.
- Load one explicit versioned, secret-free local configuration and structured mutation requests
  from a file or stdin.
- Use the real Codex SDK Runtime in installed lifecycle composition; retain scripted Runtime only in
  test support and never make it selectable through production configuration or environment.
- Preserve application input, caller idempotency, exact human-gate subjects, result objects, typed
  diagnostics, JSON stdout, and isolated stderr.
- Keep exact-id audit reader-only and migrate it to `changefleet debug audit run|changeset`.
- Remove the standalone audit executable, parser-only module, npm alias, obsolete invocation docs,
  and redundant tests after unified equivalents pass.
- Add Simplified Chinese intent comments to every new production module and non-obvious boundary.

## Non-Goals

- Stable or released CLI compatibility, a public package contract, shell completion, or formatted
  tables.
- API, App Server, daemon, UI, Linear, remote access, authentication service, or public service
  graph.
- New lifecycle transitions, store schema, recovery semantics, Runtime behavior, Agent capability,
  delivery, merge, or deployment.
- Portfolio or control-root discovery, listing, wildcards, ancestor scans, implicit registration,
  or ambient Harness copying.
- Raw transcript, diff, prompt, Harness, command-log, or Provider-reasoning output.
- Production fake Runtime, fake evidence source, generic command bus, CLI framework, or
  compatibility shim.
- Automatic inclusion of nondeterministic real Provider execution in the deterministic suite.

## Acceptance Criteria

- `changefleet` is the sole product executable and exposes only the accepted command allowlist.
- A caller can complete the current single-Repository lifecycle through CLI operations without
  importing application code.
- Complex mutations consume one structured request and delegate its unchanged logical fields to one
  existing application operation, including the caller idempotency key.
- Configuration is explicit and versioned, resolves control/workspace roots relative to its file,
  selects the accepted Codex Runtime and AgentProfile, and persists no secret or credential path.
- Success emits one bounded JSON result on stdout; invalid invocation and typed application failure
  remain machine-detectable on stderr with no stack or progress contamination.
- Debug audit retains exact-id, pagination, projection identity, missing-root, and zero-write
  behavior without lifecycle or Runtime construction.
- The old `changefleet-audit` binary, `npm run audit` alias, parser-only module, obsolete usage, and
  redundant command tests are absent.
- Installed commands cannot select a scripted or fake Runtime through configuration or environment.
- Every temporary executable created during implementation is removed before review.
- No deferred API, UI, App Server, tracker, delivery, or analytics boundary enters the final diff.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Targeted CLI unit tests | grammar, config, request loading, allowlist, delegation, diagnostics | Required | Directly covers every new isolated production boundary |
| Targeted CLI integration tests | real process I/O, filesystem composition, audit zero writes, obsolete invocation | Required | Covers the installed executable and exact local stores |
| Deterministic CLI acceptance test | complete current single-Repository lifecycle with test-only Runtime injection | Required | Proves the vertical operator flow without a production fake path |
| Existing multi-Repository acceptance | unchanged orchestration regression | Required | The CLI delegates across the full lifecycle service and the final diff crosses application tiers |
| `npm run check` under Node.js 24 | complete deterministic repository gate | Required | The implementation crosses CLI, application, Runtime composition, audit, integration, and acceptance tiers |
| Real Codex Provider flow | installed CLI with external credentials and cost | Conditional | Select only when the final Provider or Runtime-host boundary requires it; repository standing authorization removes another conversational prompt |
| `git diff --check` plus boundary audits | links, eager sizes, Chinese comments, command manifest, fakes, obsolete and temporary entries | Required | Covers Harness and executable-retirement policy |
| API/UI/App Server/remote validation | deferred surfaces | Excluded | The accepted WorkItem does not implement these surfaces |

Every changed test file must execute. Final validation selection will be reassessed against the
stable diff before review.

## Current Projection

- Current subject: WI-0007 is accepted and landed on `main`; Git owns the exact implementation.
- Last verified state: Node.js 24 `npm run check` passes with 41 unit, 38 integration, and three
  serial acceptance tests; zero failures.
- Next step: select the next independently bounded vertical slice.
- Active blocker or decision: real Provider validation was not selected because this WorkItem does
  not change Provider invocation or evidence capture; standing authorization now permits future
  selected runs without another conversational confirmation.

## Implementation Evidence

Implementation was confirmed and started by the user's 2026-08-03 request: `建并确认唯一的
WI-0007，并执行`.

The review subject implements:

- one installed `changefleet` root executable with an explicit allowlist over ten existing
  application operations and no internal `resolve`, recovery, Runtime, Git, workspace, validator,
  or Store command;
- strict versioned local configuration with relative control/workspace roots, one real `codex-sdk`
  adapter, logical credential identity, and host-owned `local_codex_home` or `OPENAI_API_KEY`
  sources without persisted secrets or credential paths;
- bounded JSON request loading from a file or stdin, unchanged application delegation, caller
  idempotency, typed localized failure, and isolated stdout/stderr;
- exact-id debug audit through reader-only dynamic routing, with projection equality, missing-root,
  malformed-root, pagination, and byte-identical zero-write coverage;
- removal of the standalone audit binary, parser-only module, npm alias, obsolete active usage, and
  redundant tests after equivalent unified process tests passed;
- test-only scripted Runtime injection that is unavailable to installed configuration or process
  environment selection.

Validation evidence on 2026-08-03:

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/unit/operator-application.test.js test/unit/local-cli.test.js` | 0 | Ten focused tests passed for command grammar, strict config, request input, real Runtime selection, presentation, allowlist, and unchanged delegation | Process and Git lifecycle behavior required broader gates |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/integration/local-cli.test.js` | 0 | Six process tests passed for non-Provider lifecycle commands, fake rejection, audit equivalence and zero writes, capability isolation, and obsolete-entry removal | Planning and execution used the acceptance gate |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test --test-concurrency=1 test/acceptance/local-cli-flow.test.js` | 0 | One complete single-Repository CLI lifecycle passed with test-only Runtime injection | Does not prove external Provider credentials or cost |
| Node.js 24 `npm test` | 0 | All 41 unit tests passed | Filesystem behavior covered separately |
| Node.js 24 `npm run test:integration` | 0 | All 38 integration tests passed in about 160.6 seconds | Real Provider remains external |
| Node.js 24 `npm run test:acceptance` | 0 | All three serial acceptance tests passed in about 63.9 seconds | Delivery remains deferred |
| Node.js 24 `npm run check` | 0 | Final deterministic gate passed 41 unit, 38 integration, and three serial acceptance tests in about 211.4 seconds | Paid real Provider gate was not run |
| Node.js 24 `npm install --package-lock-only --ignore-scripts --offline` | 0 | Root lockfile synchronized the sole `changefleet` bin without dependency or lifecycle-script changes | Does not publish the private package |

The real Provider gate was not run because this WorkItem does not change Provider invocation or
evidence capture. During review on 2026-08-03, the user granted standing authorization for future
selected real Codex development gates. The user also reported that native Windows may surface a
sandbox authorization prompt; ChangeFleet already requires pre-provisioned elevated-sandbox state
and does not fall back to full access. If the prompt recurs, capture its exact text and relevant
sandbox log before changing Runtime-host policy.

## Acceptance Review

Accepted by the user on 2026-08-03 with the request to update authoritative state and commit the
complete WI-0007 implementation.

## Project Memory Impact

WI-0007 is accepted and landed with one experimental local CLI over shared application operations
and a read-only debug audit route replacing the standalone audit entry point. API, UI, App Server,
Linear, delivery, stable CLI compatibility, and later analytics remain deferred.
