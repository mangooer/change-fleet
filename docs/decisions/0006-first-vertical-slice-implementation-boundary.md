# 0006: First Vertical Slice Implementation Boundary

Status: Accepted

Date: 2026-07-30

Source: Repository Design Proposal 0001

## Decision

The first implementation is one private Node.js 24 LTS package using ESM JavaScript and the built-in
`node:test` runner. It has pure domain modules, application commands, filesystem, Git, and Runtime
adapters, and unit, integration, and acceptance test scopes. It exposes no public CLI, HTTP API, UI,
or compatibility contract.

The first durable store is a ChangeFleet-owned versioned filesystem store under an explicit control
root. It uses atomic snapshot replacement, token-owned directory locks, bounded current aggregate
state, append-only or immutable Run evidence, and immutable CandidateBundle records. A Run snapshot
exists before dispatch state references it, and terminal evidence exists before a terminal
aggregate transition references it. Restart recovery reconciles persisted dispatch ownership
before another Run may be created.

The first application surface is an in-process service whose mutating commands require caller
idempotency keys. Planning and execution use a deterministic fake behind a ChangeFleet-owned
Runtime port. The fake proves the versioned Control Contract, generated planning and execution
projections, scoped capabilities, disabled Runtime Kit, and honest
`enforced | estimated | unknown` initial context evidence.

One confirmed ChangePlan defines the combined validation command as an executable, argument array,
timeout, and stable command id. ChangeFleet invokes it without a shell and passes one immutable
manifest through `CHANGEFLEET_VALIDATION_MANIFEST`. The validation subject binds sorted Candidate
identities and the required check while excluding host workspace paths. Candidate preflight runs
before and after the command. CandidateBundle assembly occurs only after validation evidence is
finalized.

The first `RepositoryWorker` is a clean ChangeFleet adapter with explicit repository, target,
base-SHA, workspace-id, and workspace-root inputs. It may port small, verified Conductor algorithms
and failure cases, but it must not import Conductor modules, persisted schemas, WorkItem identity,
workspace naming, review lifecycle, or `ProjectRuntime`.

## Rationale

This stack keeps the deterministic slice small and aligns with behavior already exercised in the
Conductor reference without inheriting its single-repository aggregate. Runtime boundary
normalization is still required for persisted JSON and Agent outcomes, so adding TypeScript would
not remove the most important validation work.

Filesystem snapshots provide inspectable local recovery without committing to an unsettled
relational schema or an additional database dependency. A test-only application surface proves
control semantics before a public interface freezes them. A manifest gives a combined check exact
multi-repository locators while keeping host paths out of durable Candidate identity.

## Consequences

- Package engines target `>=24 <25`; Node 24 execution is required before the slice is ready.
- The package manifest exposes `npm test`, `npm run test:integration`,
  `npm run test:acceptance`, and `npm run check`.
- There is one portfolio scheduler owner and a per-ChangeSet mutation lock in the first slice.
- Unreferenced evidence may remain after a crash, but authoritative terminal state cannot reference
  missing evidence.
- SQLite, a public CLI or UI, and shared Conductor extraction require demonstrated need or a later
  proposal.
- Runtime Kit packaging, a real Provider adapter, Linear integration, and continuous context
  enforcement remain deferred by Decision 0005.
