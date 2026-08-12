import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_TASK_AUTHORIZATION,
  TaskControlStore,
} from "../../src/adapters/filesystem/task-control-store.js";
import { createFixtureRoot } from "../support/git-fixture.js";

describe("task control store", () => {
  test("persists idempotent commands and a bounded safe timeline outside ChangeSet state", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-task-control-");
    const store = new TaskControlStore(root, {
      idFactory: sequenceId("task"),
    });
    await store.initialize();
    await store.ensureTask("change-1", DEFAULT_TASK_AUTHORIZATION);

    const first = await store.enqueue({
      changeSetId: "change-1",
      idempotencyKey: "message-1",
      kind: "message",
      payload: { text: "hello" },
    });
    const retry = await store.enqueue({
      changeSetId: "change-1",
      idempotencyKey: "message-1",
      kind: "message",
      payload: { text: "hello" },
    });
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(retry.command.command_id, first.command.command_id);

    const claimed = await store.claimNext("change-1");
    assert.equal(claimed.status, "running");
    assert.equal(claimed.attempt, 1);
    await store.settle("change-1", claimed.command_id, {
      status: "completed",
      result: { status: "done" },
    });
    await store.appendTimelineEvent("change-1", {
      role: "human",
      stage: "planning",
      text: "hello",
    });

    const task = await store.readTask("change-1");
    assert.equal(task.commands[0].status, "completed");
    assert.equal(task.timeline[0].text, "hello");
    await assert.rejects(
      store.enqueue({
        changeSetId: "change-1",
        idempotencyKey: "message-1",
        kind: "message",
        payload: { text: "different" },
      }),
      { code: "IDEMPOTENCY_KEY_REUSED" },
    );
  });

  test("recovers interrupted commands and lets cancellation supersede queued work", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-task-recovery-");
    const store = new TaskControlStore(root, {
      idFactory: sequenceId("recovery"),
    });
    await store.initialize();
    await store.ensureTask("change-2");
    await store.enqueue({
      changeSetId: "change-2",
      idempotencyKey: "initial",
      kind: "initial_plan",
      payload: {},
    });
    await store.claimNext("change-2");
    assert.equal((await store.recoverInterruptedCommands()).length, 1);
    await store.enqueue({
      changeSetId: "change-2",
      idempotencyKey: "queued-message",
      kind: "message",
      payload: { text: "later" },
    });
    const cancellation = await store.enqueueCancellation({
      changeSetId: "change-2",
      idempotencyKey: "cancel",
      payload: { reason: "stop" },
    });

    const task = await store.readTask("change-2");
    assert.deepEqual(
      task.commands.map((command) => command.status),
      ["cancelled", "cancelled", "accepted"],
    );
    assert.equal(cancellation.command.kind, "cancel");
    assert.deepEqual(await store.listPendingTaskIds(), ["change-2"]);
  });
});

function sequenceId(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}
