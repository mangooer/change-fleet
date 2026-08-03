# 0013: Add A Local Read-Only Audit Entry Point

Status: Accepted

Date: 2026-08-03

Source: Repository Design Proposal 0011

## Decision

ChangeFleet will provide one package-private local Node.js command for inspecting the existing
versioned `RunAuditProjection` and `ChangeSetAuditProjection` views. Every invocation requires one
explicit control-root locator and one exact Run or ChangeSet id. The command does not discover,
list, infer, or scan audit subjects.

Successful stdout is exactly one existing audit projection JSON document. Expected failure is one
bounded JSON diagnostic on stderr with a stable code and a supported localized message. Exit
statuses distinguish success, invalid invocation, and query or local-read failure.

The command constructs only the existing filesystem readers and passes bound read capabilities to
`RuntimeAuditQueryService`. It does not initialize a store, open the lifecycle service, write or
repair state, invoke an Agent, access Git or a registered Repository, materialize a workspace, or
place audit output into Runtime context.

The entry point remains package-private and dependency-free. It does not establish a released CLI
compatibility contract, operator API, server, dashboard, report store, portfolio scan, comparison,
pricing, or tracker integration.

## Rationale

WI-0005 made exact audit facts trustworthy but left them reachable only from imported code and
tests. A narrow local process boundary makes those facts inspectable and exercises their real
presentation and zero-write behavior without introducing remote-service, discovery, or analytics
authority.

Reusing the existing projection as the complete success document avoids a second report schema.
Requiring the root and exact id keeps the first surface bounded while real operator experience is
collected for later design.

## Consequences

- One separately tracked implementation slice may add only `run` and `changeset` inspection.
- Missing or malformed roots must remain unmodified and must never be initialized or repaired.
- Stable field names remain English; only diagnostics use the selected supported locale.
- The local command needs process-level stdout, stderr, exit-status, pagination, and zero-write
  tests.
- The Provider gate is not repeated because this decision changes neither Runtime execution nor
  evidence capture.
- Listing, comparison, pricing, public surfaces, Linear, and remote access require later authority.
