import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { normalizeAgentProfile } from "../../src/domain/agent-profile.js";
import {
  createCodexAggregateUsageObservation,
  createRuntimeInvocationEvidence,
} from "../../src/domain/runtime-evidence.js";
import {
  assertStructuredOutcome,
  EXECUTION_OUTCOME_SCHEMA,
  PLANNING_OUTCOME_SCHEMA,
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
        status: "abandoned",
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
    const planOutcome = {
      type: "conversation_message",
      message: { text: "ready", plan: { work_units: [{}] } },
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
  });
});
