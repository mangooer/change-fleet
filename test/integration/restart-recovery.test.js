import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { ChangeFleetError } from "../../src/domain/errors.js";
import {
  createFixtureRoot,
  createGitRepository,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createOneRepositoryPlan,
  createTwoRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("restart recovery", () => {
  test("abandons an interrupted planning thread and retries from a fresh worktree", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-plan-recovery-");
    const api = await createGitRepository(root, "api");
    const plan = createOneRepositoryPlan(
      await writeCombinedCheckScript(root, 1),
    );
    const options = {
      controlRoot: path.join(root, "control"),
      workspaceRoot: path.join(root, "workspaces"),
      agentProfile: TEST_AGENT_PROFILE,
    };
    const first = await ChangeFleetService.open({
      ...options,
      runtime: new PlanningInterruptRuntime({ plan }),
    });
    await first.registerProject({
      idempotency_key: "register",
      project: {
        project_id: "project",
        repositories: [
          { repository_id: "api", locator: { path: api.path } },
        ],
      },
    });
    await first.createChangeSet({
      idempotency_key: "create",
      change_set_id: "change",
      project_id: "project",
      intent: { objective: "Recover planning" },
    });
    await assert.rejects(
      first.planChangeSet({
        idempotency_key: "plan-interrupted",
        change_set_id: "change",
      }),
      { code: "CONTROLLER_INTERRUPTED" },
    );
    const interruptedState = await first.readChangeSet("change");
    const interruptedRunId = interruptedState.run_references[0].run_id;
    const interruptedRun = await first.runStore.read(interruptedRunId);
    const interruptedWorkspace =
      interruptedRun.planning_workspaces[0].workspace_path;
    assert.equal(interruptedRun.status, "running");
    assert.equal((await stat(interruptedWorkspace)).isDirectory(), true);

    const secondRuntime = new ScriptedRuntime({ plan });
    const reopened = await ChangeFleetService.open({
      ...options,
      runtime: secondRuntime,
    });
    await reopened.planChangeSet({
      idempotency_key: "plan-retry",
      change_set_id: "change",
    });

    const recoveredState = await reopened.readChangeSet("change");
    assert.deepEqual(
      recoveredState.run_references.map((reference) => reference.status),
      ["abandoned", "completed"],
    );
    const recoveredRun = await reopened.runStore.read(interruptedRunId);
    assert.equal(recoveredRun.status, "abandoned");
    assert.equal(recoveredRun.outcome.type, "controller_restart");
    assert.equal(recoveredRun.runtime_evidence.kind, "runtime_invocation");
    assert.equal(await stat(interruptedWorkspace).catch(() => null), null);
    assert.equal(secondRuntime.invocations.length, 1);
  });

  test("abandons an interrupted Run and resumes without duplicate dispatch", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-recovery-");
    const api = await createGitRepository(root, "api");
    const web = await createGitRepository(root, "web");
    const combinedScript = await writeCombinedCheckScript(root);
    const plan = createTwoRepositoryPlan(combinedScript);
    const firstRuntime = new ScriptedRuntime({
      plan,
      interruptRepository: "api",
    });
    const options = {
      controlRoot: path.join(root, "control"),
      workspaceRoot: path.join(root, "workspaces"),
      agentProfile: TEST_AGENT_PROFILE,
    };
    const first = await ChangeFleetService.open({
      ...options,
      runtime: firstRuntime,
    });
    await bootstrap(first, api.path, web.path);

    await assert.rejects(
      first.executeChangeSet({
        idempotency_key: "execute-1",
        change_set_id: "change-1",
      }),
      { code: "CONTROLLER_INTERRUPTED" },
    );
    const interrupted = await first.readChangeSet("change-1");
    const apiUnit = interrupted.work_units.find(
      (unit) => unit.work_unit_id === "api-unit",
    );
    assert.equal(apiUnit.state, "running");
    assert.equal(apiUnit.run_references.length, 1);

    const secondRuntime = new ScriptedRuntime({ plan });
    const reopened = await ChangeFleetService.open({
      ...options,
      runtime: secondRuntime,
    });
    const result = await reopened.executeChangeSet({
      idempotency_key: "execute-1",
      change_set_id: "change-1",
    });
    const recovered = await reopened.readChangeSet("change-1");
    const recoveredApi = recovered.work_units.find(
      (unit) => unit.work_unit_id === "api-unit",
    );
    assert.equal(result.bundle_revision, 1);
    assert.deepEqual(
      recoveredApi.run_references.map((reference) => reference.status),
      ["abandoned", "completed"],
    );
    assert.equal(
      firstRuntime.invocations.filter(
        (invocation) => invocation.operation === "execution",
      ).length,
      1,
    );
    assert.equal(
      secondRuntime.invocations.filter(
        (invocation) => invocation.operation === "execution",
      ).length,
      2,
    );

    const repeated = await reopened.executeChangeSet({
      idempotency_key: "execute-1",
      change_set_id: "change-1",
    });
    assert.deepEqual(repeated, result);
    assert.equal(
      secondRuntime.invocations.filter(
        (invocation) => invocation.operation === "execution",
      ).length,
      2,
    );
  });
});

class PlanningInterruptRuntime extends ScriptedRuntime {
  async invoke(invocation) {
    this.invocations.push(structuredClone(invocation));
    throw new ChangeFleetError(
      "CONTROLLER_INTERRUPTED",
      "Simulated controller loss while planning",
    );
  }
}

async function bootstrap(service, apiPath, webPath) {
  await service.registerProject({
    idempotency_key: "register-1",
    project: {
      project_id: "project-1",
      description: "Recovery fixture",
      repositories: [
        { repository_id: "api", locator: { path: apiPath } },
        { repository_id: "web", locator: { path: webPath } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create-1",
    change_set_id: "change-1",
    project_id: "project-1",
    intent: {
      objective: "Change API and web coherently",
      acceptance_criteria: ["Both repositories contain feature.txt"],
    },
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
}
