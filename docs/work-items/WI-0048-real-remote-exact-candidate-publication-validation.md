---
artifact_type: development_work_item
id: WI-0048
status: done
title: Real-remote exact Candidate publication validation
source: User explicitly authorized the recommended real-remote validation on 2026-08-17
confirmed_by: user
confirmed_at: 2026-08-17
standing_policy:
design_proposal: docs/proposals/0033-task-scoped-agent-sessions-and-exact-integration-action-grants.md
---

# WI-0048: Real-Remote Exact Candidate Publication Validation

## Objective

Validate one accepted `publish_exact_candidate` ActionGrant against the real GitLab-backed `yszt`
Repository without moving or writing its target branch, then independently observe the exact
remote result and finish truthfully without managed integration.

## Context

- Decision 0035 and WI-0047 implement exact non-force publication but currently have only local
  bare-remote evidence.
- The authorized Repository is `D:\phpProject\site-backend\yszt`, remote `origin` at
  `git.devcloud.ztgame.com/gwt/site-backend/yszt-backend.git`.
- Read-only preflight observed clean local state and exact local/remote `develop` SHA
  `55bdae47e7862ab2a71d434162c89aba09085420`.
- The authorized destination is the currently absent non-target ref
  `refs/heads/changefleet/integration/yszt-publish-validation-wi0048/yszt`.
- The Candidate objective is limited to adding
  `app/Modules/QixiVote/docs/changefleet-publication-validation.md` with a concise Chinese warning
  that the branch is publication-validation evidence only, must not be merged or deployed, and
  changes no runtime behavior. No other Repository path is authorized.

## Scope

- Use a fresh current-schema control root and one new ChangeSet based on exact `develop`.
- Plan, execute, validate, review, and accept one exact Candidate for the single documentation file.
- Offer, grant, and execute exactly one `publish_exact_candidate` action through the configured
  host-user Codex Runtime, with `origin`, the fixed non-target ref, non-force semantics, and one
  authorized attempt.
- Independently observe that the destination ref equals the Candidate SHA and that `develop` did
  not move.
- Complete with `accepted_without_managed_integration`; publication is not merge or integration.
- Record exact commands, ids, SHAs, exit codes, observations, and the remaining cleanup boundary.
- Correct the surfaced attempt-authority defect so the offered maximum is explicit, bounded to one
  or two, and included in the immutable input digest; preserve two as the compatibility default.
- Correct the surfaced terminal AgentSession lineage inconsistency by synchronizing its Run
  references from authoritative ChangeSet Run references before closing or re-releasing resources.

## Non-Goals

- No write to `develop`, `main`, a tag, or any other ref; no force push, merge request, merge,
  deployment, or provider-specific delivery feature.
- No product code or schema change and no reuse or migration of WI-0046 control state.
- No automatic or implicit deletion of the published branch. Cleanup requires separate authority.

## Acceptance Criteria

- The new ChangeSet freezes the observed `develop` base and produces one accepted Candidate whose
  changed-path set is exactly the authorized documentation file.
- The immutable ActionGrant binds the exact Bundle, Candidate SHA, remote, absent destination ref,
  AgentSession/Profile, non-force action contract, and one attempt.
- ChangeFleet independently observes the destination at the exact Candidate SHA while `develop`
  remains at `55bdae47e7862ab2a71d434162c89aba09085420`.
- The ChangeSet reaches terminal(done) only through `accepted_without_managed_integration` and makes
  no merge, delivery, or target-integration claim.
- The remote branch remains as an explicit test artifact unless separately authorized cleanup is
  performed.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Read-only Git preflight | local cleanliness, target SHA, absent destination | Required | Freezes the exact external-write subject |
| Real ChangeSet and ActionGrant run | current-schema planning through publication | Required | This WorkItem is the missing real-remote gate |
| Independent `git ls-remote` observation | destination and unchanged target | Required | Agent prose is not result evidence |
| Targeted deterministic tests | any surfaced product defect | Conditional | Run only if validation requires a code fix |
| Full Node.js 24 check | shared AgentSession and integration contracts | Required after defects | Final diff crosses shared domain and resource-release boundaries |
| `npm run check:harness` and `git diff --check` | WorkItem and current-state maintenance | Required | Repository Harness handoff contract |

## Current Projection

