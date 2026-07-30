# 0004: Concurrency, Delivery Identity, And Compensation

Status: Accepted for initial project bootstrap

Date: 2026-07-29

## Decision

Repository execution and destination integration use separate coordination boundaries.

- WorkUnits may execute concurrently when their explicit dependency DAG and configured capacity
  permit.
- Publication or integration to a mutable destination is serialized by
  `repository_id + target_ref`.
- A Candidate is permanently bound to its exact base and candidate SHAs.
- Target movement creates integration staleness; it does not rewrite historical Candidate evidence.
- An implicit dependency on another task's mutable branch is invalid. Future stacked ChangeSets must
  reference an exact upstream CandidateBundle.

Cross-repository failure and rollback use saga semantics:

- preserve partial success as fact;
- stop unsafe downstream actions;
- perform only explicitly supported discard, revert, rollout, or compensation;
- require human intervention where no safe compensation exists.

## Rationale

Serializing all work per repository would waste Agent and compute capacity. Allowing unconstrained
integration would attribute evidence to stale targets and create race conditions.

Git can discard or revert repository commits but cannot atomically undo deployments, data
migrations, or external business side effects across repositories.

## Consequences

- Parallel Candidates from the same base are allowed.
- Integration checks may need to be repeated after a target moves.
- New SHA identity requires new evidence binding and normally a new Bundle revision.
- Different target refs are distinct destinations.
- Automatic merge, deployment, production rollback, and stacked ChangeSets are not part of the
  first slice.
