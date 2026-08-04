---
artifact_type: development_work_item
id: WI-0009
status: blocked
title: Implement the local review and delivery console
source: 'User request: "创建并确认WI-0009。"'
confirmed_by: user
confirmed_at: 2026-08-03
started_by: user
started_at: 2026-08-03
review_ready_at:
completed_by:
completed_at:
standing_policy:
design_proposal: docs/proposals/0014-local-review-and-delivery-console.md
accepted_decisions:
  - docs/decisions/0016-local-review-and-delivery-console.md
---

# WI-0009: Implement The Local Review And Delivery Console

## Objective

Implement the sole foreground local review and delivery console accepted by Proposal 0014: add a
bounded recent-ChangeSet read model, one loopback HTTP adapter over explicit shared operations, and
a repository-owned browser UI for exact Bundle decisions and GitHub delivery without duplicating
control-plane logic or expanding into a full lifecycle frontend.

## Scope

- Correct the dogfood planning boundary discovered after start: planning may select a non-empty
  subset of authorized Repositories, but must combine all work for one Repository into at most one
  WorkUnit.
- Preserve completed Provider identity, timing, and aggregate usage evidence when deterministic
  post-Provider plan normalization rejects the proposed plan.
- Add a bounded, cursor-stable `changeset.list` query over one configured ChangeFleet control root.
- Add one retained experimental `changefleet serve --config <path> [--port <port>]` product command
  that runs in the foreground and binds only loopback.
- Add an explicit experimental local HTTP route allowlist for recent and exact ChangeSet reads,
  exact audit presentation, exact Bundle decisions, and delivery read/publish/refresh.
- Delegate mutations unchanged to shared application operations and reads to explicit bounded query
  services; do not expose arbitrary operation names or internal helpers.
- Add repository-owned HTML, CSS, and browser ESM views for recent ChangeSets, exact current state,
  Bundle subject and evidence summary, Runtime audit summary, and per-Repository GitHub delivery.
- Add exact Bundle accept/reject, delivery publish, and delivery refresh interactions with explicit
  confirmation, exact-subject display, caller attempt identity, and ambiguous-result recovery.
- Enforce exact loopback and Host, same-origin requests, no CORS, an in-memory session/CSRF nonce,
  bounded JSON mutation bodies, restrictive security headers, safe errors, and graceful shutdown.
- Keep UI, HTTP, audit, and browser state outside Runtime context and keep large or sensitive
  artifacts out of list and bootstrap payloads.
- Add one exact pinned `@playwright/test` development dependency, explicit Chromium setup, and a
  selected `test:ui` gate without adding a production UI framework or build system.
- Add Simplified Chinese intent comments to every new production module and non-obvious changed
  boundary.
- Remove every temporary server, command, generated browser report, screenshot, trace, fixture
  executable, and unowned scaffold before review.

## Non-Goals

- Project registration, Repository or Harness configuration, selection revision, planning,
  execution, cancellation, recovery, or Agent chat UI.
- GitHub binding configuration, merge button, automatic merge, merge queue, deployment, rollback,
  PR comments, or issue synchronization.
- Generic REST API, GraphQL, generic operation bus, generated client, stable public API, or stable
  UI compatibility promise.
- Daemon, background poller, webhook, SSE, WebSocket, system service, tray process, Electron, Tauri,
  remote listener, multi-user account, TLS, or hosted tenancy.
- React, Vue, Svelte, frontend router, bundler, production web framework, CDN, external assets,
  telemetry, or analytics.
- Full unbounded diff transport, source editor, inline code review, pricing, comparison dashboard,
  Linear, remote workers, or another Agent Provider.
- Real GitHub writes without separately recorded repository, target, namespace, PR, merge, and
  cleanup authority.

## Acceptance Criteria

- The recent list is bounded to at most 50 entries per page, cursor-stable, current-subject only,
  and free of transcripts, full diffs, logs, raw provider payloads, secrets, and artifact bodies.
