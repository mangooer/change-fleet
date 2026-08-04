# Validation Policy

Status: Active policy; Node.js 24 deterministic commands and the WI-0005 opt-in Provider gate pass

## Principles

- Use the smallest check that covers the changed behavior.
- Select required gates from the final diff and risk boundary; do not make the full suite a default.
- Execute every changed test file, even when a broader suite is not selected.
- Bind every check to the exact source or Candidate subject it exercised.
- Preserve command, exit code, scope, concise observation, and unverified boundaries.
- Do not treat Agent prose as deterministic execution evidence.
- Do not rerun an expensive exact check solely to duplicate evidence.
- A changed base or candidate SHA invalidates subject binding even when the patch text appears
  equivalent.
- Combined validation must identify the exact Candidate set and required check definition. Its
  finalized evidence is then included in the CandidateBundle.

## Tiers

| Change | Required scope |
| --- | --- |
| Documentation only | formatting, targeted authority/link inspection, and eager Harness size inspection; no Node tests |
| Test only | every changed test file; add its production subject test when expectations or fixtures changed |
| Pure model or state decision | affected unit tests |
| Store, lock, restart, or recovery | affected deterministic integration tests |
| Git workspace or Candidate | affected real-Git integration tests |
| Candidate checkpoint or validation resume | domain and schema tests plus store restart, real-Git preflight, immutable-attempt, zero-Runtime resume, and tamper integration tests |
| Repository Harness overlay | selector and identity unit tests plus real-Git containment, restart, mutation, cleanup, and Candidate-exclusion integration tests |
| Runtime adapter | deterministic protocol tests |
| Runtime audit projection | canonical usage and unknown semantics, required-reference integrity, restart reproduction, zero writes, and context exclusion |
| Debug audit CLI route | exact grammar, process JSON, exit statuses, projection equivalence, missing-root behavior, and zero writes |
| Unified local CLI | allowlist, application delegation, idempotency, process I/O, human gates, lifecycle path, and obsolete-entry removal |
| API or UI | affected tests plus one targeted user path |
| Multi-repository orchestration | real two-repository acceptance fixture |
| Delivery integration | provider fixture plus exact target-movement case |

## Selection Rules

Validation is selected twice: when a WorkItem is confirmed and again from its final diff before
review. The WorkItem records each required, conditional, or explicitly excluded gate and why. A
later scope or diff change requires reselection; it does not automatically require the full suite.

During implementation, run the smallest test file or command that covers the current edit. Before
review, run the selected gates against the stable final code. Every changed production module must
have at least one direct behavioral check, and every changed test file must execute. If no reliable
dependency boundary is known, escalate to the nearest parent suite and record that uncertainty.

`npm run check` is required when at least one of these conditions applies:

- the final diff changes shared domain contracts, persisted schemas, package dependencies, module
  loading, or the test runner;
- the change crosses several tiers such as lifecycle, stores, workspaces, Runtime, and acceptance;
- no bounded test set can cover the affected dependency surface with reasonable confidence;
- an accepted Proposal, Decision, WorkItem, release, or merge policy explicitly requires it.

`npm run check` is not required merely because files changed. Documentation-only work runs no Node
tests. An isolated module with direct unit or integration coverage may stop after those selected
checks. A changed test fixture must run every test file that consumes it or the nearest owning
suite when consumers are not reliably enumerable.

Run an expensive full gate only after code has stabilized. A later evidence, comment, or
documentation-only edit does not invalidate it. A later production, dependency, test-runner, or
behavioral test change does invalidate the relevant subject; reselect the smallest gates, and rerun
the full suite only when one of the full-suite conditions still applies.

## Current Commands

Documentation-only changes require the following command plus targeted link and eager-size
inspection; they do not require Node tests:

```sh
git diff --check
```

Decision 0006 accepts this implementation command contract:

| Package command | Scope |
| --- | --- |
| `npm test` | Pure domain and application tests |
| `npm run test:integration` | Filesystem, locks, recovery, real-Git workspaces, and Candidate identity |
| `npm run test:acceptance` | Serial real two-repository flow |
| `npm run test:provider:codex` | Opt-in real Codex single-Repository flow; requires `CHANGEFLEET_RUN_REAL_CODEX=1` and external credentials |
| `npm run check` | Fail-fast Node.js 24 guard, then all accepted test scopes |

WI-0001 implements the deterministic commands in the private package. WI-0003 adds the real
Provider command but deliberately keeps it outside the normal fast suite. A WorkItem that selects
`npm run check` must run it under Node.js 24; a passing run under another major is only compatibility
evidence. The check entry point validates its actual process major before dispatching tests and
fails immediately with `UNSUPPORTED_NODE_VERSION` when PATH selected another major.

