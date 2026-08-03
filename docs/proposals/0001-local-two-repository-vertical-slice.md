# 0001: Local Two-Repository Vertical Slice

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-07-29

Accepted: 2026-07-30

Depends on: Decision 0005, accepted

Decision: [Decision 0006](../decisions/0006-first-vertical-slice-implementation-boundary.md)

Implementation tracking:
[WI-0001](../work-items/WI-0001-local-two-repository-vertical-slice.md), `complete`

## Context

ChangeFleet's product thesis is that one confirmed intent can remain coherent across repository
analysis, plan revision, isolated execution, exact Git Candidates, combined validation, and human
review.

The repository currently contains only product authority and no implementation. Building broad
catalog, provider, UI, delivery, or remote-worker frameworks before one complete local change would
repeat the over-generalization this project is intended to avoid.

The first slice should prove the smallest boundary that cannot be reduced to one ordinary coding
Agent invocation: one exact review subject spanning two independent Git repositories.

## Proposed Decision

Implement one local process capable of:

1. registering one logical Project with two local-path Git repositories;
2. accepting one confirmed ChangeIntent fixture or minimal CLI input;
3. invoking one Agent planning operation with read-only access to both registered repositories;
4. persisting a ChangePlan containing both repositories, target refs, base SHAs, WorkUnits,
   dependency order, checks, and risks;
5. requiring explicit plan confirmation because the scope spans multiple repositories;
6. creating one isolated worktree per WorkUnit;
7. invoking repository execution through a single RepositoryWorker boundary;
8. publishing one exact Candidate per repository;
9. recording one check per Candidate and one combined validation result;
10. assembling an immutable CandidateBundle;
11. recording one exact human accept, reject, or request-revision command;
12. restoring current ChangeSet state after process restart.

The slice is complete through human Bundle decision. It does not create or merge PRs.

## Required Decisions Before Acceptance

Acceptance must choose:

- implementation language and module system;
- package and source layout;
- durable local store;
- first Agent Runtime adapter or deterministic fake boundary;
- whether the user surface is a minimal CLI or test-only application service;
- combined validation command contract;
- how reusable Conductor modules are extracted, wrapped, or reimplemented.

These choices must be recorded in this proposal before implementation starts.

## Proposed Domain Shape

The slice should persist only the minimum current control facts:

```text
Project
Repository
ChangeSet
ChangeIntentRevision
ChangePlanRevision
WorkUnit
RunReference
Candidate
CandidateBundle
HumanDecision
```

Complete events, command output, diffs, and check logs belong in an evidence store rather than the
current aggregate record.

## Execution Sequence

```text
confirmed intent
  -> analyze registered repositories
  -> proposed plan
  -> human plan confirmation
  -> prepare WorkUnits
  -> execute according to simple DAG
  -> publish repository Candidates
  -> repository checks
  -> combined validation
  -> CandidateBundle
  -> human Bundle decision
```

Only a two-node DAG is required:

- parallel WorkUnits with no dependency; or
- one WorkUnit depending on the other.

Arbitrary graphs are unnecessary for this slice.

## Acceptance Criteria

1. Project configuration contains only id, description, two Repository ids, local paths, optional
   descriptions, and optional default refs.
2. Registration rejects a non-Git path and records resolved Git roots without mutating either
   repository.
3. Dirty files in registered checkouts do not enter WorkUnit worktrees.
4. Planning can inspect both repositories but cannot add a third repository without a typed scope
   expansion.
5. The multi-repository plan cannot execute before explicit confirmation.
6. Each WorkUnit records Repository id, target ref, base SHA, workspace identity, Run reference, and
   terminal result.
7. A process restart preserves current ChangeSet and workspace ownership without duplicate
   dispatch.
8. Each Candidate is mechanically validated against its exact repository workspace and SHAs.
9. Combined validation names the exact two Candidate identities.
10. CandidateBundle hashing is deterministic and changes when either Candidate or required evidence
    identity changes.
