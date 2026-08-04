# 0017: Durable Codex Runtime Home And Pre-Candidate Retry

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-04

Accepted: 2026-08-04

Supersedes:

Superseded in part by: [Proposal 0018](0018-provider-environment-ownership-and-pre-candidate-retry-correction.md)

Depends on: Decisions 0005, 0009, 0010, and 0017; WI-0009-v2 execution evidence

Blocks: Safe retry of `changefleet-wi-0009-v2`

Decision: [Decision 0019](../decisions/0019-durable-codex-runtime-home-and-pre-candidate-retry.md)

Implementation tracking: [WI-0012](../work-items/WI-0012-durable-codex-runtime-home-and-pre-candidate-retry.md), `done`

## Context

The first execution of `changefleet-wi-0009-v2` exposed two coupled correctness gaps before a real
Candidate existed.

ChangeFleet created a fresh temporary `CODEX_HOME` for every Provider invocation and copied local
authentication, `cap_sid`, and the elevated Windows sandbox marker. It intentionally omitted the
sandbox account credential state. Planning could complete, but the first workspace-write shell
command treated the temporary home as incompletely provisioned, repeatedly launched
`codex-windows-sandbox-setup.exe`, and failed with Windows error `1223`. This is operating-system
setup, not a Codex approval request, so `approvalPolicy: "never"` cannot suppress it.

The Provider nevertheless returned `implementation_completed` after all commands failed. The
workspace remained at its exact base with no changed paths. ChangeFleet published and persisted a
base-equal CandidateCheckpoint, then attempted repository validation. The check independently
failed because the host `PATH` resolved Node.js 22 while this repository requires Node.js 24.

The failed aggregate now has an immutable completed Run, an empty checkpoint, failed validation
evidence, and no Candidate. The existing resume path would only validate that empty checkpoint; it
must not be used to manufacture success. Closing the ChangeSet and creating another task would also
hide a general pre-Candidate retry gap already anticipated by Decision 0010.

## Decision

Give the Codex adapter one durable, isolated Provider Runtime Home for each local credential profile
and pinned adapter version. Its root is explicit host configuration. It is Provider operational
state, not ChangeFleet Control Store state, Repository Harness, Runtime Kit, workspace input, or Git
content.

The adapter initializes the home once from the selected credential source. It copies only the
authentication and native Windows sandbox state required by the pinned CLI, including the sandbox
account credential file, and then reuses that isolated home for later fresh Provider threads. It
does not copy user config, instructions, Skills, plugins, MCP configuration, sessions, history, or
other ambient Codex Home content. Secret bytes and host locators never enter ChangeSet, Run,
Evidence, logs, prompts, or diagnostics. A missing or incomplete required source fails closed before
starting the Provider. An SDK/CLI version change receives a different versioned home rather than
silently reusing incompatible state.

Add a strict `implementation_blocked` execution outcome. A Runtime that cannot inspect, edit, or
verify the workspace reports a bounded blocker instead of claiming completion. A Provider turn may
complete while the WorkUnit remains blocked; these are separate facts.

Reject an `implementation_completed` result when deterministic Git publication proves that the
candidate SHA equals the base or that no changed path exists. Preserve the completed Provider Run,
but do not create a current CandidateCheckpoint or start validation.

A new explicit `changeset.execute` request may retry semantic execution in the same ChangeSet only
before a real Candidate exists and only after deterministic preflight proves the owned workspace is
still clean at the exact confirmed base. The retry uses a fresh Run and Provider thread, preserves
all earlier Runs, usage, checkpoints, validation attempts, commands, and blockers, and records a
bounded retry decision. An old base-equal checkpoint is detached from the current WorkUnit but
retained as immutable history. No retry resets, cleans, or adopts a partially modified workspace.

The Node.js 24 failure is corrected operationally for the dogfood retry by launching ChangeFleet
with Node.js 24 first on `PATH`. This proposal does not force every registered repository's `node`
command to use ChangeFleet's own executable or add a general toolchain manager.

## Post-Acceptance Implementation Finding

The first real Provider gate on 2026-08-04 disproved the Sandbox-state copy assumption. The pinned
Codex CLI completed its non-elevated ACL refresh, then reported that the copied Sandbox users were
missing or incompatible and entered its explicit elevated setup path. The selected global source
home already contained the same incompatibility in its prior Sandbox log. Codex subsequently
removed the copied users file while recovering from the failed logon.

Plain file copying also does not reproduce the protected ACLs that the official elevated setup
applies to `.sandbox-secrets`. Therefore the accepted secret-copy mechanism must not land. The
durable-home, blocked-result, empty-publication, and clean pre-Candidate retry directions remain
separable, but Runtime provisioning now requires a follow-up accepted design. No further real
Provider or WI-0009-v2 retry is authorized by this proposal alone.

## Boundaries

