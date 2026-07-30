import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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
  createTwoRepositoryPlan,
  createOneRepositoryPlan,
  ScriptedRuntime,
} from "../support/scripted-runtime.js";

describe("local two-repository vertical slice", () => {
  test("allows one Repository Project and one Repository ChangeSet", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-single-");
    const api = await createGitRepository(root, "api");
    const web = await createGitRepository(root, "web");
    const service = await ChangeFleetService.open({
      controlRoot: path.join(root, "control"), workspaceRoot: path.join(root, "workspaces"),
      runtime: new ScriptedRuntime({ plan: createOneRepositoryPlan(await writeCombinedCheckScript(root, 1)) }),
    });
    await service.registerProject({ idempotency_key: "register", project: { project_id: "project", repositories: [
      { repository_id: "api", locator: { path: api.path } },
    ] } });
    await service.createChangeSet({ idempotency_key: "create", change_set_id: "single", project_id: "project", intent: { objective: "Change only API" } });
    await service.planChangeSet({ idempotency_key: "plan", change_set_id: "single" });
    await service.confirmPlanRevision({ idempotency_key: "confirm", change_set_id: "single", plan_revision: 1 });
    const execution = await service.executeChangeSet({ idempotency_key: "execute", change_set_id: "single" });
    const state = await service.readChangeSet("single");
    assert.equal(state.candidates.length, 1);
    assert.equal(state.candidates[0].repository_id, "api");
    assert.equal(execution.bundle_revision, 1);
  });

  test("persists one exact human-decidable Bundle through restart", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-acceptance-");
    const api = await createGitRepository(root, "api", { harness: true });
    const web = await createGitRepository(root, "web", { harness: false });
    await writeFile(
      path.join(api.path, "baseline.txt"),
      "dirty API checkout content\n",
      "utf8",
    );
    await writeFile(
      path.join(api.path, "host-only.txt"),
      "must not enter workspace\n",
      "utf8",
    );
    const dirtyStatus = await git(api.path, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    const combinedScript = await writeCombinedCheckScript(root);
    const runtime = new ScriptedRuntime({
      plan: createTwoRepositoryPlan(combinedScript),
    });
    const options = {
      controlRoot: path.join(root, "control"),
      workspaceRoot: path.join(root, "workspaces"),
      runtime,
    };
    const service = await ChangeFleetService.open(options);

    const registration = await service.registerProject({
      idempotency_key: "register-1",
      project: {
        project_id: "commerce",
        description: "API and web",
        repositories: [
          {
            repository_id: "api",
            locator: { path: api.path },
            description: "API",
          },
          {
            repository_id: "web",
            locator: { path: web.path },
            description: "Web",
          },
        ],
      },
    });
    assert.equal(registration.repositories.length, 2);
    assert.equal(
      await git(api.path, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]),
      dirtyStatus,
    );
    assert.deepEqual(
      await service.registerProject({
        idempotency_key: "register-1",
        project: {
          project_id: "commerce",
          description: "API and web",
          repositories: [
            {
              repository_id: "api",
              locator: { path: api.path },
              description: "API",
            },
            {
              repository_id: "web",
              locator: { path: web.path },
              description: "Web",
            },
          ],
        },
      }),
      registration,
    );

    await service.createChangeSet({
      idempotency_key: "create-1",
      change_set_id: "checkout-change",
      project_id: "commerce",
      intent: {
        objective: "Change API and web coherently",
        constraints: ["Do not include dirty host files"],
        acceptance_criteria: ["Both exact Candidates pass combined validation"],
        source: "acceptance fixture",
      },
    });
    const planned = await service.planChangeSet({
      idempotency_key: "plan-1",
      change_set_id: "checkout-change",
    });
    assert.equal(planned.plan_revision, 1);
    const planningInvocation = runtime.invocations.find(
      (invocation) => invocation.operation === "planning",
    );
    assert.equal(planningInvocation.capabilities.mode, "read_only");
    assert.equal(
      planningInvocation.control_contract.runtime_kit.enabled,
      false,
    );
    assert.deepEqual(
      planningInvocation.context_projection.repositories.map((repository) => [
        repository.repository_id,
        repository.harness_resources.length,
      ]),
      [
        ["api", 1],
        ["web", 0],
      ],
    );

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "too-early",
        change_set_id: "checkout-change",
      }),
      { code: "PLAN_CONFIRMATION_REQUIRED" },
    );
    const confirmation = await service.confirmPlanRevision({
      idempotency_key: "confirm-1",
      change_set_id: "checkout-change",
      plan_revision: 1,
    });
    assert.deepEqual(
      await service.confirmPlanRevision({
        idempotency_key: "confirm-1",
        change_set_id: "checkout-change",
        plan_revision: 1,
      }),
      confirmation,
    );

    const execution = await service.executeChangeSet({
      idempotency_key: "execute-1",
      change_set_id: "checkout-change",
    });
    const reviewState = await service.readChangeSet("checkout-change");
    assert.equal(reviewState.state, "candidate_review");
    assert.equal(reviewState.candidates.length, 2);
    assert.equal(reviewState.bundles.length, 1);
    assert.equal(reviewState.bundles[0].bundle_hash, execution.bundle_hash);
    for (const unit of reviewState.work_units) {
      assert.equal(unit.state, "candidate_ready");
      assert.equal(
        await readFile(
          path.join(unit.workspace.workspace_path, "baseline.txt"),
          "utf8",
        ),
        `${unit.repository_id} committed baseline\n`,
      );
      await assert.rejects(
        readFile(path.join(unit.workspace.workspace_path, "host-only.txt")),
        { code: "ENOENT" },
      );
    }
    const executionInvocations = runtime.invocations.filter(
      (invocation) => invocation.operation === "execution",
    );
    assert.deepEqual(
      executionInvocations.map(
        (invocation) => invocation.capabilities.paths.length,
      ),
      [1, 1],
    );

    await assert.rejects(
      service.recordBundleDecision({
        idempotency_key: "decision-stale",
        change_set_id: "checkout-change",
        bundle_revision: execution.bundle_revision,
        bundle_hash: "0".repeat(64),
        decision: "accept",
      }),
      { code: "STALE_BUNDLE_DECISION" },
    );
    const decision = await service.recordBundleDecision({
      idempotency_key: "decision-1",
      change_set_id: "checkout-change",
      bundle_revision: execution.bundle_revision,
      bundle_hash: execution.bundle_hash,
      decision: "accept",
    });
    assert.deepEqual(
      await service.recordBundleDecision({
        idempotency_key: "decision-1",
        change_set_id: "checkout-change",
        bundle_revision: execution.bundle_revision,
        bundle_hash: execution.bundle_hash,
        decision: "accept",
      }),
      decision,
    );

    const reopened = await ChangeFleetService.open(options);
    const restored = await reopened.readChangeSet("checkout-change");
    assert.equal(restored.state, "delivery_ready");
    assert.equal(restored.decisions.at(-1).bundle_hash, execution.bundle_hash);
    assert.equal(
      await git(api.path, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]),
      dirtyStatus,
    );
  });
});
