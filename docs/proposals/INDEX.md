# Repository Design Proposal Index

Updated: 2026-07-30

These proposals govern development of the ChangeFleet repository itself. They are repository
Harness artifacts, not ChangeFleet Runtime outputs and not artifacts written into registered user
repositories.

`SPEC.md` and `docs/current-state.md` own current authority. Repository Design Proposal bodies
preserve chronological reasoning and are not current truth merely because they exist.

| Proposal | Topic | Decision status | Relationship | Implementation tracking |
| --- | --- | --- | --- | --- |
| [0001](0001-local-two-repository-vertical-slice.md) | Local two-repository vertical slice | `accepted` | Recorded by Decision 0006; depends on accepted Decision 0005 | [WI-0001](../work-items/WI-0001-local-two-repository-vertical-slice.md), `complete` |
| [0002](0002-bounded-runtime-context-and-optional-workflow-skill.md) | Bounded Runtime context and optional workflow Skill | `superseded` | Replaced by Proposal 0003 | None; superseded before acceptance |
| [0003](0003-harness-ownership-and-runtime-context.md) | Harness ownership and bounded Runtime context | `accepted` | Recorded by Decision 0005; unblocks Proposal 0001 | First-slice proof belongs to 0001; Runtime Kit, real Provider, Linear, and continuous enforcement deferred |
| [0004](0004-variable-scope-and-localized-diagnostics.md) | Variable repository scope and localized diagnostics | `accepted` | Recorded by Decision 0007; revises the exact-two-Repository constraint in Proposal 0001 and Decision 0006 | [WI-0001](../work-items/WI-0001-local-two-repository-vertical-slice.md), `complete` |
| [0005](0005-runtime-cost-and-effectiveness-observability.md) | Runtime cost and effectiveness observability | `proposed` | Extends the Runtime evidence boundary without changing ChangeSet authority | None until accepted; deferred until WI-0001 is complete |

## Status Rules

- `draft`: incomplete exploration with no implementation authority.
- `proposed`: concrete design awaiting human acceptance.
- `accepted`: approved direction; implementation is tracked by Development WorkItems.
- `reopened`: accepted direction requires a new decision because evidence or needs changed.
- `superseded`: no longer the current recommendation because a later proposal or accepted authority
  replaced it.
- `rejected`: explicitly declined and not implementation authority.

Proposal numbering records creation order, not decision or implementation order. Dependencies and
supersession must be explicit.

When decision status or relationships change, update this index and `docs/current-state.md`.
Implementation status belongs in linked Development WorkItems, not in this index.
