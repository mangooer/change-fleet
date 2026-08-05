import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { ChangeSetViewService } from "../../src/application/changeset-view-service.js";
import { RuntimeAuditQueryService } from "../../src/application/runtime-audit-query-service.js";
import {
  createFixtureRoot,
  createGitRepository,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createOneRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("changeset view service", () => {
  test("lists bounded recent ChangeSets with stable cursors and bounded fields", async (t) => {
    const { viewService } = await createFixture(t);
    const first = await viewService.listChangeSets({ limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(typeof first.next_cursor, "string");
    assert.equal(Object.hasOwn(first.items[0], "commands"), false);
    assert.equal(Object.hasOwn(first.items[0], "run_references"), false);

    const second = await viewService.listChangeSets({
      limit: 1,
      cursor: first.next_cursor,
    });
    assert.equal(second.items.length, 1);
    assert.notEqual(first.items[0].change_set_id, second.items[0].change_set_id);
  });

  test("projects exact bundle, delivery readiness, and audit summary without raw evidence bodies", async (t) => {
    const { viewService } = await createFixture(t);
    const exact = await viewService.readChangeSetView("change-2");
    assert.equal(exact.change_set_id, "change-2");
    assert.equal(exact.bundle.candidates.length, 1);
    assert.equal(exact.bundle.candidates[0].changed_paths.includes("feature.txt"), true);
    assert.equal(exact.repositories[0].delivery_binding.status, "missing");
    assert.equal(Object.hasOwn(exact, "transcript"), false);

    const audit = await viewService.readAuditView("change-2");
    assert.equal(audit.payload.runs.shown_count >= 1, true);
    assert.equal(Object.hasOwn(audit.payload, "raw_artifact_references"), false);
  });
});

async function createFixture(testContext) {
  const root = await createFixtureRoot(testContext, "changefleet-view-query-");
  const repository = await createGitRepository(root, "api");
  const runtime = new ScriptedRuntime({
    plan: createOneRepositoryPlan(await writeCombinedCheckScript(root, 1)),
  });
  const service = await ChangeFleetService.open({
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  });
  await service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      repositories: [{ repository_id: "api", locator: { path: repository.path } }],
    },
  });
  for (const changeSetId of ["change-1", "change-2"]) {
    await service.createChangeSet({
      idempotency_key: `create-${changeSetId}`,
      change_set_id: changeSetId,
      project_id: "project",
      intent: { objective: `Objective ${changeSetId}` },
    });
    await service.planChangeSet({
      idempotency_key: `plan-${changeSetId}`,
      change_set_id: changeSetId,
    });
  }
  const planned = await service.readChangeSet("change-2");
  const planReference = planned.planning_message_references.find(
    (reference) =>
      reference.message_id === planned.current_approvable_plan_message_id,
  );
  await service.confirmPlanMessage({
    idempotency_key: "confirm-change-2",
    change_set_id: "change-2",
    message_id: planReference.message_id,
    content_digest: planReference.content_digest,
  });
  await service.executeChangeSet({
    idempotency_key: "execute-change-2",
    change_set_id: "change-2",
  });
  const queryService = new RuntimeAuditQueryService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    evidenceStore: service.evidenceStore,
  });
  return {
    viewService: new ChangeSetViewService({
      controlStore: service.controlStore,
      runStore: service.runStore,
      auditQueryService: queryService,
    }),
  };
}
