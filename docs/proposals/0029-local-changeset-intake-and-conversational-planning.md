---
artifact_type: repository_design_proposal
id: 0029
status: accepted
title: Local ChangeSet intake and conversational planning
proposed_at: 2026-08-12
accepted_at: 2026-08-12
confirmed_by: user
decision: docs/decisions/0031-local-changeset-intake-and-conversational-planning.md
implementation_tracking: docs/work-items/WI-0039-local-changeset-intake-and-conversational-planning.md
---

# 0029: Local ChangeSet Intake And Conversational Planning

## Context

ChangeFleet can already register a Project, create a ChangeSet and its persistent TaskWorkspace,
run a read-only planning conversation, confirm one exact Plan message, execute under the selected
supervision policy, review a CandidateBundle, and publish delivery. The experimental CLI exposes
those shared application operations.

The loopback console starts later in the journey. It lists existing ChangeSets and supports current
review, Feedback, execution, supervision, and delivery actions, but it cannot create a task or send
a planning message. An operator must first prepare JSON requests through the CLI and then move to
the browser. That prevents the console from serving as the first practical self-iteration surface
and makes future tracker intake harder to evaluate independently of the task-creation path.

The missing slice is an adapter gap, not a new task model. `ChangeSet` remains the sole business
task, `TaskWorkspace` remains its one-to-one operational workspace, and the existing application
operations remain authoritative.

## Proposed Decision

Extend the existing foreground, single-user, loopback console with one minimal local ChangeSet
intake and conversational planning flow:

> Select an existing Project and a non-empty Repository subset, describe the task, create the
> ChangeSet and exact TaskWorkspace, converse with the Planner, and approve one exact Plan message.
> After approval, the existing task policy controls whether execution proceeds autonomously or
> waits for an operator action.

The UI and HTTP server are thin adapters over shared application and query operations. They do not
create another lifecycle, authority store, task entity, planning format, or orchestration path.

### Operator Flow

The first flow is:

1. Load bounded intake options from the configured control root.
2. Select one existing Project and one or more of its registered Repositories.
3. Enter a required objective and optional intent details.
4. Optionally choose branch and target refs for each selected Repository; omission preserves the
   accepted current-branch default.
5. Create the ChangeSet. Core resolves and freezes exact bases, applies Repository Harness policy,
   and prepares the persistent TaskWorkspace before any Agent runs.
6. Start planning and show the Agent response in the same task view.
7. Send further bounded messages until the current Agent response contains an acceptable semantic
   Plan.
8. Approve that exact message and its Core-produced workspace-control digest.
9. Continue through the already accepted manual or `autonomous_until_review` policy. The UI does
   not accept a Bundle, publish delivery, or merge merely because a Plan was approved.

The browser may present creation followed by initial planning as one continuous interaction, but
the transport performs two existing idempotent operations. If creation succeeds and planning
fails, the ChangeSet remains safely in `planning` and the operator retries planning; the adapter
does not roll back or silently create another task.

### Bounded Intake Projection

Add one purpose-built read model for task creation. It returns only:

- stable Project ids and bounded descriptions;
- selectable Repository ids and bounded descriptions;
- compact, non-secret summaries of the effective task AgentProfile, permission mode, verification,
  supervision, Bundle review, and delivery policy; and
- the fields needed to express optional branch and target selections.

It does not expose control-root paths, Repository host paths, provider credentials, environment
variables, raw catalog objects, Harness artifact bodies, arbitrary filesystem discovery, or a
generic configuration graph. Exact base SHAs and prepared workspace facts are shown from the
created ChangeSet result, not guessed by the pre-creation form.

The first slice uses the server-configured task AgentProfile and existing Project policies. They
are visible as a compact effective summary but are not editable in this UI. Project registration,
Repository registration, AgentProfile catalogs, policy editing, Harness configuration, and GitHub
binding remain existing CLI/configuration concerns.

### Shared Mutations And Explicit Routes

The local server adds explicit allowlisted routes for:

- creating a ChangeSet through `changeset.create`; and
- sending a planning turn through `changeset.plan`.

The adapter supplies or accepts only the bounded fields required by those operations. It never
accepts an operation name, control-root locator, filesystem path, executable, raw AgentProfile,
provider option, or internal service method from the browser. Opaque ChangeSet and idempotency ids
are generated and retained by the client for safe retry rather than entered by the operator.

The existing exact Plan-confirmation route remains unchanged. Browser confirmation continues to
bind the current `message_id`, `content_digest`, and workspace-control digest; a later planning
turn makes an earlier approval subject stale.

### Real Conversational Continuity Without Context Replay

The human-facing task view exposes a bounded recent planning conversation assembled from linked
planning Run evidence. It contains concise user and assistant messages only. It excludes raw Run
records, tool logs, provider payloads, complete transcripts, and unrelated historical Plans.

