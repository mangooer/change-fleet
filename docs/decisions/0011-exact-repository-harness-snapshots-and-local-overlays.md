# 0011: Freeze Explicit Repository Harness Overlays

Status: Accepted

Date: 2026-07-31

Source: Repository Design Proposal 0009

## Decision

Repository-native Harness remains the semantic authority for a registered repository. Committed
Harness is read from the selected exact Git base. ChangeFleet does not create a mandatory Runtime
Skill, translate Provider formats, or maintain Harness in the registered checkout.

A Repository may optionally have a confirmed, revisioned
`RepositoryWorkspacePolicyRevision` with `purpose = repository_harness`. Its selector is either
ChangeFleet-side explicit Git-ignore-style patterns or a tracked `.worktreeinclude` from the
selected exact base that the user explicitly authorized. Merely finding `.worktreeinclude` never
grants authority.

No later than ChangeSet creation, ChangeFleet freezes one
`RepositoryHarnessSelectionRevision` for each planning-visible Repository. The selection binds the
Repository id, exact base SHA, Provider family, workspace-policy revision, selector digest,
resolved relative paths, content digest, confirmation, and immutable artifact reference. A Run,
retry, or restart reconstructs the same input from this evidence and never rereads overlay bytes
from the registered checkout.

The first overlay mode accepts only contained, regular, Git-ignored files inside Provider-supported
semantic roots. For Codex, the initial eligible local roots are `AGENTS.override.md` and
`.agents/skills/**`. Ordinary untracked-but-not-ignored files, links that may escape the Git root,
tracked-path collisions, Provider settings, hooks, MCP configuration, credentials, environment
files, caches, and general workspace seeds are excluded. Initial per-Repository limits are 128
files, 256 KiB per file, and 2 MiB total.

ChangeFleet materializes the frozen overlay only in its owned planning and execution workspaces.
The overlay is immutable. Before Candidate publication, ChangeFleet verifies its identity, removes
it, and proves that no overlay path or content enters the Candidate. Mutation fails with
`HARNESS_OVERLAY_MODIFIED`.

Non-Git Harness is input evidence, not a delivery surface. ChangeFleet never writes it back to the
registered checkout, includes it in a CandidateBundle, or creates a separate Harness change
proposal. A request whose durable result requires changing private non-Git Harness fails with
`NON_GIT_HARNESS_CHANGE_UNSUPPORTED`; the user must maintain it outside ChangeFleet or place it in
Git.

Run evidence distinguishes exact-base resources, frozen overlay resources, Provider-observable
discovery, and unavailable load observations. Snapshot bodies and detailed inventories remain
linked evidence outside default Agent context. Capability, repository scope, exact Git subjects,
human gates, and the honest `enforced | estimated | unknown` context classification remain
ChangeFleet authority.

## Rationale

Exact Git bases are reproducible but omit intentionally ignored project guidance. Reading the live
checkout would make Run input mutable across planning, retry, and recovery. An explicitly confirmed
policy plus an immutable ChangeSet snapshot preserves native Provider discovery without treating
ambient local state as a second Git base.

Keeping non-Git Harness immutable and outside Candidate delivery also avoids inventing a second
version-control, review, writeback, and rollback system beside Git.

## Consequences

- No Repository policy means exact-base-only behavior and no copied non-Git files.
- A policy may be reused, but each ChangeSet records its own resolved inventory and digest.
- Revising a Harness selection invalidates the current plan and rebuilds current Run context while
  preserving prior attempts.
- Copy authorization is a security boundary even when the Provider does not eagerly place the
  copied bytes in model context.
- Provider adapters own their supported semantic roots and honest discovery observations.
- Generic `workspace_seed`, setup/run/archive behavior, Claude support, external Harness roots,
  remote materialization, and stronger continuous context enforcement require later authority.
- Non-Git Harness writeback and a parallel Harness change-proposal lifecycle are rejected, not
  deferred.
