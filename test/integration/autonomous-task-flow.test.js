import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { TaskControlStore } from "../../src/adapters/filesystem/task-control-store.js";
import { AutonomousTaskController } from "../../src/application/autonomous-task-controller.js";
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

test("one conversation resumes Planner input, reaches review, cancels, and recovers accepted work after restart", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-autonomous-flow-");
  const repository = await createGitRepository(root, "api");
  const plan = createOneRepositoryPlan(await writeCombinedCheckScript(root, 1));
  const runtime = new ScriptedRuntime({
    plan,
    planningOutcomes: [
      {
        type: "conversation_message",
        message: {
          text: "Should the existing public behavior remain compatible?",
          plan: null,
        },
        request: null,
      },
      {
        type: "conversation_message",
        message: {
          text: "The clarification is reflected in the focused Plan.",
          plan,
        },
        request: null,
      },
    ],
  });
  const controlRoot = path.join(root, "control");
  const service = await ChangeFleetService.open({
    controlRoot,
    workspaceRoot: path.join(root, "workspaces"),
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  });
  await service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      repositories: [
        { repository_id: "api", locator: { path: repository.path } },
      ],
    },
  });
  const taskStore = new TaskControlStore(controlRoot);
  await taskStore.initialize();
  const controller = new AutonomousTaskController({
    service,
    taskControlStore: taskStore,
  });
  await controller.start();
  t.after(() => controller.stop());

  await controller.createChangeSet({
    idempotency_key: "create-conversation",
    change_set_id: "conversation",
    project_id: "project",
    intent: { objective: "Implement the focused behavior" },
  });
  await waitForCommandCount(taskStore, "conversation", 1);
  let state = await service.readChangeSet("conversation");
  assert.equal(state.phase, "planning");
  assert.equal(state.current_approvable_plan_message_id, null);

  await controller.sendTaskMessage({
    idempotency_key: "clarification",
    change_set_id: "conversation",
    message: "Yes. Preserve the current public behavior.",
    actor: "human",
  });
  await waitForPhase(service, "conversation", "review");
  await waitForCommandCount(taskStore, "conversation", 2);
  const view = await createView(service, taskStore).readChangeSetView("conversation");
  assert.equal(view.operator_status, "needs_review");
  assert.equal(view.conversation.messages.some((message) => message.role === "human"), true);
  assert.equal(view.conversation.messages.some((message) => message.role === "agent"), true);

  await controller.cancelChangeSet({
    idempotency_key: "cancel-conversation",
    change_set_id: "conversation",
    actor: "human",
  });
  await waitForPhase(service, "conversation", "terminal");
  await waitForCommandCount(taskStore, "conversation", 3);
  state = await service.readChangeSet("conversation");
  assert.equal(state.terminal_outcome, "abandoned");
  assert.notEqual(state.task_workspace.resources_released_at, null);
  await controller.stop();

  await service.createChangeSet({
    idempotency_key: "create-recovered",
    change_set_id: "recovered",
    project_id: "project",
    intent: { objective: "Recover accepted planning after restart" },
  });
  await taskStore.ensureTask("recovered");
  await taskStore.enqueue({
    changeSetId: "recovered",
    idempotencyKey: "initial-recovered",
    kind: "initial_plan",
    payload: {},
  });
  await taskStore.claimNext("recovered");

  const restarted = new AutonomousTaskController({
    service,
    taskControlStore: taskStore,
  });
  await restarted.start();
  t.after(() => restarted.stop());
  await waitForPhase(service, "recovered", "review");
  await waitForCommandCount(taskStore, "recovered", 1);
  await restarted.stop();
  assert.equal((await taskStore.readTask("recovered")).commands[0].attempt, 2);
});

function createView(service, taskControlStore) {
  return new ChangeSetViewService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    auditQueryService: new RuntimeAuditQueryService({
      controlStore: service.controlStore,
      runStore: service.runStore,
      evidenceStore: service.evidenceStore,
    }),
    agentProfile: TEST_AGENT_PROFILE,
    taskControlStore,
  });
}

async function waitForCommandCount(store, changeSetId, count) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const task = await store.readTask(changeSetId);
    if (
      task.commands.length >= count &&
      task.commands.slice(0, count).every((command) =>
        ["completed", "cancelled"].includes(command.status),
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Task ${changeSetId} did not settle ${count} commands`);
}

async function waitForPhase(service, changeSetId, phase) {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    if ((await service.readChangeSet(changeSetId)).phase === phase) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`ChangeSet ${changeSetId} did not reach ${phase}`);
}
