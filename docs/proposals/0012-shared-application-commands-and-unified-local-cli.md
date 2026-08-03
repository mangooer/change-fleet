# 0012: Shared Application Commands And A Unified Local CLI

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-03

Accepted: 2026-08-03

Supersedes:

Depends on: Decisions 0006, 0010, and 0013; WI-0006 `done`

Blocks: A Development WorkItem for a local lifecycle operator surface

Decision: [Decision 0014](../decisions/0014-shared-application-commands-and-unified-local-cli.md)

Implementation tracking:
[WI-0007](../work-items/WI-0007-shared-application-commands-and-unified-local-cli.md), `done`

## Context

The deterministic local slice already exposes typed application methods for Project registration,
ChangeSet creation and revision, planning, confirmation, execution, Bundle decisions, and exact
state reads. The first real Codex Provider is also landed. Operators can nevertheless exercise a
complete flow only through tests or imported application code.

Decision 0013 added one deliberately package-private `changefleet-audit` process for exact-id,
read-only inspection. That command proved process JSON, typed diagnostics, and zero-write query
composition, but it explicitly did not establish a lifecycle CLI or public compatibility contract.

The next operator surface must avoid two opposite forms of waste:

- a collection of temporary lifecycle scripts whose parsing and business rules are discarded when
  an API or UI arrives;
- a prematurely frozen v1 CLI contract built around the current private filesystem layout,
  service composition, and incomplete long-running process model.

Codex and Claude Code provide a useful boundary rather than an implementation dependency. Their
terminal, automation, protocol or SDK, and graphical surfaces reuse an underlying engine while
retaining surface-specific interaction and maturity. A graphical surface does not need to invoke a
CLI parser, and terminal-only automation options do not need artificial UI equivalents.

## Decision

Introduce one unified `changefleet` local CLI as an **experimental product adapter** over the
existing typed application operations. The executable is intended to survive into a released
product, but its grammar, configuration file, and presentation format do not become a stable public
compatibility contract in this stage.

CLI, a future API or App Server, a future UI, and future tracker adapters must share application
operation semantics: authorization, input normalization, idempotency, exact subjects, state
transitions, human gates, typed errors, and durable results. They may have different interaction,
streaming, presentation, and transport behavior. A UI must not spawn or import the CLI parser; it
will call a future transport adapter over the same application operations.

Classify executable surfaces into three engineering classes:

1. **Product commands**, with `experimental` or `stable` maturity. Experimental commands are real
   user operations intended to remain, but may change before a separately accepted stability
   boundary. Stable commands carry an explicit compatibility policy.
2. **Debug commands**, which are maintained diagnostic capabilities with bounded authority but no
   public compatibility promise.
3. **Temporary scripts**, which are WorkItem-scoped implementation aids, never product commands,
   and must have an explicit removal condition.

No command is considered stable in the first implementation stage.

## Boundaries

### Shared semantics, separate adapters

The reusable boundary is the application operation, not shell syntax:

```text
CLI adapter --------------------+
                                |
future API / App Server --------+--> typed application operations --> ChangeFleet control core
                                |
future tracker adapter ---------+

future UI --> future API / App Server
```

The application boundary owns:

- normalized command and query input;
- caller idempotency and replay semantics;
- Project, Repository, ChangeSet, revision, Run, Candidate, and Bundle identity;
- authorization and explicit human decisions;
- state transitions, durable results, and typed error codes;
- exact evidence and recovery references.

The CLI owns only:

- command grammar and local configuration location;
- conversion from positional arguments or structured request input to one application call;
- stdout, stderr, exit status, and terminal-oriented progress presentation;
- process lifetime and cancellation forwarding.

A future API owns transport authentication, request framing, concurrency, event streaming, and
remote authorization. A future UI owns forms, navigation, progress views, confirmations, and visual
review. Neither surface may reproduce lifecycle decisions outside the application boundary.

### Explicit operator operation allowlist

The initial operator catalog may expose only existing human or operator application entry points:

