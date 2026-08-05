# 0014: Local Review And Delivery Console

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-03

Accepted: 2026-08-03

Supersedes:

Depends on: Decisions 0012, 0013, 0014, and 0015; WI-0008 `done`

Blocks: One Development WorkItem for the first local review and delivery console

Decision: [Decision 0016](../decisions/0016-local-review-and-delivery-console.md)

Implementation tracking:
[WI-0009](../work-items/WI-0009-local-review-and-delivery-console.md), `done`

## Context

The landed local implementation can register Projects, create and execute ChangeSets, accept exact
Bundles, derive read-only audit projections, and publish accepted Candidates through human-merged
GitHub pull requests. Those capabilities are exposed through one experimental CLI and shared typed
application operations. There is still no API, persistent service, or graphical operator surface.

The next stage should prove that another operator surface can reuse the same authority without
turning ChangeFleet into a hosted Agent frontend or duplicating lifecycle rules. The useful first
surface is not a complete workflow builder. It is a bounded local console for the human review and
delivery portion of the already-landed lifecycle.

The console must preserve four distinctions:

- ChangeFleet control state is authority; browser state is presentation and caller attempt state.
- application operations own normalization, authorization, idempotency, transitions, and errors;
  HTTP routes and pages do not.
- a Bundle decision records what exact subject a human accepted or rejected; it does not prove that
  every possible code-review artifact was available or inspected.
- local browser access is not remote-user authentication and does not authorize external GitHub
  writes by itself.

## External Reference Evidence

Accessed 2026-08-03:

- [Node.js 24 HTTP documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html)
  describes the stable, deliberately low-level `node:http` interface. It is sufficient for a small
  explicit local adapter when request parsing, limits, routing, errors, and shutdown are centralized.
