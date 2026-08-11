# Validation Policy

Status: Active policy

## Principles

- Use the smallest check that covers the changed behavior.
- Select required gates from the final diff and risk boundary; do not make the full suite a default.
- Execute every changed test file, even when a broader suite is not selected.
- Bind every check to the exact source or Candidate subject it exercised.
- Preserve command, exit code, scope, concise observation, and unverified boundaries.
- Do not treat Agent prose as deterministic execution evidence.
- Do not rerun an expensive exact check solely to duplicate evidence.
- A changed base or Candidate SHA invalidates subject binding even when the patch appears equivalent.
- Combined validation identifies the exact Candidate set and explicit optional project-check
  selection. Finalized structural or command-backed evidence becomes part of the CandidateBundle.

## Tiers

| Change | Required scope |
| --- | --- |
| Documentation only | formatting, targeted authority/link inspection, and eager Harness size inspection; no Node tests |
| Test only | every changed test file; add its production subject test when expectations or fixtures changed |
| Pure model or state decision | affected unit tests |
| Store, lock, restart, or recovery | affected deterministic integration tests |
| Git workspace or Candidate | affected real-Git integration tests |
| Verification or Bundle review | exact-subject admission, check/review protocol, mutation rejection, feedback or Gate routing, restart, and audit tests |
| Repository Harness overlay | selector and identity unit tests plus real-Git containment, restart, mutation, cleanup, and Candidate-exclusion integration tests |
| Runtime adapter | deterministic protocol, evidence, failure, and context-boundary tests |
| Runtime audit projection | canonical usage and unknown semantics, required-reference integrity, restart reproduction, zero writes, and context exclusion |
| Local CLI, HTTP, or UI | operation allowlist, shared application delegation, typed errors, caller idempotency, security boundary, and targeted user path |
| ChangeSet closure | strict request bounds, quiescence and delivery gates, history preservation, restart, context exclusion, and shared operation path |
| Multi-repository orchestration | real two-repository acceptance fixture |
| Delivery integration | provider fixture plus exact target-movement case |

## Selection Rules

Validation is selected when a WorkItem is confirmed and again from its final diff before review.
The WorkItem records each required, conditional, or explicitly excluded gate and why. A later scope
or diff change requires reselection; it does not automatically require the full suite.

During implementation, run the smallest test file or command that covers the current edit. Before
review, run the selected gates against stable final code. Every changed production module must have
at least one direct behavioral check, and every changed test file must execute. If no reliable
dependency boundary is known, escalate to the nearest parent suite and record that uncertainty.

`npm run check` is required when at least one condition applies:

- the final diff changes shared domain contracts, persisted schemas, package dependencies, module
  loading, or the test runner;
- the change crosses several tiers such as lifecycle, stores, workspaces, Runtime, and acceptance;
- no bounded test set covers the affected dependency surface with reasonable confidence;
- an accepted Proposal, Decision, WorkItem, release, or merge policy explicitly requires it.

`npm run check` is not required merely because files changed. Documentation-only work runs no Node
tests. An isolated module with direct unit or integration coverage may stop after those selected
checks. A changed fixture must run every known consumer or the nearest owning suite when consumers
cannot be enumerated reliably.

Run an expensive full gate only after code stabilizes. A later evidence, comment, or
documentation-only edit does not invalidate it. A later production, dependency, test-runner, or
behavioral-test edit invalidates the relevant subject; reselect the smallest gates and rerun the
full suite only while a full-suite condition still applies.

## Current Commands

Documentation-only changes require this command plus targeted link and eager-size inspection:

```sh
git diff --check
```

When the diff changes this repository's `AGENTS.md`, `WORKFLOW.md`, `docs/current-state.md`, or a
Development WorkItem, also run `npm run check:harness` under Node.js 24. This is ChangeFleet
repository tooling; it is not a product command and does not impose a command or format on a
registered repository.

| Package command | Scope |
| --- | --- |
| `npm run check:harness` | ChangeFleet WorkItem frontmatter and eager repository-Harness limits |
| `npm test` | Pure domain and application tests |
| `npm run test:integration` | Filesystem, locks, recovery, real-Git workspaces, and Candidate identity |
| `npm run test:acceptance` | Serial real two-repository flow |
| `npm run test:provider:codex` | Opt-in real Codex flow; requires `CHANGEFLEET_RUN_REAL_CODEX=1` and external credentials |
| `npm run test:ui` | Selected browser paths; requires the pinned Playwright browser |
| `npm run check` | Fail-fast Node.js 24 guard, then all deterministic accepted scopes |

A WorkItem that selects `npm run check` runs it under Node.js 24. The check entry point validates
the actual process major and fails with `UNSUPPORTED_NODE_VERSION` when PATH selects another major.

The real Provider command is a development-validation gate. `CHANGEFLEET_RUN_REAL_CODEX=1` prevents
accidental nondeterministic execution; it is not a product Runtime switch or per-Run approval.
Select it only when the final diff crosses Provider invocation, Runtime-host provisioning,
Provider evidence capture, or another explicit end-to-end boundary. Within this repository, the
user has granted standing authority to run a selected real Codex gate without another
conversational confirmation. Repository scope, network, full-host access, destructive delivery,
or a new external-cost class still requires its own authority. A skipped gate is never reported as
passed.

Real GitHub validation is an external-write gate, not part of `npm run check` and not covered by the
standing real Codex permission. Before running it, record the exact repository, branch namespace,
PR visibility, expected writes, human merge behavior, and cleanup authority. An omitted real
GitHub gate remains explicitly unverified when deterministic Git and `gh` fixture tests pass.

Verification, review, and supervision tests bind every decision to the exact immutable subject and
prove that Runtime output remains a proposal. Deterministic control code owns admission, budgets,
transitions, mutation checks, Feedback and Gate routing, and final human authority. Tests should
exercise the current coarse phase and generic Run lifecycle rather than preserve superseded
operation-specific states or private schema migrations.

Local adapters exercise shared application operations, never shell through the CLI. Browser tests
are selected when browser assets, view models, HTTP behavior, or local-browser security change.
Missing Playwright packages or browser binaries fail a selected gate closed; generated screenshots,
traces, reports, and browser binaries stay outside Git and control state.

For Harness documentation, `npm run check:harness` verifies the mechanical WorkItem metadata and
the byte sizes of `AGENTS.md`, `WORKFLOW.md`, and `docs/current-state.md`. Still inspect affected
links and semantic authority projections. This repository check is not proof of Provider token
usage or the 70-percent Runtime target.

## Acceptance Evidence

Every implementation WorkItem records:

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
