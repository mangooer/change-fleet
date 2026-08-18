# ChangeFleet Product Specification

Status: Initial accepted product contract

ChangeFleet coordinates one confirmed software intent across one or more Git repositories and
produces an exact, reviewable `CandidateBundle`.

This specification defines the product boundary. `docs/current-state.md` records implementation
status and open questions. `docs/architecture.md` describes the target component model. Decisions
record durable rationale, while proposals preserve chronological design changes.

## 1. Problem

General-purpose coding Agents can increasingly:

- inspect unfamiliar repositories;
- plan implementation;
- create subagents;
- use repository-native skills and tools;
- edit code and run tests;
- create branches and Git worktrees.

The remaining hard problem is not how an Agent writes code. It is how one business intent remains
coherent when it affects multiple repositories, branches, Agents, attempts, checks, and human
decisions.

Without an external control plane:

- a one-line request may begin implementation before its true repository scope is understood;
- front-end, back-end, contract, and shared-library changes may become unrelated tasks;
- plan changes may force duplicate tasks or erase why an earlier attempt was abandoned;
- parallel changes can validate against stale target branches;
- checks may be attributed to a different SHA than the reviewed result;
- a partial multi-repository result may be presented as complete;
- process loss may erase the durable relationship between work, evidence, and decisions;
- "rollback" may be promised where only discard, revert, or business compensation is possible.

ChangeFleet provides the deterministic control boundary around autonomous Agent execution.

## 2. Product Outcome

Given a confirmed change intent and an explicitly registered Project, ChangeFleet should:

1. let an Agent inspect only authorized repositories;
2. discuss a code-informed plan and version it only when an exact Agent message is approved;
3. route low-risk plans automatically and high-risk or expanded scope to human confirmation;
4. execute repository-scoped WorkUnits in isolated Git workspaces;
5. when the confirmed Plan authorizes it, autonomously advance ordinary execution, validation,
   optional Candidate verification, Feedback repair, and required Bundle quality review to final
   human review;
6. preserve plan revisions and abandoned attempts without duplicating the ChangeSet;
7. publish exact repository Candidates;
8. bind repository and combined validation evidence to those Candidates;
9. present one exact CandidateBundle for review;
10. retain durable recovery and audit evidence;
11. publish accepted exact Candidates through human-merged GitHub pull requests and reconcile exact
    external results without claiming universal atomic merge or rollback.

The primary product subject is the ChangeSet. A Run, Agent session, WorkUnit, Candidate, PR, or
branch is evidence or execution detail within that subject.

## 3. Goals

- Support one ChangeSet spanning one or more registered Git repositories.
- Keep Project configuration minimal and human-reviewable.
- Accept both discussed design intent and terse one-line requests through one intake pipeline.
- Make intent normalization, impact analysis, exact plan approval, and later plan revision explicit.
- Allow Agent-native subagents, tools, skills, code discovery, and reasoning.
- Freeze repository scope, target refs, base SHAs, and Candidate identity.
- Support safe parallel WorkUnit execution and target-specific integration serialization.
- Review one exact CandidateBundle with a complete validation matrix and an optional independent
  quality recommendation.
- Publish accepted exact Candidates through explicit GitHub PR delivery and preserve partial merge.
- Preserve state across Runtime or controller restart.
- Reduce ordinary operator continuation through Plan-bound autonomous supervision without granting
  an Agent control authority.
- Make uncertainty, missing checks, partial failure, and stale Candidates visible.
- Keep repository-specific intelligence in repository-native Harness and Agent Runtimes.

## 4. Non-Goals

The initial product does not:

- implement a generic multi-agent graph framework;
- centrally install or manage Agent skills, MCP servers, credentials, or models;
- build a semantic code index or service graph as control authority;
- infer every framework, module, service relationship, or test command in Core;
- copy repository Harness content into a central template;
- implicitly create, repair, or update Harness in a registered repository;
- scan or authorize arbitrary local directories;
- silently include dirty local files in a task base;
- provide a universal cross-repository Git transaction;
- promise universal rollback after merge, deployment, database mutation, or external side effects;
- automatically merge, deploy, or mutate production systems in the first vertical slice;
- support remote workers, hosted multi-tenancy, or organization-wide policy in the first slice;
- preserve compatibility with Conductor's single-repository WorkItem schema.

## 5. Ownership Boundaries

| Plane | Owns | Does not own |
| --- | --- | --- |
| Project repositories | source, repository Harness, skills, build configuration, Git history | ChangeSet lifecycle or cross-repository decisions |
| ChangeFleet control plane | catalog, ChangeIntent, plan revisions, WorkUnits, authorized action envelopes, scheduling, exact subjects, evidence, human commands | semantic code understanding or provider reasoning |
| Agent Runtime | reasoning, native context, code discovery, subagents, tools, implementation, check selection, bounded Supervisor action proposals | repository authorization, canonical lifecycle, evidence acceptance, budget ceilings, delivery acceptance |
| Delivery systems | PR state, CI state, merge controls, deployment state | ChangeFleet intent or private Agent reasoning |
| Human operator | scope approval, unresolved product decisions, final review, risky delivery authorization | low-level execution bookkeeping |

An Agent may propose a scope, plan, check, Supervisor action, or delivery action. It may not silently
turn that proposal into expanded repository authority, accepted evidence, raised budget, or final
human acceptance. ChangeFleet revalidates and performs every control mutation.

CLI, future API or App Server, future UI, and future tracker adapters share typed application
operation semantics rather than lifecycle implementations or presentation code. They preserve the
same normalization, authorization, idempotency, exact subjects, human gates, state transitions,
durable results, and typed errors while owning surface-specific transport and interaction. The
first lifecycle operator surface is one experimental local `changefleet` executable; stable CLI
compatibility requires a later accepted decision.

### Runtime Dispatch Context

Every managed Agent operation receives four separately owned context layers:

1. a compact, versioned ChangeFleet Control Contract;
2. a generated current Run Context Projection;
3. repository-native Harness from the exact frozen base plus any confirmed frozen overlay;
4. optional Runtime-native, operation-scoped Skills.

The Control Contract owns authorization, exact identity, allowed typed outcomes, evidence reporting,
cancellation, and human gates. The current projection supplies only the confirmed intent summary,
semantic plan and relevant WorkUnit slice, linked RepositoryWorkspace access, current blockers and
decisions, required evidence, and references needed by that operation. Core-owned profiles, budgets,
attempt ceilings, reviewer configuration, and delivery bindings are not repeated in Agent Plan
content.

Superseded plans, unrelated WorkUnits, complete transcripts, diffs, logs, and private Agent
reasoning are not default context. They remain durable structured records or linked artifacts. A
fresh Agent session reconstructs current context from those records rather than treating provider
conversation memory as lifecycle authority.

Repository Harness is optional semantic input. ChangeFleet records exact-base and explicitly frozen
overlay resources plus what the Provider reports as discovered or loaded. Registration and
execution do not create or write `AGENTS.md`, `WORKFLOW.md`, `.changefleet`, Skills, architecture,
or test policy in a registered repository. Non-Git Harness overlays are immutable Run inputs and
never become a writeback or delivery surface.

