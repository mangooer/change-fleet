# ChangeFleet

ChangeFleet coordinates one auditable software change across multiple Git repositories.

An Agent Runtime may analyze code, create subagents, select skills, and implement repository
changes. ChangeFleet owns the durable control facts around that work: confirmed intent, repository
scope, plan revisions, isolated WorkUnits, exact Git Candidates, combined validation evidence,
human decisions, and delivery targets.

The product is neither a generic multi-agent framework nor merely a way to move a coding Agent into
a service or web UI. Its durable value is keeping one business change coherent when planning,
execution, retries, evidence, and review span multiple repositories. Its primary result is a
reviewable `CandidateBundle` representing one exact cross-repository outcome.

## Current Status

This repository contains the spec-first project Harness and the private implementation through
landed WI-0021, including optional exact-Bundle quality review. The package is not released and
exposes no stable public CLI or HTTP contract.

The first accepted vertical slice, tracked by
[`WI-0001`](docs/work-items/WI-0001-local-two-repository-vertical-slice.md), is:

```text
confirmed intent
  -> inspect one or more explicitly registered local Git repositories
  -> produce and confirm a ChangePlan for an authorized non-empty Repository subset
  -> execute isolated repository WorkUnits
  -> publish exact per-repository Candidates
  -> run repository and combined validation
  -> review one CandidateBundle
```

Automatic merge, deployment, remote workers, and Git-URL materialization are outside that first
slice.

The landed delivery slice explicitly binds a Repository to GitHub, publishes an accepted exact
Candidate to a deterministic non-force branch, creates or recovers one PR, and refreshes human
merge results. It does not merge, deploy, store GitHub credentials, or contact GitHub during the
deterministic test suite.

The current overlay stage keeps exact-base Harness as the default. An optional confirmed Repository
policy can freeze bounded Git-ignored Codex instructions or Skills at ChangeSet creation, restore
them only in ChangeFleet-owned workspaces, and remove them before Candidate publication. Non-Git
Harness is never written back or delivered.

## Start Here

For human orientation:

1. [`docs/current-state.md`](docs/current-state.md) — current facts, open questions, and next work.
2. [`SPEC.md`](SPEC.md) — accepted product contract; use headings to navigate.
3. [`docs/architecture.md`](docs/architecture.md) — target components and ownership.
4. [`docs/proposals/INDEX.md`](docs/proposals/INDEX.md) — Repository Design Proposals.

For an Agent task, do not read that entire list. Apply [`AGENTS.md`](AGENTS.md), read current state
and the active Development WorkItem or Repository Design Proposal, inspect the Git diff, then load
only relevant specification, architecture, decision, and evidence sections.

## Harness Structure

[`docs/harness.md`](docs/harness.md) defines the repository's progressive-disclosure Harness:

```text
always applicable
  AGENTS.md

task startup
  docs/current-state.md
  active Development WorkItem or Repository Design Proposal
  Git status and diff

on demand
  relevant SPEC sections
  relevant architecture and accepted decisions
  historical proposals and execution evidence
```

Current truth is maintained as a projection; historical proposals and detailed evidence remain
available without being loaded into every task. The accepted boundary for user repository Harness
ownership, current Run projections, Agent Profiles, operation-scoped Skills, and honest
context-budget evidence is [`Decision 0005`](docs/decisions/0005-runtime-context-harness-and-capabilities.md);
[`Proposal 0003`](docs/proposals/0003-harness-ownership-and-runtime-context.md) preserves its design
history. [`Decision 0011`](docs/decisions/0011-exact-repository-harness-snapshots-and-local-overlays.md)
owns the exact-base and immutable local-overlay boundary.

Repository Design Proposals and Development WorkItems govern this repository. They are not
ChangeFleet Runtime outputs. Runtime coordination uses ChangeSet, ChangePlanRevision, WorkUnit,
Run, CandidateCheckpoint, VerificationAdmissionDecision, VerificationReview, ValidationAttempt,
Candidate, and CandidateBundle records.

## Product Vocabulary

- **Project**: a logical product, business system, or bounded code domain.
- **Repository**: one registered Git repository belonging to a Project.
- **ChangeIntent**: the confirmed desired outcome, constraints, and acceptance criteria.
- **ChangePlan**: a versioned, code-informed proposal for repositories, ordering, and checks.
- **WorkUnit**: one repository-scoped execution unit within a ChangeSet.
- **CandidateCheckpoint**: an exact published Git subject awaiting or resuming validation.
- **VerificationAdmissionDecision**: the immutable deterministic verification mode for one exact
  CandidateCheckpoint.
- **VerificationReview**: one bounded read-only Runtime verdict and its exact evidence references
  for an independently admitted CandidateCheckpoint.
