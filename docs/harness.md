# ChangeFleet Repository Harness

Status: Active repository-maintenance policy

This document defines the small Harness used by Agents that develop ChangeFleet. Its purpose is to
make current authority easy to find without loading the complete specification, design history,
execution logs, or unrelated project context into every task.

Product behavior belongs in `SPEC.md`. Current implementation facts belong in
`docs/current-state.md`. This document owns only repository-Harness loading and maintenance rules.

## Scope And Boundaries

Keep these three systems separate:

| System | Objects | Authority |
| --- | --- | --- |
| ChangeFleet repository governance | Repository Design Proposal, Development WorkItem | `docs/`, Git, human confirmation |
| ChangeFleet product Runtime | ChangeSet, Plan, WorkUnit, Run, CandidateBundle | ChangeFleet Control Store |
| Registered repository governance | Its own instructions, specs, issues, skills, checks | The registered repository and its systems |

`docs/proposals/` and `docs/work-items/` govern development of this repository. They are not
ChangeFleet Runtime output. Runtime records must not update repository Proposal or WorkItem state as
an internal product side effect.

A registered repository's native Harness is optional semantic input. ChangeFleet reads it from an
exact Git subject and never becomes its semantic owner, invents missing project conventions, or
writes non-Git Harness state back. The accepted product boundary is owned by
[Decision 0005](decisions/0005-runtime-context-harness-and-capabilities.md) and
[Decision 0011](decisions/0011-exact-repository-harness-snapshots-and-local-overlays.md).

## Authority And Loading Map

| Resource | Owns | Loading rule |
| --- | --- | --- |
| `README.md`, `README.zh-CN.md` | Human-facing product introduction and usage | Onboarding only |
| `AGENTS.md` | Compact mandatory repository rules | Always applicable |
| `WORKFLOW.md` | Thin Runtime-facing entry point | Only when the Runtime uses it |
| `docs/current-state.md` | Current implementation projection, gaps, next task | Read at task start |
| Active Development WorkItem | Confirmed implementation scope and concise evidence | Read for implementation |
| Active Repository Design Proposal | Current boundary change under discussion | Read for design work |
| `SPEC.md` | Accepted product contract | Read only relevant sections |
| `docs/architecture.md` | Component and ownership model | Read only relevant sections |
| Accepted Decisions | Durable rationale | Read only decisions governing the changed boundary |
| Historical Proposals and WorkItems | Chronology and detailed evidence | Load only for research, review, or recovery |
| Git and linked artifacts | Exact implementation history, logs, diffs, transcripts | Load only when the task needs them |

README files are not Agent startup context. They explain the product to humans and must not become a
second specification or current-state projection.

`SPEC.md` is not a startup document. For example, a task that changes Candidate identity reads the
Candidate, review, and affected delivery sections rather than the complete product contract.

## Task Startup

For every task:

1. apply `AGENTS.md`;
2. read `docs/current-state.md`;
3. identify and read the active WorkItem or Proposal when one exists;
4. inspect Git status and the current diff;
5. load only the contract, architecture, rationale, and evidence required by the changed boundary.

Do not preload:

- the complete `SPEC.md`;
- every Proposal, Decision, or closed WorkItem;
- full Agent transcripts, command logs, or historical diffs;
- every available Skill or unrelated repository document.

`WORKFLOW.md` may restate this startup route but must not duplicate the loading map, validation
policy, or repository governance rules.

## Current Truth Without History Replay

Current truth must be available directly:

- `SPEC.md` contains the accepted product contract;
- `docs/current-state.md` contains the replace-in-place implementation projection and next task;
- accepted Decisions contain durable rationale;
- one active WorkItem is the implementation workpad;
- Proposals preserve design chronology;
- Git and linked artifacts preserve exact execution history.

Do not reconstruct current authority by replaying Proposal or WorkItem history. Do not append a
progress diary to `docs/current-state.md`, copy rationale into `AGENTS.md`, or turn ordinary task
discussion into permanent Harness.

When a Proposal is replaced, preserve its historical body, mark it superseded, and route current
loading to the replacement. When implementation completes on a branch, update its WorkItem and
current-state projection in the same Candidate; human review and merge must not require a follow-up
Harness-status commit.

## Size And Context Guardrails

The eager-resource limits are maintenance alarms, not tokenizer guarantees:

| Eager resource | Soft maximum |
| --- | ---: |
| `AGENTS.md` | 6 KiB |
| `WORKFLOW.md` | 2 KiB |
| `docs/current-state.md` | 8 KiB |

