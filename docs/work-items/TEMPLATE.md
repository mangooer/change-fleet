---
artifact_type: development_work_item
id: WI-NNNN
status: draft
title: Development WorkItem title
source:
confirmed_by:
confirmed_at:
standing_policy:
design_proposal:
---

# WI-NNNN: Development WorkItem Title

## Objective

State the concrete outcome.

## Context

Include only facts needed to execute and review this work. Link to accepted authority rather than
copying large documents.

## Scope

- In-scope boundary.

## Non-Goals

- Explicitly excluded adjacent work.

## Acceptance Criteria

- Observable criterion.

## Validation

Select the smallest gates that cover the accepted scope and final diff. Record broader gates as
conditional or excluded instead of silently omitting them.

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| To be selected | Changed behavior | Required / conditional / excluded | Why this scope is sufficient |

Every changed test file must execute. State which broader suites remain unverified and why. Full
`npm run check` is required only when `docs/validation.md` triggers it or accepted authority names
it explicitly.

## Current Projection

- Current subject:
- Last verified state:
- Next step:
- Active blocker or decision:

Replace this projection as work advances. Do not append one entry per Agent turn.

## Implementation Evidence

Record exact commands, exit codes, concise observations, Candidate identity, and unverified
boundaries. Link large output, transcripts, and repeated events instead of copying them here.

## Project Memory Impact

State whether the accepted change alters current baseline, accepted unfinished work, open
questions, limitations, or next recommended work.
