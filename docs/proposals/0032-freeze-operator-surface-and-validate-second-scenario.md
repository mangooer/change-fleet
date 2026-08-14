---
artifact_type: repository_design_proposal
id: 0032
status: accepted
title: Freeze operator surface and governance, validate a second scenario
proposed_at: 2026-08-14
accepted_at: 2026-08-14
confirmed_by: user
supersedes: none
depends_on: none
blocks: none
decision: docs/decisions/0034-freeze-operator-surface-and-validate-second-scenario.md
implementation_tracking: docs/work-items/WI-0045-governance-freeze-amendment.md; docs/work-items/WI-0046-second-scenario-validation.md
---

# 0032: Freeze Operator Surface And Validate A Second Scenario

## Context

Under three weeks of self-hosted iteration produced 71 commits, 33 Decisions, 44 Development
WorkItems, and roughly 936 KB of production source plus 512 KB of tests. Governance documentation
under `docs/` (about 984 KB) now outweighs production source. The product has one real user: the
ChangeFleet self-repository.

Three observations from reviewing that baseline:

1. Surface work is growing faster than kernel value. The browser console, SSE timeline, usage
   presentation, and audit views serve one local single-user scenario. Agent Runtimes increasingly
   own presentation, and Provider-native frontends can absorb ordinary UI faster than a
   single-operator local console justifies. The UI is the most replaceable part of the product.
2. Governance records are inflating. One implementation stage now tends to produce one Proposal,
   one Decision, and several WorkItems. Many Decisions record stage boundaries rather than durable
   rationale, and each new record adds loading and maintenance cost for every future session. The
   Harness itself warns to keep the kernel small.
3. The unverified assumption is not whether Agents improve. It is whether a second scenario — a
   registered repository that is not the ChangeFleet self-repo — can complete an end-to-end ChangeSet
   under today's constraints (Windows host, local paths, Codex SDK, a target repository without its
   own Harness, optional semantic checks).

The kernel's durable value — authorization, exact subjects, evidence binding, recovery, human gates,
and one cross-repository reviewable CandidateBundle — remains sound. This proposal changes no kernel
boundary. It stops expanding the replaceable surface, caps governance growth, and re-points the next
work at the second-scenario question.

## Decision

Freeze three surfaces, adopt a decision moratorium, and make second-scenario validation the next
objective.

### Freeze The Browser Console

The landed console (WI-0041) is the accepted local operator surface. Until a second scenario
demonstrates a concrete need, no new console feature WorkItems: no new pages, presentation states,
SSE events, or interaction redesigns beyond defect fixes and kernel-driven projections. The console
stays exactly what it is today.

### Freeze Cost And Audit Presentation

Decision 0009 already keeps usage and cost out of default Agent context. The console's compact
counters and the `debug audit` route remain; pricing, dashboards, cross-task comparison, and new
usage views stay deferred until a second scenario needs them. `RuntimeAuditQueryService`
projections receive no new features beyond correctness defects.

### Freeze The Harness Overlay

Exact-base repository-native Harness remains the ordinary and only default path. The landed overlay
machinery (Decision 0011) stays available and tested but receives no new capabilities: no writeback,
no new file kinds, no skill packaging, no additional snapshot features. The landed machinery is not
removed or simplified now — removal is destructive without second-scenario evidence, while a freeze
is reversible.

### Decision Moratorium

A new Decision record is created only when an accepted boundary actually changes, that is, when a
proposal revises or supersedes existing accepted authority. Landing an accepted proposal's
implementation, completing a stage, or adding a clean feature inside existing boundaries records
evidence in the Development WorkItem and current projections — not in a new Decision. Proposals
remain the mechanism for product or architecture boundary discussion. Target: Decisions stop growing
linearly with stages.

### Second-Scenario Validation Is The Next Objective

The next implementation phase is one complete real ChangeSet against a registered repository that is
not the ChangeFleet self-repo: create, plan, execute, validate, verify, review, and where available
PR delivery, with every gap, cost, and recovery observation recorded as evidence. Observed gaps
become the context for the next proposal. Until that evidence exists, the deferred list stays closed.

## Boundaries

- No `SPEC.md` or kernel-boundary change: ChangeSet, WorkUnit, Run, Candidate, CandidateBundle,
  evidence, gates, recovery, and delivery semantics are untouched.
- The console, audit route, and overlay remain accepted, landed, and tested surfaces; they are frozen
  for feature work, not deprecated or removed.
- The freezes are roadmap and governance policy; reversing any one requires a new accepted proposal.
- Second-scenario runs use the existing product surfaces (CLI or console); this proposal authorizes
  no new tooling.
- The moratorium applies to ChangeFleet repository governance, not to Runtime `DecisionRequest`
  records inside a user ChangeSet.

## Alternatives

### Keep Investing In The Console Toward Provider-Frontend Parity

Rejected. Presentation is the most absorbable surface; the Provider or a later thin client can
absorb it faster than a single-operator local console justifies more investment.

