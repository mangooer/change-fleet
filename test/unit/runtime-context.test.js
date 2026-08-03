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
    assert.equal(projection.schema_version, 3);
    assert.equal(controlContract.repository_selection_revision, 1);
    assert.equal(
      controlContract.repository_harness_selection_revision,
      1,
    );
    assert.equal(projection.repository_selection.revision, 1);
    assert.equal(projection.repository_harness_selection.revision, 1);
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
