---
artifact_type: development_work_item
id: WI-0043
status: done
title: Live run time anchors and browser refresh
source: ChangeFleet local console runtime-visibility follow-up explicitly confirmed by user
confirmed_by: user
confirmed_at: 2026-08-13
standing_policy:
design_proposal: docs/proposals/0031-autonomous-task-conversation-and-operator-inbox.md
---

# WI-0043: Live Run Time Anchors And Browser Refresh

## Objective

Keep the local console's running-task timing legible by projecting stable read-only Run anchors,
refreshing relative times in the browser without new SSE events, and proving the interaction in the
Chromium path.

## Context

- WI-0041 and WI-0042 already moved the local route to one autonomous task conversation with a live
  progress-first panel and read-only activity projection.
- This follow-up stays inside that accepted boundary: it reuses existing Run records and live
  events, adds no Control Store fields, and does not write display timing into Agent context.
- Review feedback on the first Candidate also required `runStore.read` to be an explicit
  `ChangeSetViewService` dependency and asked for the WorkItem/current-state update to land in the
  same Candidate as the code.

## Scope

- Require `ChangeSetViewService` live projections to read the linked Run record directly.
- Keep the local console rendering relative Run elapsed and last-activity times from read-only live
  projection anchors with browser-local ticking during active Runs.
- Preserve timer cleanup across task switches, rerenders, reconnect, and Run completion.
- Extend focused test coverage for the constructor dependency and the Chromium timing-refresh path.
- Update branch-local Harness projection for this completed follow-up.

## Non-Goals

- No new business state, Control Store persistence, or Agent-context timing fields.
- No change to ChangeSet, Run, Bundle, or operator-state lifecycle semantics.
- No broader console redesign beyond the accepted live timing behavior.

## Acceptance Criteria

- While a Run is active, the page clearly shows elapsed Run time and time since last activity.
- Those relative times continue to advance during a quiet SSE window.
- The read-only live projection exposes only the Run start and last-activity anchors needed for the
  browser display.
- `ChangeSetViewService` fails fast when `runStore.read` is unavailable.
- Focused unit, Chromium UI, Harness, and diff checks pass on the final Candidate.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| `node --test test/unit/changeset-view-service.test.js` | live projection dependency and timing anchors | Required | Directly covers the changed application boundary and new constructor guard |
| `npm run test:ui` | local console timer refresh and browser cleanup behavior | Required | Browser path proves quiet-window timing refresh without widening scope to all integration suites |
| `npm run check:harness` | WorkItem and current-state maintenance | Required | Harness docs changed in the same Candidate |
| `git diff --check` | patch hygiene | Required | Repository validation policy requires it for the final handoff |
| `npm run check` | full deterministic suite | Excluded | The final diff stays within one read model, one focused unit file, one browser path, and Harness docs |

The final diff changes no dedicated integration or acceptance test files. Broader deterministic
suites remain unverified beyond the focused unit and selected browser path.

## Current Projection

- Current subject: branch `codex/wi-0041-autonomous-task-conversation`, based on `723e582`.
- Last verified state: the local console already displayed live timing facts and browser-local
  ticking; this follow-up tightens the read-model dependency contract and aligns Harness memory.
- Next step: use this Candidate as the updated branch-local baseline for later autonomous-console
  work.
- Active blocker or decision: none.

## Implementation Evidence

- `node --test test/unit/changeset-view-service.test.js` exited 0: the focused read-model suite
  passed, including the new constructor failure check and the existing live-anchor projection test.
- `npm run test:ui` exited 0: the Chromium path proved the running-task timing facts stayed visible
  and changed during a 3.1-second quiet SSE window.
- `npm run check:harness` exited 0: WorkItem metadata and eager Harness limits remained valid after
  adding WI-0043 and updating `docs/current-state.md`.
- `git diff --check` exited 0: the final patch had no whitespace or conflict-marker defects.

## Project Memory Impact

`docs/current-state.md` now records WI-0043 as the latest completed branch-local follow-up on the
autonomous task conversation branch. No accepted product boundary or open-question set changed.
