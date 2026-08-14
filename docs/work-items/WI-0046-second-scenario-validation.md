---
artifact_type: development_work_item
id: WI-0046
status: done
title: Second-scenario validation
source: User accepted Proposal 0032 on 2026-08-14 and chose the target repository and objective on 2026-08-14
confirmed_by: user
confirmed_at: 2026-08-14
standing_policy:
design_proposal: docs/proposals/0032-freeze-operator-surface-and-validate-second-scenario.md
---

# WI-0046: Second-Scenario Validation

## Objective

Run one complete real ChangeSet against a registered repository that is not the ChangeFleet
self-repo and record every observed gap as evidence for the next proposal.

## Context

- Proposal 0032 (Decision 0034) makes second-scenario validation the next implementation objective.
- The user chose the target: `D:\phpProject\site-backend\yszt`, objective "测试环境投票倍率改为1000"
  (change the test-environment vote multiplier to 1000).
- Facts: GitLab remote `git.devcloud.ztgame.com/gwt/site-backend/yszt-backend.git` (no GitHub remote,
  so GitHub PR delivery is expected unavailable); CI deploys the test server from `develop`; the
  Qixi vote branch is already merged into `develop`; the multiplier lives in
  `config/config_dev.php` and `config/config_pro.php` and only scales displayed heat, never ranking.
- The repository has `.agents/skills/` and module-level `docs/` but no root `AGENTS.md`; it is a PHP
  composer project with a clean working tree on `develop`.
- Control root reused: `.changefleet/` with the existing `changefleet.json` (host_user profile,
  real Codex SDK). No new product feature is authorized; this slice validates the landed baseline.

## Scope

- Register Project `yszt` with Repository `yszt` (`default_target_ref: develop`).
- Create ChangeSet `yszt-test-vote-multiplier-1000` with the objective above, freezing
  `branch_ref: develop`, `target_ref: develop`.
- Drive create, plan, execute, validate, verify, review, and delivery where available through the
  existing product surfaces.
- Record exact gaps, costs, retries, and recovery observations as WorkItem evidence.

## Non-Goals

- No console, audit, overlay, Provider, or kernel feature work.
- No second Provider, remote workers, multi-tenancy, pricing, or automatic merge.
- No claim that one non-self repository proves product-market fit.

## Acceptance Criteria

- The ChangeSet either completes through its configured review boundary with preserved exact
  evidence, or stops at precisely recorded gaps.
- Each gap records the failing step, observed behavior, and whether it belongs to kernel, console,
  audit, overlay, Provider, or documentation.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Real ChangeSet run | second scenario end-to-end | Required | This WorkItem is the gate itself |
| Selected deterministic checks | any changed boundary | Conditional | Only if the run surfaces a code defect |

## Current Projection

- Current subject: Project `yszt`, ChangeSet `yszt-test-vote-multiplier-1000`
  (`task-workspace-389e890b299f231f8a0c46b6`) in control root `.changefleet/`.
- Last verified state: project registered; ChangeSet created with `branch_ref: refs/heads/develop`,
  base SHA `ba518a7`, `target_ref: refs/heads/develop`, Harness selection `exact_base_only` with no
  resolved paths; first planning turn dispatched through the real Codex SDK.
## Current Projection

- Current subject: Project `yszt`, ChangeSet `yszt-test-vote-multiplier-1000`
  (`task-workspace-389e890b299f231f8a0c46b6`) in control root `.changefleet/`.
- Last verified state: full run complete — planning, confirmed Plan, execution, validation,
  Candidate `c14d2c6`, Bundle revision 1, human `accept` (decision-9a93c0bf). ChangeSet remains
  `phase: review` because no delivery binding exists; observed gaps recorded below.
- Next step: none — the user declined delivery for this test run; the local task branch is retained
  as a test artifact. Gaps become the next proposal's context.
- Active blocker or decision: none; delivery intentionally declined by the user (test only).

## Implementation Evidence

All commands ran with Node v24.18.1 against `.changefleet/changefleet.json`; exit codes are exact.

- `project register` exited 0: Project `yszt` registered with `default_target_ref: refs/heads/develop`,
  canonical remote `git.devcloud.ztgame.com/gwt/site-backend/yszt-backend.git`.
- `changeset create` exited 0: ChangeSet `yszt-test-vote-multiplier-1000` frozen
  `branch_ref: refs/heads/develop`, base SHA `ba518a7`, `target_ref: refs/heads/develop`.
- `changeset plan` exited 0: real Codex Run `run-034a403a` completed in 81.5s with disposition
  `ready`; usage 450,407 total tokens (372,096 cached), aggregate-only coverage; Planner located
  `config_dev.php` heat_multiplier 10→1000 and scoped the change to dev/test config plus docs and
  tests.
- `changeset plan confirm` exited 0: Plan revision 1 confirmed, control digest
  `3cb4767d…`.
- `changeset execute` exited 0: real Codex Run `run-02f55e74` completed in 183.0s; Candidate
  `c14d2c6` published with 7 changed paths; repository and combined structural validation both
  passed (702ms/701ms); Bundle revision 1 `review_ready`.
- `changeset bundle decide` exited 0 with `decision: accept`, actor `human`
  (decision-9a93c0bf).
- `debug audit changeset` exited 0 without escalation: pure store reads work under the restricted
  sandbox; audit projection preserved both Runs, usage, validations, and the human decision.

The first `project register` attempt exited 1 with `NOT_A_GIT_REPOSITORY` under the DSH sandbox:
Node `child_process` pipe spawns fail with EPERM (-4048) there, and the kernel maps the failed
spawn to a misleading not-a-git-repository diagnostic. Retries with full host access succeeded.
This is an environment-specific diagnostic-quality observation, not a normal-host product defect.

### Observed Gaps

- Kernel lifecycle: with no GitHub delivery binding, an accepted Bundle leaves the ChangeSet in
  `phase: review` with `terminal_outcome: null`. The lifecycle invariant "Only an accepted review
  with completed delivery may produce terminal done" has no no-delivery completion rule, so a
  non-GitHub or local-only repository can never reach terminal(done). Belongs to: kernel/lifecycle.
- Harness discovery: `resolved_relative_paths` was empty although the repository has a module-level
  `app/Modules/QixiVote/AGENTS.md`; exact-base discovery only recognizes root-level conventions.
  Planning still read the repository directly, so impact was limited. Belongs to: Harness overlay.
- Semantic checks: no task-configured semantic command; the module's unit tests require
  `vendor/autoload.php`, absent from the workspace, so the execution Run honestly substituted
  `php -l` on all changed PHP files plus a direct config assertion and recorded the unverified
  boundary. Belongs to: validation policy (known limitation, now confirmed in a second scenario).
- Delivery: the registered remote is GitLab, not GitHub; no delivery adapter applies. Manual merge
  or push is the only publication path today. Belongs to: delivery (deferred non-GitHub providers).

## Project Memory Impact

`docs/current-state.md` records the completed second-scenario run and its gap list. The gaps —
especially the missing no-delivery terminal rule and the empty module-level Harness discovery —
are the evidence base for the next Repository Design Proposal; the deferred architecture list
remains closed until that proposal is accepted.
