---
artifact_type: development_work_item
id: WI-0021
status: done
title: Implement Bundle-level independent quality review
source: User accepted Proposal 0025 and explicitly requested the unique implementation WorkItem.
confirmed_by: user
confirmed_at: 2026-08-07
started_by: agent
started_at: 2026-08-07
review_ready_at: 2026-08-07
completed_by: user
completed_at: 2026-08-07
standing_policy:
design_proposal: docs/proposals/0025-bundle-level-independent-quality-review.md
accepted_decisions:
  - docs/decisions/0001-control-plane-boundary.md
  - docs/decisions/0002-changeset-and-bundle-aggregate.md
  - docs/decisions/0017-post-provider-candidate-finalization-and-recovery.md
  - docs/decisions/0024-risk-adaptive-candidate-verification.md
  - docs/decisions/0025-unified-stage-and-run-lifecycle.md
  - docs/decisions/0026-policy-governed-agentic-supervision.md
  - docs/decisions/0027-bundle-level-independent-quality-review.md
---

# WI-0021: Implement Bundle-Level Independent Quality Review

## Objective

Implement one optional independent Review Runtime that binds an exact CandidateBundle, recommends
passage or returns bounded Feedback or a human Gate, and lets Plan-confirmed autonomous supervision
repair and reassess the Bundle without granting the reviewer acceptance or mutation authority.

## Context

WI-0020 advances a confirmed Plan through execution, Candidate validation and verification,
Feedback repair, and exact Bundle assembly. Proposal 0025 and Decision 0027 accept a separate
Bundle-level quality perspective before human review while preserving the small lifecycle and human
Bundle-acceptance boundary.

The implementation must reuse generic Runs, Feedback, Gates, recovery, Runtime evidence, and shared
application operations. It must not grow a second review workflow or make Agent conclusions
deterministic truth.

## Scope

### Plan Admission And Exact Identity

- Add a minimal Project default and confirmed Plan projection for `none | independent`, one Review
  AgentProfile, and bounded Review Run attempts within existing Feedback and elapsed-time ceilings.
- Migrate existing Plans to `none`; never silently spend Review Runtime cost or change a current
  Bundle's review requirement.
- Bind each review admission, Run, and assessment to the exact Plan revision, Bundle revision and
  hash, Candidate base/head SHAs, and required evidence identities.

### Read-Only Review Runtime

- Add `review` to the generic Run purpose contract without adding a ChangeSet phase, WorkUnit stage,
  correction state, or separate recovery state machine.
- Assemble a compact exact-Bundle context with intent, Plan expectations, manifest, relevant diffs,
  passing evidence, unverified risks, and bounded artifact references. Exclude unrelated history,
  full logs, transcripts, audit totals, and private execution reasoning.
- Provide semantically read-only exact-Candidate resources with Git preflight and postflight. The
  reviewer cannot write repository workspaces, invent checks, access the Control Store, expand
  scope, alter budgets, accept a Bundle, deliver, or merge.
- Require a structured `pass | feedback | gate` assessment with stable finding ids, bounded text,
  `blocking | advisory` severity, exact evidence references, and authorized Repository and WorkUnit
  targets where applicable.

### Feedback, Supervision, And Recovery

- Treat `pass` as a recommendation only. Preserve advisory findings as audit evidence without
  creating another repair cycle.
- Convert valid blocking findings to the existing Feedback operation. The targeted execution Run
  must assess each claim as `adopt | adapt | decline`, publish a new exact checkpoint when it edits,
  and repeat only invalidated Candidate, combined, Bundle, and review evidence.
- Route ambiguous ownership, Plan invalidation, scope expansion, invalid structured output, and
  exhausted budget to the existing Gate or failure boundary instead of guessing.
- Extend deterministic supervision so a required review dispatch is forced after Bundle assembly;
  no Supervisor model call is spent for that choice. Continue bounded same-Plan repair until a
  current passage recommendation or an existing stop condition applies.
