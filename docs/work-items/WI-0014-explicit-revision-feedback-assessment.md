---
artifact_type: development_work_item
id: WI-0014
status: done
title: Require explicit Agent assessment of revision feedback
source: 'User request: "先解决这个问题。要求反馈，人类审查提供的信息不一定是真正正确或者说合理的。要agent思考是否合理。"'
confirmed_by: user
confirmed_at: 2026-08-05
started_by: user
started_at: 2026-08-05
review_ready_at: 2026-08-05
completed_by: agent
completed_at: 2026-08-05
standing_policy:
design_proposal: docs/proposals/0020-explicit-revision-feedback-assessment.md
accepted_decisions:
  - docs/decisions/0022-explicit-revision-feedback-assessment.md
---

# WI-0014: Require Explicit Agent Assessment Of Revision Feedback

## Objective

Make replanning evaluate every human review finding without treating human text, repository prose,
or Agent output as automatic truth.

## Scope

- Add bounded per-finding `adopt | adapt | decline` assessments to new ChangePlans.
- Require exact current-finding coverage during domain normalization.
- Update the Codex planning and execution instructions and strict planning output schema.
- Preserve old Plans without migration or invented assessments.
- Correct the landed WI-0009 repository projection that exposed the defect.
- Keep full review history, reasoning, cost, and large evidence outside Runtime context.

## Non-Goals

- Automated truth scoring, evidence ranking, clarification lifecycle, feedback voting, or appeals.
- Treating humans or Agents as universally correct.
- Changing Bundle, Candidate, Repository, delivery, or recovery identity.
- Running a real paid Provider as implementation validation.

## Acceptance Criteria

- Every current finding has exactly one persisted bounded assessment in a revised Plan.
- Missing, duplicate, unknown, or invalid assessments fail before a planning Run is successful.
- Plan and execution prompts distinguish review input from confirmed action.
- Assessments enter execution only through the confirmed current Plan.
- WI-0009 and current-state projections describe the landed `f8fd77f` baseline accurately.
- Selected deterministic tests and the Node.js 24 full repository check pass.

## Validation Selection

| Gate | Requirement | Reason |
| --- | --- | --- |
| Domain model unit test | Required | New ChangePlan invariant |
| Runtime context unit test | Required | Projection version and bounded current subject |
| Codex adapter integration | Required | Strict schema and prompt semantics |
| Application boundaries integration | Required | Replan-to-execution persistence |
| Full deterministic check | Required | Shared Plan contract and context projection changed |
| Real Provider | Excluded | Deterministic contract validation is sufficient; paid quality comparison is separate |
| Documentation, links, diff, and eager-size audit | Required | Accepted product and Harness authority changed |

## Current Projection

- Current subject: completed bootstrap repair on `codex/revision-feedback-assessment` from `f8fd77f`.
- Active blocker: none.
- Next step: none inside this completed WorkItem; successor lifecycle is tracked by ChangeFleet.

## Implementation Evidence

- Node.js 24 running `--test --test-concurrency=1 test/unit/model.test.js
  test/unit/runtime-context.test.js test/integration/codex-sdk-runtime.test.js
  test/integration/application-boundaries.test.js` returned exit code `0` in 63.4 seconds: 25 tests
  passed. It covers exact assessment coverage and ordering, invalid legacy Plan confirmation,
  projection version 5, strict Codex output schema, prompt semantics, and confirmed execution input.
- The first Node.js 24 `scripts/run-checks.mjs` attempt returned exit code `1` after 211.6 seconds:
  58 unit, 64 integration, and 6 acceptance tests passed, but the UI gate failed closed because the
  already pinned `@playwright/test` development package was absent from local `node_modules`.
- `npm.cmd install --ignore-scripts` returned exit code `0` and installed three packages from the
  existing lock file without changing `package.json` or `package-lock.json`. npm reported that its
  launcher used Node.js 22.19.0 and that the existing dependency tree has two high-severity audit
  findings; no forced dependency upgrade was made in this WorkItem.
- Node.js 24 running `scripts/run-ui-tests.mjs` returned exit code `0` in 26.8 seconds: the real
  Chromium console path passed.
- The final Node.js 24 `scripts/run-checks.mjs` returned exit code `0` in 245.8 seconds: 58 unit,
  64 integration, 6 acceptance tests, and the Chromium UI gate passed. No real Provider, network
  delivery, or paid Runtime call was part of this command.
- Final `git diff --check` returned exit code `0`. Link inspection found every new Proposal,
  Decision, WorkItem, and dependency target present. Eager Harness files measured `6079`, `1264`,
  and `8019` bytes for `AGENTS.md`, `WORKFLOW.md`, and `docs/current-state.md`, within their soft
  limits. `package.json` and `package-lock.json` remain unchanged.

## Acceptance Review

Implementation is complete and ready for user review. Human findings remain review claims; the
material behavior is that every revised Plan now exposes the Agent's disposition and rationale
before the existing human confirmation gate.

## Project Memory Impact

After this repair lands, abandon the stale-base guidance-normalization ChangeSet and create its
successor from a base containing Decision 0022.
