import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createCheckIdentity,
  createVerificationAdmissionDecision,
  normalizeValidationAttemptBudgetRequests,
  normalizeVerificationPolicy,
  resolveValidationAttemptBudget,
} from "../../src/domain/verification.js";

const command = {
  command_id: "api-check",
  executable: "node",
  argv: ["check.mjs"],
  coverage_rationale: "Covers the changed API contract",
  timeout_ms: 1_000,
};

describe("deterministic verification admission", () => {
  test("takes the basic fast path only when policy, Plan, and exact paths allow it", () => {
    const decision = createVerificationAdmissionDecision({
      checkpointId: "checkpoint-1",
      projectPolicy: {
        minimum_mode: "basic",
        default_attempt_timeout_ms: 1_000,
        max_attempt_timeout_ms: 10_000,
        escalation_triggers: ["scope_divergence"],
      },
      planExpectation: {
        mode: "basic",
        rationale: "Only a bounded deterministic hygiene change is expected.",
        escalation_triggers: ["scope_divergence"],
      },
      sourceReportedChangedPaths: ["docs/a.md"],
      actualChangedPaths: ["docs/a.md"],
      unverifiedBoundaries: [],
      createdAt: "2026-08-06T00:00:00.000Z",
    });

    assert.equal(decision.mode, "basic");
    assert.equal(decision.facts.scope_divergence, false);
    assert.deepEqual(
      decision.reasons.map((reason) => reason.code),
      ["project_minimum", "plan_expectation"],
    );
  });

  test("raises admission for hard policy, operator choice, and deterministic escalation", () => {
    const projectRaised = createDecision({
      projectMode: "deterministic",
      planMode: "basic",
    });
    assert.equal(projectRaised.mode, "deterministic");

    const operatorRaised = createDecision({
      projectMode: "basic",
      planMode: "basic",
      operatorMode: "independent_review",
    });
    assert.equal(operatorRaised.mode, "independent_review");

    const diverged = createDecision({
      projectMode: "basic",
      planMode: "basic",
      reportedPaths: ["src/a.js"],
      actualPaths: ["src/a.js", "test/a.test.js"],
    });
    assert.equal(diverged.mode, "independent_review");
    assert.equal(diverged.facts.scope_divergence, true);
  });
});

describe("validation attempt budgets", () => {
  test("keeps timeout outside check identity and records an authorized override", () => {
    const first = createCheckIdentity(command);
    const second = createCheckIdentity({ ...command, timeout_ms: 5_000 });
    assert.equal(first.check_identity_hash, second.check_identity_hash);

    const request = normalizeValidationAttemptBudgetRequests([
      {
        kind: "repository_validation",
        work_unit_id: "api-unit",
        command_id: "api-check",
        timeout_ms: 5_000,
      },
    ])[0];
    const budget = resolveValidationAttemptBudget({
      command,
      projectPolicy: {
        default_attempt_timeout_ms: 2_000,
        max_attempt_timeout_ms: 10_000,
      },
      request,
    });
    assert.deepEqual(budget.requested, { timeout_ms: 5_000 });
    assert.deepEqual(budget.effective, { timeout_ms: 5_000 });
    assert.equal(budget.source, "operator");
  });

  test("rejects duplicate selectors and timeouts above the frozen Project maximum", () => {
    assert.throws(
      () =>
        normalizeValidationAttemptBudgetRequests([
          {
            kind: "combined_validation",
            work_unit_id: null,
            command_id: "combined-check",
            timeout_ms: 1_000,
          },
          {
            kind: "combined_validation",
            work_unit_id: null,
            command_id: "combined-check",
            timeout_ms: 2_000,
          },
        ]),
      { code: "INVALID_VALIDATION_ATTEMPT_BUDGET" },
    );
    assert.throws(
      () =>
        resolveValidationAttemptBudget({
          command,
          projectPolicy: {
            default_attempt_timeout_ms: 1_000,
            max_attempt_timeout_ms: 2_000,
          },
          request: { timeout_ms: 2_001 },
        }),
      { code: "VALIDATION_ATTEMPT_BUDGET_EXCEEDED" },
    );
  });

  test("normalizes a minimal Project policy without adding semantic check rules", () => {
    assert.deepEqual(normalizeVerificationPolicy(), {
      minimum_mode: "basic",
      default_attempt_timeout_ms: 120_000,
      max_attempt_timeout_ms: 600_000,
      escalation_triggers: ["scope_divergence"],
    });
  });
});

function createDecision({
  projectMode,
  planMode,
  operatorMode = null,
  reportedPaths = ["src/a.js"],
  actualPaths = ["src/a.js"],
}) {
  return createVerificationAdmissionDecision({
    checkpointId: "checkpoint-1",
    projectPolicy: {
      minimum_mode: projectMode,
      escalation_triggers: ["scope_divergence"],
    },
    planExpectation: {
      mode: planMode,
      rationale: "Bounded test expectation",
      escalation_triggers: ["scope_divergence"],
    },
    operatorMode,
    sourceReportedChangedPaths: reportedPaths,
    actualChangedPaths: actualPaths,
    unverifiedBoundaries: [],
    createdAt: "2026-08-06T00:00:00.000Z",
  });
}
