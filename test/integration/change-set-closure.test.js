import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { RuntimeAuditQueryService } from "../../src/application/runtime-audit-query-service.js";
import {
  createFixtureRoot,
  createGitRepository,
} from "../support/git-fixture.js";
import { TEST_AGENT_PROFILE } from "../support/scripted-runtime.js";

const PRESERVED_FIELDS = [
  "intents",
  "repository_selection_revisions",
  "repository_selection_change_requests",
  "repository_harness_selection_revisions",
  "plans",
  "work_units",
  "run_references",
  "candidate_checkpoints",
  "validation_attempts",
  "candidates",
  "bundles",
  "delivery_requests",
  "current_revision_feedback",
  "blockers",
];

describe("explicit ChangeSet closure", () => {
  test("preserves history, survives restart, and remains read-only auditable", async (t) => {
    const fixture = await createClosureFixture(t, "complete");
    await createChangeSet(fixture.service, "change-close");
    const before = await fixture.service.readChangeSet("change-close");
    const request = closeRequest("change-close");

    const result = await fixture.service.closeChangeSet(request);
    assert.deepEqual(
      await fixture.service.closeChangeSet(request),
      result,
    );
    assert.equal(fixture.runtime.calls, 0);

    const closed = await fixture.service.readChangeSet("change-close");
    assert.equal(closed.state, "abandoned");
    for (const field of PRESERVED_FIELDS) {
      assert.deepEqual(closed[field], before[field], field);
    }
    for (const [key, command] of Object.entries(before.commands)) {
      assert.deepEqual(closed.commands[key], command, `command ${key}`);
    }
    assert.deepEqual(closed.decisions.at(-1), {
      decision_id: result.decision_id,
      type: "changeset_closure",
      disposition: "abandoned",
      actor: "human",
      reason: request.reason,
      decided_at: result.closed_at,
    });

    await assert.rejects(
      fixture.service.closeChangeSet({
        ...request,
        reason: { ...request.reason, summary: "different input" },
      }),
      { code: "IDEMPOTENCY_KEY_REUSED" },
    );
    await assert.rejects(
      fixture.service.closeChangeSet({
        ...request,
        idempotency_key: "close-again",
      }),
      { code: "CHANGE_SET_ALREADY_TERMINAL" },
    );

    for (const mutation of [
      () =>
        fixture.service.planChangeSet({
          idempotency_key: "plan-after-close",
          change_set_id: "change-close",
        }),
      () =>
        fixture.service.confirmPlanMessage({
          idempotency_key: "confirm-after-close",
          change_set_id: "change-close",
          message_id: "message-after-close",
          content_digest: "a".repeat(64),
        }),
      () =>
        fixture.service.executeChangeSet({
          idempotency_key: "execute-after-close",
          change_set_id: "change-close",
        }),
      () =>
        fixture.service.reviseRepositorySelection({
          idempotency_key: "selection-after-close",
          change_set_id: "change-close",
          current_repository_selection_revision: 1,
        }),
      () =>
        fixture.service.reviseRepositoryHarnessSelection({
          idempotency_key: "harness-after-close",
          change_set_id: "change-close",
          current_repository_harness_selection_revision: 1,
        }),
      () =>
        fixture.service.recoverLegacyCandidate({
          idempotency_key: "recovery-after-close",
          change_set_id: "change-close",
          plan_revision: 1,
          work_unit_id: "api-unit",
          source_run_id: "run-1",
          base_sha: "a".repeat(40),
          candidate_sha: "b".repeat(40),
        }),
      () =>
        fixture.service.recordBundleDecision({
          idempotency_key: "decision-after-close",
          change_set_id: "change-close",
          bundle_revision: 1,
          bundle_hash: "a".repeat(64),
          decision: "reject",
        }),
      () =>
        fixture.service.publishDelivery({
          idempotency_key: "publish-after-close",
          change_set_id: "change-close",
        }),
      () =>
        fixture.service.refreshDelivery({
          idempotency_key: "refresh-after-close",
          change_set_id: "change-close",
        }),
    ]) {
      await assert.rejects(mutation(), { code: "CHANGE_SET_ABANDONED" });
    }
    assert.equal(fixture.runtime.calls, 0);

    const reopened = await ChangeFleetService.open(fixture.options);
    assert.equal(
      (await reopened.readChangeSet("change-close")).state,
      "abandoned",
    );
    const audit = await new RuntimeAuditQueryService({
      controlStore: reopened.controlStore,
      runStore: reopened.runStore,
      evidenceStore: reopened.evidenceStore,
      clock: () => new Date("2026-08-04T12:00:00.000Z"),
    }).getChangeSetAudit("change-close");
    assert.equal(audit.payload.identity.state, "abandoned");
    assert.equal(audit.payload.timing.change_set_wall.complete, true);
    assert.equal(audit.payload.usage.referenced_run_count, 0);
  });

  test("allows representative quiescent unfinished states", async (t) => {
    const fixture = await createClosureFixture(t, "eligible");
    for (const state of ["failed", "candidate_review", "delivery_ready"]) {
      const changeSetId = `change-${state.replaceAll("_", "-")}`;
      await createChangeSet(fixture.service, changeSetId);
      await setChangeSet(fixture.service, changeSetId, (record) => {
        record.state = state;
      });
      const result = await fixture.service.closeChangeSet(
        closeRequest(changeSetId),
      );
      assert.equal(result.status, "abandoned");
    }
  });

  test("rejects active work, begun delivery, and terminal state", async (t) => {
    const fixture = await createClosureFixture(t, "blocked");

    await createChangeSet(fixture.service, "change-running");
    await setChangeSet(fixture.service, "change-running", (record) => {
      record.run_references.push({
        run_id: "run-active",
        operation: "planning",
        status: "running",
      });
    });
    await assert.rejects(
      fixture.service.closeChangeSet(closeRequest("change-running")),
      { code: "CHANGE_SET_NOT_QUIESCENT" },
    );

    await createChangeSet(fixture.service, "change-command");
    await setChangeSet(fixture.service, "change-command", (record) => {
      record.commands.active = {
        command: "executeChangeSet",
        fingerprint: "test-only",
        status: "in_progress",
      };
    });
    await assert.rejects(
      fixture.service.closeChangeSet(closeRequest("change-command")),
      { code: "CHANGE_SET_NOT_QUIESCENT" },
    );

    await createChangeSet(fixture.service, "change-delivery");
    await setChangeSet(fixture.service, "change-delivery", (record) => {
      record.state = "delivery_ready";
      record.delivery_requests.push({ delivery_request_id: "delivery-started" });
    });
    await assert.rejects(
      fixture.service.closeChangeSet(closeRequest("change-delivery")),
      { code: "CHANGE_SET_DELIVERY_STARTED" },
    );

    await createChangeSet(fixture.service, "change-done");
    await setChangeSet(fixture.service, "change-done", (record) => {
      record.state = "done";
    });
    await assert.rejects(
      fixture.service.closeChangeSet(closeRequest("change-done")),
      { code: "CHANGE_SET_ALREADY_TERMINAL" },
    );
  });
});

