import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assessInitialContext,
  createContextProjection,
  createControlContract,
} from "../../src/domain/runtime-context.js";

const changeSet = {
  change_set_id: "change-1",
  intents: [{ revision: 1, objective: "Change two repositories" }],
  blockers: [],
  decisions: [],
  feedback_records: [],
  current_feedback_id: null,
};

const controlContract = createControlContract({
  operation: "planning",
  changeSetId: "change-1",
  planRevision: null,
  repositorySelectionRevision: 1,
  repositoryHarnessSelectionRevision: 1,
  authorizedRepositories: ["api", "web"],
  allowedOutcomes: ["plan", "scope_expansion", "decision_request"],
  humanGates: ["multi_repository_plan_confirmation"],
});

const projection = createContextProjection({
  operation: "planning",
  changeSet,
  repositorySelection: {
    revision: 1,
    status: "current",
    repositories: [
      { repository_id: "api", resolved_base_sha: "a".repeat(40) },
      { repository_id: "web", resolved_base_sha: "b".repeat(40) },
    ],
  },
  repositoryHarnessSelection: {
    revision: 1,
    status: "current",
    repositories: [
      { repository_id: "api", mode: "exact_base_only" },
      { repository_id: "web", mode: "exact_base_only" },
    ],
  },
  repositories: [
    { repository_id: "api", base_sha: "a".repeat(40) },
    { repository_id: "web", base_sha: "b".repeat(40) },
  ],
  capability: { mode: "read_only" },
  requiredEvidence: ["plan"],
});