### Agent Profiles And Capabilities

A stable `AgentProfile` selects a Runtime adapter and provider-native model, reasoning, capability,
and optional Skill settings. Provider model names and Skill catalogs do not become fields in the
ChangeSet aggregate.

An AgentProfile explicitly selects either trusted-local `host_user` or optional constrained
`operation_scoped` permissions. The former runs with the local account's authority; the latter asks
the Provider for operation-specific confinement. Neither mode changes ChangeFleet's logical
repository authority:

| Operation | ChangeFleet acceptance boundary |
| --- | --- |
| Planning | Inspect the linked TaskWorkspace repositories read-only; any write is rejected |
| WorkUnit execution | Read linked repositories; publish only the assigned writable RepositoryWorkspace Git subject |
| Bundle review | Read-only access to exact CandidateBundle subjects and evidence |
| Integration | Execute only one current human ActionGrant; task workspaces stay unchanged and Core independently observes the remote result |
| Control decision | Typed ChangeFleet command; no raw control-store or arbitrary filesystem access |

Runtime-native subagents cannot expand accepted repository scope or authorize control transitions.
Host-user mode does not claim that ChangeFleet prevents the Runtime process from accessing other
host resources.

Task trackers such as Linear may provide intake, links, status, or generated progress projections.
Tracker state is not authority for plan confirmation, repository authorization, Candidate identity,
or CandidateBundle acceptance.

### Context Admission

The accepted initial target is:

```text
maximum_initial_context_ratio = 0.70
minimum_initial_headroom_ratio = 0.30
```

Context evidence is classified as:

- `enforced` when the adapter observes the effective context window and every component required for
  the initial admission decision and can fail before crossing the limit;
- `estimated` when ChangeFleet can bound its own material but some Runtime components are hidden;
- `unknown` when the denominator or material components are unavailable.

No adapter may claim a continuous context guarantee unless it observes or controls every relevant
model-request boundary. The first deterministic slice does not require a Runtime Skill Kit, real
Provider adapter, tracker integration, or continuous enforcement.

## 6. Core Model

### Portfolio

A Portfolio is one ChangeFleet control environment. It contains explicitly registered Projects and
Repositories plus durable ChangeSet state.

The Portfolio control root is not Candidate Git content. Registered repositories do not receive
copied control state.

### Project

A Project is a logical product, business system, or bounded code domain. It has:

- a stable id;
- a human-readable name;
- a free-form description;
- an explicit set of Repository bindings;
- a minimal verification policy defining the admission floor and bounded attempt-timeout defaults
  and maximum.

A Project is not required to match one Git repository and may bind several. Within one Portfolio,
each registered local Git store belongs to exactly one Project: the same resolved `common_git_dir`
must not appear in another binding, including through a linked-worktree or nested-path alias.
Paths, resolved roots, common Git-directory paths, and canonical remotes are locator evidence, not
durable cross-host identity. Shared Project membership or transfer requires a later explicit
Portfolio-level Repository registry and is not initially authorized.

### Repository

A Repository is a stable logical identity for one Git repository. Initial configuration includes:

- a Repository id;
- exactly one locator;
- an optional description;
- an optional default target ref;
- an optional confirmed `RepositoryWorkspacePolicyRevision`;
- mutation authorization.

The first vertical slice supports a local-path locator. The path is host-local configuration, not
durable cross-host identity. ChangeFleet resolves and records the Git root and canonical remote
when available. Repository defaults are navigation defaults, not ChangeSet base authority.

### ChangeIntent

`ChangeIntent` is the task-scoped statement of:

- objective and desired behavior;
- business or user rationale when relevant;
- constraints and non-goals;
- acceptance criteria;
- resolved design decisions;
- open questions;
- source and confirmation evidence.

A conversation transcript is not the ChangeIntent. Intake creates a bounded draft so planning can
start without pretending that a terse request is already executable. Every Planner response
returns the complete current draft. Exact approval of a Plan-bearing message atomically confirms
that draft and its semantic Plan; no separate intent-confirmation step exists.

Repository Harness is long-lived project knowledge. ChangeIntent is task-specific. Task discussion
must not be appended to repository Harness unless the accepted change establishes a durable project
fact.

### RepositorySelectionRevision

Creating a ChangeSet establishes the planning-visible Repository set and branch selection before
Runtime planning. The set is a non-empty subset of the Project catalog and defaults to all
registered Repositories.

For every visible Repository, the caller may select a branch and target ref. An omitted branch is
the local checkout's current symbolic branch observed at ChangeSet creation. Detached HEAD without
an explicit branch is rejected. ChangeFleet resolves the branch once and persists its exact base
SHA; dirty checkout files are excluded.

RepositorySelectionRevision preserves this authority as versioned ChangeSet history. Runtime output
may request but cannot apply a later selection. A confirmed revision supersedes current planning
authority and returns the same ChangeSet to planning while preserving prior evidence.

### RepositoryHarnessSelectionRevision

Every planning-visible Repository has a frozen Harness selection no later than ChangeSet creation.
The default is `exact_base_only`. An optional confirmed Repository workspace policy may select
contained Git-ignored Provider-native semantic resources through explicit patterns or an explicitly
authorized tracked exact-base `.worktreeinclude`.

An `exact_base_plus_overlay` selection binds the Repository id, resolved base SHA, Provider family,
workspace-policy revision, selector digest, canonical relative paths, content digest, immutable
artifact reference, and confirmation. Retry and recovery reconstruct this exact snapshot instead
of rereading the registered checkout. A confirmed selection revision invalidates the current plan,
rebuilds current Run context, and preserves prior attempts.

### ChangePlan

Before approval, an Agent's plan is a conversation message and linked Run artifact. An approvable
message carries an exact logical id, content digest, and structured plan content, but it is not a
`ChangePlanRevision`. Human approval binds that exact message and atomically creates the next
confirmed Plan revision. The first confirmed Plan is revision 1. A later revision exists only after
a previously confirmed execution contract is deliberately replaced.

`ChangePlan` is concise semantic guidance for later Agents. It contains a summary, ordered
implementation steps, semantic validation expectations, risks, assumptions, and any assessment of
current human feedback. It does not contain WorkUnit ids, Git refs or SHAs, AgentProfile identities,
timeouts, attempt ceilings, supervision mode, reviewer identity, or delivery bindings.

Before approval, Core displays a separate exact workspace-control summary. Approval binds both the
semantic message and the digest of that summary. Core then compiles Repository-scoped WorkUnits and
effective verification, supervision, and review policy from the already confirmed TaskWorkspace and
Project configuration. The Planner does not author those control facts.

A ChangePlan is not proof that the impact analysis is complete. Unknown or unverified impact must
remain explicit.

### ChangeSet

A ChangeSet is the aggregate root for one business change, from its raw request and draft Intent
through the confirmed Intent and resulting delivery. It owns:

