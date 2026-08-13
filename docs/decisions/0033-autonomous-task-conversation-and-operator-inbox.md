# 0033: Autonomous Task Conversation And Operator Inbox

Status: Accepted

Date: 2026-08-12

Source: Repository Design Proposal 0031

## Decision

Make one autonomous task conversation the ordinary ChangeFleet interaction. One visible timeline
spans planning, execution, verification, review, and delivery, while Planner, Executor, Verifier,
Reviewer, and optional Supervisor remain separate role-scoped Runs and Provider sessions.

Task creation provides bounded authorization to advance inside frozen Repository, ref, Runtime,
permission, budget, review, and delivery policy. A Planner declares `ready` or `needs_input`; it
never grants authority. Core policy activates an exact eligible Plan automatically, while unresolved
questions, authority expansion, mandatory policy, or exhausted recovery produce a human request.

Ordinary mutations enqueue durable local commands and return before Agent work finishes. One
restart-aware background Controller owns the ChangeSet lease and emits a bounded safe presentation
timeline. Raw reasoning, command output, complete logs, diffs, and audit evidence remain excluded
from ordinary conversation and later-Agent context.

The operator inbox exposes only `running | needs_feedback | needs_review | waiting_for_merge |
complete | cancelled`, with exact reason codes derived from existing kernel facts. The persisted
ChangeSet lifecycle remains `planning | running | review | terminal`.

Human Bundle acceptance publishes or resumes one Ready PR when authorized. Transient Delivery
failures retry idempotently; missing configuration and non-recoverable divergence become
needs-feedback. ChangeFleet never merges automatically. Explicit cancellation stops automatic
advancement, releases eligible resources, and preserves audit evidence.

## Consequences

- Decision 0032 remains for the exact Intent, Plan, Controller, and small lifecycle kernel but is
  revised for automatic Plan activation, asynchronous advancement, one presentation timeline, and
  the six-state operator projection.
- WI-0041 owns one atomic local vertical replacement from task creation through merge observation.
- Desktop packaging, tracker intake, automatic model routing, Candidate comparison, and cost-policy
  optimization remain deferred.
