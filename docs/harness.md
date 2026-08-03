# ChangeFleet Repository Harness

Status: Active repository-maintenance policy

This document defines the small Harness used to develop ChangeFleet itself. It also explains where
product-level Harness design is discussed without turning every design discussion into startup
context.

The repository Harness has one goal: give an Agent enough current authority to work safely, while
keeping accepted contracts, historical rationale, and execution evidence available on demand.

## Two Different Meanings Of Harness

Do not conflate:

1. **This repository's development Harness.** The instructions and current project memory used by
   Agents changing ChangeFleet.
2. **A registered repository's native Harness.** Instructions, skills, architecture references,
   build configuration, and verification guidance owned by a user's repository.

ChangeFleet normally reads the second kind from an exact Git base. It may also reconstruct an
explicitly confirmed immutable local overlay under Decision 0011. It never treats ambient checkout
state as authority, writes non-Git Harness back, repairs it, or becomes its semantic owner.

## Three Separate Lifecycles

These names are intentionally different:

| Lifecycle | Objects | Purpose | Authority store |
| --- | --- | --- | --- |
| ChangeFleet repository governance | Repository Design Proposal, Development WorkItem | Evolve this repository | `docs/`, Git, and human confirmation |
| ChangeFleet product Runtime | ChangeSet, ChangeIntentRevision, ChangePlanRevision, WorkUnit, Run, CandidateBundle | Coordinate a user change | ChangeFleet Control Store |
| Registered repository governance | Repository-native specs, OpenSpec changes, issues, or other project artifacts | Govern the user's project | The registered repository or its own systems |

Files under `docs/proposals/` and `docs/work-items/` are part of the first lifecycle. They are not
ChangeFleet Runtime output and are never written into a registered repository by ChangeFleet.

An Agent Runtime may return a proposed `ChangePlanRevision`, `ScopeExpansionRequest`, or
`DecisionRequest`. The product should not persist a generic `Proposal` entity. If ChangeFleet is
eventually used to develop itself, a Runtime ChangeSet may reference a Repository Design Proposal
as an input source, but their ids, status, and authority remain separate.

## Intended Product

ChangeFleet is a spec-first control plane for one coherent software change across one or more Git
repositories. It is not a hosted shell around a coding Agent and not a generic multi-agent
framework.

Agent Runtimes perform semantic analysis, planning, implementation, subagent coordination, and
task-specific check selection. ChangeFleet preserves the control facts that must remain reliable as
Agent capabilities change:

- confirmed intent and exact plan revision;
- explicitly authorized repositories and scope changes;
- repository-scoped workspace and Run identity;
- exact base and candidate Git SHAs;
- evidence linked to the exact subject it tested;
- human gates, recovery, partial failure, delivery, and compensation state;
- one immutable `CandidateBundle` for cross-repository review.

The implementation should become smaller as Agent Runtimes improve. New Runtime intelligence is not
itself a reason to add a Core abstraction.

## Authority And Loading Map

| Resource | Owns | Normal loading rule |
| --- | --- | --- |
| `README.md` | Human orientation and navigation | Read for onboarding, not every task |
| `AGENTS.md` | Compact mandatory repository rules | Always applicable |
| `WORKFLOW.md` | Thin Runtime-facing entry point | Only when the Runtime uses it |
| `docs/current-state.md` | Current implementation projection, gaps, next task | Read at task start |
| Active Development WorkItem | Current implementation objective, scope, acceptance, evidence | Read for implementation |
| Active Repository Design Proposal | Current architecture or product-boundary change under discussion | Read for design work |
| `SPEC.md` | Accepted product contract | Read only relevant sections |
| `docs/architecture.md` | Target component and ownership model | Read only relevant sections |
| Decisions | Durable accepted rationale | Read decisions governing the changed boundary |
| Repository Design Proposals | Chronological design history | Do not replay by default |
| Development WorkItem evidence and Run artifacts | Commands, SHAs, observations, detailed history | Load only for execution, review, or recovery |

`SPEC.md` is not a startup document. A task touching Candidate identity should read the Candidate
and review sections; it should not automatically load repository configuration, rollback, and the
entire initial-slice discussion.

## External Reference Identity

