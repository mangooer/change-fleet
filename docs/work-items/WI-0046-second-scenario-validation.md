---
artifact_type: development_work_item
id: WI-0046
status: draft
title: Second-scenario validation
source: User accepted Proposal 0032 on 2026-08-14
confirmed_by:
confirmed_at:
standing_policy:
design_proposal: docs/proposals/0032-freeze-operator-surface-and-validate-second-scenario.md
---

# WI-0046: Second-Scenario Validation

## Objective

Run one complete real ChangeSet against a registered repository that is not the ChangeFleet
self-repo and record every observed gap as evidence for the next proposal.

## Context

- Proposal 0032 (Decision 0034) makes second-scenario validation the next implementation objective.
- The self-repo loop proves one scenario with a known Harness and familiar codebase. An unfamiliar
  repository exercises different conventions, optional semantic checks, and possibly an absent
  repository Harness.
- No new product feature is authorized by this slice; it validates the landed baseline as-is.

## Scope

- One human-chosen registered repository (choice required before this draft becomes `todo`).
- One bounded real ChangeSet: create, plan, execute, validate, verify, review, and where available
  PR delivery, through the existing product surfaces.
- Record exact gaps, costs, retries, and recovery observations as WorkItem evidence.

## Non-Goals

- No console, audit, overlay, Provider, or kernel feature work.
- No second Provider, remote workers, multi-tenancy, pricing, or automatic merge.
- No claim that one non-self repository proves product-market fit.

## Acceptance Criteria

- The ChangeSet either completes through its configured review boundary with preserved exact
  evidence, or stops at precisely recorded gaps.
- Each gap records the failing step, observed behavior, and whether it belongs to kernel, console,
  audit, overlay, Provider, or documentation.

## Validation

| Command or gate | Scope | Requirement | Selection reason |
| --- | --- | --- | --- |
| Real ChangeSet run | second scenario end-to-end | Required | This WorkItem is the gate itself |
| Selected deterministic checks | any changed boundary | Conditional | Only if the run surfaces a code defect |

## Current Projection

- Current subject: none.
- Last verified state: none.
- Next step: human chooses the target repository, then this draft becomes `todo` with that choice
  recorded.
- Active blocker or decision: repository choice required.

## Implementation Evidence

To be recorded.

## Project Memory Impact

Observed gaps become the context for the next Repository Design Proposal; the deferred architecture
list stays closed until this evidence exists.