| Application operation | Purpose |
| --- | --- |
| `registerProject` | Register one Project with one or more explicit local Repositories |
| `reviseRepositoryWorkspacePolicy` | Confirm a Repository's future local workspace/Harness policy |
| `createChangeSet` | Freeze confirmed intent, Repository selection, branches, bases, and Harness input |
| `reviseRepositorySelection` | Propose a typed revision of the selected Repository subjects |
| `resolveRepositorySelectionRevision` | Record the human decision for a pending selection revision |
| `reviseRepositoryHarnessSelection` | Propose a typed revision of frozen Harness input |
| `resolveRepositoryHarnessSelectionRevision` | Record the human decision for a pending Harness revision |
| `planChangeSet` | Invoke the configured Runtime for one current ChangeSet planning attempt |
| `confirmPlanRevision` | Confirm one exact current plan revision |
| `executeChangeSet` | Execute the confirmed WorkUnits and assemble an exact CandidateBundle |
| `recordBundleDecision` | Accept, reject, or request revision of one exact Bundle subject |
| `readChangeSet` | Read one exact current ChangeSet state |
| `getRunAudit` / `getChangeSetAudit` | Read the existing exact-id audit projections |

Internal recovery helpers, individual WorkUnit execution helpers, validators, store methods,
failure-recording helpers, Runtime invocation, Git commands, and workspace methods are not operator
commands merely because the current JavaScript class can call them.

Implementation clarification (2026-08-03): inspection for WI-0007 established that
`resolveRepositorySelectionRevision` and `resolveRepositoryHarnessSelectionRevision` are internal
deterministic helpers called by `createChangeSet`, `reviseRepositorySelection`, and
`reviseRepositoryHarnessSelection`. They do not accept caller idempotency or record independent
human decisions. The two table rows describe resolution work inside those confirmed operations;
they do not authorize `repository-selection resolve` or `harness-selection resolve` CLI commands.
This clarification applies the proposal's explicit prohibition on exposing internal helpers.

The implementation may create a small explicit router or facade to enforce this allowlist. It must
not introduce a generic command bus, dependency-injection framework, public service graph, or
speculative API abstraction.

### One experimental root executable

The product has one root executable, conceptually organized as:

```text
changefleet project register
changefleet project repository-policy revise

changefleet changeset create
changefleet changeset repository-selection revise
changefleet changeset harness-selection revise
changefleet changeset plan
changefleet changeset plan confirm
changefleet changeset execute
changefleet changeset bundle decide
changefleet changeset show

changefleet debug audit run
changefleet debug audit changeset
```

These names define the intended grouping and first implementation target, not a stable released
grammar. Before any command is marked stable, a later accepted proposal must define versioning,
deprecation, completion, human presentation, machine output, and compatibility policy.

Complex mutating operations accept one structured JSON request from an explicit file or stdin. The
request maps to the corresponding application input, including a caller-supplied idempotency key;
the CLI must not invent a parallel domain schema or reimplement domain normalization. Exact-id
queries may use positional ids and bounded query options.

The first surface is JSON-first. Successful stdout contains one bounded application result or
query projection. Stable typed error codes are the machine discriminator; localized messages and
terminal progress must not contaminate machine output. Raw transcripts, prompts, diffs, Harness
bodies, command logs, and Provider reasoning remain linked artifacts rather than default CLI
payloads.

### Local composition without premature compatibility

Lifecycle commands require an explicit local configuration locator. The initial versioned
configuration may identify:

- the control root;
- the workspace root;
- one AgentProfile and Runtime adapter selection;
- logical credential profile selection;
- the diagnostic locale.

It must not contain API keys, tokens, copied authentication state, or a host credential file path.
Credentials remain owned by the selected Provider or host credential mechanism. The CLI performs
no ancestor search, arbitrary directory scan, implicit Repository registration, or ambient Harness
copy.

The exact configuration grammar remains experimental because a future persistent service may own
Runtime composition and allow the CLI to become a client. Such a transport change must preserve
the application operation and lifecycle semantics; it need not preserve the current in-process
constructor wiring.

Read-only debug queries retain Decision 0013's stricter composition. They do not open the lifecycle
service, initialize a missing store, construct a Runtime, touch Git or workspaces, or acquire write
capabilities merely because they now share the root executable.

### Maturity and retirement policy

Product command maturity is explicit:

| Maturity | Meaning |
| --- | --- |
| `experimental` | Real supported operation intended to remain; grammar or presentation may change before stability |
| `stable` | Separately accepted compatibility, versioning, and deprecation contract |
| `debug` | Maintained bounded diagnostic; excluded from public compatibility |

Temporary scripts are not a maturity level. They must:

- live under `scripts/` or test support, never the installed product command tree;
- use a `dev:` or `test:` package-script prefix when an npm alias is required;
- contain no unique lifecycle, authorization, state-transition, or evidence semantics;
- record an owner and removal condition in the active WorkItem;
- be deleted before that WorkItem is accepted unless an explicitly confirmed follow-up WorkItem
  owns the remaining need.

WorkItem review must inspect executable manifests, `bin/`, package scripts, documentation, and
tests for obsolete entry points. Replacing a command removes its old parser, executable, alias,
documentation, and command-specific tests in the same WorkItem after equivalent coverage exists.

Repository validation commands such as `npm test` and `npm run check` are maintained development
Harness commands, not product commands or disposable scaffolding.

### Existing audit command migration

The accepted audit projections and `RuntimeAuditQueryService` remain. The unified CLI moves their
process presentation under `changefleet debug audit ...` while preserving exact ids, pagination,
JSON projection identity, typed diagnostics, and the zero-write boundary from Decision 0013.

Once equivalent process tests pass, the same WorkItem removes:

- the standalone `bin/changefleet-audit.js` executable;
- its standalone parser module if no reusable presentation code remains;
- the `npm run audit` alias;
- documentation and tests that assert the obsolete standalone invocation.

The old and new process entry points must not remain indefinitely as parallel ways to reach the
same capability.

## Alternatives

### Freeze a complete stable public CLI now

This would maximize immediate syntax certainty, but it would make the current filesystem roots,
Runtime construction, synchronous process ownership, configuration, and output presentation a
compatibility burden before an API, service lifetime, or release policy is accepted. Reject this
for the current stage.

### Build only shared application operations and defer every CLI

This avoids presentation decisions, but imported application code has already limited operational
feedback. It would also delay proving real process composition, idempotent retries, diagnostics,
and human gates. Reject this as the next slice.

### Add independent temporary lifecycle scripts

This is initially fast but creates duplicate parsers, accidental behavior, and removal debt. It
also makes later API and UI work more likely to reproduce untested lifecycle logic. Reject this.

### Build a local API or App Server first

A persistent protocol may eventually be appropriate for concurrent clients, streaming, and remote
or UI use. It currently introduces service ownership, authentication, transport versioning,
availability, and shutdown questions before one supported local operator flow exists. Defer it.

### Require CLI and UI feature-for-feature equivalence

This would force terminal-only piping and machine output into UI design and visual review or
interactive progress into CLI grammar. Reject exact presentation equivalence. Require semantic
equivalence only where both surfaces expose the same application operation.

## Implementation Slices

After acceptance, create one Development WorkItem for one complete local operator slice rather than
separate parser scaffolding WorkItems:

1. add one experimental `changefleet` root executable and an explicit command allowlist;
2. load one explicit local, secret-free configuration and construct only the required real
   production adapters;
3. expose the accepted Project and ChangeSet application operations needed to complete and recover
   the current local flow, with structured request input and JSON-first results;
4. preserve caller idempotency keys, exact human-gate subjects, typed diagnostics, and current
   application results without reimplementing domain rules in the CLI;
5. route exact-id audit through `changefleet debug audit ...` using read-only composition;
6. delete the obsolete standalone audit process entry point and alias after equivalent coverage;
7. add command-process tests and one deterministic complete local lifecycle acceptance path;
8. run one explicitly authorized real Codex Provider flow only if the WorkItem selects that
   external-cost gate.

The WorkItem must not add a production fake Runtime. Deterministic test Runtime injection may remain
inside test support only and must not be selectable by installed commands, configuration, or an
environment variable.

### Review Clarification: Runtime Execution And Windows Sandbox

On 2026-08-03, the user granted standing authorization to run a real Codex development gate when
the accepted validation selection requires it. The earlier phrase "explicitly authorized" records
the proposal-time external-cost selection boundary; it does not make conversational confirmation a
Codex SDK or product requirement. `CHANGEFLEET_RUN_REAL_CODEX=1` remains only an accidental-execution
guard for the nondeterministic Provider test. Installed lifecycle commands construct the configured
real Runtime without that flag.

Native Windows elevated-sandbox setup is a separate Runtime-host provisioning concern and may
surface an operating-system administrator prompt. The next recurring prompt, if any, should be
captured before changing host policy. This clarification does not authorize an unelevated or
full-access fallback and does not add sandbox setup behavior to the ChangeFleet Runtime Harness.

## Acceptance Criteria

