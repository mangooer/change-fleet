---
ui:
  default_locale: zh-CN
---

# ChangeFleet Workflow Entry

This is a thin Runtime-facing entry point, not a second Harness.

Apply `AGENTS.md`, then read `docs/current-state.md` and the active Development WorkItem or current
Repository Design Proposal. Inspect the Git diff before changing files. Load additional contract,
rationale, and evidence only for the boundary being changed.

Agent Runtimes own semantic analysis, implementation details, and task-specific checks.
ChangeFleet owns authorization, exact Git identity, durable state, evidence linkage, recovery, and
human decisions.

Use Simplified Chinese for human-facing plans, progress, review conclusions, and delivery
summaries. Follow `docs/validation.md` for checks.
