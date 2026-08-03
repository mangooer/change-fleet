# 0011: Local Read-Only Audit Entry Point

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-03

Discussion revised: 2026-08-03

Accepted: 2026-08-03

Supersedes:

Depends on: Proposal 0010, Decision 0012, and WI-0005 `done`

Decision: [Decision 0013](../decisions/0013-local-read-only-audit-entry-point.md)

Implementation tracking:
[WI-0006](../work-items/WI-0006-local-read-only-audit-entry-point.md), `done`

## Context

Decision 0012 and WI-0005 provide private, versioned `RunAuditProjection` and
`ChangeSetAuditProjection` views derived from immutable local evidence. The implementation is
intentionally isolated from Runtime input, lifecycle commands, Git mutation, and registered
Repository workspaces.

Those projections are currently reachable only by importing `RuntimeAuditQueryService` from code
or tests. An operator therefore has no small supported path to inspect one exact Run or ChangeSet
in an existing local control root. Building more metrics before the existing facts can be inspected
would encourage continued schema work without operational feedback.

## Problem

The first operator surface must make the landed audit projections usable without becoming a broad
ChangeFleet CLI or a second analytics product. In particular, it must answer:

- how an operator identifies the exact local control root and exact audit subject;
- how success and typed failure are represented for both humans and scripts;
- how the command proves that opening a missing or malformed root cannot initialize or repair it;
- how pagination and existing projection bounds remain effective at the process boundary;
- which conveniences are deliberately absent so that exact-id audit does not become portfolio
  discovery, comparison, or mutable lifecycle control.

## Options Considered

### Option A: Add one package-private local audit command

Add a thin Node.js process entry point that parses one exact subject, constructs only the existing
read capabilities, invokes `RuntimeAuditQueryService`, writes one JSON document, and exits.

Advantages:

- makes WI-0005 directly usable with a small independently testable boundary;
- exercises the same projection contract that a later API or UI may call;
- preserves exact-id authorization and avoids directory or portfolio scanning;
- requires no service process, network listener, credential store, or UI framework;
- gives representative operational feedback before comparison or pricing design.

Tradeoffs:

- it is intentionally less convenient than listing, searching, or interactive exploration;
- process invocation and JSON are the only initial presentation path;
- this creates a local command contract even though the package remains private.

### Option B: Publish a code example only

Document a short script that imports `RuntimeAuditQueryService` and lets each operator compose the
stores manually.

Advantages:

- almost no production surface;
- callers can customize output freely.

Tradeoffs:

- every caller must rediscover safe read-only composition and error handling;
- examples tend to drift from the real store layout and projection bounds;
- there is no process-level proof of stdout, stderr, exit status, or zero initialization writes.

Reject this option as the primary surface. A usage example may show the accepted command but must
not replace it.

### Option C: Start with a local HTTP API or dashboard

Expose audit queries through a server, browser UI, or general operator API.

Advantages:

- easier interactive discovery and later visualization;
- natural base for remote access.

Tradeoffs:

- immediately introduces listening, authentication, authorization, tenancy, lifecycle, and API
  compatibility questions;
- encourages listing and portfolio queries before their authority and bounds are designed;
- is much larger than the exact-id inspection need.

Defer this option.

## Recommendation

Adopt Option A. Add exactly one package-private local audit command over the existing query service.
Its first contract is JSON-only, exact-id, explicitly rooted, read-only, and intentionally unable
to discover subjects or invoke lifecycle commands.

## Proposed Design

### 1. Expose one narrow local command

The package-local entry point is conceptually:

```text
node ./bin/changefleet-audit.js run <run_id> --control-root <path> [--locale <locale>]
node ./bin/changefleet-audit.js changeset <change_set_id> --control-root <path> \
  [--detail-page <positive_integer>] [--page-size <1..100>] [--locale <locale>]
```

An `npm run audit -- ...` alias may invoke the same file. The direct Node entry point remains the
test subject so npm output cannot be confused with the JSON contract.

The command has only the `run` and `changeset` subcommands. It does not expose Project,
Repository, WorkUnit, Bundle, planning, execution, review, delivery, or recovery commands. It is a
package-private operator tool, not a released public CLI or compatibility promise.

