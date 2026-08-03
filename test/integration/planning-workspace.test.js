import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

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

test("planning reads and cleans an exact frozen detached worktree", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-planning-worktree-");
  const repository = await createGitRepository(root, "api", {
    harness: true,
  });
  const plan = createOneRepositoryPlan(
    await writeCombinedCheckScript(root, 1),
  );
  const runtime = new InspectingRuntime({ plan });
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
        { repository_id: "api", locator: { path: repository.path } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: "change",
    project_id: "project",
    intent: { objective: "Read the selected exact base" },
  });

  await writeFile(
    path.join(repository.path, "baseline.txt"),
    "new committed tip\n",
    "utf8",
  );
  await git(repository.path, ["add", "baseline.txt"]);
  await git(repository.path, ["commit", "-m", "move branch after selection"]);
  await writeFile(
    path.join(repository.path, "AGENTS.md"),
    "dirty host-only instructions\n",
    "utf8",
  );

  await service.planChangeSet({
    idempotency_key: "plan",
    change_set_id: "change",
  });

  assert.equal(runtime.snapshot.head, repository.base_sha);
  assert.equal(runtime.snapshot.baseline, "api committed baseline\n");
  assert.match(runtime.snapshot.harness, /Keep changes deterministic/u);
  assert.equal(
    runtime.snapshot.root_path,
    runtime.snapshot.capability_path,
  );
  assert.notEqual(
    path.resolve(runtime.snapshot.root_path),
    path.resolve(repository.path),
  );
  assert.equal(
    await stat(runtime.snapshot.root_path).catch(() => null),
    null,
  );
});

test("planning preserves Provider evidence when domain validation rejects the plan", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-planning-evidence-");
  const repository = await createGitRepository(root, "api");
  const plan = createOneRepositoryPlan(
    await writeCombinedCheckScript(root, 1),
  );
  plan.work_units.push({
    ...structuredClone(plan.work_units[0]),
    work_unit_id: "api-unit-duplicate",
  });
  const runtime = new CompletedProviderRuntime({ plan });
  const controlRoot = path.join(root, "control");
  const service = await ChangeFleetService.open({
    controlRoot,
    workspaceRoot: path.join(root, "workspaces"),
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  });
  await service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      repositories: [
        { repository_id: "api", locator: { path: repository.path } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: "change",
    project_id: "project",
    intent: { objective: "Reject a duplicate Repository WorkUnit" },
  });

  await assert.rejects(
    service.planChangeSet({
      idempotency_key: "plan",
      change_set_id: "change",
    }),
    { code: "DUPLICATE_REPOSITORY_WORK_UNIT" },
  );

  const state = await service.readChangeSet("change");
  const run = await service.runStore.read(state.run_references[0].run_id);
  const evidence = JSON.parse(
    await readFile(
      path.join(
        controlRoot,
        "evidence",
        `${run.runtime_evidence.evidence_id}.json`,
      ),
      "utf8",
    ),
  );
  assert.equal(run.status, "failed");
  assert.equal(evidence.payload.provider.thread_id, "completed-thread");
  assert.equal(evidence.payload.usage_observations[0].total_tokens, 77);
  assert.equal(
    evidence.payload.terminal.error_code,
    "DUPLICATE_REPOSITORY_WORK_UNIT",
  );
});

class InspectingRuntime extends ScriptedRuntime {
  async invoke(invocation, options) {
    if (invocation.operation === "planning") {
      const rootPath =
        invocation.context_projection.repositories[0].root_path;
      this.snapshot = {
        root_path: rootPath,
        capability_path: invocation.capabilities.paths[0],
        head: (await git(rootPath, ["rev-parse", "HEAD"])).trim(),
        baseline: await readFile(
          path.join(rootPath, "baseline.txt"),
          "utf8",
        ),
        harness: await readFile(path.join(rootPath, "AGENTS.md"), "utf8"),
      };
    }
    return super.invoke(invocation, options);
  }
}

class CompletedProviderRuntime extends ScriptedRuntime {
  async invoke(invocation, options) {
    const result = await super.invoke(invocation, options);
    if (invocation.operation === "planning") {
      result.provider_evidence = {
        ...result.provider_evidence,
        evidence_classification: "provider_observed",
        provider: {
          ...result.provider_evidence.provider,
          thread_id: "completed-thread",
        },
        usage_observations: [
          {
            scope: "aggregate",
            confidence: "provider_reported",
            coverage: "aggregate_only",
            input_tokens: 60,
            cached_input_tokens: 20,
            cache_write_input_tokens: 0,
            output_tokens: 17,
            reasoning_output_tokens: 5,
            total_tokens: 77,
            provider_cost: null,
          },
        ],
      };
    }
    return result;
  }
}
