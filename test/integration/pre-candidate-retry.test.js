import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import {
  createFixtureRoot,
  createGitRepository,
  git,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createOneRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("pre-Candidate execution retry", () => {
  test("retries an explicit Runtime blocker without discarding audit history", async (t) => {
    const fixture = await createFixture(t, "blocked");
    const blockedRuntime = new ScriptedRuntime({
      plan: fixture.plan,
      executionOutcome: {
        type: "implementation_blocked",
        summary: "sandbox setup unavailable",
        changed_paths: [],
        blocker: {
          code: "sandbox_unavailable",
          message: "sandbox setup unavailable",
        },
      },
    });
    const service = await bootstrap(fixture, blockedRuntime);

    await assert.rejects(
      execute(service, "execute-blocked"),
      { code: "RUNTIME_IMPLEMENTATION_BLOCKED" },
    );
    const blocked = await service.readChangeSet("change-1");
    assert.equal(blocked.work_units[0].phase, "execution");
    assert.equal(
      blocked.blockers.some((item) => item.work_unit_id === "api-unit"),
      true,
    );
    assert.equal(blocked.work_units[0].run_references[0].status, "completed");
    assert.equal(blocked.candidate_checkpoints.length, 0);

    const retryRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await open(fixture, retryRuntime);
    const result = await execute(reopened, "execute-retry");
    const recovered = await reopened.readChangeSet("change-1");

    assert.equal(result.bundle_revision, 1);
    assert.equal(recovered.phase, "review");
    assert.equal(recovered.work_units[0].run_references.length, 2);
    assert.deepEqual(
      recovered.work_units[0].run_references.map((reference) => reference.status),
      ["completed", "completed"],
    );
    assert.equal(recovered.decisions.at(-1).type, "provider_retry");
    assert.equal(
      recovered.decisions.at(-1).source_run_id,
      blocked.work_units[0].run_references[0].run_id,
    );
    assert.equal(
      retryRuntime.invocations.filter((item) => item.operation === "execution").length,
      1,
    );
  });

  test("rejects an empty implementation before checkpoint and retries from exact base", async (t) => {
    const fixture = await createFixture(t, "empty");
    const emptyRuntime = new ScriptedRuntime({
      plan: fixture.plan,
      executionOutcome: {
        type: "implementation_completed",
        summary: "nothing changed",
        changed_paths: [],
        blocker: null,
      },
    });
    const service = await bootstrap(fixture, emptyRuntime);

    await assert.rejects(
      execute(service, "execute-empty"),
      { code: "EMPTY_IMPLEMENTATION_RESULT" },
    );
    const failed = await service.readChangeSet("change-1");
    assert.equal(failed.work_units[0].phase, "execution");
    assert.equal(failed.work_units[0].last_error.code, "EMPTY_IMPLEMENTATION_RESULT");
    assert.equal(failed.candidate_checkpoints.length, 0);
    assert.equal(failed.validation_attempts.length, 0);

    const retryRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await open(fixture, retryRuntime);
    await execute(reopened, "execute-empty-retry");
    const recovered = await reopened.readChangeSet("change-1");
    assert.equal(recovered.phase, "review");
    assert.equal(recovered.candidate_checkpoints.length, 1);
    assert.equal(recovered.work_units[0].run_references.length, 2);
  });

  test("refuses to reset a dirty failed workspace before retry", async (t) => {
    const fixture = await createFixture(t, "dirty");
    const service = await bootstrap(
      fixture,
      blockedRuntime(fixture.plan),
    );
    await assert.rejects(
      execute(service, "execute-blocked"),
      { code: "RUNTIME_IMPLEMENTATION_BLOCKED" },
    );
    const failed = await service.readChangeSet("change-1");
    await writeFile(
      path.join(failed.work_units[0].workspace.workspace_path, "partial.txt"),
      "partial\n",
      "utf8",
    );
    const retryRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await open(fixture, retryRuntime);

    await assert.rejects(
      execute(reopened, "execute-dirty-retry"),
      { code: "EXECUTION_RETRY_WORKSPACE_DIRTY" },
    );
    assert.equal(retryRuntime.invocations.length, 0);
  });

  test("refuses a retry after the failed workspace HEAD moved", async (t) => {
    const fixture = await createFixture(t, "moved");
    const service = await bootstrap(
      fixture,
      blockedRuntime(fixture.plan),
    );
    await assert.rejects(
      execute(service, "execute-blocked"),
      { code: "RUNTIME_IMPLEMENTATION_BLOCKED" },
    );
    const failed = await service.readChangeSet("change-1");
    await git(failed.work_units[0].workspace.workspace_path, [
      "commit",
      "--allow-empty",
      "-m",
      "move retry subject",
    ]);
    const retryRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await open(fixture, retryRuntime);

    await assert.rejects(
      execute(reopened, "execute-moved-retry"),
      { code: "EXECUTION_RETRY_HEAD_MOVED" },
    );
    assert.equal(retryRuntime.invocations.length, 0);
  });

  test("refuses stale Repository and Harness authority before recording a retry", async (t) => {
    const fixture = await createFixture(t, "stale-authority");
    const service = await bootstrap(
      fixture,
      blockedRuntime(fixture.plan),
    );
    await assert.rejects(
      execute(service, "execute-blocked"),
      { code: "RUNTIME_IMPLEMENTATION_BLOCKED" },
    );
    await service.controlStore.transactChangeSet("change-1", (state) => {
      // 模拟确认后主体被错误换指针；重试入口必须零写入失败，不能依赖后续 Runtime 派发再发现。
      const priorRepository = state.repository_selection_revisions[0];
      const priorHarness = state.repository_harness_selection_revisions[0];
      priorRepository.status = "superseded";
      priorHarness.status = "superseded";
      state.repository_selection_revisions.push({
        ...structuredClone(priorRepository),
        revision: 2,
        status: "current",
      });
      state.repository_harness_selection_revisions.push({
        ...structuredClone(priorHarness),
        revision: 2,
        status: "current",
      });
      state.current_repository_selection_revision = 2;
      state.current_repository_harness_selection_revision = 2;
    });
    const before = await service.readChangeSet("change-1");
    const decisionCount = before.decisions.length;
    const retryRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await open(fixture, retryRuntime);

    await assert.rejects(
      execute(reopened, "execute-stale-retry"),
      { code: "EXECUTION_RETRY_SUBJECT_MISMATCH" },
    );
    const after = await reopened.readChangeSet("change-1");
    assert.equal(retryRuntime.invocations.length, 0);
    assert.equal(after.decisions.length, decisionCount);
    assert.equal(after.work_units[0].phase, "execution");
  });
});

function blockedRuntime(plan) {
  return new ScriptedRuntime({
    plan,
    executionOutcome: {
      type: "implementation_blocked",
      summary: "sandbox setup unavailable",
      changed_paths: [],
      blocker: {
        code: "sandbox_unavailable",
        message: "sandbox setup unavailable",
      },
    },
  });
}

async function createFixture(t, name) {
  const root = await createFixtureRoot(t, `changefleet-pre-candidate-${name}-`);
  const api = await createGitRepository(root, "api");
  const combinedScript = await writeCombinedCheckScript(root, 1);
  return {
    root,
    api,
    combinedScript,
    plan: createOneRepositoryPlan(combinedScript),
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
  };
}

async function bootstrap(fixture, runtime) {
  const service = await open(fixture, runtime);
  await service.registerProject({
    idempotency_key: "register-1",
    project: {
      project_id: "project-1",
      repositories: [
        { repository_id: "api", locator: { path: fixture.api.path } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create-1",
    change_set_id: "change-1",
    project_id: "project-1",
    intent: { objective: "Prove exact pre-Candidate retry" },
  });
  const planned = await service.planChangeSet({
    idempotency_key: "plan-1",
    change_set_id: "change-1",
  });
  await service.confirmPlanMessage({
    idempotency_key: "confirm-1",
    change_set_id: "change-1",
    message_id: planned.message.message_id,
    content_digest: planned.message.content_digest,
  });
  return service;
}

function open(fixture, runtime) {
  return ChangeFleetService.open({
    controlRoot: fixture.controlRoot,
    workspaceRoot: fixture.workspaceRoot,
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  });
}

function execute(service, idempotencyKey) {
  return service.executeChangeSet({
    idempotency_key: idempotencyKey,
    change_set_id: "change-1",
  });
}
