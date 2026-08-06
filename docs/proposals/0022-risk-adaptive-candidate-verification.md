# 0022: Risk-Adaptive Candidate Verification

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-06

Accepted: 2026-08-06

Supersedes in part: Decision 0017 requirement that every checkpoint resume use an entirely
unchanged Plan-bound validation command, including its operational timeout

Depends on: Decisions 0002, 0005, 0009, 0017, 0022, and 0023

Blocks: Reliable recovery of the current guidance-normalization CandidateCheckpoint and further
self-iteration through independent Candidate verification

Decision: [Decision 0024](../decisions/0024-risk-adaptive-candidate-verification.md)

Implementation tracking: [WI-0016](../work-items/WI-0016-deterministic-verification-admission-and-attempt-budgets.md),
`done` for the first deterministic slice only

## Context

The guidance-normalization dogfood ChangeSet exposed three coupled problems in the current
validation boundary. The execution Runtime selected and repeatedly ran checks while implementing,
then completed after its own Node.js 24 full check passed. ChangeFleet subsequently repeated the
same full check as Plan-bound repository validation. Its first attempt used the wrong host Node.js
version; its second used Node.js 24 but hit the Plan's fixed 240-second timeout shortly before the
same suite would normally complete. The exact implementation remains preserved as a
CandidateCheckpoint, but it is not a Candidate.

The failure is not evidence that every task needs more time or another Agent. It shows that the
first slice conflates four decisions:

- development-time checks selected by the executing Agent;
- authoritative deterministic checks against an exact Candidate subject;
- operational attempt budgets such as timeout;
- semantic review of the Git change and the adequacy of its checks.

A fixed full suite is too expensive for small changes and may still miss the relevant behavior.
Pure path and size rules cannot reliably assess semantic risk across arbitrary repositories. A
mandatory second Agent would add latency and token cost even for trivial work. The product needs a
bounded fast path plus optional independent semantic verification chosen from the actual Candidate,
not a universal full-test or universal second-Agent rule.

## Decision

### Candidate-Bound Verification Admission

After execution publishes an exact CandidateCheckpoint, ChangeFleet creates one immutable
`VerificationAdmissionDecision` for that checkpoint. It resolves one of three modes:

- `basic`: no independent Agent; run only the small required deterministic hygiene checks;
- `deterministic`: no independent Agent; run the exact selected behavioral checks;
- `independent_review`: run deterministic checks plus one read-only Verification Runtime.

The Plan carries a preliminary verification expectation, rationale, and conditional escalation
triggers. Final admission uses the actual Candidate facts, explicit operator choice, Project policy,
the confirmed expectation, execution uncertainty, and scope divergence. Project or operator
requirements cannot be waived by an Agent. ChangeFleet Core evaluates typed facts and policy; it
does not attempt language-specific semantic source analysis or parse repository workflow state.

An obvious low-risk fast path may select `basic` without a Runtime call. When deterministic facts do
not justify either skipping or requiring independent review, one Verification Runtime performs a
bounded triage. If it selects deep review, the same Run continues; ChangeFleet does not start a
second reviewer merely to repeat triage.

### Verification Runtime Boundary

The Verification Runtime uses its own versioned AgentProfile and may select a different Provider,
model, reasoning level, or permission profile from execution. It receives only the confirmed intent
and Plan, exact Candidate identity and diff, relevant repository-native guidance, proposed or
completed checks, execution outcome, and bounded current failure evidence. It does not receive the
executing Agent's private reasoning, complete transcript, historical cost, or unrelated audit data.

The Verification Runtime is read-only with respect to Candidate Git state. It assesses the diff,
check coverage, and residual uncertainty, and may request additional structured checks. ChangeFleet's
Runner executes every authoritative command in a disposable exact-subject workspace and records
the evidence. Agent prose alone is never passing deterministic evidence.

One verification produces exactly one of:

- `pass`;
- `pass_with_notes` with bounded non-blocking residual risks;
- `changes_required` with bounded actionable findings;
- `human_decision_required` with the exact unresolved choice.

