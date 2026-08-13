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

  test("automatically returns exact verification feedback to execution within budget", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-autonomous-repair-");
    const store = new TaskControlStore(root);
    await store.initialize();
    const calls = [];
    const state = feedbackState();
    const service = fakeService(calls, {
      state,
      runResults: [
        {
          phase: "running",
          status: "feedback_required",
          feedback_id: "feedback-1",
        },
        { phase: "review", status: "settled" },
      ],
    });
    const controller = new AutonomousTaskController({
      service,
      taskControlStore: store,
      clock: () => new Date("2026-08-07T00:00:02.000Z"),
    });
    await controller.start();

    await controller.createChangeSet({
      idempotency_key: "create-repair",
      change_set_id: "change-1",
      intent: { objective: "Repair the focused behavior" },
    });
    const task = await waitForCommand(store, "change-1", "completed");
    await controller.stop();

    assert.deepEqual(calls, ["create", "plan", "confirm", "run", "run"]);
    assert.equal(task.hold, null);
    assert.equal(
      task.timeline.some((event) => event.kind === "automatic_repair"),
      true,
    );
  });

  test("requests human input when exact repair capacity is exhausted", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-autonomous-budget-");
    const store = new TaskControlStore(root);
    await store.initialize();
    const calls = [];
    const state = feedbackState({ exhausted: true });
    const service = fakeService(calls, {
      state,
      runResults: [
        {
          phase: "running",
          status: "feedback_required",
          feedback_id: "feedback-1",
        },
      ],
    });
    const controller = new AutonomousTaskController({
      service,
      taskControlStore: store,
      clock: () => new Date("2026-08-07T00:00:02.000Z"),
    });
    await controller.start();

    await controller.createChangeSet({
      idempotency_key: "create-budget",
      change_set_id: "change-1",
      intent: { objective: "Repair the focused behavior" },
    });
    const task = await waitForCommand(store, "change-1", "completed");
    await controller.stop();

    assert.deepEqual(calls, ["create", "plan", "confirm", "run"]);
    assert.equal(task.hold.reason, "repair_budget_exhausted");
    assert.equal(
      task.timeline.some((event) => event.kind === "human_request"),
      true,
    );
  });
});

function fakeService(
  calls,
  { needsInput = false, runResults = null, state = null } = {},
) {
  const queuedRunResults = runResults === null ? null : [...runResults];
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
      return queuedRunResults?.shift() ?? { phase: "review", status: "settled" };
    },
    async readChangeSet() {
      return state ?? { phase: "planning", delivery_requests: [] };
    },
  };
}

function feedbackState({ exhausted = false } = {}) {
  const executionReferences = (exhausted ? [1, 2, 3] : [1]).map((attempt) => ({
    run_id: `execution-${attempt}`,
    operation: "execution",
    trigger: attempt === 1 ? "initial" : "feedback",
    status: "completed",
  }));
  return {
    change_set_id: "change-1",
    phase: "running",
    terminal_outcome: null,
    current_plan_revision: 1,
    current_repository_selection_revision: 1,
    current_repository_harness_selection_revision: 1,
    plans: [
      {
        revision: 1,
        status: "confirmed",
        confirmed_at: "2026-08-07T00:00:00.000Z",
        bundle_review: { mode: "none", attempt_limit: 1 },
        supervision: {
          mode: "autonomous_until_review",
          execution_attempt_limit_per_work_unit: 3,
          verification_attempt_limit_per_work_unit: 3,
          feedback_cycle_limit_per_work_unit: 2,
          elapsed_time_limit_ms: 1_800_000,
        },
      },
    ],
    work_units: [
      {
        plan_revision: 1,
        work_unit_id: "unit-1",
        repository_id: "repository-1",
        phase: "verification",
        disposition: "current",
        run_references: executionReferences,
        validation_attempt_ids: [],
        candidate_checkpoint_id: "checkpoint-1",
        pending_feedback_id: "feedback-1",
        candidate: null,
        last_error: null,
      },
    ],
    run_references: executionReferences,
    validation_attempts: [],
    bundles: [],
    bundle_review_assessments: [],
    current_bundle_review_assessment_id: null,
    blockers: [],
    gates: [],
    delivery_requests: [],
    feedback_records: [
      {
        feedback_id: "feedback-1",
        source: "verification",
        target: { work_unit_id: "unit-1" },
      },
    ],
    current_feedback_id: "feedback-1",
    supervision_control: {
      plan_revision: 1,
      authorized_at: "2026-08-07T00:00:00.000Z",
      active_elapsed_ms: 0,
      active_started_at: "2026-08-07T00:00:00.000Z",
      hold: null,
      last_stop_reason: null,
      updated_at: "2026-08-07T00:00:00.000Z",
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