- [Playwright installation](https://playwright.dev/docs/intro) documents Node.js 24 support, and
  [Playwright browser management](https://playwright.dev/docs/browsers) documents that each pinned
  Playwright release expects matching browser binaries. UI validation therefore needs an exact
  test dependency and explicit Chromium installation rather than an ambient or `latest` browser.

These references inform transport and testing choices. They do not become ChangeFleet authority or
justify a generic web framework.

## Decision

### Product Boundary

The first graphical surface is a **Local Review and Delivery Console**. It is a foreground,
single-user, loopback-only product adapter over explicit shared application and query operations.
It is not an Agent chat frontend, repository editor, hosted control plane, or general workflow UI.

The first console provides:

- a bounded recent-ChangeSet list;
- one exact ChangeSet current-state view;
- current plan, CandidateBundle, Candidate, changed-path, validation, decision, and evidence
  summaries already available through bounded control projections;
- one exact ChangeSet Runtime-audit summary, clearly presented as audit evidence rather than
  Runtime input or routing authority;
- current GitHub binding readiness and per-Repository delivery state;
- exact Candidate, PR, check, merge-result, partial-delivery, stale, and divergence summaries;
- links to GitHub for external review and human merge.

The first console permits only these mutations:

- accept or reject the current exact CandidateBundle;
- publish the current accepted Bundle through the landed delivery operation;
- explicitly refresh the current delivery observation.

Repository registration, Harness policy, Repository selection, planning, execution, GitHub binding
configuration, automatic merge, and compensation creation remain CLI-only or deferred. The UI may
display why one of those prerequisites is missing but may not silently perform it.

### Honest Bundle Review

A Bundle-decision page binds every action to the exact Bundle id, revision, hash, plan revision,
Candidate ids, base SHAs, Candidate SHAs, changed paths, validation identity, and available evidence
references. Any unavailable, omitted, truncated, stale, or externally reviewed artifact is shown as
such.

The first slice does not introduce an unbounded patch transport or claim that a bounded summary is
a complete code review. A human may inspect referenced Git subjects or later GitHub subjects using
an appropriate external tool. The recorded decision proves the exact subject and explicit human
action, not subjective review completeness.

Before submitting `accept` or `reject`, the page repeats the current exact Bundle identity and
requires an explicit confirmation. A stale browser page cannot apply a decision to a newer Bundle;
the shared operation rejects mismatched revision or hash authority.

### Bounded ChangeSet Discovery

The console must not require users to know every ChangeSet id, and browser code must never enumerate
filesystem directories. Add one explicit shared read operation equivalent to:

```text
changeset.list({ cursor, limit })
```

The query:

- reads only the selected ChangeFleet-owned control root;
- uses stable cursor ordering over `updated_at` plus stable ChangeSet id;
- has a default and hard maximum page size, with the first maximum no greater than 50;
- returns only stable id, Project id, state, current revisions, update time, blocker summary, and
  bounded current Bundle and delivery summaries;
- exposes only the current actionable subject while preserving historical records in exact reads;
- does not return transcripts, full diffs, logs, raw GitHub payloads, secrets, or artifact bodies;
- performs no repair, migration side effect, Git access, workspace access, Runtime invocation, or
  lifecycle mutation.

This operation is a product read model, not a directory listing API, analytics index, search engine,
or cross-ChangeSet effectiveness dashboard.

### Foreground Local Service

Add one maintained experimental product command equivalent to:

```text
changefleet serve --config <path> [--port <loopback-port>]
```

The command composes one local control environment and remains in the product command tree. It:

- runs in the foreground and shuts down on ordinary process termination;
- binds only an explicit IPv4 or IPv6 loopback address;
- binds exactly one configured control root at startup;
- prints a non-secret local URL and concise readiness information;
- never accepts a control-root, repository path, command name, or executable from an HTTP request;
- does not register a system service, daemonize, open a remote listener, or launch a hidden helper;
- does not automatically open a browser in the first slice;
- does not create another service graph or authority store.

This local HTTP process is a presentation adapter, not the Codex App Server and not a commitment to
a stable remote ChangeFleet API.

### Explicit Experimental HTTP Transport

The first transport uses explicit JSON routes beneath an experimental local namespace, equivalent
to:

```text
GET  /api/local/v0/changesets
GET  /api/local/v0/changesets/{change_set_id}
GET  /api/local/v0/changesets/{change_set_id}/audit
POST /api/local/v0/changesets/{change_set_id}/bundle-decisions
GET  /api/local/v0/changesets/{change_set_id}/delivery
POST /api/local/v0/changesets/{change_set_id}/delivery/publish
POST /api/local/v0/changesets/{change_set_id}/delivery/refresh
```

Exact paths may be finalized by the implementation WorkItem, but the route allowlist and semantic
boundary may not expand. There is no generic `/operations`, arbitrary method invocation, raw store
query, GraphQL surface, shell bridge, or CLI subprocess adapter.

Routes delegate unchanged typed inputs to the shared operator application or an explicit read-only
query. They return bounded versioned JSON and stable typed errors without stack traces, stderr,
credentials, filesystem internals, or unbounded provider payloads. Transport status codes are
presentation facts and do not replace ChangeFleet error codes.

The existing isolated CLI audit route retains its zero-capability forensic composition. The local
console may present a bounded audit projection inside a process that also owns explicit mutations,
but it must call the unchanged read-only query component and must not claim the stronger isolated
CLI-process boundary.

### Frontend Stack

The first frontend uses repository-owned HTML, CSS, and browser-native ECMAScript modules. The
local server uses the existing Node.js 24 ESM runtime and a centralized `node:http` adapter.

The first implementation adds:

- no React, Vue, Svelte, frontend router, production web framework, bundler, package CDN, or runtime
  dependency solely for UI rendering;
- no inline third-party script, remote font, analytics, telemetry, or external asset request;
- no duplicate domain model or hand-coded lifecycle transition logic in browser modules.

View-model transformation, formatting, and interaction state may live in testable browser modules.
The application and query results remain the source schema. A future framework migration requires
new evidence and, if it changes the public implementation stack or boundary, a later proposal.

### Local Browser Security

Loopback is a network-scope restriction, not user authentication. The first local server therefore
must fail closed with at least these controls:

- exact loopback bind and strict `Host` validation;
- no permissive CORS response;
- exact same-origin validation for API requests;
- a per-process in-memory browser-session/CSRF nonce obtained only through the same-origin page and
  never placed in a URL, terminal output, persistent state, or ordinary log;
- mutation requests limited to explicit JSON `POST` routes with bounded body size and strict field
  validation;
- read routes that also require the established same-origin session rather than becoming ambient
  localhost data endpoints;
- restrictive Content Security Policy and standard content-type, framing, and sniffing protections;
- bounded timeouts and graceful connection shutdown;
- secret-safe request and failure logging.

The service trusts the local operating-system user and existing host-managed GitHub/Codex
credentials to the same degree as the local CLI. It does not defend against a malicious process
already running as that user. Remote access, multiple users, TLS termination, account sessions,
authorization roles, and hosted credentials require a separate proposal.

### Caller Idempotency And Browser Recovery

Every mutation carries a browser-generated attempt id mapped to the existing application
idempotency key. The browser retains the same attempt id while a response is ambiguous and never
generates repeated publish or decision operations merely because presentation timed out.

Browser state is not durable ChangeFleet authority. After reload or server restart, the page first
reads current exact state and presents the durable application result. GitHub publication remains
subject-idempotent and performs the landed branch/PR reconciliation before any retry. A browser may
offer retry only when the returned state and typed error permit it.

Delivery refresh is an explicit mutation because it contacts GitHub and records evidence. Ordinary
page reload and `GET` requests do not silently refresh GitHub, start a Runtime, repair state, or
advance the lifecycle.

### Context And Audit Isolation

Console queries and browser rendering are operator activity. They are never admitted to the
Control Contract, Run Context Projection, Provider thread, repository Harness, or Agent prompt.

The console may show already-derived token, duration, retry, validation, decision, and delivery
facts for one exact ChangeSet. It does not add pricing authority, comparison, rankings, optimization,
or a materialized analytics store. Full logs, transcripts, diffs, GitHub payloads, and evidence
bodies remain on-demand linked artifacts rather than list or bootstrap payloads.

### Manual Refresh And Process Lifetime

The first UI uses explicit page and delivery refresh. It adds no polling scheduler, Server-Sent
Events, WebSocket, webhook receiver, background worker, tray process, or durable browser session.
The selected first mutations are short application calls or already-supported external delivery
operations; starting long-running Agent execution from the UI remains deferred.

## Real GitHub Gate And First Self-Iteration

Proposal acceptance does not authorize a GitHub write. Before the first real publication, record
the exact repository, target, remote, branch namespace, PR visibility, expected writes, human merge
behavior, and source-branch cleanup authority.

Avoid a disposable smoke-only repository change. The recommended first real GitHub gate is the
accepted UI implementation WorkItem's own exact Candidate:

1. create and confirm one UI Development WorkItem;
2. create a ChangeFleet ChangeSet against the registered ChangeFleet repository and selected base;
3. use the landed Runtime path to plan and implement the console in an isolated WorkUnit;
4. validate and review the exact CandidateBundle through the currently landed operator surface;
5. after separate GitHub authority is recorded, publish the exact UI Candidate through ChangeFleet;
6. let a human review and merge in GitHub;
7. refresh delivery and record `done` only for the matching exact result.

If real GitHub authority is withheld or the gate fails, the local implementation Candidate may
still be reviewed, revised, or accepted as code, but ChangeFleet must not claim that the external
self-iteration loop was proven.

## Alternatives

### Exact-id delivery viewer only

This would reuse the fewest operations, but it requires manual ids and leaves the central Bundle
human gate in the CLI. It is too weak to validate a useful graphical operator surface. Reject it.

### Full lifecycle UI

Project configuration, scope revision, planning, execution, streaming progress, cancellation, and
recovery would require long-running service semantics before the bounded review surface is proven.
Defer them.

### UI invokes the CLI

Spawning CLI commands would make one presentation adapter another adapter's private protocol,
duplicate process error handling, and prematurely freeze terminal JSON. Reject it.

### Generic operation bus

A single endpoint accepting arbitrary operation names looks compact but exposes future allowlist
changes accidentally and trends toward a public command bus. Use explicit routes.

### React or another SPA framework immediately

A framework could improve component ergonomics later, but the first bounded console does not yet
justify a second build system, dependency family, asset pipeline, or hydration model. Start with
native modules and revisit from evidence.

### Electron or Tauri desktop shell

A desktop shell adds packaging, update, signing, process, and cross-platform policy before the
local service and application boundary are proven. Defer it.

### Background daemon with polling or webhooks

This adds lifetime ownership, authentication, event replay, scheduling, and cleanup. Explicit
foreground operation and refresh are sufficient for the first stage.

### Disposable GitHub smoke PR before the UI

It isolates provider diagnosis but creates throwaway work and external cleanup. Prefer the UI
Candidate itself after read-only readiness checks and explicit authority.

## First Implementation Stage

After acceptance, create exactly one confirmed Development WorkItem that delivers one end-to-end
local console slice:

1. add the bounded ChangeSet list query and current exact UI projections;
2. add the foreground loopback server composition and retained experimental `serve` command;
3. add the explicit HTTP route allowlist, typed errors, limits, shutdown, and local-browser security;
4. add repository-owned HTML, CSS, and ESM views for list, exact ChangeSet, Bundle, audit, and
   delivery;
5. add exact Bundle accept/reject, delivery publish, and delivery refresh interactions with caller
   idempotency and confirmation;
6. add deterministic transport, security, projection, and browser tests;
7. add one exact pinned `@playwright/test` development dependency and a selected Chromium UI gate;
8. keep browser binaries and generated Playwright output outside Git and aggregate state;
9. remove every temporary server, fixture executable, screenshot, trace, or generated asset not
   owned as maintained test infrastructure;
10. attempt real self-iteration delivery only after separate exact GitHub authority.

The WorkItem must not add planning or execution controls, a daemon, a frontend framework, automatic
merge, remote access, or a generic API.

## Acceptance Criteria

1. The UI and HTTP adapter reuse shared operations and never invoke the CLI, Store, Runtime, Git,
   workspace, or `gh` directly.
2. The foreground server binds one configured control root and loopback address and cannot be
   redirected by an HTTP request.
3. Only explicit bounded routes exist; unknown routes, fields, methods, origins, hosts, oversized
   bodies, and missing session nonce fail closed.
4. The recent list is bounded, cursor-stable, current-subject only, and free of large or secret
   fields.
5. Bundle decisions bind the exact revision and hash and show omitted or unavailable review
   evidence honestly.
6. Delivery publish and refresh preserve existing authorization, exact-Candidate, idempotency,
   divergence, and human-merge semantics.
7. Browser retries reuse one attempt identity while a result is ambiguous and reconcile durable
   state after restart.
8. GET and page reload perform no Runtime, GitHub refresh, repair, or lifecycle mutation.
9. Runtime audit presentation does not mutate audit state or enter Agent context and does not claim
   the isolated CLI route's stronger process composition.
10. The frontend makes no external asset, telemetry, font, analytics, or CDN request.
11. Production adds no web framework, frontend framework, bundler, daemon, WebSocket, SSE, webhook,
    or generic operation bus.
12. Selected Node and Chromium tests cover routes, security, exact-subject confirmation,
    idempotency, restart reads, partial delivery, and typed failures.
13. Real GitHub success is claimed only after the separately authorized exact UI Candidate is
    published and reconciled; otherwise it remains explicitly unverified.

## Validation

| Gate | Scope |
| --- | --- |
| Pure query and view-model unit tests | bounded ordering, cursor, exact subject, formatting, omitted evidence |
| HTTP adapter unit tests | route allowlist, method/content type, limits, typed error mapping, safe output |
| Local service integration | loopback binding, one root, Host/Origin/session checks, shutdown, zero GET mutation |
| Application integration | Bundle decision, publish, refresh, idempotency, stale subject, restart reconciliation |
| Chromium acceptance | list to exact view, confirmation, decision, publish, partial/merged refresh, accessibility basics |
| Context regression | no UI, audit, HTTP, or browser state in Runtime invocation |
| Asset and command audit | retained `serve`, no temporary server, no generated browser output or external asset |
| Real GitHub gate | conditional exact UI Candidate write under separately recorded authority |
| Documentation maintenance | `git diff --check`, affected links, authority projections, eager Harness sizes |

The pinned browser gate is selected whenever UI assets, view models, HTTP behavior, or local-browser
security change. Pure documentation or unrelated domain work need not launch or download a browser.
Missing browser infrastructure is reported as unverified, not passed.

## Risks And Open Questions

- `node:http` is intentionally low-level. The implementation must centralize parsing, routing,
  limits, errors, security headers, and shutdown rather than spread ad hoc handling across views.
- A same-user local malicious process remains inside the first trust boundary. Remote or multi-user
  use cannot reuse the loopback session model.
- Browser idempotency state can disappear. Durable application state and exact-subject
  reconciliation remain authoritative after reload or restart.
- Large or multi-Repository Bundles may exceed a useful single page. The first UI must paginate or
  summarize without admitting unbounded artifacts.
- Chromium installation is an external test prerequisite tied to the pinned Playwright version.
  It must not be silently downloaded by ordinary production startup.
- The first real self-iteration couples a new UI Candidate with the first real GitHub write. Exact
  readiness checks and typed evidence must keep failures diagnosable.

## Non-Goals

- Agent chat, prompt editing, in-flight steering, terminal emulation, or Provider-session UI.
- Project registration, Repository selection, planning, execution, cancellation, or recovery UI.
- GitHub binding configuration, merge button, automatic merge, merge queue, deployment, or rollback.
- Full code-review diff transport, inline comments, PR review ingestion, or source editor.
- Generic REST API, GraphQL, operation bus, generated client, or stable public API contract.
- Daemon, service installer, tray application, Electron, Tauri, mobile app, or remote listener.
- Webhook, polling scheduler, SSE, WebSocket, GitHub App, OAuth, or stored GitHub credential.
- Multi-user accounts, roles, TLS, hosted tenancy, organization catalog, or remote workers.
- React, Vue, Svelte, frontend build pipeline, external CDN, telemetry, or analytics.
- Linear, issue synchronization, dashboards, pricing, rankings, or automatic Agent optimization.

## Documentation Impact

Acceptance records one decision and updates `SPEC.md`, architecture, validation, current state, and
the Proposal index. Implementation requires one separately confirmed WorkItem and must not be
projected as landed before its acceptance and commit.