- **Candidate**: one immutable repository result identified by base and candidate SHAs.
- **CandidateBundle**: the exact set of Candidates reviewed as one coherent change.
- **DeliveryTarget**: the repository branch or integration destination for one Candidate.
- **DeliveryRequest**: the stable exact Candidate, GitHub branch, PR, and target reconciliation record.

See [`docs/glossary.md`](docs/glossary.md) for the complete vocabulary.

## Development

[`Decision 0006`](docs/decisions/0006-first-vertical-slice-implementation-boundary.md) accepts one
private Node.js 24 LTS ESM JavaScript package and a versioned filesystem store. WI-0001 and WI-0002
implement the deterministic control kernel. The accepted WI-0003 implementation adds the pinned
Codex SDK production adapter; scripted Runtime behavior remains test support only.
WI-0004 adds the accepted Codex local Harness overlay path without adding a general workspace seed
framework or a second Provider. WI-0007 adds one experimental local CLI over the existing typed
application operations and retains exact-id audit as a bounded debug command. Landed WI-0010 pins
`cross-spawn@7.0.6` only for structured cross-platform process launch and the reviewed Windows
batch-shim boundary; callers still cannot submit shell strings. WI-0011 adds human-gated closure
without generic resume, automatic successor creation, or destructive cleanup.

The accepted package exposes:

```sh
npm test
npm run test:integration
npm run test:acceptance
npm run test:provider:codex
npm run test:ui
npm run check
```

The development-only real Provider test runs only when `CHANGEFLEET_RUN_REAL_CODEX=1`; the flag
prevents accidental nondeterministic external execution and is intentionally excluded from
`npm run check`. It is not a product Runtime switch: installed lifecycle commands construct the
configured real Codex Runtime directly when credentials and host prerequisites are available.
`npm run check` fails before dispatching tests unless its actual process is Node.js 24; place the
Node.js 24 executable first on PATH when multiple installations exist.

### Experimental Local CLI

The package has one product executable. Lifecycle commands require an explicit versioned JSON
configuration; relative control and workspace roots resolve from that file:

```json
{
  "schema_version": 1,
  "control_root": "./control",
  "workspace_root": "./workspaces",
  "locale": "zh-CN",
  "runtime": {
    "adapter": "codex-sdk",
    "credential_source": "local_codex_home",
    "codex_home": "C:/Users/example/.codex"
  },
  "agent_profile": {
    "profile_id": "local-codex-profile",
    "revision": 1,
    "provider": "openai",
    "runtime": "codex-sdk",
    "model": "gpt-5.4",
    "reasoning": "medium",
    "permissions": "operation_scoped",
    "network_access": false,
    "skills": [],
    "credential_profile_id": "local-codex-credentials"
  }
}
```

`credential_source` accepts `local_codex_home` or `openai_api_key`; the configuration never stores
the credential value. `codex_home` explicitly selects an already prepared Provider environment.
ChangeFleet passes that host locator to Codex but never copies, scans, repairs, or deletes the
directory. It also does not override the selected environment's native Windows Sandbox
implementation. The shown `operation_scoped` profile is the optional constrained mode: planning
and independent verification are `read-only`, execution is `workspace-write`, the environment is
filtered, and network is disabled. Independent verification uses a disposable exact-Candidate
worktree and must leave it unchanged.
For Conductor-style trusted local execution, set `permissions` to `host_user` and
`network_access` to `true`; Codex then runs as the local account with `danger-full-access`, and
ChangeFleet makes no OS-confinement claim. The two modes are explicit and never silent fallbacks.
Mutations read one exact application request from a JSON file or `--request -` stdin:

```sh
node ./bin/changefleet.js project register --config changefleet.json --request register.json
node ./bin/changefleet.js project repository-policy revise --config changefleet.json --request policy.json
node ./bin/changefleet.js project github-delivery configure --config changefleet.json --request github-binding.json
node ./bin/changefleet.js changeset create --config changefleet.json --request create.json
node ./bin/changefleet.js changeset close --config changefleet.json --request close.json
node ./bin/changefleet.js changeset repository-selection revise --config changefleet.json --request selection.json
node ./bin/changefleet.js changeset harness-selection revise --config changefleet.json --request harness.json
node ./bin/changefleet.js changeset plan --config changefleet.json --request plan.json
node ./bin/changefleet.js changeset plan confirm --config changefleet.json --request confirm.json
node ./bin/changefleet.js changeset feedback submit --config changefleet.json --request feedback.json
node ./bin/changefleet.js changeset gate resolve --config changefleet.json --request gate.json
node ./bin/changefleet.js changeset candidate recover-legacy --config changefleet.json --request recovery.json
node ./bin/changefleet.js changeset execute --config changefleet.json --request execute.json
node ./bin/changefleet.js changeset supervision start --config changefleet.json --request supervision-start.json
node ./bin/changefleet.js changeset supervision pause --config changefleet.json --request supervision-pause.json
node ./bin/changefleet.js changeset supervision resume --config changefleet.json --request supervision-resume.json
node ./bin/changefleet.js changeset supervision show <change_set_id> --config changefleet.json
node ./bin/changefleet.js changeset bundle decide --config changefleet.json --request decision.json
node ./bin/changefleet.js changeset delivery publish --config changefleet.json --request publish.json
node ./bin/changefleet.js changeset delivery refresh --config changefleet.json --request refresh.json
node ./bin/changefleet.js changeset delivery show <change_set_id> --config changefleet.json
node ./bin/changefleet.js changeset show <change_set_id> --config changefleet.json
node ./bin/changefleet.js serve --config changefleet.json [--port 4311]
```

