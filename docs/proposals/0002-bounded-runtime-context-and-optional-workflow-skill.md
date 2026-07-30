# 0002: Bounded Runtime Context And Optional Workflow Skill

Artifact type: Repository Design Proposal

Decision status: Superseded

Drafted: 2026-07-30

Superseded: 2026-07-30 by
[Proposal 0003](0003-harness-ownership-and-runtime-context.md)

Implementation tracking: None; superseded before acceptance

This document preserves the initial three-layer and single optional Skill discussion. Accepted
Proposal 0003 and Decision 0005 replace it with a generated Run Context Projection, Agent Profiles,
operation-scoped Skills, scoped permissions, tracker boundaries, and structured history that is not
replayed into every prompt.

## Context

ChangeFleet's accepted boundary keeps repository-specific knowledge in repository-native Harness
and keeps Core out of skill installation, semantic code understanding, and project-specific test
policy. That boundary prevents one centrally copied Harness from becoming a second, stale authority
for every registered repository.

ChangeFleet nevertheless needs a small, versioned contract that tells an Agent Runtime which exact
ChangeSet, plan revision, repository scope, workspace, evidence rules, and typed outcomes apply to
one Run. That contract is control-plane protocol, not project semantic Harness.

Two additional needs are now explicit:

1. ChangeFleet-owned instructions must not grow without a measurable context budget.
2. A project should be able to opt into reusable ChangeFleet workflow guidance without making that
   guidance mandatory or asking Core to become a universal skill manager.

The desired operator outcome is to retain at least 30 percent context headroom. A static Harness
alone cannot guarantee that the complete live context remains below 70 percent because provider
system instructions, tool schemas, conversation history, tool results, compaction, and subagents
are Runtime-owned. The product must distinguish an enforceable bound from an estimate or unknown
state rather than reporting false precision.

## Proposed Direction

Use three layers with separate ownership:

1. **ChangeFleet Control Contract.** A compact, versioned, ChangeFleet-owned machine contract
   supplied to every managed Run. It describes authorized repositories, exact subject identity,
   current intent and plan references, workspace capability, decision boundaries, typed outcomes,
   evidence reporting, cancellation, and recovery. It is shipped with ChangeFleet and is not
   copied into registered repositories.
2. **Repository-native Harness.** Project-owned instructions, skills, architecture references,
   build configuration, and check guidance reachable from the exact repository base. Existing
   Harness remains semantic authority for that repository. Missing Harness is permitted.
3. **Optional ChangeFleet workflow Skill.** A small Runtime-native Skill that teaches an Agent how
   to use the Control Contract and request task-relevant resources progressively. A project or
   operator may install and select it through the Agent Runtime's own skill mechanism. ChangeFleet
   Core does not install it, copy it into repositories, or treat its presence as authorization.

The optional Skill is an inner Agent method. It cannot replace ChangeSet lifecycle, plan
confirmation, repository scope, Candidate identity, evidence binding, or human Bundle decisions.
Those rules remain in the Control Contract and deterministic Core.

Proposal 0001 should prove the Control Contract and context-budget accounting through a
deterministic fake Runtime. It should not require production Skill packaging or one real provider
integration.

## Context Budget Contract

Every Runtime adapter should classify context-budget evidence as one of:

```text
enforced
estimated
unknown
```

- `enforced` means the adapter reports the applicable model context window and usage at every
  boundary required by the policy, and can refuse continuation or start a fresh bounded Run before
  violating that boundary.
- `estimated` means ChangeFleet can bound its own serialized payload and estimate tokens, but the
  Runtime does not expose enough information to guarantee total live usage.
- `unknown` means the adapter cannot produce a meaningful denominator or total-usage observation.
  The Run may proceed only under explicit policy and must not be presented as context-bounded.

The proposed default policy is:

```text
maximum_initial_context_ratio = 0.70
minimum_context_headroom_ratio = 0.30
maximum_changefleet_static_ratio = 0.10
```

At dispatch, the denominator is the effective context window for the resolved model. The numerator
for the initial-context check includes Runtime-visible system instructions when observable, tool
schemas, ChangeFleet Control Contract, selected Skill body, initially loaded Skill references,
ChangeIntent and ChangePlan material, repository Harness material supplied eagerly, and current
conversation history.

ChangeFleet must record both the measured or estimated values and which components were unavailable
to the calculation. A 70-percent result based only on ChangeFleet-owned bytes is not a guaranteed
total-context result.

