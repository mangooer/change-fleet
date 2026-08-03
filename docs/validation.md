# Validation Policy

Status: Active policy; WI-0004 deterministic commands and its opt-in real Provider gate pass

## Principles

- Use the smallest check that covers the changed behavior.
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
| Documentation | formatting, targeted authority/link inspection, and eager Harness size inspection |
| Pure model or state decision | affected unit tests |
| Store, lock, restart, or recovery | affected deterministic integration tests |
| Git workspace or Candidate | affected real-Git integration tests |
| Repository Harness overlay | selector and identity unit tests plus real-Git containment, restart, mutation, cleanup, and Candidate-exclusion integration tests |
| Runtime adapter | deterministic protocol tests |
| API or UI | affected tests plus one targeted user path |
| Multi-repository orchestration | real two-repository acceptance fixture |
| Delivery integration | provider fixture plus exact target-movement case |

## Current Commands

Documentation-only changes require:

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
| `npm run check` | All accepted test scopes on Node.js 24 |

WI-0001 implements the deterministic commands in the private package. WI-0003 adds the real
Provider command but deliberately keeps it outside the normal fast suite. Required completion
evidence must include `npm run check` under Node.js 24; a passing run under another major is only
compatibility evidence.

WI-0004 extends these commands without a parallel fake production path. Its deterministic gate
covers explicit policy authorization, exact-base `.worktreeinclude` resolution, contained
Git-ignored Codex roots, byte limits, immutable restart reconstruction, overlay mutation, no
writeback, and Candidate exclusion. The opt-in real Codex command must still prove one frozen
ignored resource is available without claiming an unobservable Provider load event. The
2026-08-03 authorized gate passed while retaining `unavailable` actual-load coverage.

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
```

Human approval, unavailable infrastructure, or a plausible explanation does not convert an
unexecuted check into a passed check.
