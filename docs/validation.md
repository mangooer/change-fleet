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
| Repository Harness overlay | selector and identity unit tests plus real-Git containment, restart, mutation, cleanup, and Candidate-exclusion integration tests |
| Runtime adapter | deterministic protocol tests |
| Runtime audit projection | canonical usage and unknown semantics, required-reference integrity, restart reproduction, zero writes, and context exclusion |
| Local audit command | exact grammar, process JSON, exit statuses, projection equivalence, missing-root behavior, and zero writes |
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

WI-0004 extends these commands without a parallel fake production path. Its deterministic gate
covers explicit policy authorization, exact-base `.worktreeinclude` resolution, contained
Git-ignored Codex roots, byte limits, immutable restart reconstruction, overlay mutation, no
writeback, and Candidate exclusion. The opt-in real Codex command must still prove one frozen
ignored resource is available without claiming an unobservable Provider load event. The
2026-08-03 authorized gate passed while retaining `unavailable` actual-load coverage.

The accepted audit-projection boundary requires deterministic tests to prove canonical observation
selection, null preservation, distinct duration and outcome semantics, exact source identity,
bounded pagination, typed failure for malformed required evidence, restart reproduction, and zero
mutation of control state, evidence, workspaces, Git, or registered repositories. A context
regression must prove that audit fields do not enter ordinary Runtime input. The implementation
WorkItem may require one explicitly authorized final paid Codex flow, but that flow remains outside
`npm run check`, is not repeated automatically, and cannot be reported as passed when skipped.

Decision 0013 additionally requires child-process tests for the package-private exact-id audit
command. Success and representative failures must preserve the control-root digest, and an absent
root must remain absent. The command must be compared with the direct query projection under the
same locale and pagination parameters. This presentation-only slice does not repeat the paid
Provider gate.

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