Continuous enforcement is a separate capability. An adapter may claim it only when it can observe
or control each model-request boundary that may grow context. Otherwise it records initial
admission as enforced or estimated and continuous usage as unknown.

Changing the resolved model changes the denominator and requires a new budget decision. A
model-changing retry is a new Run attempt rather than an invisible modification of an existing
Run.

## Skill Shape

The candidate Skill name is `changefleet-workflow`.

Its source should use progressive disclosure:

```text
changefleet-workflow/
  SKILL.md
  agents/
    openai.yaml
  references/
    planning.md
    execution.md
    evidence.md
    recovery.md
  scripts/
    inspect-context-budget.*
```

The final package should include only resources proven necessary by real tasks. `SKILL.md` is a
small router containing the common workflow and explicit conditions for loading one reference.
Provider-specific or purpose-specific detail belongs in one-level-deep references. Deterministic
budget inspection belongs in a script so the Agent need not load its implementation into context.

The Skill must not contain:

- copied repository architecture or project memory;
- inferred framework or test commands;
- credentials, model catalogs, MCP installation, or sandbox configuration;
- duplicated ChangeSet lifecycle prose that belongs in the versioned Control Contract;
- automatic scope expansion, confirmation, acceptance, merge, or deployment behavior;
- a requirement to preload every reference.

Skill metadata, body, loaded references, and Control Contract must be measurable as separate context
components. A Skill release that exceeds its accepted static budget fails validation.

At Run dispatch, the adapter resolves the selected Skill to an exact version or content hash and
records that identity with the budget evidence. A Skill update cannot silently change an in-flight
Run. A later attempt that resolves different Skill content receives a new Run identity and a new
context-budget decision.

## Runtime And Model Boundary

Projects select an Agent Profile or Runtime configuration, not a model field in the ChangeSet
aggregate. An adapter may translate its profile into provider-native options such as:

```text
Codex app-server:
  model
  effort

Claude Agent SDK:
  model
  provider-native effort and permission options when supported
```

Core records the stable Agent Profile and Run references. Run evidence records the requested model,
provider-reported effective model when observable, Runtime and adapter versions, effective context
window, exact selected Skill identities, budget classification, and usage observations.

Model availability, authentication, Runtime-native settings, and skill installation remain adapter
or operator responsibilities. ChangeFleet does not maintain a universal model or skill catalog.

Repository-native settings must be loaded deliberately. A Runtime adapter must not silently include
user-global or local-only instructions when the Run contract is intended to bind only the exact
repository base.

## Precedence And Conflict Rules

The layers do not merge into one undifferentiated prompt:

1. ChangeFleet Control Contract owns authorization, exact identity, lifecycle, and reporting.
2. Confirmed ChangeIntent and ChangePlan own task-specific objective and scope.
3. Repository-native Harness owns repository semantic guidance.
4. The optional workflow Skill supplies reusable execution method.
5. Agent reasoning selects task-specific implementation and checks within those boundaries.

A repository Harness or Skill instruction that conflicts with repository authorization, exact Git
identity, or a human gate cannot override Core. A semantic conflict between confirmed plan and
repository Harness produces a blocker, decision request, or plan revision rather than silent
precedence.

Only Harness content reachable from the frozen repository base is normal task input. Local-only or
dirty Harness material is reported as excluded and cannot silently enter a WorkUnit.

## Alternatives

### Mandatory ChangeFleet Harness Per Project

ChangeFleet could create and maintain a custom Harness directory for every Project. This provides a
uniform entry point but creates a second semantic authority, introduces drift, and requires every
external Harness revision to become part of Run evidence. It also pushes Core toward framework,
test-policy, and skill management. This draft rejects it.

### Repository Harness Only

ChangeFleet could supply only the Control Contract and never publish reusable workflow guidance.
This keeps ownership simple and remains a valid fallback, but every Runtime integration would
reconstruct the same resource-reading and outcome-reporting method. The optional Skill captures
that method without making it lifecycle authority.

### Inline Complete Workflow On Every Run

ChangeFleet could serialize the complete workflow, examples, and provider instructions into every
prompt. This is easy to dispatch but guarantees context growth and duplicates versioned contract
text. This draft rejects it in favor of progressive disclosure.

### Mandatory Hard 70-Percent Claim

ChangeFleet could reject every Runtime that cannot prove complete live context usage. This provides
strong semantics but would prevent the first fake slice and many provider adapters before their
usage protocols are known. This remains a possible future project policy, not a universal product
claim.

## Implementation Slices

