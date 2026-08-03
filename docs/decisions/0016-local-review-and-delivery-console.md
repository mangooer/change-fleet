# 0016: Add A Foreground Local Review And Delivery Console

Status: Accepted

Date: 2026-08-03

Source: Repository Design Proposal 0014

## Decision

ChangeFleet's first graphical operator surface will be a foreground, single-user, loopback-only
Local Review and Delivery Console. It reuses explicit shared application and read-only query
operations through a bounded experimental HTTP adapter. It never invokes the CLI or directly owns
Store, Runtime, Git, workspace, GitHub, authorization, lifecycle, or recovery logic.

The first console shows a bounded recent-ChangeSet list, one exact ChangeSet and current Bundle,
available validation and audit summaries, and exact GitHub delivery state. It may accept or reject
the current exact Bundle, publish an accepted Bundle, and explicitly refresh delivery. Project and
Repository configuration, planning, execution, GitHub binding changes, automatic merge, and remote
operation remain outside the surface.

Add one bounded `changeset.list` read model with stable cursor ordering and no large artifacts,
transcripts, raw provider payloads, secrets, Git, workspace, Runtime, or mutation capability.
Bundle-decision pages bind the exact revision, hash, Candidates, SHAs, changed paths, validation,
and available evidence while identifying omitted or unavailable review material honestly.

The retained experimental `changefleet serve` command composes one configured control root, binds
only loopback, runs in the foreground, and exposes an explicit route allowlist. It is not a daemon,
remote API, generic operation bus, or Codex App Server. Browser requests cannot choose a control
root, filesystem path, operation name, executable, or internal capability.

The first production UI uses Node.js 24 ESM, centralized `node:http`, and repository-owned HTML,
CSS, and browser ECMAScript modules without a production web framework, frontend framework,
bundler, CDN, telemetry, or external assets. Local-browser controls include strict Host and Origin,
no CORS, an in-memory same-origin session/CSRF nonce, bounded JSON mutation bodies, restrictive
security headers, safe errors, and graceful shutdown.

Browser mutation attempts preserve caller idempotency while results are ambiguous. Page reads do
not invoke Agents, refresh GitHub, repair state, or advance lifecycle. UI, HTTP, audit, and browser
state remain outside every Agent Runtime context.

UI validation uses an exact pinned `@playwright/test` development dependency and explicitly
installed Chromium. The browser gate is required when the affected UI, HTTP, view-model, or local
security boundary changes, not for unrelated or documentation-only work.

The recommended first real GitHub gate is the UI implementation WorkItem's own exact Candidate,
not a disposable smoke change. Proposal acceptance does not authorize that write: exact repository,
target, branch namespace, PR behavior, human merge, and cleanup authority must be recorded before
publication.

## Rationale

A bounded human-gate console proves the shared application boundary without expanding into a
generic Agent frontend or long-running service platform. Exact Bundle and delivery actions provide
real operator value, while deferring planning and execution avoids premature streaming, daemon,
and Provider-session semantics.

Native browser modules and a small explicit Node adapter fit the current private ESM package and
avoid a second production dependency system before interaction evidence exists. A maintained
Chromium acceptance gate still validates the actual browser surface.

Using the UI Candidate for the first external gate avoids throwaway PR work and makes the accepted
self-iteration path auditable, while separate external-write authority preserves the GitHub
boundary.

## Consequences

- One separately confirmed Development WorkItem may implement the complete first local console.
- The WorkItem must add the bounded list query, foreground server, explicit HTTP adapter, native UI,
  browser security, selected tests, and retained product command as one vertical slice.
- Existing CLI and isolated audit routes remain; the UI does not replace or invoke them.
- The UI is experimental and local. Stable API compatibility, remote access, multiple users,
  daemon lifetime, and framework adoption require later evidence and authority.
- Real GitHub self-iteration remains unverified until its exact external-write gate is authorized,
  executed, and reconciled.
- Full lifecycle UI, Agent chat, automatic merge, deployment, Linear, dashboards, webhooks, SSE,
  WebSockets, desktop shells, hosted multi-tenancy, and remote workers remain deferred.
