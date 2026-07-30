import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import {
  createFixtureRoot,
  createGitRepository,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createTwoRepositoryPlan,
  ScriptedRuntime,
} from "../support/scripted-runtime.js";

describe("restart recovery", () => {
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
  await service.planChangeSet({
    idempotency_key: "plan-1",
    change_set_id: "change-1",
  });
  await service.confirmPlanRevision({
    idempotency_key: "confirm-1",
    change_set_id: "change-1",
    plan_revision: 1,
  });
}
