import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
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
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("application failure and revision boundaries", () => {
  test("preserves partial failure and cannot assemble a complete Bundle", async (t) => {
    const fixture = await createApplicationFixture(t, "partial");
    const runtime = new ScriptedRuntime({
      plan: fixture.plan,
      failRepository: "web",
    });
    const service = await openBootstrappedService(fixture, runtime);

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-1",
        change_set_id: "change-1",
      }),
      { code: "SCRIPTED_EXECUTION_FAILURE" },
    );
    const state = await service.readChangeSet("change-1");
    assert.equal(state.state, "failed");
    assert.equal(state.candidates.length, 1);
    assert.equal(state.candidates[0].repository_id, "api");
    assert.equal(state.bundles.length, 0);
    assert.equal(
      state.work_units.find((unit) => unit.repository_id === "web").state,
      "failed",
    );
  });

  test("fails combined validation when a Candidate workspace changes", async (t) => {
    const fixture = await createApplicationFixture(t, "mutating");
    const mutatingScript = path.join(fixture.root, "mutating-check.mjs");
    await writeFile(
      mutatingScript,
      [
        'import { readFile, writeFile } from "node:fs/promises";',
        "const manifest = JSON.parse(await readFile(process.env.CHANGEFLEET_VALIDATION_MANIFEST, 'utf8'));",
        "await writeFile(`${manifest.candidates[0].workspace_path}/tampered.txt`, 'changed\\n', 'utf8');",
        "",
      ].join("\n"),
      "utf8",
    );
    fixture.plan.combined_check.argv = [mutatingScript];
    const service = await openBootstrappedService(
      fixture,
      new ScriptedRuntime({ plan: fixture.plan }),
    );

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-1",
        change_set_id: "change-1",
      }),
      { code: "COMBINED_VALIDATION_FAILED" },
    );
    const state = await service.readChangeSet("change-1");
    assert.equal(state.state, "failed");
    assert.equal(state.candidates.length, 2);
    assert.equal(state.bundles.length, 0);
  });

  test("replanning continues one ChangeSet and preserves superseded work", async (t) => {
    const fixture = await createApplicationFixture(t, "replan");
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const service = await ChangeFleetService.open({
      controlRoot: fixture.controlRoot,
      workspaceRoot: fixture.workspaceRoot,
      runtime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    await registerAndCreate(service, fixture);
    await service.planChangeSet({
      idempotency_key: "plan-1",
      change_set_id: "change-1",
    });
    await service.planChangeSet({
      idempotency_key: "plan-2",
      change_set_id: "change-1",
    });

    const state = await service.readChangeSet("change-1");
    assert.equal(state.change_set_id, "change-1");
    assert.equal(state.current_plan_revision, 2);
    assert.deepEqual(
      state.plans.map((plan) => plan.status),
      ["superseded", "proposed"],
    );
    assert.equal(state.work_units.length, 4);
    assert.deepEqual(
      state.work_units
        .filter((unit) => unit.plan_revision === 1)
        .map((unit) => unit.state),
      ["superseded", "superseded"],
    );
  });
});

async function createApplicationFixture(t, name) {
  const root = await createFixtureRoot(t, `changefleet-${name}-`);
  const api = await createGitRepository(root, "api");
  const web = await createGitRepository(root, "web");
  const combinedScript = await writeCombinedCheckScript(root);
  return {
    root,
    api,
    web,
    plan: createTwoRepositoryPlan(combinedScript),
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
  };
}

async function openBootstrappedService(fixture, runtime) {
  const service = await ChangeFleetService.open({
    controlRoot: fixture.controlRoot,
    workspaceRoot: fixture.workspaceRoot,
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  });
  await registerAndCreate(service, fixture);
  await service.planChangeSet({
    idempotency_key: "plan-1",
    change_set_id: "change-1",
  });
  await service.confirmPlanRevision({
    idempotency_key: "confirm-1",
    change_set_id: "change-1",
    plan_revision: 1,
  });
  return service;
}

async function registerAndCreate(service, fixture) {
  await service.registerProject({
    idempotency_key: "register-1",
    project: {
      project_id: "project-1",
      repositories: [
        { repository_id: "api", locator: { path: fixture.api.path } },
        { repository_id: "web", locator: { path: fixture.web.path } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create-1",
    change_set_id: "change-1",
    project_id: "project-1",
    intent: {
      objective: "Change both repositories",
      acceptance_criteria: ["Produce one exact Bundle"],
    },
  });
}
