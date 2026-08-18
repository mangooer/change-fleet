# Decision Index

These records contain durable architectural decisions and rationale. `SPEC.md` owns the current
accepted product contract, while `docs/current-state.md` owns the concise implementation
projection.

| Decision | Topic | Status |
| --- | --- | --- |
| [0001](0001-control-plane-boundary.md) | Agent Runtime and deterministic control-plane ownership | Accepted for initial bootstrap |
| [0002](0002-changeset-and-bundle-aggregate.md) | ChangeSet aggregate and CandidateBundle review identity | Accepted for initial bootstrap |
| [0003](0003-minimal-repository-catalog.md) | Minimal Project catalog and local Repository materialization | Accepted for initial bootstrap |
| [0004](0004-concurrency-delivery-and-compensation.md) | Parallel execution, delivery serialization, and compensation | Accepted for initial bootstrap |
| [0005](0005-runtime-context-harness-and-capabilities.md) | Runtime context projection, Harness ownership, Agent Profiles, and capability dispatch | Accepted |
| [0006](0006-first-vertical-slice-implementation-boundary.md) | First local two-repository implementation stack, store, ports, validation, and reuse boundary | Accepted; fixed command presence revised by 0029 |
| [0007](0007-variable-scope-and-localized-diagnostics.md) | Variable Repository scope and localized diagnostics | Accepted |
| [0008](0008-change-set-repository-selection.md) | ChangeSet Repository selection, branch freezing, and revision | Accepted |
| [0009](0009-runtime-observability-evidence-boundary.md) | Runtime invocation, usage, coverage, and out-of-context audit evidence | Accepted |
| [0010](0010-first-real-codex-sdk-provider.md) | First real Codex SDK Provider and exact-base planning workspace boundary | Accepted |
| [0011](0011-exact-repository-harness-snapshots-and-local-overlays.md) | Exact-base Repository Harness and explicit immutable local overlays | Accepted |
| [0012](0012-read-only-runtime-audit-projections.md) | Query-time Run and ChangeSet audit projections with strict isolation | Accepted |
| [0013](0013-local-read-only-audit-entry-point.md) | Exact-id local read-only audit entry point | Accepted |
| [0014](0014-shared-application-commands-and-unified-local-cli.md) | Shared application commands and unified experimental local CLI | Accepted |
| [0015](0015-exact-github-pull-request-delivery.md) | Exact GitHub pull-request delivery and human-controlled integration | Accepted |
| [0016](0016-local-review-and-delivery-console.md) | Foreground local review and delivery console | Accepted |
| [0017](0017-post-provider-candidate-finalization-and-recovery.md) | Post-Provider Candidate finalization and recovery | Accepted; operation-specific recovery state revised by 0025, legacy recovery surface removed by WI-0022 |
| [0018](0018-explicit-changeset-closure.md) | Explicit human closure of an unfinished ChangeSet | Accepted |
| [0019](0019-durable-codex-runtime-home-and-pre-candidate-retry.md) | Blocked and empty-result handling with clean exact-base retry | Accepted; Provider Home mechanism revised by 0020 |
| [0020](0020-provider-environment-ownership-boundary.md) | Provider environment ownership outside ChangeFleet | Accepted |
| [0021](0021-provider-owned-host-permissions-and-multi-repository-workspaces.md) | Provider-owned host permissions outside multi-Repository workspace control | Accepted |
| [0022](0022-explicit-revision-feedback-assessment.md) | Explicit Agent assessment of bounded revision feedback | Accepted; assessment placement revised by 0023 |
| [0023](0023-conversation-first-planning-and-stage-scoped-feedback.md) | Conversation-first planning, exact approval, and stage-scoped feedback | Accepted |
| [0024](0024-risk-adaptive-candidate-verification.md) | Risk-adaptive Candidate verification and optional independent review | Accepted |
| [0025](0025-unified-stage-and-run-lifecycle.md) | Unified ChangeSet, WorkUnit, and Agent Run lifecycle | Accepted |
| [0026](0026-policy-governed-agentic-supervision.md) | Policy-governed Agentic supervision within deterministic action authority | Accepted |
| [0027](0027-bundle-level-independent-quality-review.md) | Bundle-level independent quality review before human acceptance | Accepted |
| [0028](0028-shared-application-orchestration-boundary.md) | Shared application orchestration boundary | Accepted |
| [0029](0029-optional-project-semantic-checks.md) | Optional project semantic checks with mandatory structural preflight | Accepted |
| [0030](0030-persistent-task-workspaces-and-linked-repositories.md) | Persistent task workspaces, linked repositories, and semantic Plans | Accepted |
| [0031](0031-local-changeset-intake-and-conversational-planning.md) | Local ChangeSet intake and conversational planning | Accepted |
| [0032](0032-unified-task-control-and-conversational-operator-flow.md) | Unified task control and conversational operator flow | Accepted |
| [0033](0033-autonomous-task-conversation-and-operator-inbox.md) | Autonomous task conversation and six-state operator inbox | Accepted |
| [0034](0034-freeze-operator-surface-and-validate-second-scenario.md) | Freeze console/audit/overlay feature work, decision moratorium, second-scenario validation | Accepted |
| [0035](0035-task-scoped-agent-sessions-and-exact-integration-action-grants.md) | Task-scoped Agent Sessions, exact human ActionGrants, verifiable integration, and explicit completion without managed integration | Accepted |
| [0036](0036-single-project-repository-ownership.md) | Single-Project ownership for each registered local Git repository | Accepted |

Changing one of these boundaries requires a proposal. When a decision is superseded, preserve this
record and point to the later accepted authority.
