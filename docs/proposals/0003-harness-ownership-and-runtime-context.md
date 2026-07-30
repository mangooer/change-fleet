# 0003: Harness Ownership And Bounded Runtime Context

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-07-30

Accepted: 2026-07-30

Supersedes: Draft Proposal 0002

Decision: [0005](../decisions/0005-runtime-context-harness-and-capabilities.md)

Unblocks: Revision and decision on Proposal 0001

Implementation tracking: First-slice proof belongs to Proposal 0001; Runtime Kit, real Provider,
Linear, and continuous context enforcement are deferred

## Acceptance Record

The accepted core boundary is:

- no implicit Harness creation or maintenance in registered repositories;
- a compact Control Contract plus current Run Context Projection;
- durable history retained outside default Agent context;
- read-only planning and WorkUnit-workspace-scoped execution;
- Agent Profiles for Runtime-native model, permission, and optional Skill selection;
- tracker systems such as Linear remain edge intake and projection surfaces;
- 70 percent is an initial context-admission target with honest evidence classification;
- Runtime Kit packaging, real Provider adapters, Linear integration, and continuous context
  enforcement are deferred beyond the deterministic first slice.

## Context

ChangeFleet must remain useful as coding Agents become more capable. Its purpose is not to move an
Agent into another UI or to reproduce provider-native planning, subagents, skills, and context
management. Its purpose is to preserve one authorized, recoverable, auditable change across
repositories, attempts, evidence, and human decisions.

Discussion of Symphony, OpenSpec-style change history, repository Harness ownership, model
selection, permissions, plan revision, tracker integration, and context growth produced these
conclusions:

- a scheduler can remain small when it keeps only a mutable current workpad and delegates history
  to an issue tracker, Git, workspaces, and the Agent Runtime;
- ChangeFleet intentionally promises stronger exact-plan, CandidateBundle, and recovery semantics,
  so it cannot use a mutable workpad as its only authority;
- complete immutable history still does not belong in every Agent prompt;
- a user's repository may have an excellent, weak, incompatible, or missing Harness;
- ChangeFleet must not silently rewrite that repository to normalize it;
- no provider-independent component can guarantee continuous 70-percent context usage when the
  Runtime hides system instructions, tools, compaction, or per-request usage;
- one universal workflow Skill would eventually become another large Harness.

This proposal replaces the single optional Skill emphasis of Proposal 0002 with a current Run
projection and an optional kit of operation-scoped Runtime Skills.

## Proposed Decision

### 1. Preserve The Product Boundary

ChangeFleet owns:

- ChangeIntent and ChangePlan revisions and their confirmation evidence;
- repository authorization and typed scope expansion;
- WorkUnit scheduling and workspace identity;
- exact Run, Candidate, CandidateBundle, and validation identity;
- human gates, recovery, cancellation, and delivery state.

Agent Runtimes own:

- semantic code and impact analysis;
- implementation-level planning;
- provider-native context and compaction;
- internal subagents and tools;
- repository edits and task-specific check selection.

A Runtime can propose a plan revision or decision. It cannot make that proposal canonical, authorize
a repository, accept a CandidateBundle, or rewrite ChangeFleet control state directly.

### 2. Use Four Separate Context Layers

1. **Control Contract**: a compact, versioned, machine-oriented ChangeFleet contract defining
   authorization, exact identity, allowed typed outcomes, evidence reporting, cancellation, and
   human gates.
2. **Run Context Projection**: a disposable current view generated for one planning, execution,
   review, or recovery operation.
3. **Repository-native Harness**: project-owned instructions, skills, source, architecture
   references, build configuration, and verification guidance reachable from the frozen Git base.
4. **Optional Runtime Kit**: provider-native, operation-scoped Skills that teach an Agent how to
   consume the Control Contract and request more resources progressively.

The layers remain independently versioned and measurable. A Skill or repository instruction cannot
override repository authorization, exact identity, or human gates.