- A durable Runtime Home contains Provider operational state only and is excluded from Runtime
  context, audit payloads, registered repositories, Candidate publication, and Harness discovery.
- Every semantic retry requires a new operator execution command and idempotency key. There is no
  timer, retry budget, hidden loop, or automatic paid Provider invocation.
- Retry keeps the same ChangeSet, confirmed plan, Repository and Harness selections, WorkUnit,
  target, base SHA, and task. Changing any of those still requires the existing revision or new-task
  flow.
- A dirty workspace or moved HEAD blocks retry. ChangeFleet does not reset, stash, delete, or merge
  partial work.
- CandidateCheckpoint validation resume remains unchanged for a non-empty exact Candidate. A real
  Candidate is never discarded merely to rerun the Provider.
- Provider-session continuation, transcript replay, turn checkpoints, in-flight steering, generic
  rewind, and user-authored retry feedback remain deferred.
- `unelevated`, full host access, the user global Codex Home, and WSL are not silent fallbacks.

## Alternatives

### Copy Sandbox State Into Every Temporary Home

This keeps the current lifecycle but duplicates sensitive state, loses sandbox mapping updates when
the directory is deleted, and recreates the same setup race on every invocation.

### Reuse The User Global Codex Home

This avoids provisioning but reintroduces ambient config, Harness, Skills, plugins, MCP servers,
history, and sessions that ChangeFleet deliberately excludes.

### Switch To Unelevated Or Full Access

The unelevated sandbox is a documented troubleshooting fallback but weakens the accepted native
Windows boundary. Full access violates the operation-scoped Provider contract. Neither should occur
without an explicit Agent Profile and later accepted security design.

### Close The ChangeSet And Create A Third Task

This is valid when the base or requested business change has changed. It is unnecessary when the
same exact-base WorkUnit failed before producing any change and would avoid fixing the controller
defect.

### Recommended

Use a versioned durable isolated Runtime Home, strict blocked and empty-result handling, and an
operator-triggered clean-base pre-Candidate retry in the same ChangeSet.

## Acceptance Criteria

- Repeated invocations for one credential profile and pinned SDK reuse one deterministic isolated
  Runtime Home while fresh Provider threads remain per Run.
- The home contains only the accepted minimal Provider files; tests prove user config, Harness,
  Skills, plugins, MCP data, sessions, and history are not copied.
- Native Windows setup credentials are required without reading or emitting their contents in
  diagnostics, persisted state, or test output.
- `implementation_blocked` is a valid strict structured result and cannot become a checkpoint,
  Candidate, validation subject, or Bundle.
- A base-equal or empty published result fails with a stable diagnostic before checkpoint
  persistence and repository validation.
- A new execution command retries a failed or blocked pre-Candidate WorkUnit only from an owned,
  clean, exact-base workspace and creates a new immutable Run attempt.
- An existing base-equal checkpoint can be retired from current authority without deletion; its
  Run, validation attempt, usage, command, blocker, and checkpoint remain auditable.
- Dirty, moved, real-Candidate, stale-plan, stale-selection, and stale-Harness subjects fail closed
  without Runtime invocation or workspace mutation.
- A real Windows Provider gate no longer displays per-Run sandbox setup after the Runtime Home is
  correctly initialized; until observed, that claim remains unverified.
- The WI-0009-v2 retry runs ChangeFleet and its repository check under Node.js 24. No product-level
  universal Node resolution claim is made.

## Validation

- Unit tests for strict execution outcomes, diagnostics, and Runtime Home identity.
- Integration tests for minimal persistent-home initialization and reuse using test-only fake
  credential files; no real sandbox secret content enters fixtures.
- Integration tests for blocked output, empty publication, exact clean-base retry, process restart,
  old empty-checkpoint retirement, dirty/moved rejection, and zero Runtime calls for real Candidate
  validation resume.
- Context and audit regressions proving Runtime Home locators, secret paths, retry detail, and
  validation output remain excluded while attempt usage stays attributable to the ChangeSet.
- Full deterministic `npm run check` under Node.js 24 after the cross-layer implementation
  stabilizes.
- One separately observed real Windows Provider retry for `changefleet-wi-0009-v2`; any UAC prompt
  or setup failure is reported, not clicked through or treated as success.

## Non-Goals

- Runtime Kit packaging, optional Skills, App Server, another Provider, Linear, remote workers, or
  hosted credential management.
- Automatic retries, retry budgets, pricing, effectiveness ranking, dashboard comparison, or
  cross-ChangeSet lineage aggregation.
- Partial-workspace reset, stash, cleanup, deletion, import, merge, or arbitrary commit adoption.
- Provider-session resume, transcript retention changes, conversation editing, or turn-level
  continuation.
- A general Node version manager, repository toolchain installer, PATH policy, or validation-command
  rewrite.
- UI controls for execution or recovery in WI-0009.
