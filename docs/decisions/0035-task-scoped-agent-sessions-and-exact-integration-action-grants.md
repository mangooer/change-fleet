# 0035: Task-Scoped Agent Sessions And Exact Integration Action Grants

Status: Accepted

Date: 2026-08-17

Source: Repository Design Proposal 0033

Revises: Decisions 0015, 0025, 0030, and 0033; makes one narrow kernel-projection exception to
Decision 0034

## Decision

One ChangeSet and its one TaskWorkspace remain the sole business-task and workspace authority.
ChangeFleet adds a durable logical AgentSession inside that TaskWorkspace for revisioned
AgentProfile assignment, allowed Run purposes, Run lineage, and replaceable Provider-session
locators. AgentSession owns no separate lifecycle, Plan, workspace, Candidate, Bundle, budget, or
authority. Runtime-native subagents remain internal to their parent Run.

Run routing is no longer limited to a fixed named-role pipeline. Existing typed Run purposes retain
their authority boundaries, and integration is added to the common Run lifecycle for one
post-review action. Plan-confirmed autonomy still ends at Bundle review. An integration Run
requires a separate immutable human ActionGrant compiled from one exact Core-offered envelope.

Each ActionGrant binds the accepted Bundle, Repository and Candidate SHAs, destination and observed
destination SHA, one closed action kind, one AgentSession and AgentProfile, permission mode,
attempts, expiry, idempotency, preflight, result observer, and human actor. Agents cannot grant,
broaden, renew, or accept authority, and their output is never result evidence by itself. Core
revalidates every bound subject and independently observes the result before admitting it.

The initial Runtime-executed actions are limited to non-force publication of one exact Candidate to
one named non-target remote ref and one explicitly granted non-force fast-forward of a target from
its observed base to that exact Candidate. Target movement, divergence, changed identity, or an
unobservable result fails closed. Existing Core-owned GitHub pull-request delivery remains valid.

After exact Bundle acceptance, a human may instead choose
complete_without_managed_integration. That decision binds the Bundle and unintegrated Candidates
and produces terminal(done) with reason accepted_without_managed_integration. It never claims
publication, merge, or integration. A human statement about an external merge remains input until
a supported observer records exact integration evidence.

ChangeFleet enforces authoritative result admission and records the effective Runtime permission
mode. It does not claim that host-user execution confines ambient host or network side effects.
Credentials remain host-managed and outside persistent state and ordinary context.

Decision 0034's general console, audit-presentation, and Harness-overlay freezes remain. Only the
minimum existing-surface projection of AgentSession, ActionGrant, integration Run, exact evidence,
and completion reason is allowed.

## Rationale

WI-0046 proved that a valid accepted Bundle can remain permanently in review when its repository
has no supported GitHub binding. Adding one ChangeFleet adapter and fixed stage for every provider
would grow the replaceable surface, while generic Agent external-write authority would discard
exact scope and evidence. Task-scoped sessions plus exact human grants preserve ChangeFleet's
durable authorization, identity, observation, and recovery value while letting improving Runtimes
perform narrowly bounded integration actions.

## Consequences

- WI-0047 owns one end-to-end implementation slice.
- AgentSession is stable logical routing state; Provider conversation ids remain locators.
- Integration adds no ChangeSet or WorkUnit phase and has no Plan-derived autonomous authority.
- Candidate change or destination movement invalidates the grant and its evidence identity.
- Publication and target integration remain serialized by Repository and target ref.
- Partial multi-Repository results remain facts; no atomic integration or automatic compensation is
  claimed.
- Candidate lanes, generic Agent graphs, merge commits, squash, rebase, force push, automatic merge,
  deployment, remote workers, and hosted multi-tenancy remain outside the accepted boundary.
