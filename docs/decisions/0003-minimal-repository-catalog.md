# 0003: Minimal Repository Catalog And Local Materialization

Status: Accepted for initial project bootstrap

Date: 2026-07-29

## Decision

Initial Project configuration contains:

- a stable Project id;
- a free-form Project description;
- explicit Repository ids;
- exactly one locator per Repository;
- optional Repository descriptions;
- optional default target refs;
- mutation authorization.

The initial locator is a local filesystem path. ChangeFleet discovers the Git top-level, common Git
directory, canonical remote when available, and current default ref through read-only inspection.
Every WorkUnit freezes a target ref and base SHA before mutation and runs in an isolated workspace.

Project, service, and module relationships remain natural-language hints in the first product.
ChangeFleet does not require an authoritative service graph or centrally copied repository Harness.

The internal locator boundary must permit a future Git URL implementation without changing
ChangeSet, WorkUnit, Candidate, or review semantics.

## Rationale

Detailed topology configuration is expensive, quickly stale, and duplicates information that a
repository-aware Agent can discover. Deterministic control nevertheless requires explicit
repository allow-listing and exact Git identity.

Local paths provide the shortest path to validating a multi-repository local product and reuse
existing clones and caches. Treating the path as a locator rather than identity avoids blocking a
future remote materializer.

## Consequences

- A logical Project may contain multiple repositories.
- Repository ids, not absolute paths, appear in durable ChangeSet identity.
- Dirty files in the registered checkout are never silently included.
- Repository discovery may be read-only, but registration and mutation require confirmation.
- Agents may propose description or relationship updates; they do not silently change catalog
  authority.
- Git URL cloning, mirrors, remote workers, and shared catalogs require later proposals.
