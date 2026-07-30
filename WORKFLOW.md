---
ui:
  default_locale: zh-CN
---

# ChangeFleet Workflow Entry

This is a thin Runtime-facing entry point, not a second project Harness.

Apply `AGENTS.md`, then read `docs/current-state.md` and the active Development WorkItem or current
Repository Design Proposal. Inspect the Git diff before changing files. Load `SPEC.md`,
architecture, decisions, historical proposals, and evidence only for the boundary being changed.

Keep ChangeFleet's deterministic control plane thin. Agent Runtimes own semantic repository
analysis, subagent use, skill selection, implementation details, and task-specific verification
choices. ChangeFleet owns authorization, durable ChangeSet state, repository scope, exact Git
identity, evidence linkage, recovery, and human decisions.

Use Simplified Chinese for human-facing plans, progress, review conclusions, and delivery
summaries. Keep source code, schemas, stable technical documentation, identifiers, paths, and raw
evidence in their original language.

Decision 0006 accepts the first implementation stack, and WI-0001 owns its local package and review
evidence. Follow `docs/validation.md`; documentation-only work also runs `git diff --check` and
inspects affected links, authority projections, and eager Harness sizes.