### 3. Generate A Current Run Context Projection

The projection contains only the current material required by one operation:

```text
operation purpose
ChangeSet and current revision identities
confirmed intent summary and reference
current plan summary and relevant WorkUnit slice
authorized Repository ids, target refs, and base SHAs
workspace and capability boundary
current blockers, human decisions, and required gates
expected typed outcomes and evidence requirements
references for progressively loading additional authority or history
context-budget observation
```

The projection does not embed:

- every superseded intent or plan;
- complete event, transcript, diff, or command history;
- unrelated WorkUnits;
- every repository document or Skill reference;
- private reasoning from an earlier Agent session.

Complete revisions and evidence remain durable in ChangeFleet stores and content-addressed
artifacts. The projection is a rebuildable materialized view, never the sole source of truth.

When context pressure requires a fresh Agent session, ChangeFleet may generate a new projection from
the same current revisions. A new session does not create a new ChangeSet. A changed model, Skill
identity, repository base, plan revision, or authorization boundary creates a new Run attempt and
budget decision.

### 4. Do Not Automatically Harness User Repositories

Registration and execution must not write `AGENTS.md`, `WORKFLOW.md`, `.changefleet`, Skills, test
configuration, or architecture documentation into a registered repository.

Repository Harness is optional. ChangeFleet:

- discovers it only through the exact frozen base;
- records which resources were supplied or loaded;
- treats dirty or host-global instructions as excluded unless explicitly authorized;
- reports missing or conflicting guidance;
- continues when the Control Contract and Runtime can operate safely without it.

A future explicit bootstrap tool may help a project create its own Harness, but that is a separate
operator action and product proposal. It is not implicit registration behavior or a prerequisite
for the first vertical slice.

### 5. Package Workflow Guidance As An Optional Runtime Kit

Do not begin with one monolithic `changefleet-workflow` Skill. If real provider work proves reusable
guidance is needed, publish a small Runtime-owned kit with operation-scoped entry points such as:

```text
changefleet-plan
changefleet-execute
changefleet-review
changefleet-recover
```

Only the selected operation Skill is loaded. Each Skill is a short router whose references are
loaded by explicit conditions. Stable lifecycle and authorization prose remains in the Control
Contract rather than being duplicated across Skills.

ChangeFleet Core does not install or update the kit. A project or operator selects an exact Skill
version or content hash through the Runtime. Run evidence records what was requested, resolved, and
actually loaded when observable.

The initial fake-Runtime slice must prove that the Control Contract works with the kit disabled.
Production Skill packaging waits for at least one real planning and one real execution workflow.

### 6. Select Runtime, Model, Permissions, And Skills Through Agent Profiles

A Project or dispatch policy selects a stable `AgentProfile`, not a universal model field embedded
in the ChangeSet aggregate. A Runtime adapter translates the profile into provider-native options.
For example, an adapter may pass model and reasoning settings to Codex app-server or supported
model and permission settings to Claude Agent SDK.

Run evidence records:

- AgentProfile identity;
- Runtime and adapter versions;
- requested and provider-reported effective model when observable;
- effective context window when observable;
- sandbox or capability profile;
- exact optional Skill identities;
- context-budget classification and observations.

Permissions are operation-scoped:

| Operation | Default capability |
| --- | --- |
| Impact analysis and planning | Read-only access to explicitly registered repository bases |
| WorkUnit execution | Read/write access to that WorkUnit's isolated repository workspace |
| Review | Read-only access to the exact CandidateBundle subjects and evidence |
| Control decisions | Typed ChangeFleet API commands, never raw store or arbitrary filesystem writes |

ChangeFleet does not give one parent Agent unrestricted access so it can launch privileged child
Agents. It schedules controlled operations and WorkUnits; the selected Runtime may use subagents
internally within the operation capability boundary.

### 7. Keep Tracker Integrations At The Edge