- ChangeIntent revisions;
- RepositorySelectionRevisions;
- RepositoryHarnessSelectionRevisions;
- one stable logical TaskWorkspace and its RepositoryWorkspace generations;
- task-scoped logical AgentSessions with exact AgentProfile purpose assignments and Run lineage;
- confirmed ChangePlan revisions;
- Core-derived Repository WorkUnits;
- execution attempts;
- post-Provider Candidate checkpoints and validation attempts;
- immutable Candidate-bound verification admission decisions;
- bounded Candidate-bound verification reviews and exact Run references;
- repository Candidates;
- CandidateBundle revisions;
- exact Bundle review admissions, assessments, and Review Run references;
- validation evidence;
- scope decisions;
- bounded autonomous-supervision authorization and exact decision-envelope references;
- human review and delivery decisions;
- exact integration offers, ActionGrants, observed results, and terminal dispositions.

Its persisted business phase is limited to:

```text
planning | running | review | terminal
```

`terminal` additionally records the exact `done | abandoned` outcome. Waiting, input requests,
pause, retry, failure, delivery progress, and interruption are not ChangeSet phases; they are
derived from Runs, Gates, Blockers, delivery records, and exact artifacts.

Replanning continues the same ChangeSet. A new ChangeSet is created only for a distinct business
intent, not merely because an earlier plan was wrong.

### TaskWorkspace And RepositoryWorkspace

Each ChangeSet owns one logical TaskWorkspace before its first planning Run. It links the explicitly
selected repositories as independent RepositoryWorkspaces, each with an exact base, target, local
branch, owned worktree, and Harness selection. The logical TaskWorkspace id survives physical
workspace replacement and Repository or Harness selection revisions.

Planning, execution, verification, feedback repair, review, and delivery belong to this same task
container. An execution Run may read all linked repositories but receives write authority only for
its assigned RepositoryWorkspace; Core compares non-assigned Git subjects before and after the Run.
Independent business tasks always receive different TaskWorkspaces, branches, and worktrees even
when they start from the same Repository and base.

Physical worktrees remain available through Bundle review and delivery. Terminal delivery or an
explicit abandonment releases current and retired physical RepositoryWorkspace generations while
retaining TaskWorkspace identity, Git subjects, evidence, cost, and delivery facts.

Each TaskWorkspace also owns one or more logical AgentSessions. An AgentSession binds a stable
logical id, one exact revisioned AgentProfile, allowed Run purposes, status, optional replaceable
Provider-session locators, and bounded Run references. It owns no separate Plan, lifecycle,
workspace, Candidate, Bundle, budget, or authority. Several purposes may share one session when
they use the same exact Profile; Runtime-native subagents remain internal to their parent Run.

### WorkUnit

A WorkUnit is one repository-scoped unit of execution. It records:

- ChangeSet and plan revision;
- Repository id;
- target ref and base SHA;
- RepositoryWorkspace identity;
- Agent assignment and Run references;
- current `execution | verification | complete` phase;
- independent `current | superseded | excluded` disposition;
- resulting CandidateCheckpoint, Candidate, blocker, or supersession.

One Agent Run may use native subagents internally. ChangeFleet does not model those subagents as
WorkUnits unless they correspond to independently controlled repository execution.

### Run, Feedback, Gate, And Blocker

Every Agent invocation is one `planning | execution | verification | supervision | review |
integration` Run with
status `queued | running | completed | failed | interrupted | cancelled`. A new attempt records
`initial | feedback | retry | recovery` trigger and optional continuation lineage. Terminal Run
facts are immutable and do not imply success of the owning phase.

`supervision` is ChangeSet-scoped and read-only. The deterministic kernel supplies exact currently
authorized action envelopes. A Supervisor Agent may select an offered action or request a Gate;
the kernel revalidates current subjects, authority, preconditions, and budget before performing any
mutation. A forced next action requires no Supervisor model call.

`review` is ChangeSet-scoped, semantically read-only, and bound to one exact CandidateBundle
revision. Its assessment is evidence for final human review or bounded Feedback routing; it is not
Bundle acceptance or mutation authority.

`integration` is ChangeSet-scoped and exists only after exact Bundle acceptance plus a separate
current human ActionGrant. It adds no ChangeSet or WorkUnit phase. The Runtime may perform only the
grant's one non-force refspec; Core revalidates every subject, compares task workspace Git subjects
before and after the Run, and admits success only after an independent remote-ref observation.

Feedback is immutable bounded input from a human, planning, validation, verification, supervision,
review, or delivery source. The handling Agent assesses each finding as `adopt | adapt | decline`;
Core checks exact subjects and authority but does not certify the feedback as true. Human questions
are open Gates; semantic or environmental impediments are Blockers. Neither creates another
lifecycle state. Normal views derive `ready | running | waiting | blocked | complete` activity.

### Candidate

A Candidate is one immutable repository result:

```text
repository_id
target_ref
base_sha
candidate_sha
workspace ownership
changed paths and Git evidence
Candidate-bound verification observations
```

Changing the commit, rebasing, merging, or applying the patch to another base creates a new
Candidate identity.

### CandidateCheckpoint

A `CandidateCheckpoint` is the durable exact Git subject published after Provider completion and
before repository validation. It binds the current ChangeSet, revisions, WorkUnit, Repository,
target, base and candidate SHAs, workspace ownership, changed paths, source Run, and creation time.

A checkpoint is not a Candidate or review and delivery authority. Every validation records exact
structural evidence; each selected project-command attempt additionally appends bounded immutable
attempt evidence. Passing current validation creates the ordinary Candidate. Failure or
interruption leaves the checkpoint available for exact preflight and resume without another Runtime
invocation.

Before repository validation, ChangeFleet records one immutable admission decision for the exact
checkpoint. The deterministic first implementation resolves `basic`, `deterministic`, or
`independent_review` from the frozen Project and task policy bound to the confirmed Plan control
digest, optional
operator elevation, reported-path divergence, and explicit unverified boundaries. `basic` and
`deterministic` proceed without another Runtime. `independent_review` first requires exact
repository validation, including the Plan-bound project command when one was selected, then
dispatches one read-only Verification Runtime over a disposable exact-Candidate worktree.

The Verification Runtime returns one bounded `triage` or `deep_review` result with exactly one
verdict: `pass`, `pass_with_notes`, `changes_required`, or `human_decision_required`. It may request
additional structured checks, but ChangeFleet executes those commands and binds their evidence to
the unchanged checkpoint. Passing review is not Bundle acceptance. Malformed output, missing check
evidence, workspace mutation, blocking findings, or an unresolved human decision fails closed.

`changes_required` is a reviewer claim, not controller-certified truth. ChangeFleet records exact
Feedback and returns the same WorkUnit to `execution`. The next writable execution Run uses trigger
`feedback`, receives only the current bounded findings and authority, and assesses each finding as
`adopt`, `adapt`, or `decline`. A fully assessed no-change result may reuse the exact checkpoint;
otherwise publication creates a descendant checkpoint while preserving all prior evidence.

The WorkUnit then naturally re-enters `verification`. A new read-only verification Run may receive
prior-finding and exact-delta focus metadata, but remains an ordinary verification Run and may
inspect the full relevant diff. Further actionable feedback repeats the same phase transition;
resource policy may instead open a Gate. Core does not impose a fixed number of semantic repair
cycles.