### 2. Require explicit root and exact subject identity

Every invocation requires `--control-root`. There is no current-directory discovery, environment
fallback, remembered default, ancestor search, registry search, or scan across sibling control
roots. A relative path may be accepted but is resolved once before reads.

The operator supplies exactly one Run or ChangeSet id. The command does not list, search, infer,
autocomplete, or accept wildcards. An explicit local invocation authorizes only reading that root
under the operating-system identity of the process; hosted authentication and tenant policy are
not inferred from this local boundary.

The host path is a locator, not durable identity. It is not added to the audit payload, source
identity, or payload digest.

### 3. Reuse the projection without a second success schema

On success, stdout contains exactly one JSON serialization of the existing
`RunAuditProjection` or `ChangeSetAuditProjection`, followed by one newline. The command does not
wrap, rename, summarize, recalculate, persist, or append fields to that projection.

Stable machine field names remain English. `--locale` selects only ChangeFleet-generated
diagnostic messages and accepts the repository's supported `zh-CN` and `en` values; the default is
`zh-CN`. Pagination maps directly to the accepted `detail_page` and `page_size` query parameters.

The successful process writes no progress text to stdout. Shell redirection is an operator action;
ChangeFleet itself does not own report files, retention, export delivery, or scheduled generation.

### 4. Make errors machine-detectable and localized

Expected failures write one bounded JSON error document to stderr with:

```text
error.code
error.message
error.locale
error.details
```

Stable codes, rather than localized messages, are the machine contract. Default output does not
include a JavaScript stack, raw source document, transcript, prompt, Harness body, or artifact
body. Unknown commands, repeated or unknown flags, missing required arguments, unsupported locales,
and invalid pagination fail before store reads.

Initial process statuses are:

| Status | Meaning |
| ---: | --- |
| `0` | One audit projection was written successfully |
| `2` | Invocation arguments are invalid |
| `1` | The exact audit query failed or an unexpected local read error occurred |

Typed query diagnostics retain their existing codes. Unexpected failures use one stable generic
code and keep implementation details out of default stderr.

### 5. Compose readers without initialization or repair

The command constructs the filesystem store readers needed by `RuntimeAuditQueryService` but must
not call `ChangeFleetService.open()`, any store `initialize()` method, or any lifecycle command.
The query service receives only bound read capabilities:

```text
ControlStore.readChangeSet
RunStore.read
EvidenceStore.read
```

It receives no writer, scheduler, Agent Runtime, `RepositoryWorker`, Git adapter, workspace
materializer, or registered Repository handle. A missing control root remains missing; a malformed
or unsupported source fails closed and is never initialized, migrated, repaired, or normalized in
place.

The process may read the exact local files referenced by the projection. It does not open raw
transcripts, source snapshots, diffs, prompts, Harness bodies, or linked artifact bodies by
default.

### 6. Preserve existing bounds and context isolation

`run` returns one exact Run. `changeset` returns one exact ChangeSet with at most 100 detailed Run
rows on the selected page; complete-set totals retain the WI-0005 semantics. There is no `all`,
`list`, `find`, comparison, filter language, or portfolio aggregate.

Command output remains operator/debug data. It is not placed in a Control Contract, current Run
Context Projection, Agent prompt, Harness discovery result, plan revision, Bundle decision,
automatic routing input, or subsequent command context.

### 7. Keep the implementation dependency-free and replaceable

The first command uses Node.js built-ins and the existing application and filesystem components.
It does not add a CLI framework, generic command bus, public package export, server abstraction, or
operator-surface plugin system.

A later CLI, API, or UI may reuse `RuntimeAuditQueryService`; it is not required to preserve this
private process syntax unless a future proposal accepts a public compatibility contract.

## First Implementation Stage

After acceptance, create exactly one Development WorkItem for one local read-only vertical slice:

