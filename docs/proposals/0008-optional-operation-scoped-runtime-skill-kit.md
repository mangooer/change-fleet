# 0008: Optional Operation-Scoped Runtime Skill Kit

Artifact type: Repository Design Proposal

Decision status: Rejected

Proposed: 2026-07-31

Rejected: 2026-07-31

Supersedes:

Depends on: Decisions 0005, 0009, and 0010; WI-0003, `done`

Blocks:

Implementation tracking: No Development WorkItem; implementation is not authorized

## Context

Decision 0005 accepts four separate Runtime context layers: the compact Control Contract, current
Run Context Projection, repository-native Harness, and optional operation-scoped Runtime Skills.
It requires the first two layers to remain sufficient when the other two are absent. Proposal 0003
deferred production Runtime Kit packaging until at least one real planning and execution flow
existed.

WI-0003 now satisfies that prerequisite. Its real Codex flow succeeds without a Runtime Kit and
shows the first reusable provider guidance:

- planning inspects exact authorized bases, proposes a typed plan or selection request, and names
  executable checks;
- execution inspects the current WorkUnit, edits the authorized workspace, runs the repository
  check, and leaves Candidate publication to ChangeFleet.

The current implementation deliberately rejects every non-empty `AgentProfile.skills` value.
Its isolated `CODEX_HOME` does not copy user configuration or Skills, and the TypeScript SDK
`0.146.0` exposes no direct per-thread Skill parameter.