### CandidateBundle

A CandidateBundle is an immutable, versioned manifest containing the exact Candidates reviewed as
one coherent ChangeSet result.

It also records:

- ChangeIntent and ChangePlan revisions;
- expected WorkUnits;
- missing, blocked, superseded, or excluded WorkUnits;
- repository validation;
- combined validation;
- unverified risks;
- bundle hash and creation evidence.

Human review and acceptance bind to the complete bundle manifest, not merely one repository SHA.

### BundleReviewAssessment

Task configuration records `none | independent` Bundle quality-review admission before planning and
Core binds it to the confirmed Plan's control digest. `none` presents the exact Bundle directly for
human review and spends no Review Runtime cost. `independent` requires one current
`pass | feedback | gate` assessment from the selected Review AgentProfile before the Bundle is
presented as quality-reviewed.

The assessment binds the exact Plan revision, Bundle revision and hash, every Candidate base and
head SHA, required validation and verification evidence, and its Review Run. A changed Plan,
Candidate, Bundle, or required evidence identity requires another assessment. `pass` is a
recommendation only. Blocking findings may become bounded Feedback for exact authorized WorkUnits;
advisory findings remain audit-only. Ambiguous ownership, authority expansion, invalid output,
failure, or exhausted budget retries safely or opens a Gate.

### Deterministic Validation Invocation

Semantic Plan text may state what should be proven, but it does not carry executable commands.
ChangeFleet always performs exact Git structural preflight. An independent verification Agent may
request bounded structured checks against the exact Candidate; Core validates and executes those
requests without treating the Agent as authorization. With no applicable command, the attempt is
explicitly structural and carries no command identity or process budget.

A selected command uses a stable command id, executable, argument array, coverage rationale, and a
default attempt timeout. Command id, executable, arguments, and coverage rationale form semantic
check identity; timeout is an attempt-scoped resource and is excluded from that identity. Native
executables are invoked directly from the repository workspace or a control-owned combined-
validation directory. On Windows only, an exactly resolved `.cmd` or `.bat` may use the accepted
argv-preserving adapter; callers never supply a command string or generic shell mode. ChangeFleet
supplies one immutable JSON manifest through `CHANGEFLEET_VALIDATION_MANIFEST` for combined
validation whether or not a combined semantic command was selected.

The manifest contains the ChangeSet and plan revision, exact Candidate identities, host workspace
locators, and a canonical validation-subject hash. The subject hash excludes host paths and binds
the sorted Candidate identities plus the optional check selection and its rationale. The manifest
bytes receive their own evidence hash.

ChangeFleet mechanically validates each Candidate workspace before promotion and before any
selected command, then revalidates it after command execution. A selected command passes only with
exit code zero and unchanged exact Candidate state. With no command, passing structural preflight
is recorded without a command attempt. CandidateBundle assembly occurs only after exact validation
evidence is finalized, so Bundle identity includes that evidence without circularly requiring a
Bundle hash before execution.

### DeliveryTarget

A DeliveryTarget maps a Candidate to a repository destination ref or external PR subject. The
destination may move after Candidate creation.

Publication or integration against a moved target requires new integration evidence and may require
a new CandidateBundle. Evidence for the old Candidate never silently transfers to a changed SHA.

### GitHub Delivery Request And Result

GitHub is the first accepted delivery provider. Publication requires a separately confirmed,
revisioned binding from one registered Repository to one canonical GitHub `owner/name` and verified
Git push remote. Ambient remotes, Agent output, and Bundle acceptance do not independently grant
external write authority. Credentials remain host-managed and outside persistent state, evidence
payloads exposed by default, command output, and Agent context.

One stable `DeliveryRequest` binds an accepted current Bundle revision, Repository, Candidate SHA,
Candidate base, target ref, binding revision, deterministic remote branch, and eventual GitHub PR
identity. Exact publication never force-pushes. An existing delivery branch at another SHA or a PR
head that differs from the accepted Candidate is a divergence, not a subject update.

A human merges through GitHub. ChangeFleet records the PR head and base, checks and review summary,
merged actor and time, GitHub merge-result SHA, and target reachability as bounded observations with
linked immutable evidence. Merge, squash, and rebase may produce a SHA different from the reviewed
Candidate; both identities remain durable and equality is never assumed.

One Candidate maps to one PR, while one Bundle may map to several PRs. Partial merge is preserved
as fact. `done` requires a matching observed merge result for every selected exact Candidate;
closed-unmerged, target-stale, Candidate-diverged, and failed destinations remain explicit.

### AgentSession, ActionGrant, And Exact Git Integration

After exact Bundle acceptance, Core may offer one closed integration action for one Candidate and
destination. A human ActionGrant immutably binds the ChangeSet and TaskWorkspace, Bundle revision
and hash, Repository and Candidate base/head SHAs, target and destination refs, latest observed
destination SHA, action kind and canonical input digest, AgentSession and AgentProfile revision,
permission mode, maximum attempts, expiry, preflight, observer, accepted result schema, recovery
boundary, actor, and time. An Agent cannot create, broaden, renew, or accept this authority.

The implemented action catalog contains only:

1. `publish_exact_candidate`: publish the exact Candidate SHA without force to one named non-target
   `refs/heads/changefleet/...` ref; and
2. `fast_forward_target`: move the exact target from the granted observed base SHA to that exact
   Candidate SHA with one non-force push.

Core verifies local commits and ancestry, serializes by Repository and destination ref, rejects
target movement or destination divergence, and independently reads the exact remote ref after the
Runtime returns. Agent prose is never integration evidence. Controller loss uses observe-then-retry
recovery: an interrupted Run remains interrupted, while an already satisfied exact remote result
may be admitted separately without rewriting that Run. Merge commits, squash, rebase, force push,
arbitrary refs, deployment, and generic external-write grants are unsupported.

The accepted Bundle may instead receive one exact human
`complete_without_managed_integration` disposition. It records all unintegrated Candidate subjects
and moves the ChangeSet to `terminal(done)` with reason
`accepted_without_managed_integration`; it never claims publication, merge, delivery, or
integration. Managed completion requires exact observed integration or GitHub merge evidence for
every Bundle Candidate.

## 7. Intake And Planning

ChangeFleet supports two input shapes:

1. a discussed and confirmed design intent;
2. a terse request whose intent must be elaborated.

They use one pipeline:

```text
raw request or discussion draft
  -> bounded Intent draft
  -> confirmed Repository selection and exact branch freeze
  -> persistent TaskWorkspace and linked RepositoryWorkspaces
  -> authorized repository discovery
  -> planning conversation
  -> exact Intent-and-Plan message approval
  -> deterministic Task Controller
  -> execution, verification, configured review, or a genuine human boundary
```

The difference is input completeness, not lifecycle authority.

### Risk Routing

Project policy may pre-authorize low-risk execution. A plan normally requires explicit confirmation
when it includes:

- more than one repository;
- public API, event, or schema changes;
- database migration;
- authentication, authorization, secrets, payment, or security behavior;
- external writes or irreversible side effects;
- a target ref other than the configured default;
- repository scope expansion;
- unresolved product choices;
- rollback or compatibility uncertainty.

An Agent's confidence score may inform a decision but is not the only gate. Deterministic risk
triggers and standing human policy own authorization.

A Project may configure internal supervision policy; the bound workspace-control summary records
its effective authority and limits. The ordinary operator route does not ask a user to choose
manual execution versus supervision. One Task Controller advances the configured route and never
authorizes scope expansion, Bundle acceptance, external publication, merge, deployment, or an
irreversible action.

## 8. Execution And Replanning

A WorkUnit executes only after its RepositoryWorkspace, target ref, base SHA, and plan revision are
frozen by Core at Plan confirmation.

During execution:

- implementation-detail changes may continue without human interruption;
- user guidance, test failures, and ordinary review feedback continue under the confirmed Plan;
- repository scope expansion produces a typed decision request;
- branch, target, or planning-visibility changes produce a typed Repository selection request;
- invalidated design assumptions return to planning; exact approval produces the new plan revision;
- existing useful changes may be reused when their exact identity remains valid;
- abandoned attempts remain immutable history;
- a blocker pauses the ChangeSet without manufacturing terminal failure.

When the current Plan authorizes autonomous supervision, a deterministic policy derives the exact
currently legal action envelopes. Forced actions execute directly. If legitimate semantic choices
remain, a read-only Supervisor Run receives only the compact current projection, relevant Evidence,
remaining budget, and offered action ids. Its proposal is advisory until ChangeFleet revalidates and
performs it. Ordinary failed checks and actionable review findings may become Feedback and continue
through execution and verification without another operator command.

When task policy bound to the confirmed Plan requires independent Bundle review, deterministic supervision dispatches
that Review Run after exact Bundle assembly without a Supervisor model call. Valid blocking
Feedback may continue through the same-Plan repair route and produce a new Bundle revision.
Autonomous supervision stops with the current required passage recommendation, a Gate, an authority
or Plan change, unresolved human judgment, an unbounded semantic route, exhausted budget, operator
hold, abandonment, or terminal outcome. It does not create a supervision or review phase or
operation-specific waiting and failure states.

The persistent lifecycle is deliberately small:

```text
ChangeSet: planning -> running -> review -> terminal(done)
WorkUnit:  execution -> verification -> complete
Run:       queued -> running -> completed | failed | interrupted | cancelled
```

Review feedback may return a WorkUnit to execution. A typed Plan invalidation may return the
ChangeSet to planning. Accepted delivery or granted integration remains attached to `review` until
exact observation can produce `terminal(done)`. A separate human disposition may also finish an
accepted Bundle without managed integration while preserving that exact reason. Human abandonment
creates `terminal(abandoned)`. All other activity is derived rather than persisted as a compound
state.

## 9. Parallel Work And Branches

WorkUnits may execute concurrently in isolated workspaces.

Execution generally does not require an exclusive repository lock. Integration or publication to a
mutable destination is serialized by:

```text
destination_key = repository_id + target_ref
```

Two ChangeSets may produce Candidates from the same base in parallel. When one result moves the
target ref, the other becomes integration-stale. It must be refreshed, produce a new exact subject,
and rerun the checks affected by the new base before delivery.

Different target refs are independent delivery destinations.

An implicit dependency created by starting from another task's mutable branch is invalid. A
dependent or stacked ChangeSet must reference an exact upstream CandidateBundle revision. Stacked
ChangeSets are outside the first vertical slice.

## 10. Repository Configuration And Materialization

The initial human-authored configuration should contain only stable control facts:

```yaml
projects:
  commerce:
    description: |
      Customer web calls the order API. Public contract changes must remain backward compatible.
    repositories:
      customer-web:
        source:
          path: D:/workspace/customer-web
        description: Customer-facing web application
      order-api:
        source:
          path: D:/workspace/order-api
        description: Order and fulfillment service
```

Relationships and service descriptions are navigation hints. Agents must verify them against
current repository code and Harness.

An optional GitHub delivery binding is a separate stable control fact: provider `github`, canonical
`owner/name`, verified push remote, revision, and human confirmation. The ChangeSet Repository
selection continues to own the target ref. No token, credential path, or ambient remote authority
is stored in this binding.

Registration resolves a local locator through read-only Git inspection:

```text
configured path
  -> Git top-level
  -> Git common directory
  -> canonical remote when available
  -> default ref
  -> readiness and authorization evidence
```

Registration compares the resolved common Git directory against every existing and concurrently
submitted Repository binding. An already owned common Git store fails closed rather than creating a
second Project authority. Canonical remote alone is not a uniqueness key for distinct clones.

ChangeSet creation freezes commit SHAs and creates the linked isolated RepositoryWorkspaces before
planning. Dirty files in the
registered checkout are never silently copied. The only initial exception is a confirmed
Repository Harness policy resolved and snapshotted no later than ChangeSet creation. It may admit
contained Git-ignored semantic resources, never ordinary untracked files or Provider settings,
credentials, environment files, caches, or general workspace seeds.

Frozen Harness overlays are restored only inside ChangeFleet-owned RepositoryWorkspaces. They are
immutable, verified and removed before Candidate publication, and excluded
from Git identity. ChangeFleet never writes them back to the registered checkout. Overlay mutation
fails with `HARNESS_OVERLAY_MODIFIED`; a requested durable private Harness change fails with
`NON_GIT_HARNESS_CHANGE_UNSUPPORTED`.

A future Git URL locator may materialize through a local mirror or clone, but must produce the same
resolved Repository and WorkUnit contracts.

## 11. Validation And Review

Validation has two levels:

- repository validation for each exact Candidate;
- combined validation for the exact CandidateBundle.

Both levels always perform ChangeFleet-owned structural preflight. Their project semantic command
is optional and Plan-selected; absence requires an explicit rationale and is not semantic proof.

Combined validation may include:

- contract compatibility;
- generated-client consistency;
- cross-repository builds;
- integration tests;
- end-to-end behavior;
- rollout compatibility checks.

Core records structure, identity, command, exit status, evidence reference, and unverified
boundaries. Agent Runtimes and repository Harness select semantically appropriate checks.

Final deterministic admission binds each exact CandidateCheckpoint. `basic` and `deterministic`
continue without another Runtime. `independent_review` requires passing exact repository
validation and one passing read-only VerificationReview for the exact unchanged checkpoint. The Plan
expectation is preliminary and cannot waive a Project minimum or an explicit operator elevation.
The verifier may request bounded additional checks; only Runner-produced immutable evidence can
satisfy them.

A successful command is evidence only for the exact subject and behavior it exercised.
Spawn failure, timeout, nonzero exit, output overflow, cancellation, and postflight mutation also
produce bounded immutable attempt evidence. Each attempt records semantic check identity,
requested and effective timeout, frozen maximum, environment identity where observable, duration,
outcome, and EvidenceStore reference. Repository validation may resume only from a matching current
CandidateCheckpoint after ownership, HEAD, cleanliness, ancestry, changed-path, revision, Harness,
and source-Run preflight. Combined validation may resume over the unchanged current Candidate set.
Neither resume path invokes an Agent Runtime or changes semantic check identity. A retry may change
only its timeout within the frozen Project maximum without a Plan revision.

