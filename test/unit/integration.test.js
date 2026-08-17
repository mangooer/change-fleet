import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertCurrentActionGrant,
  createActionGrant,
  createIntegrationActionOffer,
  createIntegrationResult,
} from "../../src/domain/integration.js";
import { TEST_AGENT_PROFILE } from "../support/scripted-runtime.js";

const BASE_SHA = "a".repeat(40);
const CANDIDATE_SHA = "b".repeat(40);
const NOW = "2026-08-17T00:00:00.000Z";
const EXPIRES = "2026-08-17T01:00:00.000Z";

function fixture() {
  const candidate = {
    candidate_id: "candidate-1",
    repository_id: "api",
    base_sha: BASE_SHA,
    candidate_sha: CANDIDATE_SHA,
    target_ref: "refs/heads/main",
  };
  const bundle = {
    bundle_id: "bundle-1",
    revision: 1,
    bundle_hash: "c".repeat(64),
    candidates: [candidate],
  };
  const changeSet = {
    change_set_id: "change-1",
    phase: "review",
    task_workspace: { task_workspace_id: "task-workspace-1" },
    bundles: [bundle],
    candidates: [candidate],
    decisions: [
      {
        type: "bundle_review",
        decision: "accept",
        bundle_revision: 1,
        bundle_hash: bundle.bundle_hash,
      },
    ],
  };
  const agentSession = {
    agent_session_id: "agent-session-1",
    agent_profile: TEST_AGENT_PROFILE,
  };
  return { changeSet, bundle, candidate, agentSession };
}

function createOffer(overrides = {}) {
  const { changeSet, bundle, candidate, agentSession } = fixture();
  return createIntegrationActionOffer({
    changeSet,
    bundle,
    candidate,
    agentSession,
    actionKind: "fast_forward_target",
    pushRemote: "origin",
    destinationRef: candidate.target_ref,
    observedDestinationSha: candidate.base_sha,
    offeredAt: NOW,
    expiresAt: EXPIRES,
    idFactory: (prefix) => `${prefix}-1`,
    ...overrides,
  });
}

describe("exact integration action authority", () => {
  test("freezes the full offered action and copies it unchanged into a human grant", () => {
    const offer = createOffer({ maximumAttempts: 1 });
    const grant = createActionGrant({
      offer,
      actor: "operator-1",
      grantedAt: NOW,
      idFactory: (prefix) => `${prefix}-1`,
    });
    const { changeSet, candidate } = fixture();

    assert.equal(grant.input_digest, offer.input_digest);
    assert.equal(grant.candidate_sha, candidate.candidate_sha);
    assert.equal(grant.observed_destination_sha, candidate.base_sha);
    assert.equal(offer.maximum_attempts, 1);
    assert.equal(grant.maximum_attempts, 1);
    assert.deepEqual(grant.action_contract, {
      mutation_scope: "one_exact_remote_branch_ref",
      force_allowed: false,
      refspec: `${candidate.candidate_sha}:${candidate.target_ref}`,
    });
    assert.equal(grant.result_observer.kind, "independent_git_ls_remote_v1");
    assert.equal(
      grant.accepted_result_schema,
      "exact_remote_ref_equals_candidate_v1",
    );
    assert.deepEqual(
      assertCurrentActionGrant({
        state: changeSet,
        grant,
        now: "2026-08-17T00:30:00.000Z",
      }).candidate,
      candidate,
    );
  });

  test("binds the exact attempt ceiling into the immutable offer digest", () => {
    const singleAttempt = createOffer({ maximumAttempts: 1 });
    const recoverable = createOffer({ maximumAttempts: 2 });

    assert.notEqual(singleAttempt.input_digest, recoverable.input_digest);
    assert.throws(() => createOffer({ maximumAttempts: 0 }), {
      code: "INVALID_INTEGRATION_ATTEMPT_LIMIT",
    });
    assert.throws(() => createOffer({ maximumAttempts: 3 }), {
      code: "INVALID_INTEGRATION_ATTEMPT_LIMIT",
    });
  });

  test("rejects target movement, expiry, and publication to a target branch", () => {
    const offer = createOffer();
    const grant = createActionGrant({
      offer,
      actor: "operator-1",
      grantedAt: NOW,
      idFactory: (prefix) => `${prefix}-1`,
    });
    const { changeSet, candidate } = fixture();
    changeSet.candidates[0] = { ...candidate, candidate_sha: "d".repeat(40) };
    assert.throws(
      () => assertCurrentActionGrant({ state: changeSet, grant, now: NOW }),
      { code: "ACTION_GRANT_SUBJECT_CHANGED" },
    );
    assert.throws(
      () =>
        assertCurrentActionGrant({
          state: fixture().changeSet,
          grant,
          now: EXPIRES,
        }),
      { code: "ACTION_GRANT_NOT_CURRENT" },
    );
    assert.throws(
      () =>
        createOffer({
          actionKind: "publish_exact_candidate",
          destinationRef: "refs/heads/main",
          observedDestinationSha: null,
        }),
      { code: "INVALID_INTEGRATION_DESTINATION" },
    );
  });

  test("records success only for an independently observed exact Candidate", () => {
    const offer = createOffer();
    const grant = createActionGrant({
      offer,
      actor: "operator-1",
      grantedAt: NOW,
      idFactory: (prefix) => `${prefix}-1`,
    });
    const result = createIntegrationResult({
      grant,
      runId: "run-1",
      evidence: { evidence_id: "evidence-1" },
      observedDestinationSha: CANDIDATE_SHA,
      completedAt: NOW,
      idFactory: (prefix) => `${prefix}-1`,
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.action_grant_id, grant.action_grant_id);
    assert.throws(
      () =>
        createIntegrationResult({
          grant,
          runId: "run-2",
          evidence: {},
          observedDestinationSha: BASE_SHA,
          completedAt: NOW,
          idFactory: (prefix) => `${prefix}-2`,
        }),
      { code: "INTEGRATION_RESULT_DIVERGED" },
    );
  });
});
