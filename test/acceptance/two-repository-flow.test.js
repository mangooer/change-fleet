import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
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
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("local two-repository vertical slice", () => {
  test("isolates concurrent tasks and releases only their terminal worktrees", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-task-isolation-");
    const api = await createGitRepository(root, "api");
    const service = await ChangeFleetService.open({
      controlRoot: path.join(root, "control"),
      workspaceRoot: path.join(root, "workspaces"),
      runtime: new ScriptedRuntime({
        plan: createOneRepositoryPlan(await writeCombinedCheckScript(root, 1)),
      }),
      agentProfile: TEST_AGENT_PROFILE,
    });
    await service.registerProject({
      idempotency_key: "register",
      project: {
        project_id: "project",
        repositories: [
          { repository_id: "api", locator: { path: api.path } },
        ],
      },
    });
    for (const changeSetId of ["feature-a", "feature-b"]) {
      await service.createChangeSet({
        idempotency_key: `create-${changeSetId}`,
        change_set_id: changeSetId,
        project_id: "project",
        intent: { objective: `Implement ${changeSetId}` },
      });
    }
    const [first, second] = await Promise.all([
      service.readChangeSet("feature-a"),
      service.readChangeSet("feature-b"),
    ]);
    const firstRepository = first.task_workspace.repositories[0];
    const secondRepository = second.task_workspace.repositories[0];
    assert.notEqual(
      first.task_workspace.task_workspace_id,
      second.task_workspace.task_workspace_id,
    );
    assert.notEqual(firstRepository.branch_ref, secondRepository.branch_ref);
    assert.notEqual(
      firstRepository.workspace.workspace_path,
      secondRepository.workspace.workspace_path,
    );

    await service.closeChangeSet({
      idempotency_key: "close-a",
      change_set_id: "feature-a",
      actor: "test-operator",
      reason: { code: "other", summary: "Complete isolation fixture" },
    });
    const closed = await service.readChangeSet("feature-a");
    assert.notEqual(closed.task_workspace.resources_released_at, null);
    assert.equal(
      await stat(firstRepository.workspace.workspace_path).catch(() => null),
      null,
    );
    assert.equal(
      (await stat(secondRepository.workspace.workspace_path)).isDirectory(),
      true,
    );
  });

  test("allows one Repository Project and one Repository ChangeSet", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-single-");
    const api = await createGitRepository(root, "api");
    await git(api.path, ["checkout", "-b", "feature"]);
    await writeFile(path.join(api.path, "feature-base.txt"), "feature base\n");
    await git(api.path, ["add", "feature-base.txt"]);
    await git(api.path, ["commit", "-m", "feature base"]);
    const featureSha = (await git(api.path, ["rev-parse", "HEAD"])).trim();
    await git(api.path, ["checkout", "main"]);
    const service = await ChangeFleetService.open({
      controlRoot: path.join(root, "control"), workspaceRoot: path.join(root, "workspaces"),
      runtime: new ScriptedRuntime({ plan: createOneRepositoryPlan(await writeCombinedCheckScript(root, 1)) }),
      agentProfile: TEST_AGENT_PROFILE,
    });
    await service.registerProject({ idempotency_key: "register", project: { project_id: "project", repositories: [
      { repository_id: "api", locator: { path: api.path } },
    ] } });
    await service.createChangeSet({ idempotency_key: "create", change_set_id: "single", project_id: "project", intent: { objective: "Change only API" } });
    await service.planChangeSet({ idempotency_key: "plan-1", change_set_id: "single" });
    await service.reviseRepositorySelection({
      idempotency_key: "selection-2",
      change_set_id: "single",
      current_repository_selection_revision: 1,
      planning_repository_ids: ["api"],
      repository_selections: [{ repository_id: "api", branch_ref: "feature", target_ref: "main" }],
    });
    await git(api.path, ["checkout", "feature"]);
    await writeFile(path.join(api.path, "feature-base.txt"), "moved feature\n");
    await git(api.path, ["add", "feature-base.txt"]);
    await git(api.path, ["commit", "-m", "move selected branch"]);
    assert.notEqual(
      (await git(api.path, ["rev-parse", "HEAD"])).trim(),
      featureSha,
    );
    await git(api.path, ["checkout", "main"]);
    const planned = await service.planChangeSet({ idempotency_key: "plan-2", change_set_id: "single" });
    await service.confirmPlanMessage({
      idempotency_key: "confirm",
      change_set_id: "single",
      message_id: planned.message.message_id,
      content_digest: planned.message.content_digest,
    });
    const execution = await service.executeChangeSet({ idempotency_key: "execute", change_set_id: "single" });
    const state = await service.readChangeSet("single");
    assert.equal(state.candidates.length, 1);
    assert.equal(state.candidates[0].repository_id, "api");
    assert.equal(state.candidates[0].base_sha, featureSha);
    assert.equal(state.candidates[0].target_ref, "refs/heads/main");
    assert.equal(state.current_repository_selection_revision, 2);
    assert.equal(execution.bundle_revision, 1);
    await assert.rejects(
      service.reviseRepositorySelection({
        idempotency_key: "selection-too-early",
        change_set_id: "single",
        current_repository_selection_revision: 2,
        planning_repository_ids: ["api"],
      }),
      { code: "INVALID_CHANGE_SET_STATE" },
    );
    await service.recordBundleDecision({
      idempotency_key: "request-revision",
      change_set_id: "single",
      bundle_revision: execution.bundle_revision,
      bundle_hash: execution.bundle_hash,
      decision: "request_revision",
      feedback: {
        summary: "Move this ChangeSet to the newly selected base",
        findings: [
          {
            finding_id: "base-selection",
            text: "Replan against the current main branch",
          },
        ],
      },
    });
    await assert.rejects(
      service.reviseRepositorySelection({
        idempotency_key: "selection-3",
        change_set_id: "single",
        current_repository_selection_revision: 2,
        planning_repository_ids: ["api"],
        repository_selections: [{ repository_id: "api", branch_ref: "main" }],
      }),
      { code: "INVALID_CHANGE_SET_STATE" },
    );
    const revised = await service.readChangeSet("single");
    assert.equal(revised.current_repository_selection_revision, 2);
    assert.equal(revised.current_plan_revision, 1);
    assert.equal(revised.candidates.length, 1);
    assert.equal(revised.bundles.length, 1);
    assert.equal(
      revised.work_units.find((unit) => unit.plan_revision === 1).phase,
      "execution",
    );
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
      agentProfile: TEST_AGENT_PROFILE,
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
    assert.equal(planned.status, "plan_ready");
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
    const confirmation = await service.confirmPlanMessage({
      idempotency_key: "confirm-1",
      change_set_id: "checkout-change",
      message_id: planned.message.message_id,
      content_digest: planned.message.content_digest,
    });
    assert.deepEqual(
      await service.confirmPlanMessage({
        idempotency_key: "confirm-1",
        change_set_id: "checkout-change",
        message_id: planned.message.message_id,
        content_digest: planned.message.content_digest,
      }),
      confirmation,
    );

    const execution = await service.executeChangeSet({
      idempotency_key: "execute-1",
      change_set_id: "checkout-change",
    });
    const reviewState = await service.readChangeSet("checkout-change");
    assert.equal(reviewState.phase, "review");
    assert.equal(reviewState.candidates.length, 2);
    assert.equal(reviewState.bundles.length, 1);
    assert.equal(reviewState.bundles[0].bundle_hash, execution.bundle_hash);
    for (const unit of reviewState.work_units) {
      assert.equal(unit.phase, "complete");
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
      [2, 2],
    );
    for (const invocation of executionInvocations) {
      assert.deepEqual(
        invocation.context_projection.repositories.map((repository) =>
          repository.access,
        ),
        ["read_write", "read_only"],
      );
    }

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
    assert.equal(restored.phase, "delivery");
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

  test("keeps the ChangeSet working while independent WorkUnits occupy different phases", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-mixed-phases-");
    const api = await createGitRepository(root, "api");
    const web = await createGitRepository(root, "web");
    const combinedScript = await writeCombinedCheckScript(root);
    const plan = createTwoRepositoryPlan(combinedScript);
    const entered = deferred();
    const released = deferred();

    class PausingRuntime extends ScriptedRuntime {
      async invoke(invocation) {
        if (
          invocation.operation === "execution" &&
          invocation.context_projection.work_unit.repository_id === "web"
        ) {
          entered.resolve();
          await released.promise;
        }
        return super.invoke(invocation);
      }
    }

    const runtime = new PausingRuntime({ plan });
    const service = await ChangeFleetService.open({
      controlRoot: path.join(root, "control"),
      workspaceRoot: path.join(root, "workspaces"),
      runtime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    await service.registerProject({
      idempotency_key: "register",
      project: {
        project_id: "project",
        repositories: [
          { repository_id: "api", locator: { path: api.path } },
          { repository_id: "web", locator: { path: web.path } },
        ],
      },
    });
    await service.createChangeSet({
      idempotency_key: "create",
      change_set_id: "mixed-phases",
      project_id: "project",
      intent: { objective: "Change two independent repositories" },
    });
    const planned = await service.planChangeSet({
      idempotency_key: "plan",
      change_set_id: "mixed-phases",
    });
    await service.confirmPlanMessage({
      idempotency_key: "confirm",
      change_set_id: "mixed-phases",
      message_id: planned.message.message_id,
      content_digest: planned.message.content_digest,
    });

    const execution = service.executeChangeSet({
      idempotency_key: "execute",
      change_set_id: "mixed-phases",
    });
    await entered.promise;
    try {
      const state = await service.readChangeSet("mixed-phases");
      assert.equal(state.phase, "working");
      assert.equal(
        state.work_units.find((unit) => unit.repository_id === "api").phase,
        "verification",
      );
      assert.equal(
        state.work_units.find((unit) => unit.repository_id === "web").phase,
        "execution",
      );
      assert.equal(
        state.work_units
          .find((unit) => unit.repository_id === "web")
          .run_references.at(-1).status,
        "running",
      );
    } finally {
      released.resolve();
    }
    const result = await execution;
    assert.equal(result.bundle_revision, 1);
  });
});

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
