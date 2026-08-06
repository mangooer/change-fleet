# 0024: Make Candidate Verification Risk-Adaptive

Status: Accepted

Date: 2026-08-06

Source: Repository Design Proposal 0022

Revises in part: Decision 0017 treatment of every validation timeout as immutable Plan-bound
command identity

## Decision

Candidate verification is selected from the exact implementation result rather than fixed as a
universal full-suite or universal second-Agent gate. A CandidateCheckpoint receives one auditable
verification admission mode:

- `basic` for a deterministic low-risk fast path;
- `deterministic` for exact selected behavioral checks without another Agent;
- `independent_review` for exact checks plus one optional read-only Verification Runtime.

The confirmed Plan records a preliminary verification expectation and escalation conditions. Final
admission evaluates the actual Candidate, explicit operator choice, Project policy, scope divergence,
and execution uncertainty. ChangeFleet Core evaluates typed policy and generic Candidate facts; it
does not parse repository workflow state or implement a universal semantic source analyzer.

When semantic triage is required, one Verification Runtime may stop after bounded triage or continue
deep review in the same Run. It uses its own versioned AgentProfile, may use a different Provider or
model, and receives only confirmed authority, exact diffs, relevant repository-native guidance,
proposed or completed checks, and bounded current evidence. It is read-only and cannot accept a
Bundle, edit Candidate code, expand scope, waive hard policy, or convert prose into passing command
evidence.

Authoritative commands remain structured and are executed by ChangeFleet against exact Git
subjects. Each selected check has a stable identity and coverage rationale. A full suite is not
selected merely because files changed or because more testing is generically safer.

Verification returns exactly `pass`, `pass_with_notes`, `changes_required`, or
`human_decision_required`. Blocking findings require a concrete confirmed-contract, correctness,
security, data, compatibility, scope, or evidence defect. Style preferences, unrelated debt, and
optional improvements cannot block. Findings remain claims assessed by a same-Plan correction Run;
only typed Plan invalidation returns to planning. Re-review is focused on prior blocking findings and
the correction delta, with unresolved disagreement routed to a human rather than an unbounded loop.

Operational timeout and similar resource limits are validation-attempt budgets rather than semantic
check identity. An unchanged exact check and checkpoint may retry with a different explicitly
authorized bounded budget, preserving every attempt as evidence, without a Plan revision or Runtime
call. Changing the check id, executable, argv, subject, or coverage contract remains a semantic
change.

Verification Runtime usage, timing, AgentProfile, outcome, attempts, and correction costs are
independently auditable and attributable to their WorkUnit and ChangeSet. These audit facts remain
outside ordinary Runtime context.

## Rationale

Dogfood execution demonstrated that an Agent may pass an expensive check during implementation and
the control layer may then repeat it under a host-specific fixed timeout. Mandatory full validation
duplicates work for small changes without proving relevant coverage, while mandatory independent
review adds model cost to trivial tasks. Pure Core heuristics cannot interpret every repository's
semantic risk.

A deterministic fast path plus actual-Candidate admission keeps simple work cheap. Optional Agent
triage provides semantic judgment only when needed. Separating operational budgets from semantic
check identity permits exact, auditable recovery from environmental timing without silently changing
what is being verified.

## Consequences

- Decision 0017 remains authority for durable CandidateCheckpoint identity, immutable validation
  attempts, exact preflight, and no-Provider resume; its unchanged-command rule is revised only for
  bounded attempt resources.
- Implementation proceeds in separately confirmed vertical slices: admission and attempt budgets;
  Verification Runtime; correction and focused re-review; then UI and preserved-checkpoint recovery.
- Existing Bundle review and human acceptance remain separate exact-subject gates.
- Another Provider adapter, Provider-session resume, multi-Agent consensus, automatic acceptance,
  pricing, quotas, rankings, and dashboards remain deferred.