`changeset plan` may include a bounded `message` string to continue the planning conversation. Its
result is an Agent message with optional `plan_content`, not a Plan revision. `changeset plan
confirm` accepts `idempotency_key`, `change_set_id`, `message_id`, `content_digest`, and `actor`;
only that exact approval creates the first or next confirmed Plan revision. The local console reads
the same linked message artifact and delegates its approval button to the same application
operation.

A confirmed Plan records `manual` or `autonomous_until_review` supervision plus bounded execution,
verification, Feedback, and elapsed-time limits. In autonomous mode, exact forced actions run
without a Supervisor model call. A read-only Supervisor Run is used only when several bounded
semantic routes remain; it must select one offered exact action. A Plan may additionally freeze
`none | independent` Bundle review, one exact Review AgentProfile revision, and a bounded attempt
ceiling. Required review is a forced read-only action, so it does not spend a Supervisor model call.
Start, pause, resume, and progress commands use the same application operations as the local
console. Autonomous authority stops with a current passage recommendation, an explicit Gate or
hold, stale authority, exhausted budget, or a terminal ChangeSet; it never accepts or delivers the
Bundle.

An independent Bundle reviewer sees disposable read-only worktrees for the exact CandidateBundle
and returns `pass | feedback | gate`. Passage is advisory. Blocking findings must cite authorized
Repositories, WorkUnits, and available evidence ids before ChangeFleet can route them through the
existing same-Plan Feedback repair path. Advisory findings remain audit-only, while Review Run
usage, duration, retries, and assessment artifacts stay in the audit surface rather than later
Agent context.

A `request_revision` Bundle decision also requires `feedback.summary` and 1-20 bounded
`feedback.findings`, each with a stable `finding_id` and concise `text`. Only that current bounded
feedback is projected to an execution Run with trigger `feedback` under the current confirmed Plan.
That Run assesses every finding as `adopt`, `adapt`, or `decline`. Only a typed Plan invalidation
returns to planning; prior review and conversation artifacts stay linked outside Runtime context.

An independent Candidate review that returns `changes_required` follows the same rule: ChangeFleet
records Feedback and returns the same WorkUnit to `execution`. A changed result publishes a
descendant checkpoint; a fully assessed no-change result preserves the original checkpoint. Exact
repository validation then precedes another ordinary read-only verification Run, optionally with
prior-finding focus metadata. Repeated feedback uses the same phases, while unresolved choices use
an open Gate. Every Run is separately auditable, while costs and historical output stay outside
ordinary Runtime input.

ChangeSets persist only `planning | working | review | delivery | terminal`; WorkUnits persist only
`execution | verification | complete` plus disposition. UI and CLI activity is derived as
`ready | running | waiting | blocked | complete` from Runs, Gates, Blockers, and exact artifacts.

`changeset close` accepts only `idempotency_key`, `change_set_id`, `actor`, and a `reason` with one
of `no_longer_needed`, `restart_on_new_base`, `route_abandoned`, `duplicate`, or `other` plus a
bounded `summary`. It abandons only a quiescent pre-delivery ChangeSet; it does not create, choose,
or link a successor. A later task continues to use ordinary `changeset create`.

Debug audit preserves the exact-id, read-only, zero-initialization boundary without loading the
lifecycle or Runtime adapter:

```sh
node ./bin/changefleet.js debug audit run <run_id> --control-root <path> [--locale zh-CN|en]
node ./bin/changefleet.js debug audit changeset <change_set_id> --control-root <path> \
  [--detail-page <positive_integer>] [--page-size <1..100>] [--locale zh-CN|en]
```

Success writes one bounded JSON result to stdout. Failure writes one typed localized JSON diagnostic
to stderr. The CLI cannot discover roots or subjects, select a fake Runtime, or expose internal
recovery helpers. `candidate recover-legacy` is the sole explicit human-gated private-schema
recovery operation; it requires the exact current plan, WorkUnit, completed Run, base, candidate,
and actor. Its current grammar is experimental rather than a released compatibility contract.

`serve` keeps one foreground loopback server alive for the repository-owned browser console. It
reuses the shared application and query services directly rather than shelling back into the CLI.

Report every command actually executed and never claim an unexecuted check passed.
