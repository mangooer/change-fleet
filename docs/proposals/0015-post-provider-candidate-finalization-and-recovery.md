# 0015: Post-Provider Candidate Finalization And Recovery

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-03

Accepted: 2026-08-04

Supersedes:

Depends on: Decisions 0002, 0006, 0009, and 0010; WI-0009 dogfood evidence

Blocks: Recovery of the WI-0009 dogfood ChangeSet until WI-0010 is accepted and landed

Decision: [Decision 0017](../decisions/0017-post-provider-candidate-finalization-and-recovery.md)

Implementation tracking: [WI-0010](../work-items/WI-0010-post-provider-candidate-finalization-and-recovery.md), `done`

## Context

The real `changefleet-wi-0009` execution proved that Provider completion and Candidate readiness are
different durable phases. Execution Run `run-f7d39a4b-2469-46d2-afa7-204cb7328fba` completed with
`implementation_completed` after 1,873,150 ms and reported 7,111,129 aggregate tokens. The control
plane then published clean commit `12a70365a7ab16323cfd24a117779d6ea48ffe12` from exact base
`5f2ad1d771645c28088de8f34715e209b522d30c`, but repository validation could not start
`executable: "npm"` on Windows and failed with `COMMAND_SPAWN_FAILED`.

The current aggregate persists the completed Provider Run and workspace, but does not persist the
published Git subject until repository validation has passed. The commit therefore exists only as
the current HEAD of an owned worktree. `executeChangeSet` cannot resume it: the WorkUnit is `failed`,
the idempotent execution command is terminally failed, and a new dispatch requires the workspace to
still be at the base SHA. Blind retry would either be rejected or require another costly Provider
attempt.

The same dogfood review exposed two related gaps:

- strict argv commands do not currently define how a Windows `.cmd` shim such as `npm.cmd` is
  resolved without accepting an arbitrary shell command string;
- `request_revision` returns the same ChangeSet to planning, and architecture already permits
  “current plan or decision feedback”, but the persisted decision has no bounded feedback for the
  next Runtime projection.

The unaccepted UI commit is reusable evidence, not an accepted Candidate. Read-only review found a
non-reproducible Playwright lockfile, a UI gate that exits zero when Chromium is unavailable, an
inline-bootstrap XSS, missing strict POST field and media-type validation, unsafe error detail
projection, and incomplete browser coverage. Those findings must become explicit revision feedback,
not an out-of-band prompt or a rewrite of the original Run.

## Decision

Introduce a durable post-Provider finalization checkpoint and resume path. Provider work is never
repeated merely because repository or combined validation could not start, was interrupted, or
failed after an exact Git subject had already been published.

After `publishCandidate` and before repository validation, ChangeFleet records one
`CandidateCheckpoint` containing the exact ChangeSet, plan, WorkUnit, Repository, target, base SHA,
candidate SHA, workspace id, workspace locator, changed paths, source Run id, and creation time. A
checkpoint is not a Candidate and is never reviewable or deliverable without passing evidence.

Each repository-validation attempt records immutable evidence even when process spawn fails. The
WorkUnit retains the checkpoint, validation attempt references, and a typed resumable or terminal
failure state. A new idempotent execution command may resume the exact checkpoint, re-run ownership,
HEAD, clean-state, ancestry, and changed-path preflight, then execute the unchanged confirmed check.
It skips Runtime invocation. A passing attempt creates the ordinary Candidate; failed attempts
remain historical evidence.

When every current WorkUnit already has a Candidate, a later execution command may similarly retry
the exact combined validation subject without re-running any Provider. A new Bundle is assembled
only from the current exact Candidates and the latest passing combined evidence.

For pre-checkpoint private-schema records only, add one explicit human recovery command. It accepts
the exact ChangeSet id, plan revision, WorkUnit id, completed source Run id, base SHA, candidate SHA,
and actor. Recovery succeeds only when the persisted completed Run, owned workspace, current clean
HEAD, ancestry, and computed changed paths all match. It records a `legacy_candidate_recovery`
decision before creating the checkpoint. It never guesses a SHA, resets a workspace, adopts dirty
files, or changes a confirmed plan.

Revise the literal Windows no-shell boundary narrowly. Commands remain structured as executable plus
argv and never accept a caller-provided command string. Direct native executables still use
`shell: false`. On Windows only, a resolved `.cmd` or `.bat` executable may use one reviewed,
argv-preserving shim adapter; the requested executable, resolved locator, adapter kind, and effective
invocation are recorded in validation evidence. PowerShell scripts, shell operators, redirection,
pipes, command substitution, and implicit arbitrary shell strings remain unsupported.

Finally, add bounded human revision feedback to `request_revision`. The decision binds the exact
Bundle and contains a required concise summary plus a bounded list of actionable findings. The next
planning and execution projections include only the current feedback summary and finding ids/text;
full review artifacts remain linked evidence outside Runtime context. Reject and accept semantics do
not gain feedback-driven execution authority.

## Boundaries

- A completed Provider Run remains completed even when finalization or validation later fails.
- CandidateCheckpoint is durable implementation state but not Candidate, evidence, Bundle, review,
  delivery, or acceptance authority.
- Resume never invokes a Provider and never changes Repository selection, Harness selection, plan,
  check command, base SHA, candidate SHA, or workspace identity.
- A changed command requires a new confirmed plan revision. Recovery does not smuggle a command
  override into validation.
- Legacy recovery is private-schema repair under an exact human gate. It is not a general import of
  arbitrary commits or workspaces.