A blocking finding must identify a violation of confirmed intent, accepted repository authority,
a credible correctness, security, data, or compatibility failure, an unauthorized scope change, or
a required evidence gap. Style preference, unrelated pre-existing debt, speculative improvement,
and optional refactoring cannot block. They may appear only as bounded notes.

Verification feedback remains a claim. A correction Run under the same confirmed Plan assesses each
finding as `adopt | adapt | decline`. `changes_required` creates a new execution attempt and exact
checkpoint; only typed Plan invalidation returns to planning. One focused re-review checks prior
blocking findings and the correction delta. New blocking findings are allowed only for newly
introduced or critical defects; unresolved disagreement becomes a human decision rather than an
unbounded Agent loop.

### Check Selection And Attempt Budgets

Plans confirm verification intent, required policy gates, and expected check coverage; they do not
freeze an exhaustive full suite before the final diff exists. The executing Agent reports its
development checks and proposes a final exact check set. Admission and, when selected, the
Verification Runtime assess that set against the actual Candidate. Every authoritative check has a
stable id, structured executable and argv, exact subject, and coverage rationale. No component may
select a full suite merely because files changed or because more testing is generically safer.

Timeout and similar resource limits are validation-attempt budgets, not semantic check identity.
Project or operator policy supplies bounded defaults and maxima. An exact checkpoint may retry the
unchanged check with a different explicitly authorized budget without a Plan revision or Runtime
call. Each attempt records requested and effective budgets, environment identity where observable,
duration, result, and immutable evidence. Changing the check id, executable, argv, required subject,
or coverage contract remains a semantic change and requires the appropriate verification or Plan
decision.

### Cost And Presentation

Every Verification Runtime invocation records the existing immutable Runtime usage, duration,
AgentProfile, Provider coverage, and outcome evidence. ChangeSet audit queries may derive planning,
execution, verification, correction, and total costs without adding those totals to ordinary
Runtime context.

The normal UI presents only `verifying`, `changes required`, `human decision required`, `passed`, or
`passed with notes`. It may recommend a bounded retry for an operational failure. Admission reasons,
check evidence, AgentProfile identity, token usage, attempts, and exact SHAs remain available in an
advanced audit view.

## Boundaries

- Independent verification is optional and risk-adaptive, not a mandatory second Agent.
- The Verification Runtime cannot edit Candidate code, approve a Bundle, expand Repository scope,
  waive hard Project policy, or grant itself additional resources.
- Fast-path admission is deterministic and auditable; semantic uncertainty escalates instead of
  being hidden behind brittle Core source analysis.
- Plan-time verification is preliminary. Final check selection and review admission bind the exact
  CandidateCheckpoint or current Candidate set.
- Passing deterministic evidence always binds the exact Git subject and effective command; a
  reviewer cannot convert missing or failed evidence into a pass.
- `pass_with_notes` does not block Bundle assembly. `changes_required` and
  `human_decision_required` do.
- Human Bundle acceptance remains a separate exact-subject gate after successful verification.
- Verification and cost history remain linked audit evidence outside eager Runtime context.

## Alternatives

### Always Trust The Executing Agent

This provides a natural inner loop but makes the implementer the only reviewer and cannot prove
that self-reported checks exercised the final exact Git subject. Rejected as authoritative review.

### Always Run A Full Suite

This is simple but repeats expensive work, is disproportionate for small changes, and does not prove
that the suite covers the changed risk. Rejected as the default.

### Always Start An Independent Agent

This improves independence but adds cost and latency to trivial changes. Rejected in favor of a
deterministic fast path and conditional triage.

### Encode All Risk In Core Rules

Generic metadata is useful for hard policy and fast paths, but ChangeFleet cannot understand every
repository's semantic contracts through universal path or language rules. Rejected as the sole
decision mechanism.

### Recommended

Use a small deterministic fast path, typed Project and Plan policy, actual-Candidate admission, and
one optional read-only Verification Runtime that triages and reviews in the same Run. Keep command
execution authoritative in ChangeFleet and keep operational retry budgets outside semantic Plan
identity.

## Implementation Slices

1. Add Candidate-bound admission modes, Project policy, preliminary Plan expectation, immutable
   admission evidence, and attempt-scoped validation budgets without a Verification Runtime.