If a file exceeds its limit, first remove duplication or move existing detail to its proper
on-demand authority. Do not create another document merely to make a metric pass.

For product-managed Runs, the accepted target is no more than 70 percent initial context use, with
at least 30 percent headroom. Call this enforced only when the Runtime exposes the effective context
window and every required request boundary; otherwise record an estimate or unknown state.

Complete logs, diffs, transcripts, cost details, and large Agent output belong in linked artifacts,
not aggregate state or later-Agent context. Compact summaries and stable references may be
projected when needed.

## Route The Request Before Creating Artifacts

| Request | Repository artifact |
| --- | --- |
| Explanation, review, diagnosis, status, research | None |
| Product or architecture boundary change | Draft or update a Proposal |
| Small explicit maintenance inside accepted boundaries | Usually none; Git diff is sufficient |
| Durable implementation of accepted scope | Create or resume one WorkItem |

An Agent may draft an artifact, but it may not confirm its own inferred scope expansion or
architecture decision. A WorkItem may move directly to `todo` only when an explicit user request or
named standing policy unambiguously confirms its objective, repository authority, and acceptance
boundary.

## Proposal And WorkItem Discipline

The normal Proposal flow is short:

1. discuss options, tradeoffs, and the recommendation in conversation;
2. after the user chooses a direction, write the concrete Proposal as `proposed` and explain it;
3. the user accepts it or requests specific revisions.

Use `draft` only when a material unresolved choice must be preserved. A written Proposal does not
justify an extra generic confirmation round, and an Agent never accepts its own Proposal.

One WorkItem represents one confirmed implementation slice, not one Agent turn or retry. Keep its
objective, scope, acceptance criteria, status, and next step concise. Record only the exact command
and exit code, subject identity, concise observation, artifact reference, unverified boundary, and
decision or blocker. Detailed output stays in linked artifacts.

Do not create a new WorkItem because a Plan changed, an Agent retried, or a human supplied more
information. Create one only for new confirmed implementation demand.

## Validation And Executable Surfaces

`docs/validation.md` owns check selection, command requirements, and evidence fields. Documentation
maintenance inspects affected links, authority pointers, translation parity, and eager-resource
sizes. It does not run Node test suites unless the diff also changes executable behavior.

Keep these surfaces distinct:

- product operations live under the `changefleet` executable;
- maintained debug commands are bounded diagnostics without public compatibility promises;
- `npm test`, `npm run check:harness`, and related commands belong to this repository's development
  Harness, not the product CLI or a registered repository requirement;
- temporary scripts contain no unique lifecycle or authorization logic and are removed when their
  owning WorkItem completes unless a confirmed follow-up owns them.

CLI, HTTP, UI, and tracker adapters call shared application operations. They must not independently
implement authorization, state transitions, exact-subject selection, human decisions, or evidence
rules.

Mocks and fakes may provide deterministic test fixtures. They must never appear as selectable
production capabilities or production evidence. When a real implementation replaces a fake
boundary, remove the fake from production selection and retain only fixtures that prove named test
cases.

Cost, effectiveness, retry, and Provider telemetry is audit material. Keep it outside ordinary
Agent context; a diagnostic request may load a minimal explicit subset when necessary.

## Human Documentation And Translation

`README.md` is the English default entry and `README.zh-CN.md` is its Simplified Chinese peer. Both
must describe the same implemented features, limitations, quick-start path, commands, and document
links. Update them in the same change. Commands, identifiers, JSON fields, and product status must
remain exact across translations.

README content should answer:

1. what ChangeFleet is;
2. what it currently does;
3. how to run the current local prototype;
4. what is not implemented or stable;
5. where specification, current state, architecture, and development rules live.

Do not place Proposal history, WorkItem chronology, complete CLI internals, test evidence, or
unaccepted roadmap promises in README files.

## External Comparisons

External products are comparison evidence, not ChangeFleet authority. Verify time-sensitive claims
against official sources and separate the observed fact from the ChangeFleet inference.

In this repository, unqualified **Conductor** means the product documented at
[conductor.build](https://www.conductor.build/docs). A similarly named local checkout is not
authority unless the user explicitly identifies that exact checkout and Git subject.

## Maintenance Check

Before reporting Harness or README maintenance ready:

1. follow `docs/validation.md`;
2. inspect every changed link and authority pointer;
3. compare the English and Simplified Chinese README structure and commands;
4. verify `docs/current-state.md` contains current facts rather than history or proposed behavior;
5. inspect eager-resource byte sizes;
6. report any proposed, external, or unverified boundary explicitly.
