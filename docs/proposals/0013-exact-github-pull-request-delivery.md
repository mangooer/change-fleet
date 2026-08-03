# 0013: Exact GitHub Pull Request Delivery And Human-Controlled Integration

Artifact type: Repository Design Proposal

Decision status: Accepted

Proposed: 2026-08-03

Accepted: 2026-08-03

Supersedes:

Depends on: Decisions 0002, 0004, 0008, and 0014; WI-0007 `done`

Blocks: One Development WorkItem for the first GitHub delivery vertical slice

Decision: [Decision 0015](../decisions/0015-exact-github-pull-request-delivery.md)

Implementation tracking:
[WI-0008](../work-items/WI-0008-exact-github-pull-request-delivery.md), `done`

## Context

The landed local lifecycle produces and accepts one exact `CandidateBundle`, then stops in
`delivery_ready`. `DeliveryTarget` already permits an external pull-request subject, destination
operations are serialized by `repository_id + target_ref`, and Proposal 0012 established shared
application operations behind the experimental CLI. Pull-request publication, merge observation,
and delivery audit nevertheless remain explicitly unimplemented.

The user selected GitHub as the first delivery provider so that ChangeFleet can close one real
delivery loop before adding a small UI. Once that loop is proven, a separately governed UI change
should be implementable through ChangeFleet itself. The current repository's GitHub `origin` makes
that future dogfood path possible, but an ambient remote does not itself grant delivery authority.

This proposal distinguishes three subjects that must never be collapsed:

- the immutable Candidate SHA reviewed inside a `CandidateBundle`;
- the GitHub pull request used for human integration;
- the exact Git result produced by GitHub merge, squash, or rebase.

## External Reference Evidence

Accessed 2026-08-03:

- [Conductor workflow](https://www.conductor.build/docs/concepts/workflow) and
  [review and merge](https://www.conductor.build/docs/guides/review-and-merge) document a workflow
  in which an isolated workspace and branch lead to diff and check review, pull-request creation,
  human-controlled merge, and eventual workspace archival.
- [GitHub's pull-request REST documentation](https://docs.github.com/en/rest/pulls/pulls) documents
  explicit head and base subjects, merged-state queries, exact-head merge preconditions, and the
  differing meaning of `merge_commit_sha` across merge methods.
- [GitHub's check-run REST documentation](https://docs.github.com/en/rest/checks/runs) permits
  check observations for an exact commit ref or SHA.
- [`gh pr create`](https://cli.github.com/manual/gh_pr_create) and
  [`gh pr view`](https://cli.github.com/manual/gh_pr_view) provide a local authenticated process
  surface and structured fields including head and base OIDs, review, checks, and merge state.
- [GitHub merge-method documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github)
  documents repository-controlled merge commit, squash, and rebase methods.

The ChangeFleet design below is an inference and product choice informed by those sources. It is
not a claim that Conductor implements ChangeFleet's cross-repository Bundle, exact evidence, or
recovery semantics.

## Decision

If accepted, introduce a **GitHub-only, pull-request-first delivery vertical slice**. ChangeFleet
publishes each accepted repository Candidate to one exact remote branch, creates or recovers one
GitHub pull request, observes its state, and records the exact external merge result. A human merges
through GitHub. ChangeFleet does not merge, enable automatic merge, or grant an Agent Runtime
delivery authority in this stage.

The first local adapter uses ordinary Git for push and the authenticated `gh` executable for GitHub
pull-request creation and structured reads. It sits behind narrow application and provider ports;
the CLI does not contain delivery rules, and a future UI must call the same application operations
through a future transport rather than execute the CLI parser.

Add one aggregate lifecycle state:

```text
delivery_ready -> delivering -> done
```

Repository delivery records expose more precise current states:

```text
pending
publishing
open
merged
closed_unmerged
integration_stale
candidate_diverged
failed
```

`done` means every selected repository has an observed exact GitHub merge result for the accepted
Candidate subject. It does not mean the resulting target SHA equals the Candidate SHA, that every
check passed, or that several repositories were integrated atomically.

## Authority And Capability Boundary

CandidateBundle acceptance and delivery publication are separate human actions.

- Bundle acceptance authorizes the reviewed exact subject to become delivery-ready.
- An explicit operator `publish` application request authorizes GitHub publication. It is the
  operational gate; another generic confirmation artifact is not required.
- The authenticated ChangeFleet host owns Git and GitHub credentials. Credentials are not persisted
  in Project configuration, ChangeSet state, artifacts, output, prompts, or Agent context.
- Agent Runtimes cannot configure GitHub bindings, push remote refs, create or mutate pull requests,
  or merge them. They may propose delivery text as non-authoritative output.
- A human performs the merge through GitHub. A future separately accepted control operation may
  expose merge, but this proposal does not.

The installed CLI may expose accepted delivery operations, but the reusable authority boundary is
the application operation from Decision 0014. Delivery internals, raw Git commands, raw `gh`
commands, stores, and reconciliation helpers are not operator commands.

## Explicit GitHub Repository Binding

Publication must use one human-confirmed, revisioned repository binding rather than infer authority
from an arbitrary `origin`:

```yaml
provider: github
github_repository: mangooer/change-fleet
push_remote: origin
```

The durable binding contains only:

- ChangeFleet `repository_id`;
- the fixed provider discriminator `github`;
- canonical GitHub `owner/name`;
- one registered Git push remote name and its verified normalized remote identity;
- binding revision and human confirmation evidence.

The ChangeSet's accepted Repository selection continues to own `target_ref`; the binding does not
silently override it. Publication freezes the exact binding revision into the delivery record.
Changing owner, repository, remote, or provider after publication requires a new explicit decision
and never redirects an existing request.

This is not a generic source-control-provider framework. The persisted record may carry
`provider: github` so future migrations remain intelligible, but this stage adds no provider
registry, GitLab adapter, plug-in discovery, or common least-capability abstraction.

## Durable Delivery Subjects

Add one stable ChangeFleet-owned delivery request per:

```text
CandidateBundle revision + repository_id + target_ref
```

The request records at least:

- stable `delivery_request_id` and caller idempotency key;
- ChangeSet, plan, Bundle, Repository, and binding revisions;
- exact Candidate SHA and Candidate base SHA;
- exact target ref and target SHA observed at publication;
- deterministic ChangeFleet-owned remote branch name;
- GitHub repository, pull-request number, URL, and provider locator after creation;
- current bounded state and links to immutable observations.

Large GitHub responses, check detail, command output, and diagnostic logs remain linked artifacts.
Aggregate state retains bounded identities and summaries only, and delivery audit is not admitted to
Agent context by default.

Each refresh creates or links an immutable observation containing the exact available subjects:

- PR head and base OIDs;
- open, closed, or merged state;
- mergeability, review decision, and status-check summary when reported;
- observation time and provider response identity;
- merged actor, merged time, and GitHub merge result SHA when merged.

Final delivery evidence maps the reviewed Candidate SHA to the exact GitHub result. GitHub merge,
squash, and rebase may produce different target commits, so ChangeFleet must not assert
`delivered_sha == candidate_sha`. The final record preserves both identities and verifies that the
reported merge result is reachable from the target ref when the local remote permits that check.

## Publication Workflow

For each current Candidate in the accepted Bundle, the `publish` operation:

1. verifies that the Bundle revision is current, accepted, and still delivery-ready;
2. resolves the exact confirmed GitHub binding and target ref;
3. acquires the destination operation lease for `repository_id + target_ref`;
4. fetches and verifies the current target SHA;
5. rejects publication as `integration_stale` when the target moved from the accepted delivery
   subject; refresh, affected validation, and possibly a new CandidateBundle are required;
6. mechanically revalidates that the Candidate SHA and workspace identity are unchanged;
7. pushes that exact SHA to a deterministic ChangeFleet branch without force;
8. creates the GitHub pull request with explicit head and base, or recovers the exact existing PR;
9. immediately reads the normalized PR identity and verifies that its head equals the Candidate;
10. persists the result before releasing the destination operation lease.

A suggested branch shape is:

```text
changefleet/<change-set-id>/<repository-id>/<bundle-revision>
```

The implementation may normalize lengths and Git-invalid characters, but the branch must remain
deterministically derivable from stable ids. If the branch already points at the exact Candidate,
retry continues idempotently. If it points elsewhere, ChangeFleet reports
`candidate_diverged`; it never force-pushes or silently selects another branch.

The destination lease protects each publication, refresh-finalization, or other target-sensitive
critical section. It is not held for the entire human review period. Several PRs may therefore be
open against one target; when one merge moves that target, other requests expose stale integration
evidence on their next refresh.

Pull-request title and body may include bounded operator input plus deterministic ChangeSet, Bundle,
Candidate, and evidence links. Text does not grant authority and cannot replace the exact ids.

## Refresh, Merge, And Divergence

The first stage uses explicit foreground refresh from CLI or application code. It has no webhook,
daemon, background poller, or subscription service.

Refresh must verify the PR locator and exact head before interpreting external state:

```text
github_head_sha == accepted_candidate_sha
```

Outcomes are handled as follows:

- An exact open PR remains `open`; current review, mergeability, and check summaries are projected.
- Movement of only the target branch invalidates earlier integration observations. The Candidate
  remains the reviewed subject, but current integration evidence must be refreshed before the UI or
  CLI describes it as current.
- Clicking GitHub's update-branch behavior, rebasing, amending, or any other source-branch mutation
  changes the PR head. The request becomes `candidate_diverged` and cannot deliver the accepted
  Bundle without a new exact Candidate and review decision.
- A PR closed without merge becomes `closed_unmerged`. It may be reopened, retried when identity is
  still exact, revised, or canceled by a later explicit decision; it is not silently recreated.
- Transient Git, process, network, or GitHub failures record a failed attempt but preserve the
  stable request for an idempotent retry.
- An exact-head merged PR becomes `merged` even if a check was failed or bypassed. Merge is an
  external fact that cannot be hidden; check and review observations remain audit evidence.
- A merged PR whose head differs from the accepted Candidate records the external divergence and
  routes the ChangeSet to `decision_required`. It must not be reported as successful delivery of
  the accepted Bundle.

The application records the exact merge method or provider evidence when available, the GitHub
merge result SHA, actor, time, and target reachability observation. It does not assume that a late
read of the mutable target ref is the immediate post-merge SHA; subsequent target movement remains
separate history.

## Multi-Repository Completion And Recovery

One Candidate maps to one GitHub pull request. One CandidateBundle may therefore map to multiple
pull requests.

The ChangeSet remains `delivering` until every selected Repository delivery record is `merged` for
the exact accepted Candidate. A partial outcome is represented directly:

```text
repository-a -> merged
repository-b -> open | closed_unmerged | integration_stale | failed
```

ChangeFleet preserves completed external writes and resumes only unfinished or recoverable work. It
does not roll back an already merged repository automatically, claim universal atomicity, or erase
the partial result. An operator may retry the remaining delivery, revise the same ChangeSet when
the exact subject can be replaced safely, or create an explicit compensation ChangeSet.

Process restart reloads stable delivery request ids, persisted provider locators, and the last
observation. Reconciliation queries GitHub before retrying any create operation. It must not create
duplicate pull requests merely because a process stopped after the external write but before local
result persistence.

Remote source-branch deletion is not automatic in this slice. PR and delivery identities remain
durable even if a human or repository policy later removes the branch.

## Shared Application Operations And Future UI

The first slice adds narrow typed application semantics, with exact names finalized by its
WorkItem, equivalent to:

| Operation | Purpose |
| --- | --- |
| `configureGitHubDelivery` | Confirm or revise one Repository's explicit GitHub binding |
| `publishDelivery` | Publish the current accepted Bundle through stable idempotent requests |
| `readDelivery` | Read bounded current and per-Repository delivery projections |
| `refreshDelivery` | Reconcile exact GitHub PR, checks, and merge outcomes |

The experimental CLI may map these operations to terminal commands. A future local API or App
Server maps the same requests and typed results to a transport. A future UI calls that transport;
it does not spawn the CLI or reproduce binding, publication, reconciliation, completion, or
divergence rules.

The first UI should remain a separate proposal and initially provide only:

- ChangeSet, Bundle, and per-Repository delivery views;
- publish and refresh actions through shared operations;
- exact PR, Candidate, checks, and merge-result summaries;
- navigation to GitHub for review and human merge;
- visible partial-delivery, stale, divergence, and retry states.

It should not initially provide a merge button.

## ChangeFleet Self-Iteration Path

After this proposal is accepted and its implementation WorkItem lands, a separately accepted UI
Proposal and Development WorkItem may become the first substantial dogfood demand:

1. the repository Harness owns and confirms the UI Proposal and Development WorkItem;
2. a ChangeFleet Runtime ChangeSet references that demand without becoming its authority store;
3. ChangeFleet plans and executes the UI change against the registered ChangeFleet repository;
4. this delivery slice publishes the exact Candidate to GitHub;
5. a human reviews and merges the PR in GitHub;
6. ChangeFleet refreshes the result and reaches `done`.

Repository Design Proposal, Development WorkItem, Runtime ChangeSet, and GitHub pull request remain
four distinct identities throughout that self-iteration.

## Alternatives

### Publish a PR and require manual completion entry

This minimizes GitHub reads but cannot reliably distinguish open, closed, merged, changed-head, or
partially delivered outcomes. It would make UI state and delivery audit depend on duplicate human
entry. Reject it.

### Let ChangeFleet merge the pull request

This would shorten interaction but introduces merge authority, branch protection, merge queues,
repository policy, and higher-risk credentials before publication and reconciliation are proven.
Defer it to a separate proposal.

### Use the GitHub REST API and stored token immediately

A direct API client may later be appropriate for a service, but the first local slice would need
credential lifecycle and secret configuration prematurely. Prefer host-managed `gh` authentication
behind the adapter. Do not preclude a later adapter-internal transport replacement.

### Start with a GitHub App and webhooks

This is a stronger basis for hosted, multi-user, event-driven operation, but requires installation,
callback, tenant, secret, delivery, and replay semantics. Defer it until a persistent service and
hosted authority are accepted.

### Build GitHub and GitLab together

This would force a generalized provider model before one complete delivery path is observed. Add
no GitLab or generic SCM framework in this stage.

### Put the UI in the same proposal

This mixes exact delivery semantics with service lifetime, HTTP authorization, event transport,
and presentation. Close and dogfood the GitHub loop first; govern the smallest useful UI
separately.

## First Implementation Stage

After acceptance, create exactly one confirmed Development WorkItem for one end-to-end GitHub
delivery slice:

1. add the explicit GitHub Repository binding and human revision path;
2. add durable delivery request, observation references, state transitions, and restart recovery;
3. implement exact, non-force Git publication and target-movement checks;
4. implement one narrow `gh` pull-request adapter with structured process arguments and JSON reads;
5. expose publish, read, and refresh through shared application operations and the experimental
   CLI;
6. derive bounded delivery audit without admitting it to default Runtime context;
7. cover single- and multi-Repository completion, idempotency, partial merge, changed target,
   changed PR head, closed PR, process loss, and typed external failure;
8. retain deterministic GitHub process fixtures only in test support, with no production fake or
   user-selectable fake provider;
9. run a real GitHub external-write validation only against an explicitly authorized repository,
   branch namespace, and cleanup policy.

The WorkItem must not add a UI, HTTP server, stable public CLI promise, provider framework, or merge
operation.

## Acceptance Criteria

1. Only an accepted current CandidateBundle can be published.
2. Publication requires one explicit human-confirmed GitHub Repository binding and one explicit
   operator request; ambient remotes and Agent output cannot authorize it.
3. One stable delivery request binds the exact Bundle revision, Repository, Candidate SHA, target
   ref, binding revision, branch, and GitHub PR identity.
4. Exact target movement is detected before publication and never inherits old evidence silently.
5. Candidate publication uses a deterministic branch, never force-pushes, and is idempotent across
   retry and controller restart.
6. PR creation and recovery always verify that the GitHub head equals the accepted Candidate SHA.
7. Closed-unmerged, target-moved, changed-head, transient-failure, exact-merged, and externally
   divergent outcomes remain distinct and recoverable where possible.
8. Merge, squash, and rebase results preserve both reviewed Candidate and exact GitHub result
   identities without asserting SHA equality.
9. One merged repository does not hide another open or failed delivery; cross-repository completion
   never claims atomicity or automatic rollback.
10. ChangeSet `done` is derived only after every selected exact Candidate has a recorded matching
    GitHub merge result.
11. GitHub checks and reviews are bounded external observations bound to reported exact subjects;
    failed or bypassed evidence is not erased after an external merge.
12. GitHub credentials remain host-managed and absent from persistent state, artifacts, output,
    test fixtures, and Runtime context.
13. Agent Runtimes cannot push, create or mutate PRs, configure bindings, or merge through the
    ChangeFleet capability surface.
14. CLI commands delegate to shared application operations; a future UI can reuse those semantics
    without invoking the CLI parser.
15. No GitLab, automatic merge, merge queue, webhook, GitHub App, deployment, remote worker, UI, or
    App Server is introduced.

## Validation

| Gate | Scope |
| --- | --- |
| Delivery model and application unit tests | identities, states, authorization, idempotency, exact-head and target rules |
| Deterministic GitHub adapter fixture | argument safety, JSON normalization, typed auth/network/provider failures, no production fake |
| Real-Git integration | exact-SHA push, non-force conflict, target movement, destination lease, branch identity |
| Store and restart integration | external-write ambiguity, PR recovery, observation append, duplicate prevention |
| Single-Repository acceptance | accepted Bundle through publish, open, exact merge observation, and `done` |
| Multi-Repository acceptance | independent PRs, partial merge, retry, and aggregate completion |
| CLI regression | shared operation delegation, structured results, typed failures, existing lifecycle preservation |
| Real GitHub gate | conditional external write with separately confirmed repository and cleanup authority |
| Documentation maintenance | `git diff --check`, affected links and authority projections, eager Harness size inspection |

Final validation selection follows `docs/validation.md` and the actual implementation diff. Test
fixtures that provide ongoing deterministic provider coverage are maintained test infrastructure,
not temporary scaffolding; any temporary setup or migration command must still be removed before
WorkItem acceptance.

## Risks And Open Questions

- Local `gh` authentication is appropriate for the first local UI path but not a hosted or
  multi-user credential model. Moving to GitHub App authority requires a later proposal.
- Git push and `gh` authentication may be configured differently on a host. Readiness checks must
  diagnose both without printing secrets or silently changing host credentials.
- GitHub fields and check rollups can change while a PR is open. Every observation needs an exact
  timestamp and subject; a projection is not immutable evidence merely because it was once read.
- Repository branch protection may allow an administrator to bypass checks. ChangeFleet records the
  resulting merge fact and evidence honestly rather than rewriting history as successful checks.
- A target may move after a PR is merged and before refresh. Provider merge identity and target
  reachability must be recorded separately from the later mutable target head.
- Real GitHub validation creates externally visible state and cannot inherit the standing real
  Codex test authorization. Its repository, branch namespace, PR behavior, and cleanup need
  explicit WorkItem-time authority.

## Non-Goals

- GitLab merge requests or a generic source-control-provider framework.
- Automatic merge, merge queue control, or a ChangeFleet merge button.
- GitHub App installation, OAuth, webhook receipt, daemon polling, or hosted credentials.
- Deployment, rollout, release, automatic rollback, or cross-repository atomic integration.
- Pull-request comment ingestion, Agent review loops, issue synchronization, or Linear projection.
- Remote repository materialization, remote workers, or hosted multi-tenancy.
- Automatic source-branch deletion or organization-wide GitHub policy management.
- A browser, desktop UI, HTTP API, App Server, generated client, or stable CLI contract.
- Admission of delivery audit, GitHub payloads, or credentials into default Agent context.

## Documentation Impact

If accepted:

- record one decision for GitHub-first PR publication, human-controlled merge, exact reconciliation,
  and shared UI-ready application semantics;
- revise `SPEC.md` with delivery request, exact external result, `delivering`, divergence, and
  completion semantics;
- revise `docs/architecture.md` with the DeliveryCoordinator application and GitHub adapter
  boundaries;
- revise `docs/validation.md` with deterministic provider, real-Git, restart, target-movement, and
  conditional external-write gates;
- update `docs/current-state.md` without describing implementation as landed;
- create exactly one confirmed Development WorkItem before implementation.