- The browser never scans a control directory or supplies a control root, repository path,
  operation name, executable, or internal capability through HTTP.
- The server runs in the foreground, binds exactly one configured root and loopback address, and
  closes listeners and idle connections cleanly.
- Only accepted explicit routes exist; unknown paths, methods, fields, hosts, origins, sessions,
  content types, and oversized bodies fail closed with bounded typed responses.
- UI and HTTP adapters invoke neither the CLI parser nor raw Store, Runtime, Git, workspace, `gh`,
  failure-recording, or recovery helpers.
- Bundle actions show and bind the exact Bundle revision and hash, Candidate ids and SHAs, changed
  paths, validation identity, and available or omitted evidence before confirmation.
- Delivery actions retain the landed binding, exact-Candidate, target, non-force, human-merge,
  idempotency, restart, partial-result, and divergence semantics.
- Browser retries reuse one attempt id while a result is ambiguous and reread durable state after
  reload or service restart.
- GET and ordinary page reload produce no lifecycle, repair, Runtime, GitHub refresh, or evidence
  mutation.
- Audit presentation calls the unchanged read-only query component, remains outside Runtime
  context, and does not claim the isolated CLI audit route's stronger process boundary.
- Frontend production assets make no external network request and require no framework, bundler,
  CDN, analytics, font, or telemetry dependency.
- All new production modules contain Chinese intent comments and key non-obvious security,
  identity, recovery, and context boundaries are commented in Chinese.
- Every maintained test fixture and product command has an ongoing accepted purpose; no temporary
  command or generated browser artifact remains.
- Real self-iteration success is recorded only if the exact UI Candidate is separately authorized,
  published, human-merged, and reconciled; otherwise that gate remains unverified.

## Validation Selection

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| ChangeSet query and view-model unit tests | cursor ordering, limit, exact subjects, bounded fields, formatting | Required | New read model and browser transformation logic |
| HTTP adapter unit tests | explicit routes, parsing, limits, typed errors, safe responses | Required | New local transport boundary |
| Local service integration tests | loopback, one root, Host/Origin/session, shutdown, zero-write GET | Required | New foreground process and browser-security boundary |
| Shared-operation integration tests | Bundle decision, publish, refresh, idempotency, stale subject, restart | Required | UI mutations must preserve landed application semantics |
| Context regression | UI, HTTP, audit, and browser fields absent from Runtime invocations | Required | Accepted audit and context isolation boundary |
| Chromium `test:ui` acceptance | list, exact view, confirmation, decision, publish, partial/merged refresh, basic accessibility | Required when browser assets and server are implemented | Proves the real operator path rather than HTML strings only |
| Existing affected Node suites | current domain, store, CLI, delivery, and acceptance regressions selected from final diff | Required | The slice crosses existing operator and delivery surfaces |
| Full deterministic `npm run check` | final stable implementation subject | Required unless final selection documents a narrower equivalent gate | Broad cross-layer implementation |
| Real Codex Provider | implementation through a ChangeFleet ChangeSet | Selected only when WI-0009 is explicitly started through the dogfood path | Proposal recommends self-iteration, but confirmation alone does not start a Run |
| Provider planning regression | one-WorkUnit-per-Repository prompt and post-Provider rejection evidence | Required before retrying dogfood planning | Prevents a known-invalid retry and preserves the cost audit of failed proposals |
| Real GitHub delivery | exact UI Candidate branch and PR | Conditional on separate exact external-write authority | Proposal and WorkItem confirmation do not authorize GitHub mutation |
| Documentation and boundary audit | links, status projections, eager sizes, commands, comments, assets, fakes | Required | Maintains Harness and stage boundaries |

Every changed test file must execute. Chromium binaries and generated reports remain external test
infrastructure, not repository or control-state artifacts. A missing browser or withheld external
authority is reported as unverified, never passed.

## Execution And External Authority

