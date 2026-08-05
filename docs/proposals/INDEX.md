# Repository Design Proposal Index

Updated: 2026-08-04

These proposals govern development of the ChangeFleet repository itself. They are repository
Harness artifacts, not ChangeFleet Runtime outputs and not artifacts written into registered user
repositories.

`SPEC.md` and `docs/current-state.md` own current authority. Repository Design Proposal bodies
preserve chronological reasoning and are not current truth merely because they exist.

| Proposal | Topic | Decision status | Relationship | Implementation tracking |
| --- | --- | --- | --- | --- |
| [0001](0001-local-two-repository-vertical-slice.md) | Local two-repository vertical slice | `accepted` | Recorded by Decision 0006; depends on accepted Decision 0005 | [WI-0001](../work-items/WI-0001-local-two-repository-vertical-slice.md), `complete` |
| [0002](0002-bounded-runtime-context-and-optional-workflow-skill.md) | Bounded Runtime context and optional workflow Skill | `superseded` | Replaced by Proposal 0003 | None; superseded before acceptance |
| [0003](0003-harness-ownership-and-runtime-context.md) | Harness ownership and bounded Runtime context | `accepted` | Recorded by Decision 0005; unblocks Proposal 0001 | First-slice and real-Provider prerequisites are complete; Runtime Kit remains deferred after rejected 0008; exact local overlays are accepted by 0009 |
| [0004](0004-variable-scope-and-localized-diagnostics.md) | Variable repository scope and localized diagnostics | `accepted` | Recorded by Decision 0007; revises the exact-two-Repository constraint in Proposal 0001 and Decision 0006 | [WI-0001](../work-items/WI-0001-local-two-repository-vertical-slice.md), `complete` |
| [0005](0005-runtime-cost-and-effectiveness-observability.md) | Runtime cost and effectiveness observability | `accepted` | Raw invocation, usage, coverage, and audit isolation recorded by Decision 0009; pricing and comparison remain deferred | Raw first-Provider capture in [WI-0003](../work-items/WI-0003-first-real-codex-sdk-provider.md), `done` |
| [0006](0006-change-set-base-selection-and-revision.md) | ChangeSet Repository selection and revision | `accepted` | Recorded by Decision 0008; required before the first real Provider | [WI-0002](../work-items/WI-0002-change-set-repository-selection.md), `done` |
| [0007](0007-first-real-codex-sdk-provider.md) | First real Codex SDK Provider | `accepted` | Recorded by Decision 0010; depends on accepted raw observability and landed Repository selection | [WI-0003](../work-items/WI-0003-first-real-codex-sdk-provider.md), `done` |
| [0008](0008-optional-operation-scoped-runtime-skill-kit.md) | Optional operation-scoped Runtime Skill Kit | `rejected` | The user chose repository-native Harness before any ChangeFleet-owned Runtime Kit | None; rejected before implementation |
| [0009](0009-exact-repository-harness-snapshots-and-local-overlays.md) | Exact Repository Harness snapshots and local overlays | `accepted` | Recorded by Decision 0011; depends on exact base selection and repository-native Harness ownership | [WI-0004](../work-items/WI-0004-exact-repository-harness-snapshots-and-local-overlays.md), `done` |
| [0010](0010-read-only-runtime-audit-projections.md) | Read-only Runtime audit projections | `accepted` | Recorded by Decision 0012; derives bounded Run and ChangeSet facts while comparison remains deferred | [WI-0005](../work-items/WI-0005-read-only-runtime-audit-projections.md), `done` |
| [0011](0011-local-read-only-audit-entry-point.md) | Local read-only audit entry point | `accepted` | Recorded by Decision 0013; exposes only the landed exact-id WI-0005 projections | [WI-0006](../work-items/WI-0006-local-read-only-audit-entry-point.md), `done` |
| [0012](0012-shared-application-commands-and-unified-local-cli.md) | Shared application commands and a unified local CLI | `accepted` | Recorded by Decision 0014; accepts an experimental product CLI, debug namespace, and temporary-script retirement policy | [WI-0007](../work-items/WI-0007-shared-application-commands-and-unified-local-cli.md), `done` |
| [0013](0013-exact-github-pull-request-delivery.md) | Exact GitHub pull-request delivery and human-controlled integration | `accepted` | Recorded by Decision 0015; GitHub-first publication and reconciliation over accepted Bundle, Repository selection, delivery serialization, and shared application-operation boundaries | [WI-0008](../work-items/WI-0008-exact-github-pull-request-delivery.md), `done` |
| [0014](0014-local-review-and-delivery-console.md) | Foreground local review and delivery console | `accepted` | Recorded by Decision 0016; bounded loopback UI and HTTP adapter over shared Bundle, audit, and delivery semantics | [WI-0009](../work-items/WI-0009-local-review-and-delivery-console.md), `done` |
| [0015](0015-post-provider-candidate-finalization-and-recovery.md) | Post-Provider Candidate finalization and recovery | `accepted` | Recorded by Decision 0017; exact Candidate checkpoints, validation resume, narrow Windows argv shims, and bounded revision feedback | [WI-0010](../work-items/WI-0010-post-provider-candidate-finalization-and-recovery.md), `done` |
| [0016](0016-explicit-changeset-closure.md) | Explicit ChangeSet closure | `accepted` | Recorded by Decision 0018; human close is separate from ordinary successor creation | [WI-0011](../work-items/WI-0011-explicit-changeset-closure.md), `done` |
| [0017](0017-durable-codex-runtime-home-and-pre-candidate-retry.md) | Durable Codex Runtime Home and pre-Candidate retry | `accepted; revised in part` | Decision 0019 remains for blocked, empty-result, and retry semantics; Proposal 0018 supersedes its Provider Home mechanism | [WI-0012](../work-items/WI-0012-durable-codex-runtime-home-and-pre-candidate-retry.md), `done` |
| [0018](0018-provider-environment-ownership-and-pre-candidate-retry-correction.md) | Provider environment ownership and pre-Candidate retry correction | `accepted` | Recorded by Decision 0020; Provider host state belongs to the Harness or operator while ChangeFleet retains deterministic retry controls | [WI-0012](../work-items/WI-0012-durable-codex-runtime-home-and-pre-candidate-retry.md), `done` |
| [0019](0019-provider-owned-host-permissions-and-multi-repository-workspaces.md) | Provider-owned host permissions and multi-Repository workspaces | `accepted` | Recorded by Decision 0021; worktrees isolate development state while trusted local host permissions belong to the Runtime and operator | [WI-0013](../work-items/WI-0013-provider-owned-host-permissions-and-multi-repository-workspaces.md), `done` |
| [0020](0020-explicit-revision-feedback-assessment.md) | Explicit Agent assessment of revision feedback | `accepted` | Recorded by Decision 0022; human findings are review claims assessed before Plan confirmation | [WI-0014](../work-items/WI-0014-explicit-revision-feedback-assessment.md), `done` |

## Status Rules

- `draft`: incomplete exploration preserved only when discussion must pause; it is not a mandatory
  stage.
- `proposed`: concrete design already explained after discussion and awaiting human acceptance or
  specific revision feedback.
- `accepted`: approved direction; implementation is tracked by Development WorkItems.
- `reopened`: accepted direction requires a new decision because evidence or needs changed.
- `superseded`: no longer the current recommendation because a later proposal or accepted authority
  replaced it.
- `rejected`: explicitly declined and not implementation authority.

Proposal numbering records creation order, not decision or implementation order. Dependencies and
supersession must be explicit.

When decision status or relationships change, update this index and `docs/current-state.md`.
Implementation status belongs in linked Development WorkItems, not in this index.
