import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TaskControlStore } from "../../src/adapters/filesystem/task-control-store.js";
import { AutonomousTaskController } from "../../src/application/autonomous-task-controller.js";
import { createFixtureRoot } from "../support/git-fixture.js";

describe("autonomous task controller", () => {
  test("accepts creation immediately and advances a ready Plan to review", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-autonomous-task-");
    const store = new TaskControlStore(root);
    await store.initialize();
    const calls = [];
    const service = fakeService(calls);
    const controller = new AutonomousTaskController({
      service,
      taskControlStore: store,
    });
    await controller.start();

    const accepted = await controller.createChangeSet({
      idempotency_key: "create-1",
      change_set_id: "change-1",
      intent: { objective: "Implement the small change" },
    });
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.command.status, "accepted");

    const task = await waitForCommand(store, "change-1", "completed");
    await controller.stop();
    assert.deepEqual(calls, ["create", "plan", "confirm", "run"]);
    assert.equal(task.commands[0].result.plan_revision, 1);
    assert.deepEqual(
      task.timeline.map((event) => event.role),
      ["human", "agent", "system", "system"],
    );
  });

  test("stops for Planner input without inventing plan confirmation", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-autonomous-input-");
    const store = new TaskControlStore(root);
    await store.initialize();
    const calls = [];
    const service = fakeService(calls, { needsInput: true });
    const controller = new AutonomousTaskController({
      service,
      taskControlStore: store,
    });
    await controller.start();

    await controller.createChangeSet({
      idempotency_key: "create-2",
      change_set_id: "change-2",
      intent: { objective: "Clarify the desired behavior" },
    });
    await waitForCommand(store, "change-2", "completed");
    await controller.stop();
    assert.deepEqual(calls, ["create", "plan"]);
  });
});

function fakeService(calls, { needsInput = false } = {}) {
  return {
    async createChangeSet() {
      calls.push("create");
      return { task_workspace_id: "workspace-1" };
    },
    async planChangeSet() {
      calls.push("plan");
      return {
        status: needsInput ? "needs_input" : "plan_ready",
        message: {
          message_id: "message-1",
          content_digest: "a".repeat(64),
          text: needsInput ? "Which behavior should be preserved?" : "I will update and verify the focused behavior.",
        },
      };
    },
    async confirmPlanMessage() {
      calls.push("confirm");
      return { change_set_id: "change-1", plan_revision: 1 };
    },
    async runTaskController() {
      calls.push("run");
      return { phase: "review", status: "settled" };
    },
    async readChangeSet() {
      return { phase: "planning", delivery_requests: [] };
    },
  };
}

async function waitForCommand(store, changeSetId, status) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await store.readTask(changeSetId);
    if (task.commands[0]?.status === status) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Task command did not reach ${status}`);
}