11. Human decision is caller-idempotent and bound to the exact Bundle revision and hash.
12. Partial failure is visible and cannot create a complete Bundle.
13. A plan revision continues the same ChangeSet and preserves the superseded plan and attempt
    evidence.

## Validation

The implementation must include:

- unit tests for model normalization, transitions, Bundle hashing, and idempotent decisions;
- deterministic persistence and restart tests;
- real-Git tests for two repositories and isolated worktrees;
- a fake Agent Runtime for planning and execution outcomes;
- one end-to-end two-repository acceptance test;
- the normal fast suite selected by the accepted implementation stack.

A real provider gate is not required for the deterministic first slice. Provider conformance should
be a later independent acceptance boundary.

## Reuse Boundary

Evaluate existing Conductor behavior as reference evidence for:

- Run deadlines and cancellation;
- event artifact bounding;
- Git worktree ownership;
- Candidate preflight;
- structured Agent outcomes.

Do not import or preserve:

- Conductor ProjectRuntime;
- its WorkItem state schema;
- its single-workspace lifecycle;
- its single-Candidate human review;
- its current UI and initialization model.

The implementation should extract only after the new RepositoryWorker interface is clear.

## Non-Goals

- More than two repositories in the acceptance fixture.
- Git URL cloning or mirrors.
- Shared repositories across Projects.
- Automatic relationship inference as authority.
- Stacked ChangeSets.
- PR creation, merge, deployment, or production rollback.
- Remote workers or hosted operation.
- Browser UI.
- Multiple production Agent Runtime providers.
- Backward compatibility with Conductor.

## Documentation Impact

On acceptance, update:

- this proposal's decision metadata;
- `docs/proposals/INDEX.md`;
- `docs/current-state.md`;
- exact implementation and validation commands once chosen.

On implementation, update current baseline facts without describing an unlanded Candidate as
canonical.

## Discussion Update: Bounded Context And Optional Workflow Skill

Discussed: 2026-07-30

[Draft Proposal 0002](0002-bounded-runtime-context-and-optional-workflow-skill.md) records the
candidate separation between a ChangeFleet-owned Control Contract, repository-native Harness, and
an optional Runtime-native `changefleet-workflow` Skill. It also distinguishes an enforceable
70-percent context bound from estimated or unknown provider usage.

Proposal 0001 does not authorize production Skill packaging, automatic Skill installation, a
centrally copied semantic Harness, or a real provider integration. Before Proposal 0001 is accepted,
reviewers should decide whether its deterministic fake Runtime must prove:

- a versioned, bounded Control Contract;
- context component and headroom accounting;
- explicit `enforced | estimated | unknown` budget evidence;
- one repository fixture with native Harness and one without Harness;
- no repository mutation during Harness discovery or registration.

These items remain discussion dependencies until Proposal 0002 is accepted or Proposal 0001 records
an explicit narrower decision.

## Discussion Update: Current Projection And Runtime Boundary

Discussed: 2026-07-30

[Proposal 0003](0003-harness-ownership-and-runtime-context.md) superseded Draft Proposal 0002 and
was the current recommendation at this discussion point. It retained the Control Contract and
honest context-budget evidence, but added:

- a generated current Run Context Projection instead of replaying full plan and attempt history;
- optional operation-scoped Runtime Skills instead of one universal workflow Skill;
- Agent Profiles for provider model, reasoning, permission, and Skill selection;
- read-only planning and WorkUnit-workspace-scoped execution;
- ChangeFleet ownership of plan revision and confirmation history;
- tracker systems as intake and human projections rather than lifecycle authority;
- structured records and artifact references instead of one document per operational event.

If Proposal 0003 is accepted, the deterministic fake Runtime in this proposal must prove the
Control Contract and both planning and execution projections with the optional Runtime Kit disabled.
Production Skill packaging, real-provider model selection, Linear integration, and continuous
context enforcement remain later slices.

## Decision Update: Proposal 0003 Accepted

Decided: 2026-07-30

