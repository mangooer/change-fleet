# 0018: Provider Environment Ownership And Pre-Candidate Retry Correction

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-04

Accepted: 2026-08-04

Supersedes: Provider Runtime Home creation, copying, and ownership portions of Proposal 0017 and
Decision 0019; revises the user-global environment exclusion wording in Decision 0010

Depends on: Proposals 0007 and 0017; real Windows evidence recorded by WI-0012

Decision: [Decision 0020](../decisions/0020-provider-environment-ownership-boundary.md)

Implementation tracking: [WI-0012](../work-items/WI-0012-durable-codex-runtime-home-and-pre-candidate-retry.md), `done`

## Context

Proposal 0017 attempted to eliminate repeated native Windows setup by creating a ChangeFleet-owned
Codex Home and copying authentication, setup markers, SID state, and encrypted Sandbox user
credentials into it. The real Provider gate disproved that mechanism: the selected source state was
already incompatible, Codex entered its elevated setup path, and ordinary copying did not preserve
the protected ACLs applied by official setup.

The design also crossed the product boundary. A Provider Home contains runtime-native credentials,
configuration, plugins, Skills, sessions, caches, Sandbox identities, and host security state.
Owning its lifecycle would make ChangeFleet a Codex installer and security-state manager rather
than a change control plane.

Conductor provides the useful comparison: it owns Git workspaces and the review flow while treating
Codex, Claude Code, and other Harnesses as runtime environments selected by the user. Its worktree
is development isolation, not an operating-system security boundary.

The same failed Run independently exposed valid controller defects. A Runtime must be able to
report blocked semantic work, an unchanged repository must not become a Candidate, and a clean
exact-base pre-Candidate failure needs an explicit retry. Those corrections do not require
ChangeFleet to own Provider operational state.

## Decision

The Agent Runtime or operator owns Provider installation, authentication, native configuration,
Sandbox provisioning, credentials, and runtime-home lifecycle. ChangeFleet never creates, copies,
repairs, migrates, refreshes, resets, or deletes those files.

Local configuration explicitly selects an already prepared Codex environment with
`runtime.codex_home`. The value is a host locator used only to compose the local SDK process
environment. It is not ChangeSet identity, Repository authority, Runtime context, evidence, audit
payload, Git content, or a path that ChangeFleet may scan. Selecting an existing user Codex Home is
allowed only through this explicit configuration; it is not a silent fallback.

The pinned adapter continues to control the operation-scoped SDK settings it already owns: fresh
threads, model and reasoning selection, history persistence, native subagents, working paths,
network, approval policy, and the requested `read-only` or `workspace-write` session scope. It does
not select or override the native Windows Sandbox implementation. Provider-native settings or
instructions in the explicitly selected environment are Agent Runtime behavior, not ChangeFleet
control authority. They cannot expand Repository selection, exact Git subjects, confirmed plans,
Candidates, or human gates.

ChangeFleet does not launch a setup command as part of execution and does not claim to suppress
Provider or operating-system prompts. Authentication, Sandbox, or UAC failures are Provider
environment failures. The current Run records a bounded failure; after the operator repairs the
selected environment outside ChangeFleet, a new explicit execution request may use the accepted
clean exact-base pre-Candidate retry path.

Keep the remaining Proposal 0017 controller decisions: strict `implementation_blocked`, rejection
of base-equal or empty publication, preservation of earlier attempts and cost, exact clean-base
retry preflight, and unchanged non-empty CandidateCheckpoint validation resume.

## Boundaries

- `runtime.codex_home` is explicit local process configuration and never durable aggregate state.
- ChangeFleet does not enumerate or attest the selected Home's Skills, plugins, instructions,
  sessions, Sandbox secrets, caches, or ACLs.
- A Provider environment selection never authorizes another Repository or host directory.
- No setup, doctor, login, Sandbox probe, or paid Provider turn runs implicitly during config load.
- Native elevated, unelevated, WSL, container, and remote-worker environments require explicit
  operator configuration; ChangeFleet does not silently substitute among them.
- Provider environment failure does not erase the Run or partial workspace. Retry remains explicit
  and only the exact clean-base pre-Candidate state is automatically retryable.
- Dedicated managed environments, installation workflows, hosted credentials, and continuous
  Provider-health monitoring remain deployment concerns for a later accepted stage.

## Alternatives

### ChangeFleet-Owned Minimal Runtime Home

Rejected. Codex operational state is not a stable copy contract, encrypted Sandbox credentials are
coupled to host setup, and correct ACL lifecycle belongs to the Provider.

### Implicitly Reuse The User Global Home

Rejected. It is convenient but hides which Provider environment was selected. The local config
must name the environment explicitly even when it points to the normal user Codex Home.

### Add `runtime.prepare` Now

Deferred. A first-class installer or provisioning operation would make ChangeFleet responsible for
Provider-specific host mutation and UI prompts before that deployment boundary is needed.

### Recommended

Reference one explicitly prepared Provider environment, leave its internals with the Harness or
operator, and keep ChangeFleet focused on exact workspaces, results, evidence, review, and recovery.

## Acceptance Criteria

- Local strict config requires `runtime.codex_home` and no longer accepts a ChangeFleet Runtime
  state root.
- The Codex adapter passes that exact environment as `CODEX_HOME` without creating, copying,
  reading, locking, initializing, or deleting Provider Home files.
- Two invocations may reuse the selected environment while every Run still creates a fresh thread.
- Runtime Home copy helpers, manifests, locks, secret fixtures, diagnostics, and cleanup code are
  absent from production and tests.
- Explicit environment selection does not enter Runtime context, ChangeSet state, Evidence, or
  audit projections.
- Strict blocked, empty-publication, exact retry, history preservation, and non-empty checkpoint
  resume tests remain passing.
- No real Codex or Windows setup command is required to accept WI-0012; the failed real observation
  remains evidence that Provider readiness is external.

## Validation

- Codex adapter integration tests for exact configured environment reuse, fresh threads, controlled
  environment filtering, and zero Provider Home file operations.
- Local config and composition tests for strict `runtime.codex_home` selection.
- Existing schema, blocked, empty-result, retry, recovery, context, and audit regressions.
- Full deterministic `npm run check` under Node.js 24.
- Documentation link, authority, eager-size, fake-production, and `git diff --check` audits.

## Non-Goals

- Provider installation, login, logout, Sandbox setup, ACL repair, UAC automation, or credential
  migration.
- WSL, containers, remote workers, hosted secrets, or a managed Runtime image.
- Automatic retry, dirty-workspace cleanup, Provider-session continuation, or generic rewind.
- Runtime Kit, another Provider, Linear, pricing, dashboards, or the WI-0009 console itself.