1. **Deterministic budget vocabulary.** Define Control Contract version, context components,
   `enforced | estimated | unknown`, ratio arithmetic, and Run evidence using the fake Runtime in
   Proposal 0001.
2. **Optional Skill package.** Create and validate the minimal `changefleet-workflow` Skill after
   concrete planning and execution examples prove what belongs in its router and references.
3. **Provider capability mapping.** Add one accepted Runtime adapter, map model selection and
   context observations, and prove that unsupported observations remain explicit.
4. **Independent project proof.** Exercise one repository with native Harness and one without it,
   with the Skill disabled and enabled, while preserving exact-base and context-budget evidence.

Each slice requires an accepted WorkItem. This draft does not authorize implementation.

## Acceptance Criteria

1. ChangeFleet can run against a repository with no Harness and does not create one implicitly.
2. Registration and execution do not write `.changefleet`, `WORKFLOW.md`, `AGENTS.md`, or skills
   into a registered repository.
3. The Control Contract remains sufficient to enforce repository scope, exact subject identity,
   typed outcomes, and human gates when the optional Skill is absent.
4. A project may select the workflow Skill through a Runtime-owned mechanism without adding a
   mandatory field to the initial Project and Repository catalog.
5. Missing, unavailable, or unloaded Skill state is explicit and does not become false provider
   load evidence.
6. Every selected Skill is bound to an exact version or content hash in Run and context-budget
   evidence.
7. The Skill cannot expand repository scope, change a target ref, accept a Bundle, or write control
   state.
8. Only repository Harness reachable from the exact frozen base is supplied as normal task input.
9. Initial context at or below the configured ratio records component values, denominator,
   classification, and unobserved boundaries.
10. Initial context above the configured ratio fails closed or requires an explicit policy decision;
   it is never silently truncated.
11. Continuous context is called guaranteed only for an adapter that proves observation or control
    at every required model-request boundary.
12. Changing model, Skill content, or context-window identity creates a new budget decision and Run
    attempt.
13. Skill validation fails when ChangeFleet-owned static content exceeds its accepted budget or
    requires unconditional loading of all references.

## Validation

Future implementation must include:

- unit tests for ratio arithmetic, missing denominators, component accounting, and classification;
- deterministic fake-Runtime tests below, at, and above the 70-percent boundary;
- restart tests preserving the exact model, budget decision, and Run attempt;
- Skill structural validation and a deterministic static-budget check;
- a forward test in a fresh Agent context that loads only the references needed for one planning or
  execution task;
- one provider conformance test for model selection and context reporting;
- one two-repository acceptance fixture with one native Harness and one missing Harness;
- the normal fast suite selected by the accepted implementation stack.

Every check must report the exact command, exit code, subject, observation, and unverified boundary.
A provider that exposes only partial context usage cannot pass a continuous-enforcement assertion.

## Risks And Open Questions

1. Whether 70 percent applies only before each model request or must remain a hard bound during a
   provider-owned turn.
2. Whether the ChangeFleet-owned static ratio should remain 10 percent or use an absolute token cap
   as well.
3. How token estimates are normalized when providers use different tokenizers or hide system and
   tool-schema usage.
4. Whether context pressure requests provider compaction, starts a fresh resource-backed Run, or
   requires human confirmation.
5. Which Runtime-owned mechanism selects the optional Skill without expanding the initial catalog.
6. Whether one portable Skill source can support multiple Runtime-native formats without becoming a
   compatibility framework.
7. Which provider observations are sufficient to record an effective model rather than only a
   requested model.

## Non-Goals

- A centrally copied semantic Harness.
- Automatic installation or updating of skills in registered repositories.
- A universal ChangeFleet skill, model, credential, MCP, or sandbox manager.
- Inferring project architecture, framework, build, or test policy.
- Claiming a hard total-context guarantee from byte counts or partial provider telemetry.
- Moving ChangeSet lifecycle or human authority into a Skill.
- Requiring a production workflow Skill or real provider in Proposal 0001.

## Documentation Impact

On acceptance, update:

- `SPEC.md` to distinguish Control Contract, repository Harness, optional workflow method, and
  context-budget evidence;
- Decision 0001 if the optional Skill changes the accepted control-plane wording;
- Decision 0003 only if acceptance adds catalog configuration;
- `docs/architecture.md` with Runtime capability and context-budget boundaries;
- `docs/current-state.md` with accepted and deferred slices;
- Proposal 0001 with the exact fake-Runtime budget boundary it must prove.

This superseded draft is discussion history and does not change the accepted product contract.