Proposal 0003 is accepted as
[Decision 0005](../decisions/0005-runtime-context-harness-and-capabilities.md). This proposal must
now include the deterministic first-slice proof listed in that decision. Runtime Kit packaging, a
real Provider adapter, Linear integration, and continuous context enforcement remain outside this
slice.

The remaining acceptance blockers are the implementation stack, durable store, application
surface, combined-validation contract, and Conductor extraction boundary.

## Technical Assessment And Acceptance Decision Candidate

Assessed: 2026-07-30

Reference subject:

- Conductor repository: `C:\myData\aiProject\conductor`
- branch: `main`
- commit: `66faac3b16df8b287bae100ec5be82b79d32b872`
- commit subject: `feat(onboarding): add project harness readiness`

Reference identity correction (2026-08-03): the canonical product intended by current Conductor
comparisons is the Melty Labs product documented at
[conductor.build](https://www.conductor.build/docs). The local checkout above remains exact
historical evidence for this proposal's listed tests only; it is not authority for current
Conductor.build workspace, review, PR, merge, Harness, or delivery behavior. Future comparisons
must follow the external-reference rule in `docs/harness.md` and use current official online
sources.

This update resolves the earlier design questions with concrete recommendations. It does not accept
this proposal and does not authorize implementation.

### Options Considered

| Boundary | Options | Recommendation |
| --- | --- | --- |
| Implementation stack | Node.js ESM JavaScript; Node.js TypeScript; Go or Rust | Node.js 24 LTS, ESM JavaScript, built-in `node:test` |
| Durable store | One monolithic JSON file; versioned filesystem snapshots and evidence; SQLite | Versioned filesystem snapshots and append-only evidence |
| Initial user surface | Public CLI; local API or UI; test-only application service | Test-only application service and acceptance fixture |
| Initial Runtime | Scripted fake; Conductor Runtime adapter; real Provider adapter | Scripted deterministic fake behind a ChangeFleet-owned port |
| Conductor reuse | Direct imports; immediate shared-package extraction; clean ChangeFleet adapter | Clean adapter, reusing verified behavior and test cases rather than Conductor state types |
| Combined validation input | Positional workspace arguments; inferred directories; immutable manifest path | Immutable JSON manifest passed by environment variable |

According to the official [Node.js release table](https://nodejs.org/en/about/previous-releases),
Node.js 24 is the current LTS line at assessment time, while Node.js 26 is Current. The new project
should target one tested LTS major using `engines.node: ">=24 <25"`. ESM JavaScript keeps the first
slice aligned with Conductor's proven implementation style and avoids adding a compile pipeline.
Persisted and Runtime inputs still require explicit runtime normalization; TypeScript alone would
not validate them. TypeScript may be reconsidered before a public SDK exists if the first slice
shows that JSDoc and boundary validators are insufficient.

The package should begin as one private package with no public compatibility promise:

```text
src/domain/                 pure identities, normalization, transitions, Bundle hashing
src/application/            commands, scheduling, confirmation, recovery
src/adapters/filesystem/    snapshots, evidence, atomic writes, ownership locks
src/adapters/git/           local repository registration and RepositoryWorker
src/adapters/runtime/       Runtime port and outcome normalization
test/unit/
test/integration/
test/acceptance/
test/support/               deterministic Runtime and Git fixtures
scripts/                    only a small cross-platform validation runner if needed
```

No YAML parser, web framework, database library, Provider SDK, or CLI framework is required for
this slice.

### Durable Store Contract

The first store should be a ChangeFleet-owned, versioned filesystem store under an explicitly
provided state root, never under a registered repository:

```text
catalog.json
changesets/<change_set_id>/state.json
runs/<run_id>/run.json
runs/<run_id>/events.jsonl
runs/<run_id>/artifacts/
bundles/<bundle_id>.json
locks/portfolio/
locks/changesets/<change_set_id>/
```

The contract is:

- every mutable snapshot contains `schema_version` and is replaced with temporary-file plus atomic
  rename semantics;
- a Run snapshot is created before persisted dispatch state references its id; terminal evidence
  and immutable Bundle records are finalized before the aggregate records the corresponding
  terminal transition, so a crash may leave unreferenced evidence but must not leave authoritative
  terminal state pointing at missing evidence;
- application commands persist caller idempotency keys with their result;
- a directory lock has an ownership token, host, process id, and acquisition time; elapsed wall
  time alone cannot steal a lock whose owner may still be alive;
- restart recovery reconciles persisted dispatch ownership before it may create another Run;
- current aggregate state contains bounded control facts and references, not full output or diffs.

A single portfolio scheduler owner plus a per-ChangeSet mutation lock is sufficient. Cross-file
transactions and multi-process throughput are not goals for this slice.

SQLite is not recommended initially. The domain schema is not yet settled, external SQLite would
add a dependency and migration commitment, and Node 24's built-in
[`node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) is still
documented as Stability 1.2, release candidate. Reconsider SQLite when concurrent querying or
transaction pressure is demonstrated rather than anticipated.

### Application And Runtime Ports

The first surface should be an in-process application service called by deterministic tests.
Commands should include the equivalent of:

```text
registerProject
createChangeSet
recordPlannedRevision
confirmPlanRevision
dispatchReadyWork
recordBundleDecision
```

Every mutating command accepts a caller idempotency key. Human plan confirmation and Bundle review
are exact application commands in the acceptance test. A public CLI, HTTP API, and browser UI are
deferred because none is needed to prove durable coordination and each would prematurely freeze a
user-facing lifecycle.

The Runtime boundary should be ChangeFleet-owned and operation-neutral:

```text
invoke({
  operation,
  agentProfile,
  controlContract,
  contextProjection,
  capabilities,
  workspace,
  signal
}) -> structured outcome
```

The deterministic fake records the received invocation and returns scripted planning or execution
outcomes. It must prove:

- planning receives read-only access to the two registered repositories;
- execution receives write access only to its WorkUnit workspace;
- both operations receive a versioned Control Contract and generated current projection rather
  than full ChangeSet history;
- the optional Runtime Kit is disabled;
- initial context evidence records usage, capacity when known, headroom, and
  `enforced | estimated | unknown` without converting an estimate into a guarantee.

This is contract evidence, not a production Provider or a claim of continuous context enforcement.

### Combined Validation Command Contract

The confirmed ChangePlan owns one combined-check definition:

```text
command_id
executable
argv[]
timeout_ms
```

ChangeFleet invokes the executable directly without a shell, from a ChangeFleet-controlled
validation directory. It writes an immutable JSON manifest and exposes its absolute path only as:

```text
CHANGEFLEET_VALIDATION_MANIFEST=<absolute path>
```

The manifest is an invocation locator, not CandidateBundle identity:

```json
{
  "schema_version": 1,
  "change_set_id": "change-1",
  "plan_revision": 1,
  "validation_subject_hash": "<canonical hash>",
  "candidates": [
    {
      "repository_id": "api",
      "target_ref": "refs/heads/main",
      "base_sha": "<sha>",
      "candidate_sha": "<sha>",
      "workspace_path": "<absolute locator>"
    }
  ]
}
```

`validation_subject_hash` is computed from the sorted exact Candidate identities and required
check definition, excluding host workspace paths. The executed manifest bytes receive their own
evidence hash. Before and after the command, ChangeFleet re-runs Candidate preflight. Success
requires exit code zero and both workspaces remaining clean and pinned to their exact Candidate
SHAs. Bounded stdout, stderr, exit code, timeout result, manifest hash, and command identity are
recorded as evidence against the validation subject.

Only after that evidence is finalized does ChangeFleet assemble the CandidateBundle. Bundle
identity therefore includes the exact Candidates and required evidence identities without a
circular dependency on the not-yet-created Bundle hash.

For this slice, the combined command belongs to the confirmed acceptance fixture and ChangePlan.
It does not create a centrally inferred test policy or add mandatory configuration to Project or
Repository registration.

### Conductor Reuse Decision

Conductor demonstrates useful behavior in:

- temporary-file plus rename persistence;
- token-owned directory and scheduler locks;
- bounded JSONL events with large-output artifact externalization;
- deadline and cancellation handling;
- contained Git worktree ownership and reattachment;
- exact-base Candidate publication and clean-worktree preflight.

Its `ProjectRuntime`, `WorkItemStateStore`, workspace naming, review lifecycle, and recovery paths
are built around one Conductor WorkItem and one repository. Importing those modules would leak the
wrong aggregate into ChangeFleet. Extracting a shared package now would create a compatibility
surface before ChangeFleet's `RepositoryWorker` contract has implementation evidence.

The recommendation is therefore a clean ChangeFleet `RepositoryWorker` with explicit inputs:

```text
repository_id
registered_git_root
target_ref
base_sha
workspace_id
workspace_root
```

Port the small verified algorithms and corresponding failure cases; do not depend on Conductor
source modules or persisted schemas. Consider shared extraction only after both repositories expose
the same stable behavior and duplication is concrete.

### Validation Contract For The Implementation WorkItem

The accepted package manifest should expose these exact commands:

| Package command | Underlying command | Scope |
| --- | --- | --- |
| `npm test` | `node --test "test/unit/**/*.test.js"` | Pure domain and application tests |
| `npm run test:integration` | `node --test "test/integration/**/*.test.js"` | Filesystem, lock, recovery, and real-Git tests |
| `npm run test:acceptance` | `node --test --test-concurrency=1 "test/acceptance/**/*.test.js"` | Serial two-repository flow |
| `npm run check` | `node scripts/run-checks.mjs` | Runs the preceding three commands in order and stops on the first failure |

`scripts/run-checks.mjs` must spawn the current Node executable directly without a shell. Quoted
glob patterns follow the portable invocation recommended by the official
[`node:test` documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/test.html).
The implementation WorkItem must create these files and record the commands before reporting them
as passed. Node 24 execution must be verified there; this assessment host currently runs Node.js
`v22.19.0`.

Read-only Conductor evidence collected during this assessment:

| Command | Exit | Scope | Observation |
| --- | ---: | --- | --- |
| `npm test` | 0 | Conductor normal unit tier | 149 passed, 0 failed |
| `node --test test/run-store.test.js test/workspace.test.js test/candidate-preflight.test.js test/project-scheduler-lock.test.js test/work-item-state-store.test.js` | 0 | Targeted persistence, lock, Git workspace, and Candidate integration behavior | 32 passed, 0 failed |

No Conductor code was changed or extracted. The assessment does not prove that its single-repository
state machine is suitable for ChangeFleet; it is evidence only for the listed behaviors.

### Added Acceptance Criteria

In addition to the original criteria:

14. The fake Runtime captures a versioned Control Contract, current planning and execution
    projections, scoped capabilities, disabled Runtime Kit, and honest initial budget evidence.
15. Restart tests cover both an interrupted Run and persisted dispatch ownership without duplicate
    execution.
16. Combined validation uses the immutable manifest contract, is bound to the exact validation
    subject, and fails if either Candidate workspace changes.
17. ChangeFleet has no runtime dependency on Conductor modules, schemas, or workspace names.
18. The acceptance flow enters every human decision through caller-idempotent application commands
    and exposes no public CLI contract.

### Recommendation

Accept Proposal 0001 with this technical update. Then create exactly one `todo` Development WorkItem
for the deterministic two-repository slice. Keep the real Provider adapter, Runtime Kit packaging,
Linear projection, public CLI or UI, SQLite migration, and continuous context enforcement deferred.

## Acceptance

Accepted: 2026-07-30

The user explicitly accepted the complete current version of Proposal 0001 and requested one
authorized `todo` Development WorkItem. [Decision 0006](../decisions/0006-first-vertical-slice-implementation-boundary.md)
owns the durable technical rationale, and
[WI-0001](../work-items/WI-0001-local-two-repository-vertical-slice.md) owns implementation scope
and evidence.

Acceptance includes the original criteria plus criteria 14 through 18 and all choices in the
technical assessment. The deferred capabilities listed above remain outside implementation
authority.