- Reuse the generic Run reconciler. Interrupted or failed review may retry only against the same
  current exact subject and ceiling; stale completed assessments never transfer.

### Audit And Local Surface

- Persist bounded assessment identity, disposition, findings, AgentProfile, attempts, usage,
  duration, artifacts, kernel disposition, and stop reason using existing Run and audit stores.
- Expose the current exact assessment and historical references through shared read operations.
  Update CLI/HTTP/local UI only as thin adapters over those operations.
- Keep all new or materially changed source logic documented with concise Chinese comments.

## Non-Goals

- Automatic Bundle acceptance, PR publication, merge, deployment, or irreversible action.
- Parallel reviewers, voting, blind judging, alternative Candidate competition, normalized quality
  scoring, pricing, or automatic model selection.
- Reviewer-authored validation commands, ambient shell authority, or a second QualityContract
  aggregate.
- A new workflow DSL, Agent graph, ChangeSet phase, WorkUnit stage, correction state, or waiting
  state.
- Provider-native session resume, remote workers, Linear, or broader UI redesign.

## Acceptance Criteria

- Existing persisted Plans migrate to `none`; independent review occurs only from exact confirmed
  Plan authority.
- A Review Run and assessment bind one unchanged exact Bundle revision and every Candidate SHA.
- Required review dispatch is deterministic and does not invoke the Supervisor Agent.
- The reviewer is semantically read-only and cannot accept, deliver, merge, expand authority, raise
  budgets, or satisfy deterministic checks with its own claim.
- `pass` is only a recommendation; advisory findings are visible and non-blocking.
- Valid blocking findings target authorized WorkUnits and reuse the existing Feedback, execution,
  verification, Bundle, and Run lifecycle.
- Changed Candidate, Bundle, Plan, or required evidence identity requires a new assessment.
- Invalid output, ambiguity, Provider failure, interruption, and budget exhaustion fail closed
  through generic retry, failure, or Gate behavior.
- Audit and local surfaces show exact disposition, findings, profile, usage, duration, attempts, and
  stop reason without injecting totals or detailed reasoning into ordinary Agent context.
- One- and two-Repository routes prove passage, targeted repair, advisory-only, Gate, restart, and
  stale-assessment rejection without new aggregate lifecycle states.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Focused domain, schema, and context tests | Plan policy, Run purpose, exact assessment contract | Required | Direct accepted-contract coverage |
| Store migration and restart integration | Existing Plan default, Run recovery, assessment identity | Required | Persisted schema and crash safety change |
| Real-Git one- and two-Repository integration | Exact Bundle binding, read-only postflight, Feedback repair | Required | Core Bundle authority changes |
| Supervision and audit integration | Forced dispatch, budgets, stop reasons, cost isolation | Required | Autonomous route and evidence change |
| CLI, HTTP, and browser tests | Shared assessment projection and operator audit | Required when affected | Adapters must share application semantics |
| Node.js 24 `npm run check` | Complete changed dependency surface | Required once stable | Schema, store, Runtime, supervision, UI, and acceptance cross tiers |
| Real Codex Provider flow | Independent Bundle assessment and one bounded repair | Required once stable | New production Runtime operation and prompt contract |
| Real GitHub external write | Delivery | Excluded | Bundle acceptance and delivery identity remain unchanged |
| Documentation, links, diff, and eager-size audit | Accepted authority and Harness | Required | Proposal, Decision, SPEC, architecture, and current projection change |

## Current Projection

- Accepted subject: `codex/proposal-0025-bundle-quality-review` from local `main` at `3da554f`; no
  merge or landed-baseline claim is implied.
- Project and Plan policy, schema-v12 migration, exact Review Run identity, read-only resources,
  bounded assessment, Feedback/Gate routing, generic recovery, audit, and local UI are complete.
- Existing Plans migrate to `none`; independent review requires the exact confirmed Profile id and
  revision. A passage recommendation remains separate from human Bundle acceptance.
