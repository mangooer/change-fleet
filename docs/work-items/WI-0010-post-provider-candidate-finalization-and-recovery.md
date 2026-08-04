---
artifact_type: development_work_item
id: WI-0010
status: done
title: Implement post-Provider Candidate finalization and recovery
source: 'User request: "确认 Proposal 0015 接受后创建唯一的前置 WI-0010"'
confirmed_by: user
confirmed_at: 2026-08-04
started_by: user
started_at: 2026-08-04
review_ready_at: 2026-08-04
completed_by: user
completed_at: 2026-08-04
standing_policy:
design_proposal: docs/proposals/0015-post-provider-candidate-finalization-and-recovery.md
accepted_decisions:
  - docs/decisions/0017-post-provider-candidate-finalization-and-recovery.md
---

# WI-0010: Implement Post-Provider Candidate Finalization And Recovery

## Objective

Implement the deterministic post-Provider boundary accepted by Proposal 0015 so an exact published
Git subject survives validation failure and can resume repository or combined validation without
another Agent Runtime call. Add the narrow Windows batch-shim rule and bounded current
`request_revision` feedback required to recover the blocked WI-0009 ChangeSet safely.

## Context

[Proposal 0015](../proposals/0015-post-provider-candidate-finalization-and-recovery.md) and
[Decision 0017](../decisions/0017-post-provider-candidate-finalization-and-recovery.md) are the
accepted authority. Dogfood Run `run-f7d39a4b-2469-46d2-afa7-204cb7328fba` completed Provider work
from base `5f2ad1d771645c28088de8f34715e209b522d30c` and published clean commit
`12a70365a7ab16323cfd24a117779d6ea48ffe12`, but `npm` failed with
`COMMAND_SPAWN_FAILED` before Candidate persistence. That commit remains unaccepted evidence.

## Scope

- Add private domain and persisted-schema support for `CandidateCheckpoint`, immutable repository
  validation attempts, and explicit resumable or terminal WorkUnit finalization states.
- Persist the checkpoint after exact Candidate publication and before repository validation, then
  create an ordinary Candidate only from current passing evidence.
- Add idempotent repository and combined validation resume under a new caller attempt key. Recheck
  workspace ownership, clean HEAD, ancestry, changed paths, current revisions, and exact subject;
  never invoke the Runtime during resume.
- Add one human-gated legacy recovery through a shared application operation and experimental CLI
  route for the exact pre-checkpoint record shape. Record provenance and reject guessing, dirty
  adoption, mutation, reset, stale authority, or arbitrary commit import.
- Implement and test one reviewed Windows `.cmd`/`.bat` argv-preserving adapter while retaining
  direct native execution elsewhere and recording requested, resolved, adapter, and effective
  invocation evidence without secret environment values.
- Add bounded summary and actionable findings to `request_revision`, projecting only the current
  bounded feedback into later planning and execution context.
- Add Simplified Chinese intent comments to every new production module and non-obvious changed
  state, security, identity, recovery, command, and context boundary.
- Remove temporary production commands, fake paths, fixtures, and compatibility scaffolding when
  their test or migration purpose ends.

## Non-Goals

- Recovering or accepting the actual WI-0009 commit before WI-0010 is reviewed, accepted, and
  landed.
- Changing the WI-0009 UI, its browser tests, delivery behavior, or review findings.
- Running another real Provider, resuming a Provider session, or adding automatic retry budgets.
- UI recovery controls, generic commit import, arbitrary workspace adoption, validation-command
  override, PowerShell command mode, or generic shell strings.
- Real GitHub publication, merge, deployment, remote workers, hosted tenancy, or public schema
  compatibility.

## Acceptance Criteria

- A completed Provider WorkUnit durably records its exact published subject before any repository
  validation process starts.
- Spawn failure, timeout, nonzero exit, output overflow, cancellation, and postflight mutation keep
  the checkpoint and append bounded immutable attempt evidence.
- A fresh idempotency key resumes repository or combined validation with zero Runtime calls and
  creates only current exact Candidate or Bundle authority after passing evidence.
- Resume rejects changed or dirty HEAD, wrong ownership, non-descendant SHA, changed paths, stale
  selection, Harness, plan or source Run, and every attempted command override.
- Legacy recovery requires the complete exact human-confirmed identity, records distinct
  provenance, and cannot import an unrelated commit or workspace.
- Native Windows `npm run ...` uses the accepted structured adapter; metacharacter arguments are
  preserved rather than interpreted, and timeout and cancellation remain enforceable.
- Validation evidence distinguishes the requested command, resolved executable, adapter, effective
  invocation, outcome, and spawn failure while excluding secret environment values.
- `request_revision` rejects missing or oversized feedback, and only current bounded feedback
  enters planning and execution projections; older decisions and large review artifacts stay out.
- Production code has Simplified Chinese intent comments at the accepted boundaries and contains
  no obsolete fake, mock, temporary command, or migration scaffold.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Domain and schema tests | checkpoint identity, states, feedback bounds, normalization | Required | New shared contracts and private persisted schema |