- Intended dogfood subject: one future ChangeFleet ChangeSet implementing WI-0009 against the
  registered ChangeFleet repository and an explicitly selected base branch.
- Current confirmation does not select that Runtime ChangeSet, base, Agent Profile, or execution
  time and does not start a Provider.
- Before real GitHub publication, record exact repository, remote, target, `changefleet/` namespace,
  PR visibility, human merge behavior, and branch cleanup authority.
- If GitHub authority is withheld, local implementation and deterministic review may still finish,
  but the external self-iteration claim remains open.

## Current Projection

- Current subject: WI-0009 remains the started implementation WorkItem for accepted Proposal 0014.
  The user explicitly abandoned old Runtime ChangeSet `changefleet-wi-0009` and created
  `changefleet-wi-0009-v2` with the same confirmed objective and an explicit current `main` branch.
- The abandoned attempt's planning attempt 3 produced and confirmed one WorkUnit. Execution Run
  `run-f7d39a4b-2469-46d2-afa7-204cb7328fba` completed Provider implementation and the owned
  workspace contains clean commit `12a7036`. Exact legacy recovery created checkpoint
  `candidate-checkpoint-4da5d6ffed87f65ef75db5d8`; resumed repository validation passed and
  persisted Candidate `candidate-d49b26ca52229dac377891f8` without another Runtime Run.
- Combined validation then failed before Bundle creation because the confirmed command
  `npm run test:ui` requires a repository working directory, while the accepted combined-validation
  contract runs from the control-owned validation directory containing only `manifest.json`.
- Read-only review found a partial but reusable implementation with blockers: incomplete Playwright
  lock data, false-success browser skips, inline-bootstrap XSS, non-strict HTTP fields/media types,
  unsafe error details, and missing required browser scenarios.
- `changefleet-wi-0009-v2` froze exact base `54c42b4`, confirmed Plan revision 1, and ran once. Its
  base-equal checkpoint had no changed path, Candidate, or Bundle. The user explicitly closed v2
  instead of retrying its overlapping pre-WI-0012 base; its Runs and cost remain audit history.
- `changefleet-wi-0009-v3` was independently created at exact base `f0dbe4f`. Its first planning
  Run triggered native Windows UAC and ended as `CODEX_PROVIDER_FAILED`. V3 remains `analyzing`
  with no Plan, Candidate, or Bundle, so human environment repair may continue the same ChangeSet.
- Next step: outside ChangeFleet, repair and verify the selected Provider environment. Then revise
  v3's unplanned Repository selection to current main and plan once with a fresh idempotency key.
- Active blockers: Provider readiness and UAC recurrence; real Chromium and GitHub external-write
  gates also remain unverified.

## Implementation Evidence

- 2026-08-03 host repair: explicit `RunAs` elevated refresh returned exit code `0`; the ordinary
  elevated sandbox probe then returned exit code `0`. The UAC prompt belongs to host provisioning,
  not SDK per-Run approval.
- Dogfood planning attempt 1 is durably `abandoned/controller_restart`; attempt 2 is durably
  `failed/DUPLICATE_REPOSITORY_WORK_UNIT` after 158453 ms. Its persisted usage is unavailable,
  demonstrating the post-Provider evidence-preservation defect covered by this revision.
- `node --test test/integration/codex-sdk-runtime.test.js
  test/integration/planning-workspace.test.js` under Node.js 24 returned exit code `0`: 6 tests
  passed, including prompt uniqueness and completed-Provider evidence preservation after plan
  rejection.
- `node --test test/integration/runtime-audit-query.test.js` under Node.js 24 returned exit code
  `0`: 4 tests passed, preserving bounded audit, unknown, cancellation, and restart semantics.
- `git diff --check` returned exit code `0`. The full deterministic suite, real planning retry,
  UI implementation, Chromium, and GitHub external-write gate remain unverified at this checkpoint.
