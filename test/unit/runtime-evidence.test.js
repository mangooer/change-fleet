import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { normalizeAgentProfile } from "../../src/domain/agent-profile.js";
import {
  createCodexAggregateUsageObservation,
  createRuntimeInvocationEvidence,
} from "../../src/domain/runtime-evidence.js";
import {
  assertStructuredOutcome,
  EXECUTION_OUTCOME_SCHEMA,
  INTEGRATION_OUTCOME_SCHEMA,
  PLANNING_OUTCOME_SCHEMA,
  SUPERVISION_OUTCOME_SCHEMA,
  VERIFICATION_OUTCOME_SCHEMA,
} from "../../src/adapters/runtime/runtime-schemas.js";

const PROFILE = {
  profile_id: "codex-default",
  revision: 1,
  provider: "openai",
  runtime: "codex-sdk",
  model: "gpt-5.4",
  reasoning: "high",
  permissions: "operation_scoped",
  network_access: false,
  skills: [],
  credential_profile_id: "local-chatgpt",
};

describe("Runtime identity and evidence", () => {
  test("derives distinct read-only Profile identities from a maximum-length base id", () => {
    const service = new ChangeFleetService({
      controlRoot: ".changefleet-test-control",
      workspaceRoot: ".changefleet-test-workspaces",
      runtime: { invoke: async () => ({}) },
      agentProfile: { ...PROFILE, profile_id: "p".repeat(128) },
    });

    assert.notEqual(
      service.supervisionAgentProfile.profile_id,
      service.agentProfile.profile_id,
    );
    assert.notEqual(
      service.reviewAgentProfile.profile_id,
      service.agentProfile.profile_id,
    );
    assert.notEqual(
      service.supervisionAgentProfile.profile_id,
      service.reviewAgentProfile.profile_id,
    );
  });

  test("requires an explicit versioned and non-secret Agent Profile", () => {
    assert.deepEqual(normalizeAgentProfile(PROFILE), PROFILE);
    assert.throws(
      () => normalizeAgentProfile({ ...PROFILE, revision: 0 }),
      { code: "INVALID_AGENT_PROFILE" },
    );
    assert.throws(
      () => normalizeAgentProfile({ ...PROFILE, network_access: true }),
      { code: "UNSUPPORTED_AGENT_PROFILE" },
    );
    assert.deepEqual(
      normalizeAgentProfile({
        ...PROFILE,
        permissions: "host_user",
        network_access: true,
      }),
      {
        ...PROFILE,
        permissions: "host_user",
        network_access: true,
      },
    );
    assert.throws(
      () => normalizeAgentProfile({ ...PROFILE, permissions: "host_user" }),
      { code: "UNSUPPORTED_AGENT_PROFILE" },
    );
    assert.throws(
      () => normalizeAgentProfile({ ...PROFILE, skills: ["implicit-skill"] }),
      { code: "UNSUPPORTED_AGENT_PROFILE" },
    );
  });

  test("records Codex turn usage as provider-reported aggregate only", () => {
    const observations = createCodexAggregateUsageObservation({
      input_tokens: 100,
      cached_input_tokens: 40,
      cache_write_input_tokens: 5,
      output_tokens: 30,
      reasoning_output_tokens: 20,
    });
    assert.deepEqual(observations, [
      {
        scope: "aggregate",
        confidence: "provider_reported",
        coverage: "aggregate_only",
        input_tokens: 100,
        cached_input_tokens: 40,
        cache_write_input_tokens: 5,
        output_tokens: 30,
        reasoning_output_tokens: 20,
        total_tokens: 130,
        provider_cost: null,
      },
    ]);
  });

  test("keeps missing model, usage, and monetary facts unknown", () => {
    const payload = createRuntimeInvocationEvidence({
      run: {
        run_id: "run-1",
        attempt: 1,
        operation: "planning",
        change_set_id: "change-1",
        work_unit_id: null,
        agent_profile: PROFILE,
        created_at: "2026-07-31T00:00:00.000Z",
        context_projection_identity: {
          schema_version: 2,
          digest: "a".repeat(64),
        },
      },
      invocation: null,
      providerEvidence: null,
      terminal: {
        status: "interrupted",
        outcome_type: "controller_restart",
        error_code: null,
        completed_at: "2026-07-31T00:00:01.000Z",
      },
    });
    assert.equal(payload.observed.effective_model, null);
    assert.deepEqual(payload.usage_observations, []);
    assert.equal(payload.monetary_cost, null);
    assert.equal(payload.evidence_classification, "unavailable");
    assert.equal(payload.repository_harness_observation, null);
    assert.equal(payload.timing.duration_ms, 1_000);
  });

  test("publishes strict operation schemas and validates tagged branches", () => {
    assert.equal(PLANNING_OUTCOME_SCHEMA.additionalProperties, false);
    assert.equal(EXECUTION_OUTCOME_SCHEMA.additionalProperties, false);
    assert.equal(VERIFICATION_OUTCOME_SCHEMA.additionalProperties, false);
    assert.equal(SUPERVISION_OUTCOME_SCHEMA.additionalProperties, false);
    assert.equal(INTEGRATION_OUTCOME_SCHEMA.additionalProperties, false);
    const planSchema =
      PLANNING_OUTCOME_SCHEMA.properties.message.anyOf[0].properties.plan.anyOf[0];
    assert.deepEqual(planSchema.required, [
      "summary",
      "steps",
      "validation",
      "risks",
      "assumptions",
      "revision_feedback_assessments",
    ]);
    assert.equal("work_units" in planSchema.properties, false);
    assert.equal("verification_expectation" in planSchema.properties, false);
    assert.equal("supervision" in planSchema.properties, false);
    assertStrictObjectSchemas(PLANNING_OUTCOME_SCHEMA);
    assertStrictObjectSchemas(EXECUTION_OUTCOME_SCHEMA);
    assertStrictObjectSchemas(VERIFICATION_OUTCOME_SCHEMA);
    assertStrictObjectSchemas(SUPERVISION_OUTCOME_SCHEMA);
    assertStrictObjectSchemas(INTEGRATION_OUTCOME_SCHEMA);
    const planOutcome = {
      type: "conversation_message",
      message: {
        disposition: "ready",
        text: "ready",
        intent_draft: {
          objective: "Implement the requested behavior.",
          rationale: null,
          constraints: [],
          non_goals: [],
          acceptance_criteria: ["The requested behavior is implemented."],
          resolved_decisions: [],
          open_questions: [],
        },
        plan: {
          summary: "Implement the requested behavior.",
          steps: ["Update the implementation."],
          validation: ["Run the relevant project checks."],
          risks: [],
          assumptions: [],
          revision_feedback_assessments: [],
        },
      },
      request: null,
    };
    assert.equal(
      assertStructuredOutcome("planning", planOutcome),
      planOutcome,
    );
    assert.throws(() =>
      assertStructuredOutcome("planning", {
        type: "conversation_message",
        message: null,
        request: null,
      }),
    );
    const supervisionOutcome = {
      type: "supervisor_decision_proposal",
      action_id: "action-1",
      projection_digest: "a".repeat(64),
      rationale: "The exact failure is routable Feedback.",
      expected_result: "The WorkUnit assesses the bounded finding.",
      evidence_reference_ids: ["validation-1"],
    };
    assert.equal(
      assertStructuredOutcome("supervision", supervisionOutcome),
      supervisionOutcome,
    );
    const verificationOutcome = {
      type: "verification_completed",
      review_depth: "triage",
      summary: "No blocking issue found.",
      assessment: {
        verdict: "pass",
        findings: [],
        notes: [],
        human_decision: null,
        requested_checks: [],
      },
    };
    assert.deepEqual(
      assertStructuredOutcome("verification", verificationOutcome),
      {
        type: "verification_completed",
        review_depth: "triage",
        verdict: "pass",
        summary: "No blocking issue found.",
        findings: [],
        notes: [],
        human_decision: null,
        requested_checks: [],
      },
    );
    const feedbackExecutionOutcome = {
      type: "implementation_completed",
      summary: "corrected",
      changed_paths: ["src/api.js"],
      blocker: null,
      revision_feedback_assessments: [],
    };
    assert.equal(
      assertStructuredOutcome("execution", feedbackExecutionOutcome),
      feedbackExecutionOutcome,
    );
    assert.throws(() =>
      assertStructuredOutcome("execution", {
        type: "implementation_completed",
        summary: "done",
        changed_paths: [1],
        blocker: null,
        revision_feedback_assessments: [],
      }),
    );
    const blockedOutcome = {
      type: "implementation_blocked",
      summary: "sandbox unavailable",
      changed_paths: [],
      blocker: {
        code: "sandbox_unavailable",
        message: "sandbox setup was cancelled",
      },
      revision_feedback_assessments: [],
    };
    assert.equal(
      assertStructuredOutcome("execution", blockedOutcome),
      blockedOutcome,
    );
    assert.throws(() =>
      assertStructuredOutcome("execution", {
        type: "implementation_completed",
        summary: "done",
        changed_paths: [],
      }),
    );
    const integrationOutcome = {
      type: "integration_action_completed",
      action_grant_id: "grant-1",
      input_digest: "d".repeat(64),
      summary: "Pushed the one granted refspec without force.",
      reported_destination_sha: "a".repeat(40),
      blocker: null,
    };
    assert.equal(
      assertStructuredOutcome("integration", integrationOutcome),
      integrationOutcome,
    );
    assert.throws(() =>
      assertStructuredOutcome("integration", {
        ...integrationOutcome,
        reported_destination_sha: null,
      }),
    );
  });
});

function assertStrictObjectSchemas(schema) {
  // Provider 的 strict JSON Schema 要求每个对象都显式要求其全部字段，递归检查可防止嵌套命令再次漏项。
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    assert.deepEqual(
      [...(schema.required ?? [])].sort(),
      Object.keys(schema.properties ?? {}).sort(),
    );
  }
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) {
      for (const item of value) assertStrictObjectSchemas(item);
    } else {
      assertStrictObjectSchemas(value);
    }
  }
}