async function createClosureFixture(testContext, name) {
  const root = await createFixtureRoot(
    testContext,
    `changefleet-closure-${name}-`,
  );
  const repository = await createGitRepository(root, "api");
  const runtime = new RejectingRuntime();
  const options = {
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  };
  const service = await ChangeFleetService.open(options);
  await service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      repositories: [
        { repository_id: "api", locator: { path: repository.path } },
      ],
    },
  });
  return { root, options, runtime, service };
}

function createChangeSet(service, changeSetId) {
  return service.createChangeSet({
    idempotency_key: `create-${changeSetId}`,
    change_set_id: changeSetId,
    project_id: "project",
    intent: { objective: `Exercise closure for ${changeSetId}` },
  });
}

function closeRequest(changeSetId) {
  return {
    idempotency_key: `close-${changeSetId}`,
    change_set_id: changeSetId,
    actor: "human",
    reason: {
      code: "restart_on_new_base",
      summary: "Close this task before independently creating another task",
    },
  };
}

function setChangeSet(service, changeSetId, mutate) {
  return service.controlStore.transactChangeSet(changeSetId, (record) => {
    mutate(record);
    record.updated_at = new Date().toISOString();
  });
}

class RejectingRuntime {
  constructor() {
    this.calls = 0;
  }

  async invoke() {
    this.calls += 1;
    throw new Error("Closure must not invoke Runtime");
  }
}