1. add the package-private `changefleet-audit` Node entry point and optional npm alias;
2. parse only the two accepted exact-id commands and bounded options without a new dependency;
3. compose the landed query service without initialization or mutation capabilities;
4. present success on stdout and typed localized failure on stderr with the accepted exit statuses;
5. add process-level tests for both subjects, invalid invocation, missing and malformed roots,
   pagination, deterministic payloads, and zero writes;
6. document concise local usage without presenting the package as released;
7. retain fixtures only in test support and add no production fake store or evidence source.

The stage exits when the command reads deterministic fixture evidence through the real filesystem
stores and process-level tests prove that the entire control root is byte-identical before and
after successful and failed queries. No paid Provider invocation is required because this stage
does not change Provider execution or evidence capture and WI-0005 already verified real Provider
evidence against the query service.

## Acceptance Criteria

1. An operator can request one exact Run or ChangeSet from one explicit local control root.
2. Successful stdout is exactly the existing versioned audit projection JSON plus one newline.
3. Diagnostics use stable codes and supported localized messages without contaminating stdout.
4. Invalid invocation, query failure, and success produce the specified exit statuses.
5. Unknown flags, unsupported locale values, and out-of-range pagination fail before source reads.
6. The command performs no initialization, migration, repair, lifecycle mutation, workspace
   creation, Git operation, or registered Repository access.
7. Missing control roots are not created, and successful or failed queries leave existing roots
   byte-identical.
8. Existing exact-id, pagination, artifact-link, unknown-value, and payload-digest semantics remain
   unchanged.
9. Audit output remains excluded from ordinary Agent context and every authority decision.
10. No listing, portfolio scan, comparison, pricing, dashboard, server, or public CLI contract is
    introduced.
11. No production mock, fake store, fake evidence source, CLI framework, or speculative operator
    abstraction remains after review.

## Validation

| Gate | Scope |
| --- | --- |
| Argument unit tests | exact grammar, duplicate and unknown flags, locale, positive page, page-size bound |
| Child-process integration | stdout JSON, stderr JSON, exit status, both subject kinds, missing and malformed roots |
| Read-only regression | directory digest before and after success and every representative failure |
| Projection regression | command JSON equals direct query-service projection apart from observation time |
| Context regression | command and audit fields remain absent from ordinary Runtime input |
| Existing repository checks | no lifecycle, Provider, workspace, Candidate, or audit-query regression |
| `git diff --check` plus eager-size and fake-path audit | Harness and repository hygiene |

The implementation stage does not repeat the paid real Codex gate. A future change to Provider
capture or projection semantics must make its own validation decision.

## Risks And Open Questions

- A local command is still an interface. Keeping the package private avoids a public compatibility
  promise, but tests should prevent accidental ambiguity while this interface exists.
- Existing filesystem store classes also expose write methods. Passing only bound read methods to
  the query service and proving root identity protects the first slice without creating duplicate
  reader implementations prematurely.
- Exact-id input is less convenient than discovery. That inconvenience is intentional until
  listing authority, bounds, and privacy are designed.
- JSON-only output is less approachable than a table. A later presentation option should derive
  from the same projection rather than introduce another metric contract.

## Non-Goals

- A released or compatibility-versioned public CLI.
- Lifecycle mutation, Agent execution, planning, confirmation, review, delivery, or recovery.
- Project, Repository, WorkUnit, Bundle, Run, or ChangeSet discovery and listing.
- Portfolio scans, saved filters, report files, scheduled reports, or telemetry export.
- Cross-ChangeSet comparison, ranking, quality scores, pricing, budgets, or optimization.
- An HTTP server, App Server, API, dashboard, browser UI, or remote access.
- Authentication, authorization roles, multi-tenancy, hosted retention, or encryption.
- Reading or embedding raw transcript, prompt, diff, source, Harness, log, or artifact bodies.
- Linear or another task-tracker integration.
- Another Provider, Runtime Kit, continuous context enforcement, or remote workers.

## Documentation Impact

- Acceptance records one decision for the package-private local audit command and adds the thin
  operator boundary to `docs/architecture.md`.
- The accepted product contract needs only a concise statement that exact-id audit projections may
  be inspected through a local read-only command; command syntax remains private implementation
  documentation.
- Implementation still requires exactly one separately confirmed Development WorkItem.