- Validation failure evidence may contain host locators as audit data, but locators do not become
  durable Candidate identity or Runtime context.
- The Windows shim adapter resolves one exact executable before launch and records what ran. It does
  not expose a general shell mode in CLI, HTTP, Runtime output, or persisted commands.
- Revision feedback is bounded current control context. Logs, transcripts, diffs, screenshots, and
  raw review payloads remain linked artifacts and are not eagerly injected.
- WI-0009 remains responsible for fixing and validating the console. This proposal does not accept
  commit `12a7036` or its UI behavior.

## Alternatives

### Re-run The Provider From The Base

This uses current public operations but may repeat millions of tokens and minutes after semantic
implementation already completed. It also leaves the same finalization crash window in the product.
Rejected as the default recovery.

### Manually Edit Control JSON Or Reset The Workspace

This can force the current attempt forward but destroys trustworthy idempotency, ownership, and
history. Rejected.

### Cherry-Pick The Commit Directly Into The Development Branch

This preserves code but bypasses the exact ChangeSet Candidate and Bundle path that WI-0009 is meant
to dogfood. It may be used only after explicitly abandoning the dogfood objective, not as hidden
recovery.

### Allow Generic `shell: true`

This launches common package-manager shims but turns structured argv into platform-dependent shell
parsing and expands injection risk. Rejected. The recommended adapter is limited to resolved Windows
batch shims and must prove argv preservation.

### Recommended

Persist CandidateCheckpoint before validation, resume exact deterministic stages without Provider,
support one human-gated legacy recovery, use a narrow audited Windows shim adapter, and carry bounded
request-revision feedback in the same ChangeSet.

## Implementation Slices

1. Add CandidateCheckpoint normalization, persistence, resumable WorkUnit states, immutable failed
   validation evidence, and repository/combined validation resume through a new idempotency key.
2. Add exact legacy recovery for the single pre-checkpoint WI-0009 shape, with no generic commit
   import surface.
3. Add and test the resolved Windows batch-shim adapter while preserving direct native execution on
   other platforms and structured command evidence everywhere.
4. Add bounded request-revision feedback to decisions and current Runtime context projections.
5. Recover `changefleet-wi-0009`, run its unchanged checks, produce an exact Bundle, record the review
   findings as `request_revision`, and let the next confirmed plan fix the UI in the same ChangeSet.

## Acceptance Criteria

- A Provider-completed WorkUnit persists its exact published subject before any repository check.
- Spawn failure, timeout, nonzero exit, output overflow, and postflight mutation each leave bounded
  immutable validation-attempt evidence and do not erase the checkpoint.
- A new execution idempotency key resumes repository or combined validation without a Runtime call.
- Resume rejects changed HEAD, dirty workspace, wrong repository ownership, non-descendant SHA,
  changed paths, stale plan, stale selection, stale Harness, or mismatched source Run.
- Legacy recovery requires an exact human confirmation and records that provenance distinctly from
  an automatically created checkpoint.
- Windows `npm run ...` can be launched through the accepted shim adapter without accepting a shell
  command string; metacharacter argv tests prove values are preserved rather than interpreted.
- Validation evidence distinguishes requested command, resolved executable, adapter, exit result,
  and spawn failure without placing secret environment values in state.
- `request_revision` requires bounded feedback, and only current feedback enters later Runtime
  projections; older decisions remain history references.
- The WI-0009 legacy commit can reach review without another Provider invocation, but is not accepted
  until its separately reviewed blockers are fixed and all selected gates pass.

## Validation

- Domain tests for CandidateCheckpoint identity, states, legacy recovery input, and bounded feedback.
- Integration tests for spawn failure, checkpoint persistence, process restart, exact resume,
  tampered workspace rejection, and combined-validation retry with zero additional Runtime calls.
- Native Windows integration for `npm.cmd`, argv metacharacters, resolved-locator evidence, timeout,
  and cancellation; non-Windows direct-spawn regressions remain selected.
- Runtime-context tests proving only bounded current feedback enters planning/execution and that
  checkpoint, validation output, host locators, and recovery details stay out.
- The recovered WI-0009 exact subject runs `npm run check` and `npm run test:ui`; missing Playwright
  dependency or Chromium must fail rather than report pass.
- `git diff --check`, affected links, proposal/current-state projection, and eager Harness sizes.

## Risks And Open Questions

- The exact pinned Windows shim implementation or dependency must be reviewed during the WorkItem;
  the proposal accepts the behavior and evidence boundary, not an unexamined package.
- Legacy recovery cannot prove what the controller observed before the failed spawn because no
  checkpoint existed. The explicit human gate makes that uncertainty visible rather than inventing
  historical certainty.
- A future remote worker may require a worker-specific command capability contract. This proposal
  only covers the current local worker.

## Non-Goals

- Provider-session resume, in-flight steering, automatic retry policy, retry budgets, or replacing
  Codex SDK with App Server.
- Generic commit import, arbitrary workspace adoption, validation-command override, or shell mode.
- UI controls for execution recovery or request-revision feedback in WI-0009.
- Remote workers, hosted tenancy, deployment recovery, automatic merge, or compensation changes.
- Accepting, delivering, or merging the existing WI-0009 implementation.

## Documentation Impact

Acceptance adds Decision 0017 and updates `SPEC.md`, `docs/architecture.md`,
`docs/validation.md`, `docs/current-state.md`, and the proposal index. Confirmed WI-0010 is the
only implementation prerequisite; WI-0009 recovery does not continue until it is accepted and
landed.
