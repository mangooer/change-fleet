---
artifact_type: development_work_item
id: WI-0011
status: done
title: Implement explicit ChangeSet closure
source: 'User request: "按这个执行" after accepting separate close and create actions'
confirmed_by: user
confirmed_at: 2026-08-04
started_by: user
started_at: 2026-08-04
review_ready_at: 2026-08-04
completed_by: user
completed_at: 2026-08-04
standing_policy:
design_proposal: docs/proposals/0016-explicit-changeset-closure.md
accepted_decisions:
  - docs/decisions/0018-explicit-changeset-closure.md
---

# WI-0011: Implement Explicit ChangeSet Closure

## Objective

Implement the accepted close-only lifecycle boundary so a user can intentionally abandon one
unfinished quiescent ChangeSet, preserve its exact history and measured cost, and independently use
the existing creation flow for any later task.

## Scope

- Add bounded domain normalization for closure reason code and summary.
- Add one idempotent `closeChangeSet` service operation that appends a human closure decision and
  transitions an eligible aggregate to `abandoned` without calling Runtime, Git, validation,
  workspace, delivery, or external adapters.
- Reject active Runs or lifecycle commands, begun delivery, terminal aggregates, invalid reasons,
  and repeated mutation after closure.
- Preserve every prior authority revision, Run, evidence, usage, checkpoint, validation attempt,
  Candidate, Bundle, command, decision, and blocker.
- Keep abandoned ChangeSets readable through exact state and audit projections while excluding
  closure detail from Runtime context.
- Expose `changeset.close` through the shared application allowlist and retained experimental CLI
  grammar `changeset close --config <path> --request <path|->`.
- Add Simplified Chinese intent comments to new production and non-obvious lifecycle boundaries.
- Keep all fixtures and fake adapters test-only; remove temporary production helpers.

## Non-Goals

- Creating, copying, linking, or aggregating a successor ChangeSet.
- Base resolution, selection revision, branch switching, intent copying, or replacement chains.
- Generic resume, retry, human hold, rewind, restart, fork, turn checkpoints, transcript deletion,
  artifact retention, automatic retry, or Provider-session resume.
- Canceling an active Run, cleaning workspaces, deleting Git refs, or closing PRs.
- UI controls, real Provider calls, browser validation, GitHub writes, pricing, dashboards, or
  cross-ChangeSet comparison.

## Acceptance Criteria

- A valid exact request closes an eligible ChangeSet as `abandoned` and returns a stable bounded
  result with no Runtime, Git, validation, delivery, or cleanup call.
- The persisted closure decision contains actor, reason code, summary, and decision time; none enter
  later Runtime context.
- Idempotent replay returns the same result and mismatched reuse fails.
- Active Run or command, begun delivery, `done`, and `abandoned` states reject closure with stable
  localized diagnostics.
- Every later lifecycle mutation on the abandoned ChangeSet fails closed; exact reads and audit
  projections still work and retain measured usage.
- Shared application and CLI routes are strict and do not add automatic task creation.
- Production changes contain required Chinese intent comments and no temporary command remains.

## Validation Selection

| Command or gate | Scope | Requirement |
| --- | --- | --- |
| Domain and diagnostic unit tests | reason bounds and stable codes | Required |
| Application integration | preservation, state gates, idempotency, restart | Required |
| Shared operation and CLI tests | exact allowlist and delegation | Required |
| Audit/context regression | retained cost, readable close, zero Runtime context | Required |
| Affected acceptance tests | ordinary create remains independent | Required |
| Full deterministic `npm run check` under Node.js 24 | final stable implementation | Required |
| Real Provider, browser, GitHub | external and semantic work | Excluded |
| Documentation and boundary audit | links, status, sizes, comments, temporary code | Required |

## Current Projection

- Current subject: WI-0011 is accepted and ready to land with this completion update.
- Last verified state: the close-only domain, service, audit, shared operation, CLI, and regression
  boundaries pass the selected deterministic gates.
- Next step: land this implementation, then separately close the old WI-0009 Runtime ChangeSet.
- Active blocker or decision: none. Closing the old Runtime task remains an explicit user operation.

## Implementation Evidence

Implemented:

- strict closure request and bounded reason normalization with localized stable diagnostics;
- one idempotent `closeChangeSet` transition that permits only quiescent unfinished pre-delivery
  states, records an immutable human decision, and preserves all prior aggregate facts;
- one shared `changeset.close` operation and experimental `changeset close` CLI route;
- abandoned-state guards across selection, Harness, planning, confirmation, execution, legacy
  recovery, Bundle review, delivery publication, and delivery refresh;
- restart and read-only audit support with `abandoned` recognized as complete while measured Run
  usage remains unchanged;
- Runtime projection exclusion for closure reasons and metadata;
- test-only deterministic fixtures only; no product fake, successor creation, reset, cleanup, or
  temporary executable was added.

Validation evidence:

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test --test-concurrency=1 test/integration/change-set-closure.test.js test/integration/runtime-audit-query.test.js test/acceptance/local-cli-flow.test.js test/unit/model.test.js test/unit/diagnostics.test.js test/unit/operator-application.test.js test/unit/local-cli.test.js test/unit/runtime-context.test.js` | 0 | 40 selected tests passed in 31.6 s: strict request, close gates, all exposed post-close mutations, restart, 350-token audit preservation, context exclusion, shared operation, and CLI lifecycle | No real Provider, browser, GitHub, or concurrent multi-process close race |
| `$node24 = 'C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'; $env:Path = "$node24;$env:Path"; npm run check` | 124 | First full-gate attempt was terminated by the invoking tool after about 5.2 s because its timeout was configured too low; this is not a product test result | Entire gate remained unverified by this attempt |
| `$node24 = 'C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'; $env:Path = "$node24;$env:Path"; npm run check` | 0 | Node.js 24 full gate passed in 170.4 s: 52 unit, 53 integration, and 6 acceptance tests; real Codex, browser, and GitHub external writes were not selected | External Provider credentials/cost, browser UI, and real GitHub writes |
| `git diff --check` | 0 | Final source, tests, and authority-document diff has no whitespace error | Semantic correctness remains covered by the Node gates above |
| PowerShell `Test-Path` for Proposal 0016, Decision 0018, and WI-0011; byte inspection for `AGENTS.md`, `WORKFLOW.md`, and `docs/current-state.md`; added-production-comment and temporary-marker diff searches | 0 | Authority targets exist; eager files are 5,872, 1,264, and 7,997 bytes; all added production intent comments are Chinese; no added production TODO/FIXME/temporary/mock/fake marker exists | Files not selected by the accepted eager Harness map |

## Acceptance Review

Accepted by the user on 2026-08-04. The implementation satisfies Proposal 0016 without adding
generic resume, successor creation, automatic task linkage, detailed lineage aggregates, or
destructive cleanup. Acceptance does not itself close `changefleet-wi-0009`; that remains a later
explicit operational request.

## Project Memory Impact

WI-0011 is accepted and lands the close-only lifecycle boundary. It does not close the actual
WI-0009 Runtime ChangeSet or create a successor.