### Remove The Overlay Or Audit Machinery Now

Rejected. Landed code with passing evidence should not be deleted without a defect or a measured
need. Freezing captures the cost reduction without destructive risk.

### Continue One Proposal/Decision Per Stage

Rejected. Decisions dilute into stage bookkeeping, and every record adds loading and maintenance
cost for future sessions. Evidence belongs in WorkItems; Decisions belong to boundary changes.

### Expand Kernel Scope Next

Rejected. Remote workers, a second Provider, or multi-tenancy would widen the maintenance surface
before the single-user assumption is tested anywhere but the self-repo.

### Keep Polishing The Self-Repo Loop

Rejected. The self-repo is one scenario with a known Harness and a familiar codebase; it cannot
reveal what breaks with an unfamiliar repository and its own conventions.

## Implementation Slices

1. Governance amendment WorkItem: record the three freezes and the decision moratorium in
   `AGENTS.md` or `docs/harness.md`, align `docs/current-state.md` and `README.md`, and update the
   proposal index. Documentation-only gates.
2. Second-scenario WorkItem: choose one real non-self repository, register it, run one end-to-end
   ChangeSet with a bounded objective, and record exact gaps, costs, and recovery behavior as
   evidence. This slice authorizes no new product feature.
3. Follow-up: only after slice 2 evidence exists, propose any new boundary — console change, overlay
   simplification, Provider work, or opening a deferred item.

## Acceptance Criteria

- The Harness documents the freeze policy and the moratorium, and eager resource sizes stay within
  the soft limits in `docs/harness.md`.
- The Proposal Index and `docs/current-state.md` remain consistent with this proposal's status; no
  new Decision record exists purely to mark an implementation stage.
- One real non-self ChangeSet either completes through its configured review boundary with preserved
  exact evidence, or stops at precisely recorded gaps that become the next proposal's context.
- No new console, audit, or overlay feature lands during the freeze without an accepted proposal.

## Validation

- Slice 1 runs documentation-only checks: link inspection, authority-pointer inspection, and eager
  byte-size checks; no Node test surface changes.
- Slice 2 is a Runtime exercise. Evidence is recorded in the WorkItem per `docs/validation.md`:
  exact commands, exit codes, subjects, observations, and unverified boundaries. No fake Provider
  results.
- Kernel invariants are unchanged; existing test suites remain the acceptance gate for any touched
  boundary.

## Risks And Open Questions

- A freeze can ossify a surface right before a second user needs it. Mitigation: freezes are policy,
  reversible by one accepted proposal, and slice 2 evidence is exactly what would justify lifting
  one.
- A second repository operated by the same user is not yet a second user. It validates scenario
  diversity, not product-market fit. This proposal claims only the former.
- Whether the overlay machinery should eventually be simplified (for example, reduced digest
  tracking) remains open until slice 2 shows whether external repositories actually use frozen
  overlays.
- The moratorium could hide rationale if a later boundary change lacks a record. Mitigation:
  WorkItems still carry scope, acceptance, and evidence, and any actual boundary revision still
  produces a Decision.
- The Supervisor layer and single-Provider binding identified in the strategic review are watch
  items, not changes: this proposal changes neither and does not pre-authorize their future revision.

## Non-Goals

- No removal or rewrite of landed console, audit, overlay, or supervision code.
- No second Provider, remote workers, hosted multi-tenancy, pricing, dashboards, automatic merge, or
  deployment.
- No change to the accepted product contract in `SPEC.md`.
- No new product feature is authorized by this proposal itself.

## Relationship To Prior Decisions

- Freezes the operator-surface roadmap of Decisions 0016, 0031, and 0033 without revising their
  accepted boundaries: the landed console remains the operator surface.
- Freezes presentation investment around Decisions 0009 and 0012; usage and audit remain
  out-of-context, debug-only evidence.
- Freezes the overlay boundary of Decision 0011; exact-base Harness remains the default, and no new
  overlay capability is authorized.
- Amends repository governance practice documented in `docs/harness.md` and `AGENTS.md` by adding the
  decision moratorium; no numbered Decision is revised by this proposal.
- Changes no kernel boundary governed by Decisions 0001 through 0004, 0008, 0015, 0025, 0024, 0026,
  0027, 0029, and 0030.

## Documentation Impact

- `AGENTS.md` or `docs/harness.md`: freeze and moratorium rules (slice 1).
- `docs/current-state.md`: next-task projection changes from the WI-0044 comparison to
  second-scenario validation; freezes are listed under current focus or known limitations.
- `docs/proposals/INDEX.md`: new row for 0032.
- `README.md`: only when the freeze policy is accepted and slice 1 lands.

## Revision History

- 2026-08-14: Proposed after a full-project strategic review. The user chose the direction: freeze
  console and audit UI investment, freeze the Harness overlay, adopt a decision moratorium, and
  validate a second real scenario.
- 2026-08-14: Accepted by the user as the authority for Decision 0034, WI-0045, and WI-0046.