In current ChangeFleet work, an unqualified **Conductor** means the Melty Labs product documented
at [conductor.build](https://www.conductor.build/docs). Verify time-sensitive behavior against its
official online documentation or an official source explicitly linked there; record the exact URL
and access date in any new proposal that relies on it.

Do not inspect or cite `C:\myData\aiProject\conductor`, or another similarly named local directory,
as authority for Conductor.build behavior unless the user explicitly identifies that exact checkout
and Git subject as the requested evidence. Proposal 0001's local-checkout assessment is preserved
as historical evidence about that exact subject only. It does not establish current Conductor.build
workspace, review, PR, merge, Harness, or delivery behavior.

External products are comparison evidence, not ChangeFleet authority. Separate an official fact
from a ChangeFleet inference, and never import an external product's current behavior directly into
`SPEC.md` without an accepted ChangeFleet decision.

## Task Startup

For every task:

1. apply `AGENTS.md`;
2. read `docs/current-state.md`;
3. identify and read the active Development WorkItem or Repository Design Proposal;
4. inspect the current Git status and diff;
5. load only the accepted contract and rationale needed for the boundary being changed.

If no Development WorkItem exists, explanation, review, diagnosis, Repository Design Proposal work,
and small explicitly requested repository maintenance may continue. Durable implementation must
not start until an accepted Repository Design Proposal, when required, and a confirmed `todo`
Development WorkItem authorize it.

Do not preload:

- all Repository Design Proposals or closed Development WorkItems;
- the complete `SPEC.md`;
- complete Agent transcripts, command logs, or diffs;
- every Skill reference;
- documents from unrelated repositories.

## Current Projection Instead Of Replay

Current truth must be reachable without reconstructing it from history:

- `SPEC.md` contains the accepted product contract;
- `docs/current-state.md` replaces its current projection in place;
- accepted decisions contain durable rationale;
- the active Development WorkItem is the current execution workpad;
- proposals preserve chronological design changes;
- Git and linked evidence preserve exact implementation history.

When a proposal is revised, preserve the earlier body as history and create or append a clearly
dated revision. When a later proposal replaces it, mark the earlier proposal superseded and make
only the current proposal part of the loading route.

Do not append progress logs to `docs/current-state.md`. Do not copy proposal reasoning into
`AGENTS.md`. Do not turn task discussion into permanent Harness unless it establishes a durable
project fact.

## Size And Context Guardrails

These byte limits are maintenance alarms, not claims about a provider tokenizer or the complete
Runtime context:

| Eager repository resource | Soft maximum |
| --- | ---: |
| `AGENTS.md` | 6 KiB |
| `WORKFLOW.md` | 2 KiB |
| `docs/current-state.md` | 8 KiB |

If a file exceeds its limit, first remove duplication or route detail to an existing on-demand
document. Do not create a new document solely to make a metric pass.

For product-managed Runs, the accepted target is at most 70 percent initial context usage with at
least 30 percent headroom. ChangeFleet may call this enforced only when the Runtime exposes the
effective context window and every required request boundary. Otherwise it records an estimate or
unknown state. Runtime compaction helps execution but is not durable control state.

## Development WorkItem Routing

The Agent receiving a request performs the first classification:

| Request class | Repository artifact |
| --- | --- |
| Explanation, review, diagnosis, status, or research | None |
| Product or architecture boundary discussion | Draft or update a Repository Design Proposal |
| Small, explicit maintenance inside accepted boundaries | Usually none; preserve evidence in Git diff |
| Durable implementation of accepted scope | Create or resume one Development WorkItem |

A Development WorkItem is normally required when work implements an accepted proposal, must survive
multiple sessions, spans material components, needs an explicit acceptance handoff, or is requested
by the user as a separately tracked task.

The receiving Agent may create a `draft` WorkItem when classification shows durable implementation
is needed. A draft is a proposed execution envelope, not permission to mutate.

It may create or advance directly to `todo` only when:

- the user explicitly requested implementation and the objective, scope, and accepted authority are
  unambiguous; or
- an identifiable standing policy pre-authorizes that exact low-risk class.

Record the confirming user request or policy reference. Ask for feedback before `todo` when scope,
acceptance criteria, repository authority, product behavior, risk, or proposal dependency remains
materially ambiguous. An Agent cannot confirm its own inferred scope expansion or architecture
decision.

## Proposal Discussion And Acceptance

The normal Proposal path has one human decision before the artifact and one after it:

1. discuss options, tradeoffs, and the recommended boundary in conversation;
2. after the user chooses a direction, write or revise the Proposal directly to `proposed` and
   explain its scope, important consequences, and deferrals in the same handoff;
3. the user either accepts that version or requests concrete revisions.

Do not insert another generic discussion or confirmation round merely because the Proposal file
has now been written. If the user requests revisions, update and explain the new version; only the
changed or unresolved points need further discussion.

Use `draft` only when exploration must be preserved before the design is concrete enough for an
accept-or-revise decision, such as an intentionally paused discussion or a material unresolved
choice. A draft is not a mandatory stage. The Agent may never accept its own Proposal.

## Development WorkItem Discipline

One Development WorkItem is the current workpad for one accepted slice. Keep its objective, scope,
acceptance criteria, current status, and next step concise and replace the current projection as
work advances.

Detailed output belongs in linked artifacts. The Development WorkItem records only:

- exact command and exit code;
- exact subject identity;
- concise observation;
- artifact reference when needed;
- unverified boundary;
- decision or blocker.

Do not manufacture a new Development WorkItem merely because an Agent retries or a plan changes. A
new WorkItem represents new confirmed implementation demand, not a new conversation turn.

## Validation Selection Discipline

Each WorkItem selects validation from `docs/validation.md` rather than inheriting a mandatory full
suite. Its validation table identifies required, conditional, and explicitly excluded gates with a
short reason. Reassess that selection against the final diff before review.

During implementation, run the smallest affected test. Every changed test file must execute, and
every changed production boundary needs a direct behavioral check. Escalate to the nearest owning
suite when dependency impact is uncertain; do not claim an unexecuted broader suite passed.

Reserve `npm run check` for accepted full-gate triggers such as shared contracts, schemas,
dependencies, the test runner, several crossed tiers, an unknown dependency boundary, or explicit
WorkItem or release policy. Run it once after the code stabilizes. Documentation-only work does not
run Node tests, and evidence-only edits after a valid code-bound gate do not require it again.

Historical WorkItems retain the gates they explicitly required. This policy changes future
selection and review discipline; it does not rewrite recorded evidence or retroactively weaken an
accepted WorkItem.

## Executable Surface Discipline

Keep product operations, maintained diagnostics, development Harness commands, and temporary
scripts distinct:

- product commands live under the one `changefleet` root and carry explicit `experimental` or
  `stable` maturity;
- debug commands are bounded maintained diagnostics without public compatibility;
- `npm test`, `npm run check`, and related validation commands belong to this repository's
  development Harness rather than the product CLI;
- temporary scripts live only under `scripts/` or test support, use `dev:` or `test:` aliases when
  needed, and contain no unique lifecycle or authorization logic.

Every temporary executable records an owner and removal condition in the active WorkItem. Delete it
before WorkItem acceptance unless a confirmed follow-up WorkItem owns the explicit remaining need.
When one entry point replaces another, remove the old executable, parser, alias, documentation, and
redundant tests in the same WorkItem after equivalent coverage passes.

CLI, future API or App Server, future UI, and tracker adapters share typed application-operation
semantics, not presentation implementations. Do not put state transitions, authorization,
idempotency, exact-subject selection, human gates, or evidence rules in a CLI-only or UI-only layer.

## Stage Boundaries, Fakes, And Audit Data

Every implementation stage records a clear boundary, acceptance evidence, deferred work, and exit
condition in its Development WorkItem or accepted proposal. When the acceptance evidence is met,
move the stage to review or the next accepted stage. Do not keep optimizing a completed stage unless
there is a concrete defect, measured shortfall, or newly accepted proposal.

Mocks and fakes may prove deterministic behavior of an accepted port, but they are test fixtures,
not product capabilities. When a real implementation replaces a fake boundary, remove it from
production selection promptly; retain it only when it exercises a named test case that the real
implementation cannot make deterministic. Never present fake token use, cost, quality, or Provider
results as production evidence.

Cost, effectiveness, retry, and Provider telemetry is audit/debug material. It is durable evidence
or an external artifact, not default Agent context. Ordinary Control Contracts and current Run
Context Projections must exclude it; a human-authorized diagnostic operation may request a minimal
explicit subset when necessary.

## Accepted Product Harness Direction

The accepted boundary is recorded by
[`Decision 0005`](decisions/0005-runtime-context-harness-and-capabilities.md) and
[`Decision 0011`](decisions/0011-exact-repository-harness-snapshots-and-local-overlays.md), with
Proposals [0003](proposals/0003-harness-ownership-and-runtime-context.md) and
[0009](proposals/0009-exact-repository-harness-snapshots-and-local-overlays.md) preserving
chronological reasoning:

- a compact ChangeFleet Control Contract;
- a generated current Run Context Projection instead of full history replay;
- repository-native Harness as optional semantic input, exact-base by default;
- an optional confirmed local Harness policy frozen as immutable ChangeSet evidence;
- no ChangeFleet-owned mandatory Skill, non-Git Harness writeback, or parallel Harness delivery
  lifecycle;
- an optional operation-scoped Runtime Skill layer in the model, with no accepted kit packaging;
- Agent Profiles for provider, model, permission, and Skill selection;
- read-only planning access and repository-workspace-scoped execution access;
- ChangeFleet-owned plan revision and confirmation history;
- tracker integrations such as Linear as intake and projection surfaces, not lifecycle authority.

The deterministic first slice proved the Control Contract, projections, scoped capabilities, and
initial budget evidence using a scripted test Runtime. Decisions 0009 and 0010 accept raw
out-of-context Runtime evidence and one first Codex SDK Provider. Decision 0011 accepts frozen
ignored Codex Harness as the next implementation stage. Snapshot bodies and detailed inventories
remain linked evidence rather than eager Harness context. Runtime Kit packaging, general workspace
seeds, App Server, a second Provider, Linear, pricing/effectiveness analysis, and continuous context
enforcement remain deferred.

## Maintenance Check

Before reporting documentation changes ready:

1. run `git diff --check`;
2. inspect every changed link and authority pointer;
3. verify `docs/current-state.md` still describes current, not proposed-as-implemented, facts;
4. inspect eager-resource byte sizes;
5. report what remains proposed or unverified.
