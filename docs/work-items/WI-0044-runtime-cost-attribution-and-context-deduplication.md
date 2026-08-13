---
artifact_type: development_work_item
id: WI-0044
status: done
title: Runtime cost attribution and context deduplication
source: User explicitly requested fixing the high-cost finding on current main
confirmed_by: user
confirmed_at: 2026-08-13
standing_policy:
design_proposal:
---

# WI-0044: Runtime Cost Attribution And Context Deduplication

## Objective

Remove one confirmed source of repeated Runtime context and present Provider usage honestly without
turning cumulative token traffic into an implied monetary cost.

## Context

- The bounded real self-iteration reported 11,158,421 aggregate tokens across four Runs, of which
  10,745,984 were cached input and 370,335 were non-cached input.
- The initial execution projection was only 9,807 bytes, but the semantic Plan was repeated in
  `current_plan`, the compiled `work_unit.task`, and the execution instruction. Tool-loop replay
  amplified that avoidable duplication.
- The Provider reports aggregate usage, not a monetary charge or reliable per-tool-call token
  boundary. Pricing and continuous context enforcement remain deferred accepted limitations.

## Scope

- Keep one semantic Plan in execution Runtime context and remove the duplicate WorkUnit task text
  from the projected contract.
- Make the execution instruction reference the existing semantic Plan instead of interpolating it
  again.
- Present token traffic, cached input, derived non-cached input, and output distinctly in the local
  console, with an explicit unknown monetary-cost boundary.
- Update focused protocol, context-boundary, browser, and repository-Harness coverage.

## Non-Goals

- No new ChangeSet, Run, AgentProfile, budget, attempt, or supervision state.
- No hard-coded command-count, elapsed-time, or token ceiling.
- No pricing table, billing estimate, model-routing policy, or continuous context enforcement.
- No claim that cached token traffic is free or that aggregate usage equals a Provider invoice.

## Acceptance Criteria

- Execution Runtime context contains the semantic Plan once rather than reproducing the compiled
  WorkUnit task.
- The console no longer labels aggregate token traffic as task cost or an unqualified token total.
- Ordinary task detail shows a compact honest usage signal; exact audit separates cached input,
  derived non-cached input, output, and total traffic.
- Unknown usage and unknown monetary cost remain explicit rather than becoming zero or an estimate.
- The selected deterministic checks pass on the final branch-local subject.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `node --test test/unit/runtime-context.test.js` | execution context projection | Required | Directly proves semantic Plan deduplication |
| `node --test test/integration/codex-sdk-runtime.test.js` | Codex prompt protocol | Required | Directly proves the Adapter no longer interpolates duplicate task text |
| `npm run test:ui` | ordinary and audit usage presentation | Required | Browser path owns the changed local-console behavior |
| `npm run check` | shared Runtime projection contract and UI | Required | The final diff changes a versioned Runtime contract across domain, Adapter, and browser tiers |
| `git diff --check` | patch hygiene | Required | Repository validation policy requires it for final handoff |

The real Provider gate is excluded: the change neither crosses Provider invocation/evidence capture
nor needs paid execution to prove deterministic prompt construction and presentation semantics.

## Current Projection

- Current subject: branch `codex/wi-0044-runtime-cost-clarity`, based on `d983d7e`.
- Last verified state: the context and UI replacement are complete on the branch-local subject.
- Next step: merge this Candidate, then run one explicitly bounded comparison before designing any
  additional resource-budget boundary.
- Active blocker or decision: none.

## Implementation Evidence

- `node --test test/unit/runtime-context.test.js` exited 0: seven context tests passed, including
  the single semantic execution-Plan projection.
- `node --test test/unit/local-console-usage.test.js test/unit/runtime-context.test.js` exited 0:
  nine tests passed, including exact token-dimension, unknown, and mismatched-coverage behavior.
- `node --test test/integration/codex-sdk-runtime.test.js` exited 0: eleven protocol tests passed;
  the captured execution prompt contained the semantic summary exactly once.
- `npm run test:ui` exited 0 in 74.1 seconds: Chromium displayed the honest usage labels and unknown
  monetary-cost boundary throughout the existing task path.
- The preserved real ChangeSet showed a 1,136-byte compiled task duplicated once in the context
  projection and once in the Adapter instruction. This replacement removes both copies while
  retaining its semantic Plan.
- The first default-PATH `npm run check` exited 1 before tests because Node.js 22.19.0 failed the
  repository's Node 24 guard. It produced no Provider usage and no test evidence.
- The first Node 24 full check reached the browser gate after all unit, integration, and acceptance
  suites passed, then exited 1 because the new native ESM module was absent from the static asset
  allowlist. Focused diagnostics observed zero SSE requests and the unchanged initialization
  status; the final implementation added the explicit allowlist route and deterministic reconnect
  fixture.
- Node 24 `node --test test/integration/local-console-server.test.js` exited 0 in 54.4 seconds: six
  local-server tests passed, including the new static module read.
- Final Node 24 `npm run check` exited 0 in 416.6 seconds: Harness, 114 unit tests, 120 integration
  tests, eight acceptance tests, and the Chromium path all passed without a real Provider Run.
- Final `git diff --check` exited 0: no whitespace or conflict-marker defects were present.

## Project Memory Impact

`docs/current-state.md` now records the single-source semantic execution context and honest usage
presentation. This WorkItem accepts no new product boundary; it corrects the implementation against
Decision 0030 and the existing Runtime audit contract.