describe("Runtime context admission", () => {
  test("keeps the optional Runtime Kit disabled", () => {
    assert.deepEqual(controlContract.runtime_kit, {
      enabled: false,
      skills: [],
    });
    assert.equal(projection.schema_version, 10);
    assert.equal(controlContract.repository_selection_revision, 1);
    assert.equal(
      controlContract.repository_harness_selection_revision,
      1,
    );
    assert.equal(projection.repository_selection.revision, 1);
    assert.equal(projection.repository_harness_selection.revision, 1);
  });

  test("projects only the current planning input and exact approvable message", () => {
    const result = createContextProjection({
      operation: "planning",
      changeSet,
      repositorySelection: projection.repository_selection,
      repositoryHarnessSelection: projection.repository_harness_selection,
      repositories: projection.repositories,
      capability: { mode: "read_only" },
      requiredEvidence: ["plan"],
      historyReferences: [{ kind: "run", run_id: "run-reference-only" }],
      planningConversation: {
        user_message: "Revise the current proposal.",
        current_approvable_message: {
          message_id: "message-current",
          content_digest: "a".repeat(64),
          text: "Current proposal",
          plan_content: { rationale: "current" },
          transcript: "must-not-project",
        },
      },
      verificationPolicy: {
        minimum_mode: "basic",
        default_attempt_timeout_ms: 120_000,
        max_attempt_timeout_ms: 600_000,
        escalation_triggers: ["scope_divergence"],
      },
    });
    assert.deepEqual(result.planning_conversation, {
      user_message: "Revise the current proposal.",
      current_approvable_message: {
        message_id: "message-current",
        content_digest: "a".repeat(64),
        text: "Current proposal",
        plan_content: { rationale: "current" },
      },
    });
    assert.equal(JSON.stringify(result).includes("must-not-project"), false);
    assert.equal(result.verification_policy.minimum_mode, "basic");
  });

  test("projects only bounded current feedback and excludes finalization internals", () => {
    const sensitiveChangeSet = {
      ...changeSet,
      blockers: [
        {
          code: "COMMAND_SPAWN_FAILED",
          work_unit_id: "api-unit",
          checkpoint_id: "candidate-checkpoint-secret",
          validation_attempt_id: "validation-attempt-secret",
        },
      ],
      decisions: [
        {
          decision_id: "decision-old",
          type: "bundle_review",
          feedback: { summary: "old full feedback" },
        },
        {
          decision_id: "decision-recovery",
          type: "legacy_candidate_recovery",
          checkpoint_id: "candidate-checkpoint-secret",
        },
        {
          decision_id: "decision-closure",
          type: "changeset_closure",
          reason: {
            code: "route_abandoned",
            summary: "closure-summary-must-stay-outside-runtime",
          },
        },
        {
          decision_id: "decision-provider-retry",
          type: "provider_retry",
          source_run_id: "run-cost-history",
          retired_candidate_checkpoint_id: "candidate-checkpoint-secret",
          provider_environment_path: "C:/secret/provider-environment",
        },
      ],
    };
    const feedback = {
      feedback_id: "feedback-current",
      source: { kind: "human", actor: "reviewer" },
      target: { kind: "bundle", revision: 2, hash: "a".repeat(64) },
      content: {
        summary: "Fix the current blocker",
        findings: [
          { finding_id: "finding-1", text: "Escape bootstrap data" },
        ],
      },
    };
    const result = createContextProjection({
      operation: "execution",
      changeSet: sensitiveChangeSet,
      plan: { revision: 3 },
      workUnit: {
        work_unit_id: "api-unit",
        repository_id: "api",
        phase: "verification",
        disposition: "current",
        workspace: { workspace_path: "C:/secret/workspace" },
        candidate_checkpoint_id: "candidate-checkpoint-secret",
        validation_attempt_ids: ["validation-attempt-secret"],
      },
      repositorySelection: projection.repository_selection,
      repositoryHarnessSelection: projection.repository_harness_selection,
      repositories: projection.repositories,
      capability: { mode: "read_write", paths: ["C:/allowed/workspace"] },
      requiredEvidence: ["candidate"],
      feedback,
    });

    assert.deepEqual(result.feedback.findings, [
      { finding_id: "finding-1", text: "Escape bootstrap data" },
    ]);
    assert.deepEqual(result.decisions, []);
    assert.deepEqual(result.blockers, [
      { code: "COMMAND_SPAWN_FAILED", work_unit_id: "api-unit" },
    ]);
    assert.equal("workspace" in result.work_unit, false);
    assert.equal("candidate_checkpoint_id" in result.work_unit, false);
    assert.equal(
      JSON.stringify(result).includes("candidate-checkpoint-secret"),
      false,
    );
    assert.equal(
      JSON.stringify(result).includes("closure-summary-must-stay-outside-runtime"),
      false,
    );
    assert.equal(
      JSON.stringify(result).includes("C:/secret/provider-environment"),
      false,
    );
    assert.equal(JSON.stringify(result).includes("run-cost-history"), false);
  });

  test("records unknown evidence without inventing a denominator", () => {
    const evidence = assessInitialContext({
      controlContract,
      contextProjection: projection,
      agentProfile: { profile_id: "fake" },
    });
    assert.equal(evidence.classification, "unknown");
    assert.equal(evidence.capacity_tokens, null);
    assert.ok(evidence.changefleet_bytes > 0);
  });

  test("accepts enforced or estimated evidence within 70 percent", () => {
    for (const classification of ["enforced", "estimated"]) {
      const evidence = assessInitialContext({
        controlContract,
        contextProjection: projection,
        agentProfile: { profile_id: "fake" },
        runtimeMeasurement: {
          classification,
          used_tokens: 700,
          capacity_tokens: 1_000,
        },
      });
      assert.equal(evidence.classification, classification);
      assert.ok(Math.abs(evidence.headroom_ratio - 0.3) < Number.EPSILON);
    }
  });

  test("rejects an initial invocation above the accepted target", () => {
    assert.throws(
      () =>
        assessInitialContext({
          controlContract,
          contextProjection: projection,
          agentProfile: { profile_id: "fake" },
          runtimeMeasurement: {
            classification: "enforced",
            used_tokens: 701,
            capacity_tokens: 1_000,
          },
        }),
      { code: "INITIAL_CONTEXT_BUDGET_EXCEEDED" },
    );
  });
});
