# 0014: Share Application Commands Across Operator Surfaces

Status: Accepted

Date: 2026-08-03

Source: Repository Design Proposal 0012

## Decision

ChangeFleet's CLI, future API or App Server, future UI, and future tracker adapters will share typed
application-operation semantics rather than duplicate lifecycle logic or invoke one another's
presentation adapters. Shared semantics include normalization, authorization, caller idempotency,
exact subjects, state transitions, human gates, durable results, and typed errors. Each adapter may
own transport-specific grammar, progress, streaming, and presentation.

The first lifecycle operator surface will be one unified local `changefleet` executable. It is an
experimental product adapter intended to remain, but this stage establishes no stable released CLI
compatibility promise. It may expose only an explicit allowlist of existing human and operator
application entry points; internal recovery, store, Runtime, Git, workspace, validation, and
failure-recording helpers do not become commands.

Executable surfaces are classified as product commands, bounded debug commands, or temporary
scripts. Product commands carry explicit `experimental` or later `stable` maturity. Debug commands
are maintained diagnostics without public compatibility. Temporary scripts are WorkItem-scoped,
contain no unique lifecycle logic, and are removed before acceptance unless a confirmed follow-up
WorkItem owns an explicit remaining need.

The existing exact-id audit projections remain read-only debug capabilities. When the unified CLI
provides equivalent audit commands, the same implementation WorkItem will remove the standalone
`changefleet-audit` executable, parser-only code, npm alias, obsolete documentation, and redundant
process tests while retaining `RuntimeAuditQueryService` and Decision 0013's zero-write boundary.

## Rationale

A shared application boundary prevents future UI or API work from reproducing ChangeFleet's
authorization and lifecycle decisions. Keeping the first CLI experimental avoids freezing the
current filesystem composition, synchronous process lifetime, configuration, and output format as
a v1 contract before real operator experience and a persistent service boundary exist.

Separating maintained debug commands from disposable scripts prevents both accidental public
compatibility and indefinite scaffolding. Replacing obsolete entry points in the same WorkItem
keeps migration debt visible and bounded.

## Consequences

- One separately confirmed Development WorkItem may implement the complete current local lifecycle
  through the experimental root CLI and migrate the audit command.
- Complex mutations use structured requests that map to existing application inputs and preserve
  caller idempotency; the CLI must not define a parallel domain model.
- Future UI and API adapters may differ from CLI interaction while preserving application command
  semantics.
- Stable CLI versioning, deprecation, completion, and compatibility require a later accepted
  decision.
- API, App Server, daemon, UI, Linear, remote access, delivery, merge, and deployment remain
  deferred.