The real Provider command is a development-validation gate. `CHANGEFLEET_RUN_REAL_CODEX=1` prevents
accidental nondeterministic external execution; it is not a product Runtime switch, a Codex SDK
per-Run approval, or part of `npm run check`. Select the gate only when the WorkItem or final diff
crosses Provider invocation, Runtime-host provisioning, Provider evidence capture, or another
explicit end-to-end boundary. Within this repository, the user has granted standing authorization
to run a selected real Codex gate without another conversational confirmation. Repository scope,
network, full-host access, destructive delivery, or a new external-cost class still requires its
own authority. A skipped gate is never reported as passed.

The accepted audit-projection boundary requires deterministic tests to prove canonical observation
selection, null preservation, distinct duration and outcome semantics, exact source identity,
bounded pagination, typed failure for malformed required evidence, restart reproduction, and zero
mutation of control state, evidence, workspaces, Git, or registered repositories. A context
regression must prove that audit fields do not enter ordinary Runtime input. A selected real Codex
source-to-projection check follows the development Provider rule above and is not repeated merely
because presentation code changed.

Decision 0013's exact-id audit boundary continues beneath the unified CLI debug namespace. Success
and representative failures preserve the control-root digest, an absent root remains absent, and
the command is compared with the direct query projection under the same locale and pagination.
This presentation path does not repeat the paid Provider gate.

Decision 0014 requires the unified CLI to prove explicit operator-command allowlisting, unchanged
application input and result delegation, caller idempotency, typed process failure, and one complete
current local lifecycle path. Audit migration must retain Decision 0013's projection and zero-write
checks. Final review also inspects `bin/`, package scripts, documentation, and tests to prove the
standalone audit entry point and every unowned temporary executable are absent. Real Provider
validation follows the shared development rule above rather than a CLI-specific permission gate.

Decision 0015 requires deterministic GitHub delivery tests at four boundaries: pure binding and
request identity; structured `gh` argv and bounded JSON normalization; real local Git remote
publication, non-force conflict, target movement, and reachability; and complete application
recovery through single- and multi-Repository acceptance. Tests must distinguish closed-unmerged,
Candidate-diverged, integration-stale, partial merge, and exact completion. Provider fixtures stay
under test support and cannot be selected by production configuration.

Real GitHub validation is an external-write gate, not part of `npm run check` and not authorized by
the standing real Codex test permission. Before running it, record the exact repository, branch
namespace, PR visibility, expected writes, human merge behavior, and cleanup authority. An omitted
real GitHub gate remains explicitly unverified even when deterministic Git and `gh` fixture tests
pass.

Decision 0016 requires selected tests for the bounded ChangeSet list, exact-subject UI projection,
explicit HTTP route allowlist, body and output limits, typed error mapping, loopback/Host/Origin and
session/CSRF checks, graceful shutdown, zero-mutation GET behavior, caller idempotency, stale Bundle
decisions, delivery reconciliation, and Runtime-context exclusion. The existing isolated audit CLI
keeps its stronger zero-capability process tests even when the local lifecycle server presents the
same bounded audit facts.

The first UI WorkItem may add one exact pinned `@playwright/test` development dependency and an
explicit Chromium install step. Its `test:ui` gate is required when browser assets, view models,
HTTP behavior, or local-browser security change. Documentation-only and unrelated domain changes
do not launch or download a browser. Missing browser infrastructure is reported as unavailable,
not passed, and generated screenshots, traces, reports, and browser binaries stay outside Git and
control state.

Decision 0017 requires deterministic tests for CandidateCheckpoint identity and persistence,
immutable failed validation evidence, restart and zero-Runtime repository or combined resume,
human-gated exact legacy recovery, and tampered-subject rejection. Native Windows integration must
prove `npm.cmd` resolution, metacharacter argv preservation, effective-invocation evidence, timeout,
and cancellation without exposing a caller-provided shell command.

Context regression must prove that only bounded current `request_revision` feedback enters later
planning and execution while checkpoint details, host locators, output, complete review artifacts,
and older decisions remain excluded. WI-0010 changes shared domain contracts, persisted schema,
stores, Git workspaces, command launch, context, and CLI behavior, so its final stable subject must
run `npm run check` under Node.js 24. Another real Provider call is excluded; actual WI-0009 legacy
recovery is an operational continuation only after WI-0010 is accepted and landed.

The recommended first real GitHub gate is the accepted UI WorkItem's exact Candidate rather than a
disposable smoke change. It remains separately authorized under the repository, branch, PR, merge,
and cleanup rules above; Proposal or WorkItem acceptance alone does not grant the write.

For Harness documentation, also inspect the byte sizes of `AGENTS.md`, `WORKFLOW.md`, and
`docs/current-state.md` against the soft limits in `docs/harness.md`. This is a maintenance
observation, not proof of provider token usage or the proposed 70-percent Runtime bound.

## Acceptance Evidence

Every implementation WorkItem should record:

```text
command
exit_code
scope
subject identity
observation
artifact reference when available
unverified boundary
wall duration when materially expensive
```

Human approval, unavailable infrastructure, or a plausible explanation does not convert an
unexecuted check into a passed check.
