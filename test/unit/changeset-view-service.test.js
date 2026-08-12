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

  test("projects safe intake options and bounded recent planning turns", async (t) => {
    const { viewService, repositoryPath } = await createFixture(t);
    const options = await viewService.readIntakeOptions();
    assert.equal(options.projects[0].project_id, "project");
    assert.deepEqual(
      options.projects[0].repositories.map((item) => item.repository_id),
      ["api"],
    );
    assert.equal(options.agent_profile.profile_id, TEST_AGENT_PROFILE.profile_id);
    const serializedOptions = JSON.stringify(options);
    assert.equal(serializedOptions.includes(repositoryPath), false);
    assert.equal(serializedOptions.includes("credential_profile_id"), false);
    assert.equal(serializedOptions.includes("credential-must-stay-server-side"), false);

    const exact = await viewService.readChangeSetView("change-1");
    assert.equal(exact.planning_conversation.total_turns, 2);
    assert.equal(exact.planning_conversation.shown_turns, 2);
    assert.equal(
      exact.planning_conversation.turns[1].user_message.text,
      "Explain the selected validation in one concise turn.",
    );
    assert.equal(
      exact.planning_conversation.turns[1].assistant_message.is_approvable,
      true,
    );
    assert.equal(Object.hasOwn(exact, "transcript"), false);
  });

  test("bounds the human conversation projection by turn count and encoded message size", async () => {
    const references = Array.from({ length: 20 }, (_, index) => ({
      message_id: `message-${index}`,
      run_id: `run-${index}`,
      has_plan: index === 19,
      artifact_reference: { index },
    }));
    const viewService = new ChangeSetViewService({
      controlStore: {
        readChangeSet: async () => ({}),
        readCatalog: async () => ({ projects: {} }),
      },
      runStore: {
        readJsonArtifact: async ({ index }) => ({
          message_id: `message-${index}`,
          text: "界".repeat(10_000),
          created_at: `2026-08-12T00:00:${String(index).padStart(2, "0")}Z`,
        }),
        readEvents: async (runId) => [
          {
            at: "2026-08-12T00:00:00Z",
            payload: { text: `input-${runId}` },
          },
        ],
      },
      auditQueryService: { getChangeSetAudit: async () => ({}) },
      agentProfile: TEST_AGENT_PROFILE,
    });
    const projection = await viewService.readPlanningConversation({
      planning_message_references: references,
      current_approvable_plan_message_id: "message-19",
    });

    assert.equal(projection.total_turns, 20);
    assert.equal(projection.shown_turns <= 12, true);
    assert.equal(projection.truncated, true);
    assert.equal(
      Buffer.byteLength(JSON.stringify(projection), "utf8") < 50 * 1024,
      true,
    );
    assert.equal(
      projection.turns.at(-1).assistant_message.truncated,
      true,
    );
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
  await service.planChangeSet({
    idempotency_key: "plan-change-1-follow-up",
    change_set_id: "change-1",
    message: "Explain the selected validation in one concise turn.",
  });
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
      agentProfile: {
        ...TEST_AGENT_PROFILE,
        credential_profile_id: "credential-must-stay-server-side",
      },
    }),
    repositoryPath: repository.path,
  };
}
