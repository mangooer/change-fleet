# 0009: Exact Repository Harness Snapshots And Local Overlays

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-07-31

Discussion revised: 2026-07-31

Accepted: 2026-07-31

Supersedes:

Depends on: Decisions 0003, 0005, 0008, and 0010; WI-0003, `done`

Decision:
[Decision 0011](../decisions/0011-exact-repository-harness-snapshots-and-local-overlays.md)

Implementation tracking:
[WI-0004](../work-items/WI-0004-exact-repository-harness-snapshots-and-local-overlays.md),
`done`

## Context

The user rejected a ChangeFleet-owned Runtime Skill Kit for the next stage. A managed Agent should
instead discover and follow the registered project's own Harness in the provider's native format.
ChangeFleet remains responsible only for exact input identity, capability limits, evidence, and
Candidate integrity.

Provider-native project resources do not use one universal path:

- Codex loads project instructions from `AGENTS.md` or `AGENTS.override.md` and project Skills from
  `.agents/skills` (plural);
- Claude Code loads `CLAUDE.md`, private `CLAUDE.local.md`, project Skills from `.claude/skills`,
  and other project-scoped resources under `.claude`.

Codex documents repository Skill discovery from `.agents/skills` between the current working
directory and Git root. Claude Code documents `.claude/skills`, `CLAUDE.local.md`, and a
`.worktreeinclude` file that can name ignored files for its own worktree workflow. See the official
[Codex Skill guidance](https://developers.openai.com/plugins/build/skills),
[Claude Code Skills](https://code.claude.com/docs/en/slash-commands), and
[Claude worktree reference](https://code.claude.com/docs/en/worktrees).

The existing ecosystem confirms a useful but narrow convention:

- Claude Code copies paths that both match a root `.worktreeinclude` pattern and are Git-ignored;
- [Conductor](https://www.conductor.build/docs/guides/use-files-to-copy) supports either a
  committed `.worktreeinclude` or per-Repository "Files to copy" settings;
- [Worktrunk](https://worktrunk.dev/step/#wt-step-copy-ignored) also consumes
  `.worktreeinclude`, adds exclusions, and treats the operation as worktree initialization;
- [OpenAI's Codex repository](https://github.com/openai/codex/pull/31271) uses
  `.worktreeinclude` to carry an ignored developer-specific Bazel configuration into Codex
  worktrees.

These mechanisms solve workspace initialization. They do not define whether copied content is
semantic Harness, whether an Agent may read it, or whether it becomes model context. Git worktree
itself checks out Git content and does not version ignored copies.

[Conductor's local workspace design](https://www.conductor.build/docs/concepts/git-worktrees)
provides the closest concrete reference for this proposal. It keeps the registered checkout as
project root, creates a branch in a linked Git worktree, copies selected Git-ignored static files,
and then layers setup, run, checkpoint, review, and archive behavior around that worktree.
ChangeFleet adopts this phase separation for local workspaces:

```text
exact Git materialization
-> authorized static workspace inputs
-> environment setup
-> Agent and project processes
-> verification and cleanup
```

ChangeFleet does not copy Conductor's base-selection semantics, implicit `.env*` default, live
settings behavior, or root-checkout Spotlight synchronization. The selected branch and exact base
SHA remain ChangeSet authority. Proposal 0009 implements only exact local worktree materialization
and static Harness input; setup, run, archive, and general `workspace_seed` behavior remain later
boundaries.

Committed resources are present naturally in ChangeFleet's detached exact-base workspaces. Ignored
or untracked resources are not. A normal Git clone also excludes them, so switching from worktree
to clone does not solve this problem.

The current `RepositoryWorker.discoverHarness` reads only committed root `AGENTS.md` and
`WORKFLOW.md` metadata from the frozen base. It intentionally excludes dirty checkout state.
Silently copying the registered checkout's current `.agents`, `.claude`, or local instruction
files into a later Run would break that exact-base guarantee:

- content could change after task confirmation;
- restart could reconstruct a different input;
- a private settings file could expand tools or permissions;
- copied files could enter the Candidate through `git add -A`;
- audit evidence could not identify which instructions produced the result.

The design must preserve native provider discovery without treating live uncommitted files as an
implicit second Git base.

Discussion identified two separate decisions that must not be collapsed:

1. a Repository workspace policy selects which local, non-Git files may seed an owned workspace;
2. Git membership decides whether a changed file can become a durable ChangeFleet deliverable.

Files absent from Git may be copied into an owned workspace, but ChangeFleet never writes them back
to the registered checkout and never creates a parallel non-Git delivery protocol. Durable Harness
maintenance requires the user to edit the source outside ChangeFleet or place the resource in Git.

Copying a file does not by itself place its full body in the prompt. Provider-native instruction
discovery, Skill metadata advertisement, and on-demand Skill loading still determine model input.
However, a copied file may be readable through filesystem tools, so copy authorization remains a
security and evidence boundary even when it is not a context-budget event.

## Design Options

### Option A: Committed exact-base Harness only

Use only provider-native resources present in the selected base commit.

Advantages:

- exact, reproducible, and naturally materialized;
- no additional snapshot store or cleanup path;
- Candidate Git identity and Harness identity share one subject.

Disadvantages:

- intentionally private or ignored project guidance is unavailable;
- teams must commit every Skill and instruction resource;
- does not support `CLAUDE.local.md`-style project-local preferences.

This remains the default mode and safe fallback.

### Option B: Read ignored files live from the registered checkout

Give the Agent read access to the checkout or copy matching files immediately before every Run.

Advantages:

- simplest way to see the operator's current local setup;
- no snapshot lifecycle.

Disadvantages:

- Run input changes without a ChangeSet revision;
- branch movement, local edits, restart, and concurrent user changes alter behavior;
- expands read authority from exact workspaces back to the registered checkout;
- cannot bind evidence to immutable content.

Reject this option.

### Option C: Automatically follow a Repository copy manifest

For example, treat a committed `.worktreeinclude` as standing authority to copy every matched
ignored file.

Advantages:

- matches one Provider's familiar local workflow;
- allows a project to maintain its own copy list.

Disadvantages:

- a copy list may include `.env`, credentials, caches, generated binaries, or unrelated local
  state;
- the convention is broader than Harness and may select build inputs, dependencies, and secrets;
- a manifest discovered in Git would become authorization without an explicit ChangeFleet policy;
- an ignored or live-edited manifest would reintroduce mutable ambient authority.

Do not enable a manifest merely because it exists. It may be used as one explicitly configured
selector source.

### Option D: Repository workspace policy plus immutable task snapshot

The user creates an optional, revisioned ChangeFleet Repository policy once. It selects
Git-ignore-style patterns directly or explicitly opts into the `.worktreeinclude` from the exact
selected base. At ChangeSet creation, ChangeFleet resolves that policy against eligible local
resources, freezes the actual paths and bytes, and binds the resulting snapshot to the selected
Repository base.

Advantages:

- supports ignored project-native Skills and instructions;
- avoids selecting the same stable paths for every ChangeSet;
- supports both a familiar Repository manifest and private ChangeFleet-side settings;
- restart and retry reconstruct the same input;
- the Agent discovers normal provider paths;
- overlay content is evidence rather than hidden ambient state.

Disadvantages:

- adds policy revision, resolution, storage, materialization, cleanup, and staleness behavior;
- private content becomes persisted ChangeFleet evidence and is sent to the Provider;
- provider configuration must be separated from semantic Harness.

This is the recommended optional mode, layered on Option A.

### Option E: Register an external Harness directory

Let a Repository point to another arbitrary local directory containing private Harness resources.

This expands path authorization beyond the registered checkout and complicates remote workers.
Defer it. The first overlay source must stay inside the explicitly registered local Repository
root.

### Option F: Let the Agent edit copied Harness and automatically sync it back

Advantages:

- matches the feel of editing a normal workspace;
- requires no additional review object.

Disadvantages:

- bypasses Git Candidate identity, review, rollback, and delivery semantics;
- can overwrite a concurrently edited private file;
- lets one Run change instructions that a later turn in the same Run may discover;
- turns workspace cleanup into an implicit write to the registered checkout.

Reject this option.

### Option G: Produce a separate Harness revision proposal

Create a second review object and a compare-and-swap workflow for private Harness changes outside
Git.

Advantages:

- could make ignored Harness editable through ChangeFleet;
- could detect concurrent source edits before writeback.

Disadvantages:

- introduces a second review subject and an explicit apply lifecycle;
- multi-file local writeback cannot promise Git-like atomicity or rollback;
- duplicates source-control behavior without Git identity;
- expands ChangeFleet beyond Git Candidate delivery.

Reject this option. ChangeFleet does not write back or deliver files that are not maintained in
Git.

## Recommended Decision

### 1. Use project-native Harness, not a ChangeFleet-owned Skill

ChangeFleet does not create a generic `changefleet-plan` or `changefleet-execute` Skill. It does
not rewrite Codex resources into Claude format or vice versa. Each Runtime adapter recognizes only
the semantic project resources supported by that Provider and version.

The provider's project Harness may guide implementation, architecture, checks, and task method. It
cannot expand ChangeFleet repository scope, network access, tools, credentials, human gates, or
Candidate authority.

### 2. Default to the exact Git base

Committed `AGENTS.md`, `.agents/skills`, `CLAUDE.md`, `.claude/skills`, and other supported semantic
resources are ordinary exact-base repository content. Owned workspaces materialize them from the
selected commit and let the Provider discover them normally.

ChangeFleet records available resource paths, Git blob or tree identity, sizes, and provider
discovery evidence when observable. It does not eagerly copy all bodies into the Control Contract.

### 3. Separate stable Repository policy from exact ChangeSet input

An optional `RepositoryWorkspacePolicyRevision` belongs to ChangeFleet's Repository configuration,
not to a file that ChangeFleet creates in the registered repository. It records:

```text
repository_id
policy_revision
purpose = repository_harness
selector = explicit_patterns | exact_base_worktreeinclude
patterns_or_manifest_path
confirmed_by
confirmed_at
```

The recommended policy has no mutation or writeback mode.
`purpose = repository_harness` is always immutable.

No policy means no non-Git files are copied. `explicit_patterns` are stored in ChangeFleet
configuration. `exact_base_worktreeinclude` means the user has explicitly authorized the tracked
`.worktreeinclude` from the selected base as the selector; the mere presence of the file is not
authorization. An untracked `.worktreeinclude` may be previewed and imported into a new explicit
policy revision, but is never reread live as standing authority.

The policy is a reusable authorization boundary, not exact Run evidence. An optional
`RepositoryHarnessSelectionRevision` is therefore still established no later than ChangeSet
creation for every planning-visible Repository. It records:

```text
repository_id
resolved_base_sha
mode = exact_base_only | exact_base_plus_overlay
provider_family
workspace_policy_revision
selector_digest
resolved_relative_paths
content_digest
artifact_reference
confirmed_by
confirmed_at
```

`exact_base_only` requires no overlay artifact. For `exact_base_plus_overlay`, ChangeSet creation
resolves the confirmed policy, validates every resulting path, shows a bounded inventory and digest
summary as part of task confirmation, and persists the immutable snapshot atomically with the
initial Repository and Harness selections. A caller may explicitly override or disable the
Repository default for that ChangeSet, which creates a new selection revision without mutating the
Repository policy.

The Runtime never rereads those files from the registered checkout. A changed local file affects
only a later explicit Harness selection revision. Revising Harness invalidates the current plan
and creates fresh Run context while preserving prior attempts.

### 4. Keep the first overlay source below the registered checkout

Every selected path is normalized relative to the registered Git root. Following Conductor's
useful safety rule, the first overlay admits only paths that Git reports as ignored. Ordinary
untracked-but-not-ignored files remain dirty checkout state and are never copied. The snapshotter:

- rejects absolute paths, parent traversal, filesystem junctions, and escaping symlinks;
- accepts only regular files and directories composed of contained regular files;
- requires every selected non-Git path to be Git-ignored in the registered checkout;
- rejects a path that collides with tracked content in the selected base;
- records canonical relative paths, file bytes, executable mode when meaningful, and a complete
  canonical digest;
- applies explicit file-count, per-file, and total-byte limits before persistence.

The first recommended limits are 128 files, 256 KiB per file, and 2 MiB total per Repository
overlay. Larger project resources require a later reviewed limit change or an external artifact
design.

### 5. Classify semantic Harness separately from general workspace seeds

The shared selector syntax may resemble `.worktreeinclude`, but the first Proposal 0009
implementation accepts only `purpose = repository_harness`. Provider adapters contribute bounded
semantic roots. The first Codex roots may contain:

```text
AGENTS.override.md
.agents/skills/**
```

Root `AGENTS.md` and tracked `.agents/skills` already come from Git. A later Claude adapter may add
provider-native semantic resources such as:

```text
CLAUDE.local.md
.claude/skills/**
.claude/rules/**
```

Provider settings, hooks, MCP configuration, credentials, histories, caches, environment files,
and permission rules are not Harness overlay content. In particular, `.codex/config.toml`,
`.claude/settings*.json`, `.mcp.json`, `.env*`, auth files, and provider home directories remain
excluded. Runtime capability configuration supplied by ChangeFleet takes precedence over any
committed provider configuration that the Provider can see.

Dependencies, caches, generated assets, local certificates, and environment files are
`workspace_seed` concerns, not Harness. They may be useful for future build/test startup, but they
have different size, secrecy, mutability, and context behavior. Proposal 0009 does not authorize
that broader copy surface. If added later, its resolved inventory must remain separate from
Harness identity and must not be advertised to the model as instructions. A future
`workspace_seed` may be mutable inside its owned workspace and discarded during cleanup, but it
still cannot be written back or published as a Candidate.

When `.worktreeinclude` is the configured selector, ChangeFleet takes only the intersection of its
matches and the provider's eligible semantic Harness roots. Other matches are reported as skipped,
not silently copied.

### 6. Materialize overlays only inside ChangeFleet-owned Run workspaces

Before Provider startup, the RepositoryWorker restores the immutable overlay at its original
provider-native relative paths. This gives Codex or Claude its normal filesystem discovery shape
without writing to the registered checkout.

Planning cleanup permits only the known overlay paths, verifies their bytes and digest are
unchanged, and removes the entire planning worktree.

For planning and execution, copied Harness is immutable. After execution and before Candidate
publication, ChangeFleet:

1. verifies every overlay file still matches the frozen snapshot;
2. fails with `HARNESS_OVERLAY_MODIFIED` if the Agent changed, removed, or added content under an
   overlay root;
3. removes all overlay files and now-empty overlay directories from the owned workspace;
4. verifies no overlay path remains staged, tracked, untracked, or included in the Candidate;
5. publishes only the actual repository change.

ChangeFleet never silently discards an Agent edit to copied Harness and then reports success. A
task that requests a durable change only to non-Git Harness is unsupported. The user must edit the
registered source outside ChangeFleet or first place the resource in Git.

### 7. Do not deliver or write back non-Git files

If Harness is expected to be maintained collaboratively and delivered with code, versioning it in
Git remains the recommended answer. A tracked Harness change is an ordinary Candidate change.

An ignored Harness file is an immutable input snapshot for one ChangeSet, not a Candidate source.
ChangeFleet:

- never copies its modified workspace version back to the registered checkout;
- never includes it in a Candidate or CandidateBundle;
- never creates a `RepositoryHarnessChangeProposal`;
- fails with `NON_GIT_HARNESS_CHANGE_UNSUPPORTED` when the requested durable result is a private
  Harness change;
- fails with `HARNESS_OVERLAY_MODIFIED` when an ordinary Run mutates the active Harness overlay.

The failure evidence records bounded path and digest observations, not an alternative patch to be
applied later. A user-maintained change affects a later ChangeSet only after that ChangeSet freezes
a new Harness selection.

### 8. Keep Provider discovery evidence honest

For every Run, evidence distinguishes:

- exact-base Harness resources available in Git;
- overlay resources selected, snapshotted, and materialized;
- Provider-native resources reported as discovered or loaded;
- unavailable actual-load observations.

Codex may expose availability without a stable structured load event. Claude Agent SDK documents
an initialization `skills` array for discoverable user-invocable Skills. Adapters record what their
supported interface observes and use `unknown` for the rest.

The snapshot body and detailed inventory remain linked evidence outside the default Agent context.
Only bounded resource identity and discovery hints enter the current projection.

### 9. Preserve context and security limits

Instruction bytes and eagerly advertised Skill metadata contribute to initial context evidence.
Skill references, scripts, and assets are not counted as model input unless the Provider actually
loads them or the adapter can conservatively bound them.

The 70-percent policy remains `enforced | estimated | unknown`; overlay persistence does not create
a continuous guarantee. Snapshot artifacts may contain private project information, so storage,
retention, access, and Provider disclosure must be explicit. ChangeFleet does not claim to detect
every secret embedded in an otherwise eligible Skill.

## Implementation Slice

After acceptance, create exactly one Development WorkItem for one Codex local-overlay vertical
slice:

1. add one optional ChangeFleet-side Repository workspace policy that selects either explicit
   Git-ignore-style Harness patterns or the tracked `.worktreeinclude` from the exact base;
2. bind its resolved exact Harness selection identity to ChangeSet creation and revision;
3. inspect and snapshot only eligible, contained, Git-ignored Codex resources;
4. materialize committed and overlay Harness into exact-base planning and execution workspaces;
5. prove native Codex discovery where observable;
6. verify and remove overlays before Candidate publication;
7. reject private Harness delivery with `NON_GIT_HARNESS_CHANGE_UNSUPPORTED` and overlay mutation
   with `HARNESS_OVERLAY_MODIFIED`;
8. preserve the current no-overlay path and existing real Provider flow;
9. retain only test fixtures with unique deterministic coverage and remove temporary production
   scaffolding before review.

Generic `workspace_seed` files, setup/run/archive scripts, Claude implementation, external Harness
roots, and remote workspace materialization remain later stages. Harness change proposals and
automatic writeback are excluded rather than deferred.

## Acceptance Criteria

1. A Repository with only committed `AGENTS.md` and `.agents/skills` works without overlay state.
2. An ignored `.agents/skills` tree selected by a confirmed Repository policy is frozen before
   planning and discovered from both planning and execution workspaces.
3. Changing or deleting the registered checkout's local Harness after ChangeSet creation cannot
   alter planning, retry, execution, or recovery.
4. A restart reconstructs the same overlay from immutable ChangeFleet evidence without reading the
   registered checkout.
5. Unconfirmed, unsupported, non-ignored, escaping, colliding, oversized, or changed resources fail
   before Provider execution with stable typed diagnostics.
6. Provider settings, hooks, MCP files, credentials, environment files, and caches are never
   admitted as overlay Harness.
7. An Agent cannot change overlay content and still produce a successful Candidate.
8. No overlay file, parent directory artifact, Git index entry, or content digest enters the
   Candidate commit.
9. Run evidence links the exact base Harness and overlay snapshot and reports Provider discovery
   with honest coverage.
10. Repository scope, base SHA, capability, human gates, and Candidate identity remain
    controller-owned.
11. Existing exact-base, no-overlay, single-Repository, two-Repository, recovery, and real Codex
    Provider flows remain passing.
12. One real opt-in Codex flow proves an ignored project Skill or instruction is available without
    reading live checkout state.
13. The same Repository policy may be reused by later ChangeSets, while each ChangeSet records its
    own resolved path inventory and content digest.
14. A requested private Harness edit produces `NON_GIT_HARNESS_CHANGE_UNSUPPORTED`; it never
    modifies the registered checkout or masquerades as a Git Candidate.
15. The local workspace continues to use the registered Repository's Git object database and exact
    selected base; no clone, implicit fetch-to-latest, or root-checkout synchronization is added.
16. A tracked exact-base `.worktreeinclude` is used only when the confirmed Repository policy
    selects it; explicit patterns remain available and no implicit `.env*` default is introduced.

## Validation

| Gate | Scope |
| --- | --- |
| `npm test` | Policy selectors, `.worktreeinclude` resolution, Harness identity, diagnostics, and bounded projection |
| `npm run test:integration` | Worktree containment, snapshot digest, mutation, restart, no-writeback cleanup, and Candidate exclusion |
| `npm run test:acceptance` | Existing no-overlay one- and two-Repository regressions |
| Explicit opt-in real Codex Provider gate | Native discovery of one ignored frozen project resource |
| `npm run check` under Node.js 24 | Complete deterministic package gate |
| `git diff --check` plus targeted symlink, secret-path, settings, live-checkout, Candidate, context, and Chinese-comment audit | Boundary and repository hygiene |

The real Provider gate is paid and nondeterministic and requires an explicit credential and cost
decision. Agent prose alone is not proof that a resource was loaded.

## Risks And Open Questions

- Persisting a private overlay makes it durable ChangeFleet evidence. A later retention and
  encryption policy may be required before hosted or multi-user use.
- Provider-native discovery differs. The shared product contract should describe immutable
  semantic resources and evidence, while adapters own supported paths and load observations.
- An ignored Skill may execute bundled scripts. The Agent still receives only the operation's
  sandbox and network capability; snapshot confirmation is not permission expansion.
- Native Windows filesystem links and junctions require deterministic containment tests.
- Exact file and byte limits may need revision after representative project evidence.

## Non-Goals

- A ChangeFleet-owned Runtime Skill Kit.
- Automatic Harness creation, repair, conversion, or installation.
- Reading current checkout files during a Run.
- Treating `.worktreeinclude`, `.gitignore`, or provider settings as automatic authorization.
- Copying general build inputs, dependencies, caches, certificates, environment files, or secrets.
- Applying project settings, hooks, MCP servers, credentials, model defaults, or permission rules.
- Snapshotting arbitrary external directories.
- Publishing ignored Harness changes as part of a Git Candidate.
- A non-Git Harness change proposal, review, or writeback lifecycle.
- Automatically syncing Agent edits into a registered checkout.
- Conductor-style implicit `.env*` copying, live settings propagation, or Spotlight synchronization
  into the registered checkout.
- Claude Agent SDK implementation or a generic provider Harness catalog.
- Git URL materialization, remote workers, public CLI, Linear, merge, or deployment.
- Continuous context enforcement or secret-scanner guarantees.

## Documentation Impact

On acceptance, record one decision that distinguishes exact-base Harness from explicit immutable
local overlays. Update the Repository, ChangeSet creation, Runtime context, evidence, workspace,
Harness, validation, and current-state contracts. Create no Development WorkItem before the user
accepts this proposal.
