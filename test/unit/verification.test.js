import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createCheckIdentity,
  createVerificationAdmissionDecision,
  createVerificationReview,
  normalizeValidationAttemptBudgetRequests,
  normalizeVerificationOutcome,
  normalizeVerificationPolicy,
  resolveValidationAttemptBudget,
  verificationReviewAllowsCandidate,
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

describe("independent verification outcomes", () => {
  test("normalizes one bounded deep review and binds passing requested checks", () => {
    const outcome = normalizeVerificationOutcome(
      {
        type: "verification_completed",
        review_depth: "deep_review",
        verdict: "pass_with_notes",
        summary: "The exact diff is safe after one focused compatibility check.",
        findings: [],
        notes: [
          {
            note_id: "note-1",
            message: "Another operating system remains unverified.",
          },
        ],
        human_decision: null,
        requested_checks: [
          {
            command_id: "verification-compatibility",
            executable: "node",
            argv: ["check-compatibility.mjs"],
            coverage_rationale: "Covers the changed compatibility boundary",
            timeout_ms: 2_000,
          },
        ],
      },
      {
        projectPolicy: {
          default_attempt_timeout_ms: 1_000,
          max_attempt_timeout_ms: 5_000,
        },
        existingCommandIds: ["api-check"],
      },
    );
    const review = createVerificationReview({
      admissionId: "admission-1",
      checkpoint: verificationCheckpoint(),
      runId: "run-verification-1",
      outcome,
      validationAttemptIds: ["validation-attempt-1"],
      checkStatus: "passed",
      createdAt: "2026-08-06T00:00:01.000Z",
    });

    assert.equal(review.verdict, "pass_with_notes");
    assert.equal(review.review_scope, "initial");
    assert.equal(review.requested_checks[0].command_id, "verification-compatibility");
    assert.equal(verificationReviewAllowsCandidate(review), true);
  });

  test("binds one focused review to its source finding and correction Run", () => {
    const outcome = normalizeVerificationOutcome(
      {
        type: "verification_completed",
        review_depth: "triage",
        verdict: "pass",
        summary: "The prior blocking finding is resolved.",
        findings: [],
        notes: [],
        human_decision: null,
        requested_checks: [],
      },
      { projectPolicy: {}, existingCommandIds: [] },
    );
    const review = createVerificationReview({
      admissionId: "admission-focused",
      checkpoint: verificationCheckpoint(),
      runId: "run-focused-review",
      outcome,
      validationAttemptIds: [],
      checkStatus: "not_required",
      reviewScope: "focused",
      sourceReviewId: "review-source",
      correctionRunId: "run-correction",
      createdAt: "2026-08-06T00:00:02.000Z",
    });

    assert.equal(review.review_scope, "focused");
    assert.equal(review.source_review_id, "review-source");
    assert.equal(review.correction_run_id, "run-correction");
    assert.throws(() =>
      createVerificationReview({
        admissionId: "admission-focused",
        checkpoint: verificationCheckpoint(),
        runId: "run-focused-invalid",
        outcome,
        validationAttemptIds: [],
        checkStatus: "not_required",
        reviewScope: "focused",
        createdAt: "2026-08-06T00:00:03.000Z",
      }),
    );
  });

  test("rejects optional improvements as blockers and inconsistent verdict branches", () => {
    assert.throws(
      () =>
        normalizeVerificationOutcome(
          {
            type: "verification_completed",
            review_depth: "triage",
            verdict: "changes_required",
            summary: "Optional cleanup would be pleasant.",
            findings: [
              {
                finding_id: "style-only",
                category: "style",
                message: "Rename an internal variable.",
                path: "src/a.js",
              },
            ],
            notes: [],
            human_decision: null,
            requested_checks: [],
          },
          { projectPolicy: {}, existingCommandIds: [] },
        ),
      { code: "INVALID_VERIFICATION_OUTCOME" },
    );
    assert.throws(
      () =>
        normalizeVerificationOutcome(
          {
            type: "verification_completed",
            review_depth: "triage",
            verdict: "pass",
            summary: "Passing cannot carry a blocking finding.",
            findings: [
              {
                finding_id: "bug-1",
                category: "correctness",
                message: "A confirmed output is wrong.",
                path: null,
              },
            ],
            notes: [],
            human_decision: null,
            requested_checks: [],
          },
          { projectPolicy: {}, existingCommandIds: [] },
        ),
      { code: "INVALID_VERIFICATION_OUTCOME" },
    );
  });

  test("requires a bounded real choice for human decisions", () => {
    const outcome = normalizeVerificationOutcome(
      {
        type: "verification_completed",
        review_depth: "triage",
        verdict: "human_decision_required",
        summary: "Two compatible public behaviors are possible.",
        findings: [],
        notes: [],
        human_decision: {
          question: "Which compatibility behavior should be authoritative?",
          options: ["Preserve legacy behavior", "Adopt the new behavior"],
        },
        requested_checks: [],
      },
      { projectPolicy: {}, existingCommandIds: [] },
    );
    assert.equal(outcome.human_decision.options.length, 2);
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

function verificationCheckpoint() {
  return {
    checkpoint_id: "checkpoint-1",
    repository_id: "api",
    target_ref: "refs/heads/main",
    base_sha: "a".repeat(40),
    candidate_sha: "b".repeat(40),
  };
}
