# 0029: Optional Project Semantic Checks With Mandatory Structural Preflight

Status: Accepted

Date: 2026-08-11

Source: Repository Design Proposal 0027

## Decision

ChangeFleet always performs exact Candidate and Candidate-set structural preflight, while confirmed
Plans may explicitly omit repository or combined semantic commands with a concise selection
rationale. Command-backed validation retains exact identity, bounded attempts, immutable evidence,
and recovery. Commandless validation records structural evidence and its real bounded attempt
without manufacturing a command identity, process budget, or command result.

The first implementation keeps zero-or-one Plan command at each existing slot. Additional focused
commands remain available through the bounded Verification Runtime request protocol. No lifecycle
state is added, and Core does not infer project checks from repository contents or Harness format.

## Rationale

The fixed two-level command shape belonged to the first two-Repository acceptance fixture. Making
it universal creates fake or wasteful checks for simple work and implies a project testing policy
that ChangeFleet does not own. Mandatory structural checks preserve the control-plane boundary;
optional project-selected commands preserve semantic flexibility and honest evidence.

## Consequences

- A missing command is an explicit Plan decision, not an implicit pass.
- CandidateBundle evidence still binds exact repositories and Candidates even when no semantic
  command applies.
- Residual semantic uncertainty remains visible through existing Plan boundaries, verification
  admission, review, or human Gates.
- Decision 0006 remains authoritative for direct invocation, manifest, evidence, and recovery, but
  not for universal command presence.
