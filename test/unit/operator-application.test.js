import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createOperatorApplication,
  OPERATOR_OPERATIONS,
} from "../../src/application/operator-application.js";

const EXPECTED_OPERATIONS = [
  "project.register",
  "project.repository_workspace_policy.revise",
  "project.repository_delivery.github.configure",
  "changeset.create",
  "changeset.repository_selection.revise",
  "changeset.repository_harness_selection.revise",
  "changeset.plan",
  "changeset.plan.confirm",
  "changeset.candidate.recover_legacy",
  "changeset.execute",
  "changeset.bundle.decide",
  "changeset.delivery.publish",
  "changeset.delivery.read",
  "changeset.delivery.refresh",
  "changeset.read",
];

describe("operator application allowlist", () => {
  test("delegates every allowed operation without changing mutation requests", async () => {
    const calls = [];
    const service = createServiceDouble(calls);
    const application = createOperatorApplication(service);

    assert.deepEqual(OPERATOR_OPERATIONS, EXPECTED_OPERATIONS);
    assert.deepEqual(application.operations, EXPECTED_OPERATIONS);
    assert.equal(Object.isFrozen(application), true);

    for (const operation of EXPECTED_OPERATIONS.filter(
      (candidate) => candidate !== "changeset.read",
    )) {
      const request = {
        idempotency_key: `${operation}-request`,
        marker: operation,
      };
      const result = await application.execute(operation, request);
      assert.equal(result.request, request);
    }

    const readResult = await application.execute("changeset.read", {
      change_set_id: "change-1",
    });
    assert.deepEqual(readResult, { change_set_id: "change-1" });
    assert.equal(calls.at(-1).method, "readChangeSet");
    assert.equal(calls.at(-1).request, "change-1");
  });

  test("does not expose internal resolution, recovery, Runtime, Git, or store helpers", async () => {
    const application = createOperatorApplication(createServiceDouble([]));
    const forbidden = [
      "changeset.repository_selection.resolve",
      "changeset.repository_harness_selection.resolve",
      "recoverInterruptedRuns",
      "executeWorkUnit",
      "validateRepositoryCandidate",
      "controlStore",
    ];
    for (const operation of forbidden) {
      await assert.rejects(
        application.execute(operation, {}),
        { code: "UNSUPPORTED_OPERATOR_OPERATION" },
      );
    }
    await assert.rejects(
      application.execute("changeset.create", []),
      { code: "INVALID_OPERATOR_REQUEST" },
    );
  });
});

function createServiceDouble(calls) {
  const service = {};
  const methods = [
    "registerProject",
    "reviseRepositoryWorkspacePolicy",
    "configureGithubDelivery",
    "createChangeSet",
    "reviseRepositorySelection",
    "reviseRepositoryHarnessSelection",
    "planChangeSet",
    "confirmPlanRevision",
    "recoverLegacyCandidate",
    "executeChangeSet",
    "recordBundleDecision",
    "publishDelivery",
    "readDelivery",
    "refreshDelivery",
  ];
  for (const method of methods) {
    service[method] = async (request) => {
      calls.push({ method, request });
      return { method, request };
    };
  }
  service.readChangeSet = async (changeSetId) => {
    calls.push({ method: "readChangeSet", request: changeSetId });
    return { change_set_id: changeSetId };
  };
  return service;
}
