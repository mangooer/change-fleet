# 0034: Freeze Operator Surface And Validate A Second Scenario

Status: Accepted

Date: 2026-08-14

Source: Repository Design Proposal 0032

Revises: no numbered Decision; amends repository governance practice recorded in `AGENTS.md` and
`docs/harness.md`

## Decision

ChangeFleet will freeze feature investment in three accepted operator surfaces:

- the landed local browser console;
- cost and audit presentation beyond the compact console counters and the `debug audit` route;
- the Repository Harness overlay machinery accepted by Decision 0011.

These surfaces remain accepted, landed, and tested. They receive only defect fixes and
kernel-driven projections until an accepted proposal lifts a freeze. Exact-base repository-native
Harness remains the ordinary and only default path.

A new Decision record is created only when a proposal revises or supersedes an accepted boundary.
Implementation-stage completion and clean additions inside existing boundaries record evidence in
Development WorkItems and current projections instead. Decisions must stop growing linearly with
stages.

The next implementation objective is one complete real ChangeSet against a registered repository
that is not the ChangeFleet self-repo: create, plan, execute, validate, verify, review, and where
available PR delivery, with every gap, cost, and recovery observation recorded as evidence. Observed
gaps become the context for the next proposal. Until that evidence exists, the deferred architecture
list stays closed.

## Rationale

Agent Runtimes increasingly own presentation, and Provider-native frontends can absorb ordinary UI
faster than a single-operator local console justifies more investment. Governance records have grown
until documentation outweighs production source; a Decision that marks a stage boundary carries no
durable rationale and only adds loading and maintenance cost. The kernel's durable value —
authorization, exact subjects, evidence binding, recovery, human gates, and one reviewable
CandidateBundle — is unchanged. The unverified assumption is whether a non-self repository can
complete an end-to-end ChangeSet under today's constraints, so the next evidence must come from that
scenario rather than from more surface or governance work.

## Consequences

- No new console, audit, or overlay feature WorkItems without an accepted proposal lifting the
  freeze; defect fixes and kernel-driven projections continue.
- The next WorkItem is one second-scenario ChangeSet; its repository choice is a human decision.
- Kernel boundaries governed by Decisions 0001 through 0004, 0008, 0015, 0025, 0024, 0026, 0027,
  0029, and 0030 are unchanged.
- `AGENTS.md` and `docs/harness.md` record the freeze and moratorium rules; `docs/current-state.md`
  re-points the next task from the WI-0044 comparison to second-scenario validation.
