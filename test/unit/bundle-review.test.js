import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bundleReviewAllowsHumanDecision,
  bundleReviewAssessmentMatches,
  createBundleReviewAssessment,
  normalizeBundleReviewOutcome,
  normalizeBundleReviewPolicy,
  normalizePlanBundleReview,
} from "../../src/domain/bundle-review.js";

const policy = {
  default_mode: "independent",
  default_agent_profile_id: "codex-reviewer",
  default_agent_profile_revision: 1,
  max_attempts: 2,
};
const plan = {
  revision: 3,
  bundle_review: {
    mode: "independent",
    agent_profile_id: "codex-reviewer",
    agent_profile_revision: 1,
    attempt_limit: 2,
  },
  work_units: [
    { work_unit_id: "api-unit", repository_id: "api" },
    { work_unit_id: "web-unit", repository_id: "web" },
  ],
};
const bundle = {
  bundle_id: "bundle-1",
  revision: 2,
  bundle_hash: "a".repeat(64),
  candidates: [
    {
      repository_id: "api",
      base_sha: "b".repeat(40),
      candidate_sha: "c".repeat(40),
      repository_evidence: { evidence_id: "repository-evidence-api" },
    },
    { repository_id: "web", base_sha: "d".repeat(40), candidate_sha: "e".repeat(40) },
  ],
};

test("Bundle review policy defaults to no cost and freezes exact Plan authority", () => {
  assert.deepEqual(normalizeBundleReviewPolicy(), {
    default_mode: "none",
    default_agent_profile_id: null,
    default_agent_profile_revision: null,
    max_attempts: 2,
  });
  assert.deepEqual(normalizePlanBundleReview(null, policy), {
    mode: "independent",
    agent_profile_id: "codex-reviewer",
    agent_profile_revision: 1,
    attempt_limit: 2,
  });
  assert.deepEqual(normalizePlanBundleReview({ mode: "none" }, policy), {
    mode: "none",
    agent_profile_id: null,
    agent_profile_revision: null,
    attempt_limit: 2,
  });
});

test("Bundle review accepts bounded targeted Feedback and rejects unauthorized targets", () => {
  const outcome = normalizeBundleReviewOutcome(
    {
      type: "bundle_review_completed",
      disposition: "feedback",
      summary: "The API and web contract disagree.",
      findings: [
        {
          finding_id: "contract-mismatch",
          severity: "blocking",
          category: "cross_repository",
          message: "The API returns a field the web code does not consume.",
          evidence_reference_ids: ["repository-evidence-api"],
          repository_ids: ["api"],
          work_unit_ids: ["api-unit"],
        },
      ],
      human_decision: null,
    },
    { bundle, plan, workUnits: plan.work_units },
  );
  assert.equal(outcome.disposition, "feedback");
  assert.equal(outcome.findings[0].work_unit_ids[0], "api-unit");

  assert.throws(
    () =>
      normalizeBundleReviewOutcome(
        {
          type: "bundle_review_completed",
          disposition: "feedback",
          summary: "Unauthorized target.",
          findings: [
            {
              finding_id: "unknown-target",
              severity: "blocking",
              category: "scope",
              message: "This target is outside the confirmed Plan.",
              evidence_reference_ids: [],
              repository_ids: ["unknown"],
              work_unit_ids: ["api-unit"],
            },
          ],
          human_decision: null,
        },
        { bundle, plan, workUnits: plan.work_units },
      ),
    (error) => error.code === "INVALID_BUNDLE_REVIEW_OUTCOME",
  );
  assert.throws(
    () =>
      normalizeBundleReviewOutcome(
        {
          type: "bundle_review_completed",
          disposition: "pass",
          summary: "Unknown evidence must not enter the assessment.",
          findings: [
            {
              finding_id: "unknown-evidence",
              severity: "advisory",
              category: "evidence",
              message: "The reference is not in the exact review projection.",
              evidence_reference_ids: ["invented-evidence"],
              repository_ids: ["api"],
              work_unit_ids: [],
            },
          ],
          human_decision: null,
        },
        { bundle, plan, workUnits: plan.work_units },
      ),
    (error) => error.code === "INVALID_BUNDLE_REVIEW_OUTCOME",
  );
});

test("Bundle assessment reuse and human authority remain bound to one exact Bundle", () => {
  const assessment = createBundleReviewAssessment({
    bundle,
    plan,
    runId: "run-review-1",
    agentProfile: {
      profile_id: "codex-reviewer",
      revision: 1,
      provider: "openai",
    },
    outcome: {
      type: "bundle_review_completed",
      disposition: "pass",
      summary: "No blocking issue found.",
      findings: [
        {
          finding_id: "optional-cleanup",
          severity: "advisory",
          category: "correctness",
          message: "A later cleanup could simplify this path.",
          evidence_reference_ids: [],
          repository_ids: ["api"],
          work_unit_ids: [],
        },
      ],
      human_decision: null,
    },
    createdAt: "2026-08-07T00:00:00.000Z",
  });
  assert.equal(bundleReviewAssessmentMatches(assessment, bundle, plan), true);
  assert.equal(bundleReviewAllowsHumanDecision(assessment, bundle, plan), true);
  assert.equal(
    bundleReviewAssessmentMatches(
      assessment,
      { ...bundle, bundle_hash: "f".repeat(64) },
      plan,
    ),
    false,
  );
});