1. One root `changefleet` executable is the only product command entry point.
2. A local operator can complete the currently accepted Project and ChangeSet lifecycle without
   importing JavaScript application code.
3. CLI commands delegate each lifecycle decision to an existing typed application operation; no
   duplicate transition, authorization, normalization, or evidence logic exists in CLI modules.
4. The explicit operator allowlist excludes recovery internals, stores, Runtime internals, Git,
   workspace helpers, and validators.
5. Complex mutations preserve the exact application request and caller idempotency semantics.
6. JSON-first success and typed failure remain bounded and exclude large linked artifacts.
7. Audit queries retain Decision 0013's exact-id and zero-write properties without constructing
   lifecycle or Runtime capabilities.
8. The standalone audit executable, alias, obsolete parser code, documentation, and redundant tests
   are removed once unified equivalents pass.
9. Every remaining executable is classified as product, debug, development Harness, or temporary;
   no unowned temporary command survives WorkItem acceptance.
10. No command is described as stable or publicly compatibility-versioned in this stage.
11. No API, App Server, UI, tracker integration, daemon, remote access, delivery, merge, or
    deployment surface is introduced.
12. No secret is persisted in CLI configuration, aggregate state, output, or test fixtures.

## Validation

| Gate | Scope |
| --- | --- |
| Command grammar unit tests | allowlisted groups, unsupported paths, duplicate options, structured request selection |
| Application delegation tests | one application call, unchanged normalized input/result, idempotency, typed errors |
| Process integration | stdout, stderr, exit status, explicit config, stdin/file requests, representative human gates |
| Read-only audit regression | exact projection equivalence, missing-root behavior, pagination, directory digest, no Runtime construction |
| Lifecycle acceptance | one deterministic single-Repository complete flow and the existing multi-Repository boundary where affected |
| Real Provider gate | conditional external-cost flow selected under `docs/validation.md` |
| Obsolete-entry audit | no standalone audit binary or alias; no production fake or unowned temporary executable |
| Documentation maintenance | `git diff --check`, affected links and authority projections, eager Harness size inspection |

Final validation selection must follow `docs/validation.md` and the actual implementation diff. A
full `npm run check` is required only if the accepted WorkItem or final crossed dependency boundary
selects it.

## Risks And Open Questions

- The existing `ChangeFleetService` exposes internal helpers as JavaScript methods. A narrow
  allowlist must define operator authority without prematurely splitting the service into a broad
  framework.
- Long-running execution in a foreground CLI is sufficient for the first local slice but may later
  move behind a persistent service. The future transport may change without changing durable
  ChangeSet semantics.
- JSON-first input is precise for the experimental stage but less convenient for casual use. Human
  flag shortcuts and formatted tables should follow observed usage and must map to the same
  application inputs and projections.
- The exact command names and configuration schema need implementation-level review before the
  WorkItem is confirmed. They remain experimental even after that WorkItem lands.
- Stable maturity needs a later proposal with release, compatibility, deprecation, and migration
  policy; elapsed time or incidental use does not promote a command automatically.

## Non-Goals

- A stable v1 public CLI or package compatibility promise.
- An HTTP API, App Server, daemon, browser UI, desktop UI, or remote client.
- Feature-for-feature identity between terminal and graphical surfaces.
- A generic command bus, service registry, dependency-injection framework, or generated client SDK.
- Portfolio listing, arbitrary control-root discovery, global configuration search, or Repository
  scanning.
- Raw transcript, diff, prompt, Harness, log, or Provider reasoning output by default.
- Linear or another tracker integration.
- Delivery, merge, deployment, remote workers, hosted multi-tenancy, or organization policy.
- Pricing, comparison, dashboards, automatic optimization, or continuous context enforcement.
- A production fake Runtime, fake evidence source, or test-only command selectable by users.

## Documentation Impact

If accepted:

- record one decision for shared application command semantics, the experimental unified CLI, and
  executable maturity and retirement policy;
- revise `SPEC.md` and `docs/architecture.md` only enough to distinguish shared application
  operations from CLI, future API, and future UI adapters;
- update `docs/harness.md` and `docs/validation.md` with the command classification and obsolete
  entry-point audit;
- mark Proposal 0011's standalone invocation as replaced only after implementation removes it,
  while retaining Decision 0013's read-only audit semantics;
- create exactly one confirmed Development WorkItem before implementation.
