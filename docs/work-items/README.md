# Development WorkItems

These files govern implementation work in the ChangeFleet repository itself. They are repository
Harness artifacts, not ChangeFleet Runtime `WorkUnit` records and not files written into registered
user repositories.

A Development WorkItem defines accepted implementation demand and provides one compact current
workpad. A discussion, Repository Design Proposal, or Agent suggestion is not executable merely
because it exists.

## Creation And Authorization

The Agent receiving a request decides whether a WorkItem is needed:

- explanation, review, diagnosis, status, and design discussion do not create one;
- small explicitly requested maintenance normally relies on the request and Git diff;
- durable implementation creates or resumes one WorkItem.

The Agent may generate a `draft`. It may set `todo` directly only when an explicit user
implementation request unambiguously confirms objective, scope, accepted authority, and acceptance
boundary, or when a named standing policy authorizes the exact low-risk class.

Otherwise the Agent presents the draft and asks for confirmation. It cannot confirm its own inferred
scope expansion, architecture change, or high-risk action.

## Required Fields

Every WorkItem must include:

- stable id;
- status;
- title;
- source or confirmation;
- objective;
- context;
- scope;
- non-goals;
- acceptance criteria;
- validation;
- current projection and next step;
- relevant proposal or decision references.

## Status

Use:

- `draft`: proposed envelope with no implementation authority;
- `todo`: confirmed and ready to start;
- `in_progress`: executing under the recorded confirmation;
- `review`: implementation complete enough for the required review;
- `blocked`: authorized work cannot safely continue;
- `done`: accepted completion;
- `canceled`: authorization withdrawn or demand removed.

The transition from `draft` to `todo` grants implementation authority and must identify the
confirming user request or standing policy. Later states retain that recorded authority; they do
not require a new confirmation unless scope changes.

## Evidence

Replace the current projection in place as work advances. Preserve decisions and exact evidence,
but do not append a narrative entry for every turn, retry, or progress update.

Keep concise commands, exit codes, Candidate SHAs, review findings, and unresolved boundaries in
the WorkItem implementation record. Put full output, large diffs, transcripts, and repeated Run
events in linked artifacts. Do not expand the WorkItem or `docs/current-state.md` into a Run log.

Use [`TEMPLATE.md`](TEMPLATE.md) when creating a WorkItem.