Review receives:

- confirmed intent;
- current plan revision;
- complete CandidateBundle manifest;
- exact repository diffs;
- repository and combined check evidence;
- superseded or missing WorkUnits;
- unverified risks;
- proposed delivery order and compensation boundaries.

Review does not inherit private execute reasoning as authority.

The exact confirmed Plan deterministically admits `none | independent` Bundle quality review. An
independent Review Run receives the compact review subject above plus bounded artifact references;
it does not invent validation commands or mutate Candidate workspaces. Its structured disposition
is `pass | feedback | gate`. Findings bind stable ids, severity, evidence, and authorized WorkUnit
targets where known. Passage remains a recommendation for human audit. Advisory findings do not
force repair, and reviewer claims routed as Feedback remain subject to `adopt | adapt | decline`
assessment by execution.

A `request_revision` decision binds the exact Bundle and carries a concise bounded summary plus
bounded actionable findings. It records Feedback and returns affected WorkUnits to execution under
the confirmed Plan. Only a typed authority change or materially invalidated design assumption
returns the ChangeSet to planning. Feedback is a reviewer's bounded claim, not an automatic fact
or command. The handling planning message or feedback-triggered execution Run records exactly one
bounded `adopt | adapt | decline` assessment and rationale for every current finding. Core validates
coverage and bounds, not semantic truth. A planning assessment enters a ChangePlan only when the
exact message is approved; raw feedback never becomes execution authority.

## 12. Recovery, Audit, And Rollback

ChangeFleet persists enough control state to recover after controller or Runtime process loss:

- current ChangeSet and plan revision;
- current Repository WorkUnits;
- workspace ownership;
- exact Runs, Candidate checkpoints, validation attempts, Candidates, and Bundle revisions;
- pending human decisions;
- durable blockers and dispatch holds.

Audit records must answer:

- what intent was confirmed;
- which repositories were authorized;
- why scope changed;
- what plan and code snapshot were used;
- what each Agent produced;
- what checks ran against which exact subject;
- what the human reviewed and decided;
- what was delivered or left unresolved.

### Runtime Invocation Evidence

Every real Agent Runtime call records one immutable `RuntimeInvocation` against its exact Run
attempt. It preserves operation, Agent Profile and context-projection identity, requested and
observable effective Runtime settings, Provider locators and versions, start and finish time,
duration, terminal outcome, and raw evidence references.

For a supervision Run, evidence also identifies the offered action ids, selected proposal, input
projection digest, deterministic kernel disposition, and final executed action or rejection. Full
reasoning remains a linked artifact rather than aggregate state or default Agent context.

Provider usage is stored as zero or more `UsageObservation` records at the finest scope the
supported interface exposes:

```text
scope             request | step | model | aggregate
confidence        provider_reported | estimated | unknown
coverage          complete | partial | aggregate_only | unknown
```

Missing token, cache, reasoning, model, request, or subagent detail remains unknown. ChangeFleet
does not infer exact values or complete coverage from partial Provider output. Provider-reported
monetary values are labeled estimates; normalized cost requires separately accepted versioned
pricing authority.

Runtime usage, cost, retry, effectiveness, and Provider traces are audit/debug evidence. Ordinary
Control Contracts and current Run Context Projections exclude them.

Private, versioned `RunAuditProjection` and `ChangeSetAuditProjection` views may be derived on
demand from immutable ChangeSet, Run, evidence, Bundle, and human-decision records. The isolated
query component is read-only: it does not persist a rollup, mutate lifecycle or recovery state,
invoke an Agent, touch a workspace or Git, or affect routing and authority.

The unified experimental local CLI may inspect either projection beneath its debug namespace for
one explicit control root and exact Run or ChangeSet id. It emits the unchanged projection as JSON
on stdout and typed localized failure as JSON on stderr. This route does not initialize or repair a
store, discover subjects, load lifecycle or Runtime adapters, access registered repositories, or
establish a stable public CLI contract. The earlier standalone process entry point is not retained.

Usage summaries identify the chosen source observation and selection reason. Exactly one valid
Provider aggregate is preferred; one otherwise-unambiguous observation may be used; potentially
overlapping observations produce an unknown total. Cached input and reasoning output are not added
again when defined as subsets, null remains unknown, and aggregate-only evidence never implies
per-step coverage. Reports keep Runtime, validation, wall, and human-gate clocks separate and keep
Runtime, planning, WorkUnit, validation, Bundle, review, and delivery outcomes separate.

Each bounded report binds its schema, exact source identity, query, and factual payload with a
deterministic digest that excludes observation time. Broken required references fail closed;
optional unsupported Provider values remain explicit unknowns. Large artifacts remain linked by
reference. Cross-ChangeSet comparison, rankings, pricing, dashboards, exports, and automatic
optimization require later accepted authority.

Harness evidence separately identifies exact-base resources, frozen overlays, and
Provider-observable discovery. Snapshot bodies and detailed inventories remain linked artifacts
outside ordinary Runtime context. Missing actual-load observations remain unknown.

Rollback language is phase-specific:

| Phase | Supported semantic |
| --- | --- |
| Before merge | abandon Candidate, close proposed delivery, clean eligible workspace |
| Merged but not deployed | prepare or record exact revert |
| Deployed stateless code | use delivery-system rollback or feature flag when configured |
| Database or schema mutation | use accepted expand/contract or compensation plan |
| External business side effect | record explicit compensating action or human blocker |

Cross-repository recovery follows a saga model. Partial success is preserved as fact; it is never
rewritten as atomic success or silently erased.

## 13. Initial Vertical Slice

The first implementation should prove:

- one Portfolio control root;
- one Project;
- two explicitly registered local Git repositories;
- one terse or discussed ChangeIntent;
- read-only impact analysis;
- one multi-repository ChangePlan confirmation;
- two Core-derived Repository WorkUnits;
- independent RepositoryWorkspace dispatch with semantic ordering left to the Agent;
- exact repository Candidates;
- mandatory structural preflight and optional project-native or verifier-requested checks;
- one CandidateBundle;
- one human review decision;
- process-restart-safe current state.

The first slice excludes:

- Git URL clone or mirror;
- automatic PR creation, merge, or deployment;
- stacked ChangeSets;
- service-graph authority;
- remote workers;
- a full browser UI;
- a production Runtime Skill Kit;
- a real Provider adapter;
- Linear or another tracker integration;
- continuous context enforcement;
- production database migration;
- backward compatibility with Conductor state.

Implementation begins only after the first vertical-slice proposal and implementation stack are
explicitly accepted.

## 14. First Real Provider Stage

After the deterministic kernel and Repository selection boundary, the accepted first real Agent
Runtime uses the official Codex TypeScript SDK behind the narrow `AgentRuntimeAdapter`.

