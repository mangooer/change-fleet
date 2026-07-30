# Decision Index

These records contain durable architectural decisions and rationale. `SPEC.md` owns the current
accepted product contract, while `docs/current-state.md` owns the concise implementation
projection.

| Decision | Topic | Status |
| --- | --- | --- |
| [0001](0001-control-plane-boundary.md) | Agent Runtime and deterministic control-plane ownership | Accepted for initial bootstrap |
| [0002](0002-changeset-and-bundle-aggregate.md) | ChangeSet aggregate and CandidateBundle review identity | Accepted for initial bootstrap |
| [0003](0003-minimal-repository-catalog.md) | Minimal Project catalog and local Repository materialization | Accepted for initial bootstrap |
| [0004](0004-concurrency-delivery-and-compensation.md) | Parallel execution, delivery serialization, and compensation | Accepted for initial bootstrap |
| [0005](0005-runtime-context-harness-and-capabilities.md) | Runtime context projection, Harness ownership, Agent Profiles, and capability dispatch | Accepted |
| [0006](0006-first-vertical-slice-implementation-boundary.md) | First local two-repository implementation stack, store, ports, validation, and reuse boundary | Accepted |

Changing one of these boundaries requires a proposal. When a decision is superseded, preserve this
record and point to the later accepted authority.
