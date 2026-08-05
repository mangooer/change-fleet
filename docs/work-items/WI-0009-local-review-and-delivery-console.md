---
artifact_type: development_work_item
id: WI-0009
status: review_ready
title: Implement the local review and delivery console
source: 'User request: "创建并确认WI-0009。"'
confirmed_by: user
confirmed_at: 2026-08-03
started_by: user
started_at: 2026-08-03
review_ready_at: 2026-08-05
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
- The Repository check exercises the exact Candidate from its assigned workspace; proving only
  that the base commit exists is not validation.
- The combined check must run from the control-owned validation directory and consume
  `CHANGEFLEET_VALIDATION_MANIFEST`. For this single-Repository ChangeSet, the full suite belongs in
  the Repository check and the combined command verifies the one exact manifest Candidate without
  using Repository-relative paths.
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

- WI-0009 implementation is complete on the current successor workspace and is ready for
  controller-owned review/publication. Runtime ChangeSets `changefleet-wi-0009`, v2, and v3
  remain abandoned audit history; none produced an accepted Bundle.
- V3 froze exact base `91114cd`, confirmed Plan revision 2, and completed implementation Run
  `run-a77d1902-f3f7-4dd7-9b3f-56dd13cb5eb6`. Controller-owned checkpoint
  `candidate-checkpoint-3a73cc1e1484b068738eaca8` preserved clean commit
  `bb5ed6ce6b6a954e1bac0b1837e56bed6574abd7` in its assigned workspace.
- Repository validation attempt 1 failed because the child `node` resolved to Node.js 22.19.0.
  A zero-Provider resume with process-local Node.js 24.14.0 then passed the Node suites and created
  Candidate `candidate-d419db22b26eb158f526abff`, but its own artifact reported Chromium
  unavailable while `test:ui` returned zero. This is a false-success gate, so the Candidate is not
  reviewable even though its Repository evidence says passed.
- Combined validation failed because confirmed Plan revision 2 required `candidate_id`; the
  documented manifest instead identifies each Candidate by `repository_id`, `target_ref`,
  `base_sha`, and `candidate_sha`, with `workspace_path` as a locator. No Bundle was created.
- V3 was explicitly closed through decision `decision-2ceb4101-0c03-469c-a2b3-ebfeee7e4ecb`.
  Candidate `bb5ed6c` remains immutable, unaccepted, and available only as read-only Git material.
- The current ordinary successor started from exact `main` base `7e911bcdf72855f010f20b0678745bbb8b22cb60`,
  selectively reused the `bb5ed6c` diff, made missing Playwright or Chromium fail the Repository
  gate closed, and extended the real-browser and integration paths to prove partial-then-merged
  delivery refresh under one retained refresh attempt identity. It does not treat `bb5ed6c` as an
  accepted base. Real GitHub external-write authority remains separately unverified.

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
- The captured Provider argv proved that ChangeFleet still forced
  `windows.sandbox="elevated"`; official Codex documentation identifies it as the stronger mode
  requiring administrator-approved setup. A maintenance correction removes that override under
  Decision 0020. The selected Codex Home independently configures `elevated`, so Provider
  readiness remains external and no real retry is claimed by the correction.
- Node.js 24 direct adapter validation exited `0` with 5 passing tests after the correction; no
  real Provider ran. Static inspection found no native Sandbox implementation override in
  production or test code.
- Accepted Decision 0021 now separates worktree development isolation from OS confinement.
  Deterministic WI-0013 implementation landed in commit `85c9062`.
- The external `changefleet.json` then advanced the same logical profile from revision 1 to
  revision 2 with `permissions: host_user` and `network_access: true`. Node.js 24 loaded it through
  `loadLocalCliConfig` with exit code `0`. No Runtime was invoked; prior Run and evidence snapshots
  remain revision 1 `operation_scoped` history.
- Selection command `wi-0009-v3-selection-2` bound Repository and exact-base Harness revision 2 to
  `109da56a0bba9690728195b0d40040713e8497fc`. Planning Run
  `run-0a7894c8-9443-4b76-905e-39670192197f` then completed in 89093 ms without a UAC interruption
  using Profile revision 2. Provider aggregate evidence recorded 154656 total tokens: 150870 input,
  104320 cached input, 3786 output, and 814 reasoning output; monetary cost remains unknown.
- Plan revision 1 correctly proposed one WorkUnit but used `git rev-parse` as its Repository check
  and `node scripts/run-checks.mjs` as its control-directory combined check. It is deliberately not
  confirmed; Candidate and Bundle counts remain zero.
- V3 planning Run `run-b1eb2e23-5334-4a1f-853c-5318e204f8c8` completed in 125451 ms and recorded
  386869 total tokens. Confirmed Plan revision 2 selected Candidate-scoped
  `node scripts/run-checks.mjs` plus a manifest-only combined check.
- V3 execution Run `run-a77d1902-f3f7-4dd7-9b3f-56dd13cb5eb6` completed in 988261 ms and recorded
  4434148 total tokens: 4402405 input, 4249856 cached input, 31743 output, and 4109 reasoning.
  It created checkpoint commit `bb5ed6c`; the first Repository validation then failed before tests
  because Node.js 22.19.0 violated the Node.js 24 gate.
- `changeset execute` resumed with a fresh key and a process-local Node.js 24 PATH. Exit code `1`
  created no Provider Run: Repository validation attempt 2 passed 57 unit, 64 integration, and 6
  acceptance tests and persisted `evidence-00b0fd50266475f34683da1c`, but the artifact explicitly
  left Chromium unverified. Combined evidence `evidence-e6783e3d07881266317157f0` then failed
  because the plan required a nonexistent `candidate_id` manifest field.
- `changeset close` under Node.js 24 returned exit code `0` and abandoned v3 through decision
  `decision-2ceb4101-0c03-469c-a2b3-ebfeee7e4ecb`. All prior Run, Candidate, validation, and cost
  records remain immutable audit history.
- `node --test test/integration/local-console-server.test.js test/acceptance/github-delivery-flow.test.js test/unit/local-cli.test.js test/unit/changeset-view-service.test.js`
  under Node.js 24 returned exit code `0`: 17 tests passed, covering bounded ChangeSet reads,
  explicit loopback HTTP routes, same-idempotency partial-to-merged refresh, CLI `serve`, and the
  exact Bundle/Candidate view model.
- `node scripts/run-ui-tests.mjs` under Node.js 24 returned exit code `0`: the real Chromium path
  accepted the exact Bundle, published two Repository deliveries, observed a partial refresh,
  retried refresh with the same attempt identity, and then observed merged completion.
- `node scripts/run-checks.mjs` under Node.js 24 returned exit code `0`: the full Repository check
  passed, including unit, integration, acceptance, and real Chromium `test:ui`.

## Acceptance Review

Pending controller-owned review/publication and any separately authorized real GitHub write.

## Project Memory Impact

WI-0009 is accepted unfinished work. The old ChangeSet, v2, and v3 are abandoned audit history.
No Candidate changes the landed baseline until an exact Bundle is reviewed and accepted.