Each Run attempt owns a fresh Provider thread and local process. Provider session identity is a
locator, not durable ChangeFleet authority. Controller loss abandons an unfinished attempt; retry
uses a fresh thread and rebuilt current projection rather than blindly resuming hidden Provider
context.

When the task is created, ChangeFleet materializes each selected Repository at its persisted
`resolved_base_sha` as a branch-backed RepositoryWorkspace under one TaskWorkspace. Planning reuses
these exact worktrees read-only; execution may publish only the RepositoryWorkspace assigned to its
WorkUnit. Dirty files and later branch movement in the registered checkout cannot affect these exact
views. Worktrees isolate development state; they are not an operating-system security sandbox.

The adapter:

- supplies the Control Contract, current Run Context Projection, exact-base repository Harness, and
  only explicitly selected Runtime Skills;
- maps the Agent Profile to provider-native model, reasoning, environment, and capability settings;
- requires strict structured planning, execution, verification, supervision-decision, and Bundle-
  review outcomes;
- records bounded normalized events and Runtime invocation evidence;
- keeps Provider output subject to current-revision, authorization, exact-subject, and human-gate
  validation;
- maps the exact confirmed AgentProfile permission mode without silent fallback;
- keeps secrets outside persisted ChangeSet and Run payloads.

The first stage proves one real single-Repository planning-to-Candidate flow. App Server, a second
Provider, Provider-session recovery, Runtime Skill Kit packaging, continuous context enforcement,
pricing, effectiveness comparison, dashboards, Linear, and remote workers remain deferred.

## 15. Exact Repository Harness Overlay Stage

The accepted next stage preserves exact-base Harness as the default and adds one optional Codex
local-overlay path. A confirmed, revisioned Repository policy selects explicit Git-ignore-style
patterns or an explicitly authorized tracked `.worktreeinclude`. ChangeSet creation freezes the
resolved paths and bytes against the selected base before any planning Run.

The first eligible Codex overlay roots are `AGENTS.override.md` and `.agents/skills/**`. Every
selected path must be contained, regular, Git-ignored, non-colliding, and within 128 files,
256 KiB per file, and 2 MiB total per Repository. Provider configuration and general workspace
initialization content are not Harness.

Planning, execution, retry, and recovery receive the same immutable snapshot. Candidate publication
fails if an overlay was changed and proves no overlay content entered Git. ChangeFleet records
bounded identity and discovery evidence without eagerly adding snapshot bodies to Agent context.

Generic `workspace_seed`, setup/run/archive behavior, Claude support, external Harness roots,
remote workspace materialization, non-Git Harness writeback, and a parallel Harness change review
lifecycle are outside this stage.

## 16. GitHub Delivery And Exact Granted Integration Stage

After exact Bundle acceptance, policy may authorize the local Task Controller to create or resume
one stable delivery request per Candidate. Diagnostic CLI callers may still request publication
explicitly. The first local implementation uses ordinary Git to publish the
exact Candidate SHA to a deterministic `changefleet/...` branch and authenticated `gh` commands to
create and read the PR. It verifies the remote target before publication, never force-pushes, and
recovers an existing exact branch or PR after restart instead of blindly duplicating external
writes.

The ChangeSet remains in `review` while delivery is pending or active. Exact observations may move
it directly to `terminal(done)`. Per-Repository delivery records distinguish pending, publishing,
open, merged, closed-unmerged, integration-stale, Candidate-diverged, and failed outcomes.
Destination locks protect target-sensitive critical sections but are not held throughout human
review. Another merge may move the target and stale integration evidence without rewriting
historical Candidate identity.

The experimental CLI and local UI expose GitHub binding, publish, read, and refresh only
through shared typed application operations. Delivery observations and raw provider detail stay
outside default Runtime context. HTTP adapters call the same semantics rather than execute the CLI
parser.

The same shared-operation boundary exposes Core-derived exact integration offers, immutable human
grants, background integration Runs, independently observed results, and explicit completion
without managed integration. The existing console shows the complete remote/ref/Candidate subject
before grant and does not add another page or task lifecycle. Exact Git actions use the configured
Runtime; ChangeFleet's Git adapter performs preflight and postflight observation, not the mutation.

ChangeFleet does not merge the PR. GitLab, automatic merge, merge queues, source-branch cleanup,
GitHub App, webhook, hosted polling, deployment, remote workers, and App Server remain outside
this stage. Real GitHub validation requires separately confirmed repository, branch namespace, PR,
and cleanup authority.

## 17. Local Task Console

The accepted next operator surface is a foreground, single-user, loopback-only local console over
explicit shared application and query operations. It is a presentation adapter plus a local
restart-aware task worker, not an Agent frontend, remote API, generic operation bus, or second
domain authority graph.

The console presents tasks rather than internal operations. Its ordinary view contains a grouped
task inbox, one stage-aware conversation, semantic Plan progress, current bounded Runtime activity,
effective Runtime identity, compact cost and retry metrics, necessary Gates, CandidateBundle
review, and GitHub delivery. Exact ids, revisions, digests, Runs, evidence, and complete metrics are
loaded only through an audit dialog or exact mutation subjects.

Creating a task under an existing Project requires a human objective. Project Repositories are
selected by default; optional advanced fields select per-Repository base and target refs. The same
conversation routes planning clarification and current execution or review Feedback. A Planner
returns `ready | needs_input`. `ready` permits the Core-owned task policy to bind the exact message,
confirm Intent and Plan, and run the Task Controller without a routine click; `needs_input` stops
at one human request. The user does not choose execute versus supervision. The console may confirm
an already registered Repository's GitHub binding, but does not configure Projects, Repositories,
AgentProfiles, Harness, policies, credentials, merge, deployment, or recovery.

One bounded intake-options query exposes only stable ids, human descriptions, safe defaults, and
compact effective policy summaries required by the form. It excludes repository paths, credentials,
raw catalog objects, provider settings, and unrestricted control capabilities. ChangeSet creation
and initial planning remain separate idempotent kernel operations but one browser action. After
workspace creation, Agent work runs from a durable accepted task command and ordinary mutation
requests return HTTP 202. If the Planner attempt fails, the exact created ChangeSet remains visible and retryable; the console does
not manufacture another task or roll back established Git authority.

The human-facing conversation is a bounded append-only safe timeline linked outside ChangeSet
aggregate state. It contains human messages, Agent summaries, Plan activation, role handoffs, and
safe status events, never raw reasoning, logs, commands, diffs, or evidence bodies. A new Planner
Run receives the current Intent draft, current operator message, and only
the immediately preceding assistant planning message, including a question that contains no Plan.
Older conversation, full transcripts, Runs, logs, provider payloads, and artifact bodies remain
outside ordinary Runtime context. Only the current exact Plan-bearing message is approvable.

The ordinary inbox derives exactly `running | needs_feedback | needs_review | waiting_for_merge |
complete | cancelled` plus a deterministic reason from exact kernel, delivery, task-command, and
operator-hold facts. These are presentation states, not ChangeSet phases.

One same-origin Server-Sent Events route projects only the current Run identity, sanitized activity,
and bounded Agent todo-list progress. It does not expose reasoning, logs, command output, diffs, or
audit payloads and does not become lifecycle authority.

