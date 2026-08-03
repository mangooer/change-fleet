# 0015: Deliver Exact Candidates Through Human-Merged GitHub Pull Requests

Status: Accepted

Date: 2026-08-03

Source: Repository Design Proposal 0013

## Decision

GitHub is ChangeFleet's first and only accepted delivery provider. After a human accepts one exact
current `CandidateBundle`, a separate explicit operator application request may publish each
Candidate SHA to a deterministic non-force remote branch and create or recover one GitHub pull
request. A human merges in GitHub; ChangeFleet only publishes, observes, reconciles, and records the
exact external result.

Publication requires a human-confirmed revisioned binding from one registered Repository to a
canonical GitHub `owner/name` and one verified Git push remote. Ambient remotes, Agent output, and
Bundle acceptance do not independently authorize external writes. Git and GitHub credentials stay
host-managed and outside persistent state, artifacts, command output, and Agent context.

The first local implementation uses ordinary Git for exact-SHA push and the authenticated `gh`
executable behind a narrow GitHub pull-request adapter. CLI and a future UI share typed application
operations; neither owns delivery state transitions. The first stage uses explicit refresh and has
no webhook, daemon, GitHub App, or stored token.

ChangeSet delivery progresses from `delivery_ready` through `delivering` to `done`. Per-Repository
records preserve open, merged, closed-unmerged, integration-stale, Candidate-diverged, and failed
outcomes. GitHub PR head must equal the accepted Candidate SHA. Merge, squash, and rebase results
preserve both the reviewed Candidate identity and exact GitHub merge-result identity without
assuming equality.

One Candidate maps to one PR, while one cross-Repository Bundle may map to several PRs. Partial
merge is durable fact: ChangeFleet does not promise atomic integration, automatically roll back an
already merged Repository, or hide unfinished destinations. `done` is derived only after every
selected exact Candidate has a matching observed GitHub merge result.

## Rationale

PR-first delivery follows the useful Conductor boundary of isolated work followed by human review
and merge, while retaining ChangeFleet's stronger exact-subject and multi-Repository recovery
model. Host-managed `gh` authentication closes the first local loop without introducing a service
credential lifecycle. Shared application semantics let a later local API and UI reuse the same
authority instead of invoking or duplicating the CLI.

## Consequences

- One confirmed Development WorkItem may implement the complete first GitHub delivery slice.
- The implementation must persist stable delivery requests and recover ambiguous external writes
  idempotently across restart.
- Target movement, PR-head divergence, closed PRs, partial merge, and provider failure remain
  explicit rather than being normalized into generic success or failure.
- Real GitHub validation needs explicit repository, branch namespace, PR, and cleanup authority;
  prior authorization for real Codex tests does not grant external GitHub writes.
- GitLab, automatic merge, merge queues, GitHub App, webhook, deployment, UI, App Server, remote
  workers, and hosted multi-tenancy remain deferred.
