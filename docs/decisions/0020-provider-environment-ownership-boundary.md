# 0020: Provider Environments Are Owned Outside ChangeFleet

Status: Accepted

Date: 2026-08-04

Source: Repository Design Proposal 0018

Supersedes in part: Decision 0019 Runtime Home creation and copy mechanism; Decision 0010 implicit
user-global environment exclusion wording

## Decision

The Agent Runtime or operator owns Provider installation, authentication, native configuration,
Sandbox provisioning, credentials, and runtime-home lifecycle. ChangeFleet does not create, copy,
repair, migrate, reset, or delete Provider operational state.

Local configuration explicitly selects one already prepared Codex environment through a host-only
`runtime.codex_home` locator. The adapter passes that locator to the pinned SDK process and controls
only its accepted operation-scoped session settings. Provider-native configuration in that selected
environment cannot change Repository authority, confirmed plans, exact Git subjects, Candidates,
evidence identity, or human gates.

Provider setup and UAC are external readiness concerns. ChangeFleet does not invoke setup during a
Run or silently switch Sandbox implementations. A failed Provider attempt remains evidence and may
be retried only through the accepted explicit clean exact-base pre-Candidate path.

Decision 0019 remains authoritative for strict blocked outcomes, empty-result rejection, immutable
attempt history, clean-base retry, and non-empty checkpoint resume.

## Rationale

The real Windows gate proved that copying Codex Sandbox state is neither a reliable compatibility
contract nor a safe way to reproduce protected ACLs. Keeping Provider host state outside the
controller matches ChangeFleet's control-plane boundary and the useful Conductor separation between
workspace orchestration and Harness execution.

## Consequences

- WI-0012 removes Runtime Home state roots, copy helpers, Sandbox secret fixtures, and related
  diagnostics while retaining the deterministic controller corrections.
- Selecting an existing user Codex Home is allowed only through explicit host configuration.
- Dedicated isolated Provider environments remain possible when an operator prepares and selects
  them; ChangeFleet does not provision them.
- Native Windows prompts may still originate from Codex. Their absence is not a ChangeFleet
  guarantee, and real execution remains blocked until the selected host environment is healthy.
- Managed installation, WSL, containers, remote workers, hosted credentials, and environment-health
  monitoring require later accepted authority.