Current Codex documentation describes progressive Skill loading and discovery from repository,
user, administrator, and system locations. It recommends standalone Skills for authoring and
plugins for reusable distribution. A naive implementation could therefore inherit unrelated user
Skills, inject untracked files into a WorkUnit, or append Skill bodies directly to every prompt.
All three would violate the accepted isolation or bounded-context direction. See the official
[Build skills](https://developers.openai.com/plugins/build/skills) guidance.

The question is not whether ChangeFleet can store more instructions. It is whether a small optional
Runtime-owned method can be selected reproducibly without becoming another mandatory Harness or
hidden source of authority.

## Design Options

### Option A: Keep Provider prompts only

Continue using the compact operation instructions proven by WI-0003 and leave `skills` empty.

Advantages:

- smallest implementation and context;
- no discovery, packaging, or hidden-input problem;
- already proven by one real planning and execution flow.

Disadvantages:

- does not provide the operator-selectable Runtime Kit accepted in principle by Decision 0005;
- reusable workflow guidance remains coupled to one Provider adapter;
- future Providers may duplicate the same method in adapter prompts.

This remains a valid fallback and must continue to work.

### Option B: One monolithic `changefleet-workflow` Skill

Package planning, execution, review, recovery, and future delivery guidance together.

Advantages:

- one package and one identity;
- simple operator selection.

Disadvantages:

- eagerly loads guidance irrelevant to the current operation;
- grows as ChangeFleet gains stages;
- duplicates authority prose and recreates the large Harness problem the project is avoiding.

Do not choose this option.

### Option C: Two minimal operation Skills

Start with:

```text
changefleet-plan
changefleet-execute
```

Only the Skill matching the current Run operation is materialized and explicitly invoked. Planning
and execution remain valid when the kit is disabled.

Advantages:

- covers only workflows proven by a real Provider;
- limits context to one small operation method;
- gives later Providers a reusable method without moving lifecycle authority out of Core;
- leaves review and recovery packaging until those semantic Agent workflows actually exist.

Disadvantages:

- requires exact Skill resolution, isolated provider discovery, and new evidence;
- introduces two artifacts and operation bindings;
- may not improve outcome quality over the already successful compact prompts.

This is the recommended first stage.

### Option D: Publish all four operation Skills now

Add `changefleet-review` and `changefleet-recover` immediately.

The accepted product has review and recovery state transitions, but WI-0003 did not prove separate
semantic Agent review or recovery workflows. Packaging them now would invent guidance without
real-use evidence. Defer them.

## Packaging And Dispatch Options

### Append Skill bodies to the prompt

This would work with every Provider but would not be provider-native Skill use. It defeats
progressive disclosure, makes loaded identity ambiguous, and increases every prompt. Reject it.

### Write `.agents/skills` into the repository workspace

Codex can discover repository-scoped Skills, but generated Runtime Kit files would contaminate the
exact-base view or Candidate workspace. ChangeFleet must not modify a registered repository's
Harness implicitly. Reject it.

### Inherit operator-global Skills

This is convenient but permits unselected content and silent version drift. A global path is a
locator, not evidence of exact loaded content. Reject implicit inheritance.

### Materialize the selected exact Skill into an isolated Run home

Resolve an explicitly configured Skill package, verify its identity, and copy only the
operation-selected Skill into a provider-documented discovery location owned by that Run. Invoke
it explicitly and delete the isolated materialization with the Run environment.

This is the recommended execution mechanism. The Codex SDK does not expose a Skill option, so the
implementation must prove that the pinned CLI discovers the isolated location without inheriting
unselected user-global Skills. If that cannot be proven on a supported host, the implementation
must stop or reopen this proposal; it must not fall back to prompt embedding or repository writes.

### Package a public plugin immediately

Official guidance prefers plugins for distributing multiple Skills. A plugin is a reasonable later
distribution surface, but marketplace metadata, installation, updates, and cross-surface behavior
are not required to prove the Runtime boundary. Defer public plugin packaging until the two Skills
pass the managed-Run proof.

## Recommended Decision

### 1. Keep the kit optional

An empty Skill selection remains valid. The Control Contract and current projection stay sufficient
for authorization, typed outcomes, and lifecycle continuation. Missing optional guidance cannot
silently grant or remove authority.

### 2. Begin with exactly two instruction-only Skills

The first kit contains `changefleet-plan` and `changefleet-execute`. Each Skill:

- has one `SKILL.md` and matching `agents/openai.yaml`;
- uses imperative workflow guidance;
- disables implicit invocation;
- has no scripts, assets, or reference files in the first stage;
- contains no credentials, host paths, model names, test commands, repository-specific rules, or
  duplicated lifecycle history.

Stable repository authorization, base SHA, allowed outcomes, human gates, and Candidate publication
remain in the Control Contract or controller-owned prompt boundary. A Skill may explain how to
perform semantic work but cannot redefine what is authorized.

### 3. Select Skills through one Agent Profile

`AgentProfile.skills` becomes a normalized list of logical descriptors. Each descriptor binds:

```text
skill_id
skill_version
expected_content_sha256
operations
```

The initial profile may bind `changefleet-plan` to planning and `changefleet-execute` to execution.
At dispatch, exactly zero or one Runtime Kit Skill may match the current operation. Repository-native
Skills remain a distinct context layer and are not recorded as selected Runtime Kit Skills merely
because the Provider can discover them.

A changed Skill identity creates a new Agent Profile revision, Run attempt, context decision, and
evidence identity. Host paths are resolution locators and never durable Skill identity.

### 4. Resolve and materialize outside Core authority

ChangeFleet Core does not install, update, or search arbitrary Skill directories. Production
composition supplies an explicit installed-kit root to the Runtime adapter. Before starting the
Provider, the adapter:

1. resolves the operation-selected package below that root;
2. validates its Skill name, version, file containment, and complete content digest;
3. creates a fresh isolated Runtime home;
4. materializes only the selected Skill in the supported discovery location;
5. invokes the selected Skill explicitly;
6. removes the isolated materialization after the attempt.

The canonical kit source may live in this repository's Runtime adapter package during development.
That does not make it a registered Project repository Harness, and it must not be copied into one.

Missing content, digest mismatch, multiple operation matches, an unsafe symlink, or unsupported
provider discovery fails before semantic execution with a typed diagnostic. There is no silent
fallback to another version or to an unselected global Skill.

### 5. Record honest Skill evidence

The Control Contract names the exact Runtime Kit Skill selected for the current operation. Run
evidence records separately:

- requested Skill identity from the Agent Profile;
- resolved version and content digest;
- materialized provider locator and discovery method;
- explicit invocation status;
- provider-observed loaded status when available;
- `unknown` when the stable Provider cannot report actual loading.

Materialized paths and Provider-native ids remain locators. Skill bodies, historical results, and
full provider traces remain outside ordinary Control Contracts and current projections.

### 6. Enforce a small static budget without overstating 70 percent

For the first kit:

- each `SKILL.md`, including frontmatter, is at most 4 KiB;
- each complete Skill directory is at most 8 KiB;
- exactly one Runtime Kit Skill is materialized for one operation;
- no bundled references, scripts, or assets are allowed;
- context evidence records Skill metadata and selected-body bytes as separate components.

The existing 70-percent admission policy still applies. Static bytes prove only the size of
ChangeFleet-owned Skill content. Codex SDK `0.146.0` does not expose every hidden prompt component
or the effective context-window denominator, so the adapter must continue reporting `unknown`
unless it obtains valid `estimated` or `enforced` evidence. This proposal does not authorize a
continuous context guarantee.

### 7. Use conformance evidence, not an Agent ranking

The stage proves that enabled and disabled paths preserve authority and typed outcomes. It may
record the real Provider's available aggregate usage, but it does not claim that the Skill improves
quality, cost, or speed from one sample.

## Implementation Slice

After acceptance, create exactly one Development WorkItem for one end-to-end optional-kit slice:

1. normalize operation-bound Skill descriptors and exact identity;
2. add deterministic package validation, containment, digest, and context-component evidence;
3. create the two minimal Skills using the repository's accepted Skill creation process;
4. materialize and explicitly invoke one selected Skill in the isolated Codex Run environment;
5. prove the existing no-Skill path still passes;
6. run one explicit opt-in real Codex planning and execution flow with the kit enabled;
7. remove experimental production fallbacks and retain only test fixtures with unique deterministic
   coverage.

The stage ends at that proof. It does not continue into review Skills, plugin publication, prompt
optimization, Skill effectiveness ranking, or continuous context enforcement.

## Acceptance Criteria

1. Planning and execution remain valid with `AgentProfile.skills: []`.
2. One profile may select the exact plan and execute Skills, while each Run exposes only the Skill
   matching its operation.
3. Skill name, version, content digest, operation binding, containment, and static size are validated
   before Provider launch.
4. Missing, changed, ambiguous, unsafe, or unsupported Skill materialization fails closed with a
   stable typed diagnostic.
5. No Runtime Kit file is written into a registered checkout, planning worktree, execution
   workspace, Candidate, or ChangeFleet control-state directory.
6. Unselected user-global Runtime Skills are not inherited by the managed Run; exact-base
   repository-native Skills remain a separate allowed layer.
7. The adapter explicitly invokes the selected Skill and records requested, resolved, materialized,
   and observable loaded evidence without inventing unavailable facts.
8. Each Skill and selected directory stays within the accepted static byte limits, and context
   evidence attributes those bytes separately.
9. Control Contracts, repository scope, base SHAs, allowed outcomes, human gates, and Candidate
   identity are unchanged by Skill content.
10. Existing deterministic unit, integration, one-Repository, two-Repository, recovery, and real
    no-Skill Provider behavior remains passing.
11. One explicit opt-in real Codex flow completes planning, execution, Candidate, and Bundle with
    the selected operation Skills.
12. No temporary production fake, prompt-embedding fallback, automatic installer, or repository
    Harness writer remains when the WorkItem enters review.

## Validation

| Gate | Scope |
| --- | --- |
| Skill creator `quick_validate.py` for both Skills | Frontmatter, names, and structural validity |
| Static byte and allowed-file check | Per-Skill and selected-directory budget |
| `npm test` | Agent Profile identity, operation selection, evidence, and context components |
| `npm run test:integration` | Resolution, digest mismatch, containment, isolated discovery, cleanup, and restart |
| `npm run test:acceptance` | Existing no-Skill one- and two-Repository flows |
| Explicit opt-in real Codex Provider gate | Exact plan and execute Skill discovery through CandidateBundle |
| `npm run check` under Node.js 24 | Complete deterministic package gate |
| `git diff --check` and targeted secret, fake, repository-write, eager-context, and comment audit | Repository hygiene and boundary inspection |

The real Provider gate requires an explicit credential and cost decision. A real response consistent
with Skill instructions is behavioral evidence, not proof of a Provider-internal load event unless
the supported interface exposes such an event.

## Risks And Open Questions

- Codex SDK `0.146.0` has no direct Skill parameter. The supported isolated discovery location and
  host-home behavior need a real proof, especially on native Windows.
- Provider-native actual-load telemetry may remain unavailable. Requested, resolved, materialized,
  and explicitly invoked are different facts and must stay separate.
- The current compact prompts already succeed. The kit may improve portability without measurably
  improving one Provider's result.
- A future Claude or other Provider may require a different materializer while preserving the same
  logical Skill identity and evidence boundary.
- Public plugin packaging may later become the correct installation surface, but it should follow
  the managed-Run proof rather than precede it.

## Non-Goals

- A mandatory Runtime Kit.
- One monolithic ChangeFleet workflow Skill.
- Review, recovery, delivery, Linear, or deployment Skills.
- Automatic installation or updating of Skills, plugins, MCP servers, or repository Harness.
- Writing generated Skill files into registered repositories.
- A universal cross-Provider Skill format or catalog.
- Provider routing, App Server migration, or a second real Provider.
- Skill effectiveness ranking, automatic Agent selection, pricing, dashboards, or budgets.
- Continuous 70-percent context enforcement.
- Public plugin publication or marketplace submission.

## Documentation Impact

On acceptance, add one decision for the optional two-Skill Runtime Kit and update the relevant
Agent Profile, context, evidence, Harness, architecture, validation, and current-state contracts.
Create no Development WorkItem until the user accepts this proposal.

## Discussion Update: Prefer Repository-Native Harness

Discussed: 2026-07-31

The user rejected implementation of a ChangeFleet Runtime Skill Kit for the next stage. Managed
Agents should first use the registered project's own provider-native instructions and Skills.
Proposal 0009 discusses the separate exact-base problem created when those project-owned resources
are ignored or untracked. Proposal 0008 grants no implementation authority; optional Runtime Kit
packaging remains a possible later proposal only if repository-native evidence proves a distinct
need.