For the next planning Run, the Runtime receives only:

- the current user message; and
- the immediately preceding assistant planning message, whether or not it contains a Plan.

This corrects the current gap where an assistant question without a Plan is not projected into the
following turn. It does not replay the full conversation into Runtime context. Each Agent response
must remain self-contained enough to carry the current semantic position forward, and the accepted
70 percent initial-context target remains unchanged.

The UI projection is bounded by both turn count and encoded size. Page refresh can reconstruct the
recent conversation from durable linked evidence, while older messages remain audit references
rather than startup context.

### Security And Failure Boundary

All accepted console protections remain in force: loopback binding, exact Host validation,
same-origin mutation requests, no CORS, session and CSRF nonces, bounded JSON bodies, restrictive
headers, safe diagnostics, and foreground shutdown.

GET and page load never create a ChangeSet or invoke an Agent. Creation and each planning turn are
explicit POST actions with visible pending and failure states. While one planning Run is active,
the UI does not dispatch a second turn or approve a stale response. Controller interruption and
Provider failure use the existing Run recovery and retry semantics.

## Considered Alternatives

### Build a complete administration console now

Reject for this slice. Project registration, Repository editing, AgentProfile management, Harness
selection, delivery binding, and policy editing would turn a small intake path into a configuration
platform before the ordinary task experience is proven.

### Add Linear or GitHub Issue intake first

Defer. External sources should call the same task-creation boundary through a later SourceBinding
and routing adapter. Proving local intake first separates Core and workspace behavior from webhook,
authentication, deduplication, and tracker projection failures.

### Add a composite `create_and_plan` Core operation

Reject. Creation durably allocates exact Git authority and a TaskWorkspace; planning is a fallible
Agent Run. Keeping the operations separate makes partial success explicit and recoverable without
inventing cross-operation rollback.

### Put the full planning transcript into every Planner Run

Reject. It grows context with time and conflicts with the accepted current-projection model. The
immediately preceding assistant message plus the current user message supplies conversational
continuity; bounded history remains a human and audit projection.

### Expose the CLI through the browser

Reject. The browser calls shared application operations through explicit HTTP routes. It never
executes CLI parsing or command strings.

## First Implementation Slice

After acceptance, one vertical WorkItem should:

1. add a bounded intake-options query projection;
2. add explicit local HTTP routes for ChangeSet creation and planning turns;
3. add a bounded recent planning-conversation projection and carry the latest assistant response
   into the next Planner context even when it has no Plan;
4. add the Project, Repository, intent, optional ref, creation, and planning conversation UI;
5. preserve exact Plan confirmation and existing post-confirmation supervision behavior;
6. cover query bounds, route security, idempotent retry, creation-with-planning-failure recovery,
   question-and-answer continuity, stale approval, and browser behavior; and
7. replace the accepted console scope in `SPEC.md`, architecture, README, and current projections
   without adding a parallel API or compatibility path.

## Acceptance Criteria

- An operator can create either a single-Repository or multi-Repository ChangeSet from the local
  console using one existing Project.
- The created ChangeSet freezes exact Repository authority and prepares its TaskWorkspace before
  the first planning Run.
- A failed initial planning Run leaves one reusable ChangeSet rather than a duplicate or a hidden
  rollback.
- The operator can exchange bounded planning messages, refresh the page, and see a bounded recent
  conversation.
- A Planner asking a question without returning a Plan receives that immediately preceding message
  together with the operator's next answer.
- Only the current exact Plan-bearing message can be approved, and approval follows the existing
  manual or autonomous supervision policy.
- The intake query and mutation routes expose no arbitrary paths, credentials, raw operations,
  executables, or complete control records.
- Existing review, audit, Feedback, Bundle, and delivery behavior remains authoritative and no new
  lifecycle state is introduced.
- No Project administration, AgentProfile registry, tracker adapter, streaming transport, remote
  access, model comparison, Candidate lane, deployment, or automatic merge is introduced.

## Relationship To Accepted Authority

This accepted proposal extends Decision 0016's local console beyond review and delivery while
preserving its loopback security and shared-operation boundary. It presents Decision 0030's
already implemented task creation and persistent TaskWorkspace through the local UI. It does not
revise ChangeSet, Plan, WorkUnit, CandidateBundle, evidence, supervision, review, or delivery
authority.

The implementation must revise `SPEC.md` section 17, whose first-console scope currently excludes
selection and planning. Until implementation lands, that existing text remains the landed product
contract while this Proposal and Decision own the accepted implementation direction.

## Revision History

- 2026-08-12: Proposed the minimal local intake and planning adapter after discussion selected it
  over a full administration console or tracker-first integration.
- 2026-08-12: Accepted by the user without revising its scope or deferrals.