- Current subject: Project `yszt-wi0048`, ChangeSet `yszt-publish-validation-wi0048`, base
  `55bdae47e7862ab2a71d434162c89aba09085420`, destination
  `refs/heads/changefleet/integration/yszt-publish-validation-wi0048/yszt`.
- Last verified state: the exact evidence ref remains at Candidate `debf6c1e`; WI-0050 later moved
  `develop` independently to `f2cf1820`. The publication ChangeSet remains terminal(done) through
  `accepted_without_managed_integration` with corrected attempt binding and Session lineage.
- Next step: intentionally retain the remote validation branch as durable evidence; no cleanup is
  planned.
- Active blocker or decision: none.

## Implementation Evidence

- `git push origin main` — exit `0`; ChangeFleet commit `1fb54b9` reached `origin/main`. GitHub
  reported that the repository moved to `change-fleet-agent-control.git`, but accepted this push.
- Read-only `git status`, `git rev-parse`, and `git ls-remote --heads origin` preflight — exit `0`;
  the `yszt` checkout was clean, local and remote `develop` were
  `55bdae47e7862ab2a71d434162c89aba09085420`, and the named destination did not exist.
- Node.js 24 CLI `project register`, `changeset create`, `changeset plan`, `changeset plan confirm`,
  `changeset execute`, and `changeset bundle decide` — exit `0`; fresh task workspace
  `task-workspace-6276e406fa8278c93eeaad13` produced accepted Bundle revision 1/hash
  `cca2c557…` and exact Candidate `debf6c1e580e9f9d77f20d42a574758cb16778c0`. Its only changed
  path is `app/Modules/QixiVote/docs/changefleet-publication-validation.md`; both structural
  validation attempts passed.
- The first ActionOffer exited `0` but exposed `maximum_attempts: 2`; it was never granted and was
  superseded. The corrected single-attempt Offer `integration-offer-00e7f721…`, digest
  `14a93995…`, and Grant `action-grant-1aae3790…` bound the exact Candidate, absent destination,
  non-force refspec, host-user profile, and `maximum_attempts: 1`.
- The first integration execute request exited `1` with `IDEMPOTENCY_KEY_REUSED` before dispatch or
  remote mutation; its Grant remained at attempt 0. The corrected integration-specific key exited
  `0`; Run `run-82f76628…` and result `integration-result-03e6ac08…` independently observed
  `debf6c1e580e9f9d77f20d42a574758cb16778c0` at
  `refs/heads/changefleet/integration/yszt-publish-validation-wi0048/yszt`.
- Controller-external `git ls-remote` exited `0` and independently matched the published Candidate
  while `refs/heads/develop` remained exactly `55bdae47e7862ab2a71d434162c89aba09085420`.
- `changeset integration complete-without-managed` exited `0`; disposition
  `accepted_without_managed_integration` produced terminal(done), preserved the Candidate as
  unintegrated, released the workspace, and closed every AgentSession. Idempotent replay after the
  lineage repair synchronized all three Session Run references to their authoritative completed
  records without another remote action.
- Node.js 24 targeted command
  `--test test/unit/agent-session.test.js test/unit/integration.test.js
  test/integration/integration-action-flow.test.js test/integration/change-set-closure.test.js` —
  exit `0`; 13 tests passed.
- Node.js 24 `scripts/run-checks.mjs` — exit `0`; Harness, 120 unit tests, 126 integration tests,
  eight acceptance tests, and the Chromium console path passed.
- `debug audit changeset yszt-publish-validation-wi0048` — exit `0`; three completed real Runtime
  Runs reported 261,058 aggregate tokens and 119,974 ms total Provider duration; audit diagnostics
  were empty.
- 2026-08-18 controller-external `git ls-remote` — exit `0`; the retained evidence ref still
  matched `debf6c1e...` and the separately integrated `develop` matched `f2cf1820...`. The operator
  chose retention because deletion provides no safety or cost benefit and would reduce auditability.
- Unverified boundary: no real target fast-forward, merge request, merge, deployment, or cleanup
  ran. The exact non-target remote branch remains intentionally present and requires separate
  deletion authority.

## Project Memory Impact

Current-state records the real GitLab publication evidence and removes the local-only integration
gap while retaining cleanup and target-fast-forward as separately gated, unverified boundaries.