- Active blocker or decision: none.
- Next action: integrate the accepted exact branch commit into `main`.

## Implementation Evidence

### Implemented Subject

- Added strict Bundle-review policy, Plan admission, exact-subject and structured assessment domain
  contracts. Schema v12 migrates every historical Plan to `none`, preventing upgrade-time cost.
- Added the `review` common Run purpose and Codex protocol. Each Candidate is exposed through a
  disposable exact-SHA worktree with preflight, mutation detection, cleanup, and no validation-
  command, acceptance, delivery, or merge capability.
- Extended deterministic supervision through forced review dispatch, bounded exact-subject retry,
  targeted same-Plan Feedback repair, existing Gates, and generic Run recovery without a new phase
  or review-specific state machine.
- Added exact assessment, finding, usage, duration, attempt, stop-reason, audit, shared read-model,
  HTTP, and local-UI projections while keeping audit totals and full review artifacts out of later
  Runtime context.
- Added one- and two-Repository coverage for passage, advisory evidence, targeted repair, Gate,
  invalid output, mutation rejection, interruption, restart, stale identity, and cost attribution.

### Executed Gates

| Command | Exit | Scope and observation | Unverified boundary |
| --- | ---: | --- | --- |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test "test/unit/**/*.test.js"` | 0 | Node 24; 85/85 unit tests passed, including admission, assessment identity, lifecycle and supervision policy | Provider and Real-Git behavior excluded |
| `$env:PATH='C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH; npm.cmd run check` | 0 | Node 24; 85 unit, 109 integration and 7 acceptance tests plus Chromium UI passed in 686.9 s | Real Provider and external GitHub write excluded |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/integration/autonomous-supervision.test.js` | 0 | Final test subject; 15/15 Real-Git routes passed in 229.3 s, including advisory passage and stale-assessment non-reuse | Other suites retain the unchanged full-gate evidence above |
| `$env:PATH='C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH; $env:CHANGEFLEET_RUN_REAL_CODEX='1'; npm.cmd run test:provider:codex` | 0 | Real Codex completed planning, bounded Feedback repair and exact Bundle passage review in 323.1 s; 7/7 Runs carried Provider evidence | Another Provider/model and hostile-host confinement unverified |
| `git diff --check` | 0 | Final source, test, and Harness diff has no whitespace errors | Semantic behavior covered by the gates above |
| Local Markdown-link and eager-size PowerShell audit | 0 | All local links in 11 changed Markdown files resolve; `AGENTS.md` 6004 B, `WORKFLOW.md` 1264 B, and `docs/current-state.md` 7776 B remain within soft limits | Does not measure Provider tokenization |
| `rg -n "ScriptedRuntime|FakeRuntime|MockRuntime" src package.json` | 1 (expected no match) | No deterministic test double is selectable from production source or package configuration | Scripted fixtures remain intentionally confined to `test/` |

The passing real flow observed 555,245 aggregate tokens and 282,741 ms of Provider duration. The
independent Bundle Review Run accounted for 31,600 tokens and 23,198 ms. Monetary cost and effective
model remain unknown because the current SDK evidence does not report them.

An earlier Node 24 integration run passed 108/109 tests and exposed a pre-existing test race that
temporarily changed process `PATH` while files ran concurrently. The fixture now uses an absolute
future executable path; its focused rerun and the final 109/109 full integration run pass. No
production behavior or executable surface was added for that correction.

Real GitHub publication was not selected because this WorkItem does not change Bundle acceptance or
delivery identity. Parallel reviewers, Candidate competition, normalized quality scoring, model
routing, and automatic Bundle acceptance remain deferred.

## Project Memory Impact

WI-0021 was explicitly accepted and is branch-locally complete. Bundle-level independent quality
review becomes a landed baseline only after this exact Candidate is integrated. Automatic
acceptance, delivery, multiple reviewers, Candidate competition, quality scoring, and model routing
remain deferred.