| Store and restart integration | checkpoint ordering, failed evidence, migration, idempotent resume | Required | Durable crash and recovery boundary |
| Real-Git integration | publication, ancestry, ownership, changed paths, tamper rejection | Required | Exact Candidate identity and legacy recovery |
| Native Windows command integration | `npm.cmd`, metacharacters, locator evidence, timeout, cancellation | Required on Windows | Accepted batch-shim behavior |
| Context regression | current feedback included; checkpoint, locators, output, and history excluded | Required | Bounded Runtime context boundary |
| Shared operation and CLI tests | exact human gate, grammar, delegation, typed failures | Required | Recovery must reuse the product operation boundary |
| Full deterministic `npm run check` under Node.js 24 | final stable implementation subject | Required | Scope crosses schema, stores, Git, commands, context, CLI, and acceptance |
| Real Codex Provider | another Provider invocation | Excluded | Resume must be proven with zero Runtime calls |
| Actual WI-0009 legacy recovery | exact existing Run and commit | Conditional after WI-0010 acceptance and landing | Operational continuation, not implementation validation |
| Documentation and boundary audit | links, status, eager sizes, comments, temporary-code audit | Required | Maintains Harness and stage boundaries |

Every changed test file must execute. The final diff may add narrower affected suites during
implementation, but it may not remove the required full deterministic gate without a new accepted
revision.

## Current Projection

- Current subject: WI-0010 is the sole active implementation WorkItem and is ready for review.
- Last verified state: schema v5, checkpoint/resume, legacy recovery, bounded feedback, and the
  pinned Windows adapter are implemented; the final deterministic gate passes.
- Next step: user review and acceptance of WI-0010. Actual WI-0009 recovery remains later.
- Active blocker or decision: none for implementation. Actual WI-0009 recovery waits for WI-0010
  acceptance and landing; UAC recurrence observation is an independent host limitation.

## Implementation Evidence

| Command | Exit code | Scope and concise observation | Unverified boundary |
| --- | ---: | --- | --- |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/unit/model.test.js test/unit/runtime-context.test.js test/unit/operator-application.test.js test/unit/local-cli.test.js` | 0 | 23 selected tests passed after updating v5 and allowlist expectations | Broader unit suite was then selected separately |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/integration/command-runner.test.js` | 0 | Native Windows `npm.cmd` preserved metacharacter argv; direct and batch timeout, cancellation, and spawn evidence passed | Other hosts remain unverified |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test --test-concurrency=1 test/integration/candidate-checkpoint-recovery.test.js` | 0 | Spawn, dirty preflight, timeout, overflow, nonzero, exact resume, legacy CLI recovery, and combined retry passed with zero resumed Runtime calls | Actual WI-0009 recovery remains excluded |
| `C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test --test-concurrency=1 test/integration/application-boundaries.test.js test/integration/control-store-v4-migration.test.js` | 0 | Bounded feedback, context exclusion, immutable postflight evidence, and idempotent v4-to-v5 migration passed | Full integration was then selected separately |
| `$env:PATH='C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH; node --version; npm test` | 0 | Node.js 24.14.0 ran all 49 unit tests | Integration and acceptance were separate commands |
| `$env:PATH='C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH; node --version; npm run test:integration` | 0 | Node.js 24.14.0 ran all 50 integration tests | Real Provider and actual WI-0009 recovery excluded |
| `$env:PATH='C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH; node --version; npm run test:acceptance` | 0 | Node.js 24.14.0 ran all 6 serial acceptance tests | Real GitHub writes and real Provider excluded |
| `npm audit --omit=dev --json` | 0 | Exact production dependency graph reported zero known vulnerabilities | Registry audit is time-dependent, not runtime proof |
| `$env:PATH='C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH; node --version; npm run check` | 0 | Final stable subject passed 50 unit, 50 integration, and 6 serial acceptance tests in 164.7 seconds | Real Provider, actual WI-0009 recovery, browser, and GitHub writes excluded |
| `git diff --check` plus affected-link, untracked whitespace, eager-size, status-projection, production-fake, generic-shell, dependency, generated-artifact, Chinese-comment, and runaway-process audits | 0 | Documentation and static boundaries passed; eager files are 5872, 1264, and 7320 bytes, and only WI-0010 is in review while WI-0009 is blocked | Static inspection cannot prove other hosts or external systems |

One earlier extended checkpoint test was manually terminated when a Windows `.cmd` timeout left its
child Node process holding the pipe. The exact orphan was inspected and stopped, then production
termination changed to an exact-PID `taskkill /t /f` path. Repeated direct and workflow tests passed
and left no matching child process. A separate first integration command was killed by the tool's
mistaken one-second outer timeout with exit code 124; the unchanged command later passed completely.

The first selected command
`C:\Users\tangyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test test/unit/model.test.js test/unit/runtime-context.test.js test/unit/operator-application.test.js`
returned exit code 1 with three stale test expectations for context schema 3 and the prior operator
allowlist; no production assertion failed. After updating those tests and adding the new boundary
cases, the superseding selected and complete unit commands above passed. A PowerShell loop running
`node --check` over every changed production JavaScript module returned exit code 0 before behavior
tests; it used ambient Node 22 only as a parser check, not as accepted runtime evidence.

Final documentation, link, size, status, dependency, comment, temporary-artifact, and process audits
passed. No real Codex Provider, actual WI-0009 recovery, browser, or GitHub write ran.

## Project Memory Impact

WI-0010 is accepted and landed with private schema v5, durable Candidate checkpoints, exact
validation resume, narrow legacy recovery, bounded revision feedback, and the reviewed Windows
batch-shim adapter. WI-0009 may now resume from its unchanged exact legacy subject without another
Provider invocation.

## Acceptance Review

Accepted by the user on 2026-08-04 together with the instruction to resume WI-0009. Acceptance does
not accept WI-0009 commit `12a7036`, grant a Bundle decision, invoke another Provider, or authorize
GitHub publication.