One bounded `changeset.list` read model uses stable cursor ordering and returns only current summary
fields. It never exposes arbitrary filesystem enumeration, full transcripts, logs, diffs, raw
provider payloads, secrets, or artifact bodies. UI and audit presentation remain outside every
Agent Runtime context.

The experimental `changefleet serve` command binds one configured control root to loopback in the
foreground. Its explicit local HTTP route allowlist delegates to shared operations and cannot
accept a control-root path, operation name, executable, or internal capability from a request. GET
and page reload do not invoke Agents, refresh GitHub, repair state, or advance lifecycle. The
foreground worker reconciles accepted commands on startup, serializes each ChangeSet with a lease,
and performs bounded GitHub publication retry and merge observation.

The first implementation uses Node.js 24 ESM, centralized `node:http`, and repository-owned HTML,
CSS, and browser modules without a production web or frontend framework. The server composes the
same configured production Agent Runtime used by lifecycle operations; the browser cannot select a
raw Runtime or AgentProfile. It enforces strict Host and same-origin requests, no CORS, an in-memory
browser-session/CSRF nonce, bounded JSON mutation bodies, security headers, safe errors, and
graceful shutdown. Remote or multi-user access requires a later authority model.

An exact pinned Playwright development dependency and explicitly installed Chromium validate
affected UI and HTTP boundaries. Browser infrastructure is selected when those files or security
boundaries change rather than for unrelated work.

The recommended first real GitHub gate is the console implementation Candidate itself. Acceptance
of this contract does not authorize that write; repository, target, branch namespace, PR behavior,
human merge, and cleanup authority must be confirmed separately.

## 18. Post-Provider Candidate Finalization And Recovery Stage

After a Provider completes semantic implementation, ChangeFleet publishes the exact Git subject
and persists a CandidateCheckpoint before repository validation starts. Structural and selected-
command validation attempts are immutable evidence; commandless attempts carry no command identity
or process budget. A new idempotent execution attempt may resume
repository validation from the unchanged checkpoint, or combined validation from unchanged current
Candidates, after exact deterministic preflight and without repeating execution. If independent
verification was interrupted after repository validation passed, recovery abandons its incomplete
Run and disposable workspace, reuses the exact passing validation evidence, and starts one fresh
verification Run.

One generic Run reconciler handles planning, execution, verification, supervision, and Bundle-review
attempts. A persisted `running` Run that is not provably live becomes `interrupted` with recovery
evidence. Planning and execution reuse the ChangeSet's persistent TaskWorkspace; disposable
Candidate verification and Bundle-review workspaces retain bounded operation-specific preflight and
cleanup adapters. A fresh same-purpose Run may
continue only after exact authority and resource identity are proven. Completed checkpoints and
passing checks are reused and completed Runtime invocations are never repeated.

Obsolete private pre-checkpoint records are not imported or rewritten by the current baseline.
The legacy recovery surface is removed; exact current checkpoints are the only recovery subject.

Commands remain structured executable-plus-argv data. Native executables use direct process launch;
on Windows only, a resolved `.cmd` or `.bat` may use one reviewed argv-preserving adapter with the
requested executable, resolved locator, adapter, and effective invocation recorded as evidence.
Shell strings, operators, redirection, substitution, and implicit command parsing remain rejected.

Bundle `request_revision` decisions carry bounded current feedback into a feedback-triggered
execution Run under the confirmed Plan by default. The handling Runtime must assess each finding as `adopt`, `adapt`, or
`decline`; it may not silently treat human text or repository prose as truth. A true contract
invalidation returns to planning conversation, and only exact message approval creates a new Plan
revision. Checkpoints, host locators, validation output, full review artifacts, and superseded
feedback remain outside default Runtime context. This stage does not add automatic truth scoring,
UI recovery, Provider-session resume, generic import, automatic retry policy, or GitHub write
authority.

## 19. Explicit ChangeSet Closure Stage

An exact human request may close one unfinished, quiescent ChangeSet before delivery begins. The
aggregate becomes `abandoned`, records a bounded closure reason and actor, remains readable and
auditable, and rejects later lifecycle mutation. Closure preserves all prior intent, selections,
Plans, WorkUnits, Runs, usage, evidence, checkpoints, validation attempts, Candidates, Bundles,
commands, decisions, and blockers.

Closure does not create or link a successor, resolve another branch, revise a base, copy intent,
invoke Runtime, retry validation, delete durable content, or mutate GitHub. After recording the
terminal fact it idempotently releases only ChangeFleet-owned replaceable TaskWorkspace resources. A user who
wants to restart from another branch uses ordinary ChangeSet creation and confirms the new exact
base independently.

The first close operation requires no active Run or lifecycle command and no begun delivery.
Generic resume, human holds, automatic retry, turn checkpoints, rewind, restart, fork, conversation
deletion, content retention, and Provider-session continuation remain deferred to a later
interactive lifecycle stage.

## 20. Provider Environment Ownership And Pre-Candidate Retry Stage

Provider installation, authentication, native configuration, Sandbox provisioning, credentials,
and runtime-home lifecycle belong to the Agent Runtime or operator. ChangeFleet never creates,
copies, repairs, migrates, resets, or deletes that state. Local configuration explicitly selects an
already prepared Codex environment through a host-only locator. The locator and selected Home
contents remain outside ChangeSet state, Runtime context, evidence payloads, registered
repositories, and Candidates. Provider-native configuration cannot expand Repository authority,
confirmed plans, exact Git subjects, Candidates, or human gates.

The AgentProfile explicitly selects trusted-local `host_user` or optional constrained
`operation_scoped` permissions. Codex host-user Runs use `danger-full-access`, inherit the host
environment, and leave native Sandbox, network, Web Search, history, tools, and subagents to the
selected Provider environment. Operation-scoped Runs retain `read-only` planning or
verification, `workspace-write` execution, a controlled environment, and disabled network.
Verification receives a disposable detached worktree at the exact Candidate SHA and fails closed
if Git state changes. ChangeFleet never silently falls back between modes or claims OS confinement
from worktree isolation.

Execution may return strict `implementation_blocked` when semantic work cannot proceed. A Provider
turn completion does not make the WorkUnit successful. `implementation_completed` also fails
deterministic finalization when the published Git subject equals the exact base or has no changed
path; no current CandidateCheckpoint or validation authority is created.

A new explicit execution command may retry a failed or blocked pre-Candidate WorkUnit in the same
ChangeSet only after ownership, exact-base HEAD, clean workspace, current plan, Repository
selection, and Harness selection preflight. Retry creates a fresh Run and Provider thread while
preserving prior Runs, usage, commands, blockers, validation attempts, and historical empty
checkpoints. It does not reset, stash, delete, merge, or adopt partial work and never replaces a
non-empty CandidateCheckpoint validation resume.

Provider setup is never requested or launched implicitly during a Run. Automatic retry policy,
dirty-workspace recovery, Provider-session continuation, general rewind, silent Sandbox fallback,
managed Provider environments, and universal repository toolchain selection remain deferred.