- Planning attempt 3 completed in 125132 ms with 266142 total tokens and produced one confirmed
  WorkUnit at exact base `5f2ad1d`.
- Execution Run `run-f7d39a4b-2469-46d2-afa7-204cb7328fba` completed in 1873247 ms with
  7111129 total tokens, including 6904320 cached input tokens. Provider outcome was
  `implementation_completed`; later control failure was `COMMAND_SPAWN_FAILED` for `npm`.
- On clean commit `12a7036`, Node.js `v24.14.0` running `node scripts/run-checks.mjs` returned
  exit code `0` after 331.2 seconds. Unit, integration, and acceptance suites passed; SDK cases
  skipped because that isolated workspace had no installed dependency tree.
- Review proved `test:ui` can exit zero without Playwright or Chromium, package-lock lacks the
  pinned package records, and an injected `change_set_id` can terminate the inline bootstrap
  script. The Candidate is therefore not review-ready despite the deterministic suite result.
- `git status --porcelain=v1`, `git rev-parse HEAD`, `git rev-parse --git-common-dir`, and
  `git merge-base --is-ancestor 5f2ad1d... 12a7036...` against the owned workspace returned exit
  code `0`: the workspace was clean, its HEAD was the exact proposed commit, its common Git dir was
  the registered ChangeFleet repository, and the Candidate descended from the exact base.
- Node.js 24.14.0 running `changeset candidate recover-legacy` with the exact human-bound request
  returned exit code `0`; private schema v4 migrated to v5 and created legacy checkpoint
  `candidate-checkpoint-4da5d6ffed87f65ef75db5d8` for exact commit `12a7036`.
- Node.js 24.14.0 running `changeset execute` with new key `wi-0009-execute-resume-2` returned exit
  code `1` after 168.8 seconds. Repository validation attempt 1 passed and created Candidate
  `candidate-d49b26ca52229dac377891f8`; combined attempt 1 failed with
  `COMBINED_VALIDATION_FAILED` because its control-owned working directory had no `package.json`.
  The four pre-existing Run ids remained unchanged, proving zero additional Runtime Runs.
- Validation evidence recorded requested `npm`, resolved `C:\myData\nodejs\npm.cmd`, the
  `windows_batch` adapter, and exact exit results. The outer npm shim itself binds Node 22.19.0, but
  the operator PATH began with Node 24.14.0 and the Candidate's `run-checks.mjs` rejects every
  non-24 test Runtime before dispatch; its exit code `0` therefore verifies the selected test
  Runtime. Validation evidence does not expose the nested child locator, which remains an audit
  precision limitation rather than a failed gate.
- UTF-8 inspection of `changefleet-wi-0009-v2` recorded failed ChangeSet state, confirmed Plan
  revision 1, one `validation_failed` WorkUnit, exact base and checkpoint SHA `54c42b4`, zero
  changed paths, zero Candidates, zero Bundles, and a clean owned workspace. Current `main` is one
  overlapping WI-0012 commit ahead, so the user chose ordinary successor creation instead of an
  exact-base retry.
- `changeset close` exited `0` and abandoned v2 with closure decision
  `decision-9114a2a8-45ce-4117-9421-53d88611233c`. Ordinary `changeset create` exited `0` and
  froze v3 at `f0dbe4f` with Repository and Harness selection revision 1.
- V3 planning Run `run-d975b388-f328-4ee7-80e5-3e6aad225d37` displayed native Windows UAC. Its
  exact Provider process tree was stopped without touching the Codex desktop process; the Run is
  durably `failed/CODEX_PROVIDER_FAILED` with unavailable usage, and no planning process remains.

## Acceptance Review

Pending implementation, selected validation, and user review.

## Project Memory Impact

WI-0009 is accepted unfinished work. The old ChangeSet and v2 are abandoned audit history. V3 is
the current unplanned ChangeSet and does not change the landed baseline until an exact Bundle is
reviewed and accepted.