Linear or a similar system may provide intake, human status, links, comments, or a current progress
projection. It is not the canonical store for ChangePlan confirmation, repository authorization,
Candidate identity, or Bundle acceptance.

Tracker comments may mirror the current Run projection for human convenience. Editing or deleting
that comment does not erase ChangeFleet history. A future TaskSource or tracker adapter requires a
separate accepted slice and must not become an import inside the pure ChangeSet model.

### 8. Bound Initial Context Honestly

The operator goal remains:

```text
maximum_initial_context_ratio = 0.70
minimum_initial_headroom_ratio = 0.30
maximum_changefleet_static_ratio = 0.10
```

Every adapter classifies evidence as:

- `enforced`: the effective window and all policy-required initial components are observable and
  dispatch can fail before crossing the limit;
- `estimated`: ChangeFleet can bound its own material and estimate some external components;
- `unknown`: the denominator or material components are unavailable.

The 70-percent policy is an initial admission target. Continuous enforcement may be claimed only
when the adapter observes or controls every model-request boundary. Runtime token counters and
compaction are useful execution telemetry but not substitutes for durable Run state.

An over-budget projection must first remove duplicate or non-current material and switch to
references. It must not silently truncate confirmed intent, authorization, identity, gates, or
required evidence rules.

### 9. Store History Without Turning It Into Prompt Documents

ChangeFleet should persist structured revisions, decisions, events, and artifact references.
It should not generate a new Markdown document for every retry, state transition, or check.

Use:

- current aggregate records for actionable state;
- immutable revision and decision records for audit;
- content-addressed artifacts for large output, diffs, and logs;
- generated human projections for UI, CLI, or tracker display;
- Development WorkItems for accepted repository implementation demand and concise evidence, not
  complete transcripts.

Plan revision and confirmation history belongs to ChangeFleet. The project Agent supplies semantic
proposals and implementation evidence; it does not maintain the canonical ledger.

## Relationship To Referenced Designs

The proposal borrows the useful part of Symphony's pattern: a small current workpad, isolated
workspace, external evidence, and Runtime-owned compaction. It does not adopt a mutable tracker
comment as the only history because ChangeFleet binds review and recovery to exact revisions and
SHAs.

It also follows the current-spec versus change-history separation associated with spec-first
workflows such as OpenSpec: accepted contracts and current projections are normal input; proposals
and archived history are loaded only when the task needs their rationale.

Neither reference becomes a compatibility target.

Primary references:

- [OpenAI Symphony](https://github.com/openai/symphony), especially its repository-owned
  `WORKFLOW.md`, isolated workspaces, and expectation that target repositories already support
  Harness engineering;
- [OpenSpec core concepts](https://openspec.dev/docs/overview), especially separating a current
  specification from proposed changes and archiving completed change context.

## Alternatives Considered

### Mandatory ChangeFleet Harness In Every Repository

This would provide uniform files but create a second semantic authority, drift from native project
instructions, and make ChangeFleet responsible for frameworks and test policy. Reject it.

### Repository Harness Only

This is the required fallback and must always work. It does not capture reusable Control Contract
handling across providers, so add the optional Runtime Kit only after real workflows prove a need.

### One Universal Workflow Skill

This initially looks simple but accumulates planning, execution, review, recovery, and provider
detail in one eager resource. Prefer operation-scoped Skills with progressive references.

### One Privileged Planner Agent Launching All Executors

This delegates scheduling but gives one semantic Agent excessive repository and control authority.
Prefer deterministic WorkUnit dispatch with operation-scoped capabilities; allow provider-native
subagents only inside that boundary.

### Tracker Workpad As Canonical State

This is sufficient for a liveness-oriented scheduler and keeps prompts small. It cannot reliably
bind ChangeFleet plan confirmations, exact Candidates, recovery, and Bundle decisions. Use tracker
comments only as projections.

### Full History In Every Prompt

This simplifies reconstruction but guarantees context growth. Prefer current projections and
resource references while retaining immutable history outside the prompt.

### Universal Continuous 70-Percent Enforcement

This is honest only for adapters with full per-request observation or control and would exclude
many useful Runtimes prematurely. Enforce initial admission where possible and record continuous
usage as `estimated` or `unknown` otherwise.

## Changes From Proposal 0002

- Replace one candidate universal Skill with an optional operation-scoped Runtime Kit.
- Add the Run Context Projection as the primary context-bounding mechanism.
- Define model and permission selection through Agent Profiles.
- Make planning read-only and execution workspace-scoped instead of granting broad parent-Agent
  authority.
- Clarify Linear and other trackers as edge integrations.
- Clarify that ChangeFleet owns plan revision and confirmation history.
- Treat 70 percent as an initial admission target unless continuous observation is proven.
- Prefer structured records and generated projections over accumulating task documents.

Proposal 0002 remains chronological discussion history and provides no implementation authority.

## Required First-Slice Proof

Proposal 0001 should prove, using a deterministic fake Runtime:

1. a versioned compact Control Contract;
2. a generated planning projection and repository-scoped execution projection;
3. explicit `enforced | estimated | unknown` initial-budget evidence;
4. no full plan-history replay during a later attempt;
5. no implicit repository Harness mutation;
6. one repository fixture with native Harness and one without it;
7. typed plan revision and scope-expansion outcomes;
8. operation-scoped permission descriptions;
9. restart reconstruction from durable state rather than provider conversation memory.

It does not need a real provider, a production Runtime Kit, Linear integration, or continuous
context enforcement.

## Acceptance Criteria

1. A Run can enforce authorization and typed outcomes with repository Harness and Runtime Kit
   absent.
2. The current projection is reconstructable from durable control state and exact references.
3. Superseded history remains auditable but is not eager prompt input.
4. ChangeFleet never silently installs or updates a registered repository's Harness.
5. Agent Profile and Run evidence distinguish requested model, effective model, capability profile,
   and selected Skill identities.
6. Planning cannot mutate registered repositories; execution cannot mutate outside its WorkUnit
   workspace through the granted capability.
7. Internal Runtime subagents cannot expand the WorkUnit capability boundary.
8. Tracker state cannot authorize scope, confirm a plan, or accept a Bundle without a typed
   ChangeFleet command.
9. Initial context evidence records components, denominator, unavailable observations, ratio, and
   classification.
10. Continuous context is not called enforced without per-request observation or control.
11. Changing model, Skill identity, base SHA, plan revision, or authorization produces a new Run
    attempt and budget decision.
12. Detailed history and logs remain referenced artifacts rather than mandatory prompt documents.

## Non-Goals

- Automatic repository Harness generation or repair.
- A universal model, Skill, credential, MCP, or sandbox manager.
- One mandatory workflow Skill.
- Full transcript replay as recovery.
- Tracker state as ChangeSet authority.
- A hard continuous context guarantee for opaque providers.
- Production provider or tracker integration in Proposal 0001.
- Moving Agent semantic reasoning into deterministic Core.

## Documentation Impact On Acceptance

Update:

- `SPEC.md` with the four context layers and Agent Profile boundary;
- `docs/architecture.md` with Run Context Projection and capability-scoped dispatch;
- Decision 0001 with Runtime Kit and projection terminology if needed;
- `docs/current-state.md` with accepted and deferred slices;
- Proposal 0001 with the exact fake-Runtime proof boundary.

## Acceptance Documentation Update

Completed: 2026-07-30

- Decision 0005 records durable rationale and the explicit deferrals.
- `SPEC.md` now owns the accepted dispatch-context, Harness, AgentProfile, capability, tracker, and
  initial context-admission contract.
- `docs/architecture.md` includes RunContextAssembler, AgentRuntimeAdapter, and capability-scoped
  dispatch.
- `docs/current-state.md` separates accepted unimplemented direction from the current baseline.
- Proposal 0001 records the satisfied dependency and remaining acceptance decisions.