2. Add one read-only Verification Runtime operation, bounded triage/deep-review output, structured
   check requests, and distinct usage evidence.
3. Route `changes_required` through same-Plan correction and one focused re-review; project notes
   and human decisions into the exact Bundle review surface.
4. Add the minimal local UI states and advanced audit projection, then recover the preserved
   guidance-normalization checkpoint without another execution Provider call when its exact
   preflight still passes.

Each slice must be an end-to-end vertical behavior. Do not scaffold another Provider, generic
workflow engine, or dashboard in advance.

## Acceptance Criteria

- A trivial Candidate can take a recorded fast path without a Verification Runtime invocation.
- Conditional admission can start one Verification Runtime that either stops after triage or
  continues deep review in the same Run.
- Project hard policy, explicit operator choice, Plan expectation, actual scope divergence, and
  Runtime uncertainty produce bounded auditable admission reasons.
- Authoritative checks are selected from the actual Candidate with coverage rationale; every added
  or changed test selected as required is executed, while unrelated full suites are not automatic.
- The Verification Runtime is read-only, may use a different AgentProfile, and cannot turn prose
  into passing command evidence.
- Structured verdicts distinguish pass, non-blocking notes, required correction, and a genuine
  human decision.
- Blocking findings obey the accepted defect and evidence boundary; focused re-review terminates
  or escalates instead of discovering unlimited optional work.
- Validation retry may adjust only bounded attempt resources over an unchanged exact check and
  checkpoint, with no Plan revision, code mutation, or Runtime token cost.
- Verification invocation usage and timing are independently auditable and attributable to the
  WorkUnit and ChangeSet while remaining outside normal Runtime context.
- The preserved guidance-normalization checkpoint can be recovered through accepted exact-subject
  admission and retry semantics if its preflight remains valid; otherwise it remains immutable
  historical evidence.

## Validation

- Domain tests for admission modes, policy precedence, verdict bounds, blocking-finding criteria,
  focused re-review, and attempt-budget identity.
- Application tests for fast-path zero-Runtime verification, conditional triage, deep review,
  requested checks, same-Plan correction, human escalation, and Bundle gating.
- Real-Git integration proving read-only verification, exact checkpoint and Candidate-set binding,
  changed-SHA invalidation, bounded retry budgets, restart recovery, and no duplicate execution
  Runtime call.
- Runtime-context and audit tests proving bounded verification input, independent usage evidence,
  cost attribution, and exclusion of transcripts, historical telemetry, and raw validation output.
- UI tests for the five user-facing states, retry recommendation, notes, correction, and human
  decision without exposing internal lifecycle terminology by default.
- `git diff --check`, affected links, authority projections, and eager Harness size inspection.

## Risks And Open Questions

- The first Project-policy shape must remain small. Repository-specific semantic policy belongs to
  repository-native guidance interpreted by Agents, not an expanding Core rule language.
- A Verification Runtime can be conservative and over-escalate. Audit must expose escalation rate,
  useful blocking-finding rate, execution declines, human overrides, duration, and usage before any
  automatic profile optimization is considered.
- Provider-session continuation may reduce correction context loss but is not required for the
  accepted logical loop; fresh bounded Runs remain valid.
- The exact default and maximum validation-attempt budgets should be selected during the first
  WorkItem from observed local evidence rather than fixed in this proposal.

## Non-Goals

- Mandatory multi-Agent consensus, voting, or adversarial debate.
- A universal language-aware risk analyzer or automatic proof of code correctness.
- Automatic Bundle acceptance, merge, deployment, or human-risk acceptance.
- Provider-session resume, hosted workers, another Provider adapter, or tracker integration.
- Pricing, budgets, quotas, rankings, or an effectiveness dashboard.
- Allowing Agents to run arbitrary unrecorded authoritative shell commands or edit review subjects.

## Documentation Impact

Acceptance requires a new Decision and focused updates to `SPEC.md`, `docs/architecture.md`,
`docs/validation.md`, `docs/current-state.md`, and the local UI contract. Decision 0017 remains
authority for exact CandidateCheckpoint persistence and deterministic resume; it is revised only
for Candidate-bound admission, independent verification, and attempt-scoped operational budgets.
