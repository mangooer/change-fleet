import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  symlink,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { RepositoryWorker } from "../../src/adapters/git/repository-worker.js";
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

const SKILL_PATH = ".agents/skills/private/SKILL.md";
const FROZEN_SKILL = "# Private Skill\n\nUse the frozen instruction.\n";

describe("Repository Harness overlays", () => {
  test("freezes ignored Harness, restores it after restart, and excludes it from the Candidate", async (t) => {
    const fixture = await createHarnessFixture(t, "vertical");
    await Promise.all(
      Array.from({ length: 33 }, (_, index) => {
        const relativePath =
          `.agents/skills/sample-${String(index).padStart(2, "0")}/SKILL.md`;
        const absolutePath = path.join(fixture.repository.path, relativePath);
        return mkdir(path.dirname(absolutePath), { recursive: true }).then(
          () => writeFile(absolutePath, `# Sample ${index}\n`, "utf8"),
        );
      }),
    );
    const plan = createOneRepositoryPlan(
      await writeCombinedCheckScript(fixture.root, 1),
    );
    const planningRuntime = new InspectingHarnessRuntime({ plan });
    const options = serviceOptions(fixture, planningRuntime);
    const service = await ChangeFleetService.open(options);
    await registerAndConfigure(service, fixture.repository.path);
    const creation = await service.createChangeSet({
      idempotency_key: "create",
      change_set_id: "change",
      project_id: "project",
      intent: { objective: "Use private project Harness" },
    });
    assert.equal(creation.repository_harness_selection_revision, 1);
    assert.equal(creation.repository_harness[0].mode, "exact_base_plus_overlay");
    assert.equal(
      creation.repository_harness[0].resolved_relative_paths.length,
      34,
    );
    assert.equal(
      creation.repository_harness[0].resolved_relative_paths.includes(
        SKILL_PATH,
      ),
      true,
    );

    await writeFile(fixture.skillPath, "changed after freeze\n", "utf8");
    assert.deepEqual(
      await service.createChangeSet({
        idempotency_key: "create",
        change_set_id: "change",
        project_id: "project",
        intent: { objective: "Use private project Harness" },
      }),
      creation,
    );
    await assert.rejects(
      service.createChangeSet({
        idempotency_key: "create",
        change_set_id: "change",
        project_id: "project",
        intent: { objective: "Use private project Harness" },
        actor: "different-actor",
      }),
      { code: "IDEMPOTENCY_KEY_REUSED" },
    );
    const planned = await service.planChangeSet({
      idempotency_key: "plan",
      change_set_id: "change",
    });
    assert.equal(planningRuntime.observations[0].content, FROZEN_SKILL);
    assert.equal(
      planningRuntime.observations[0].resource.source,
      "frozen_overlay",
    );
    assert.equal(
      JSON.stringify(planningRuntime.invocations[0]).includes(FROZEN_SKILL),
      false,
    );
    const planningRepository =
      planningRuntime.invocations[0].context_projection.repositories[0];
    assert.equal(planningRepository.harness_resources.length, 32);
    assert.equal(
      planningRepository.harness_resource_summary.total_count,
      35,
    );
    assert.equal(
      planningRepository.harness_resource_summary.omitted_count,
      3,
    );
    assert.match(
      planningRepository.harness_resource_summary.identity_digest,
      /^[0-9a-f]{64}$/u,
    );
    await service.confirmPlanRevision({
      idempotency_key: "confirm",
      change_set_id: "change",
      plan_revision: planned.plan_revision,
    });
    await unlink(fixture.skillPath);

    const executionRuntime = new InspectingHarnessRuntime({ plan });
    const reopened = await ChangeFleetService.open(
      serviceOptions(fixture, executionRuntime),
    );
    const result = await reopened.executeChangeSet({
      idempotency_key: "execute",
      change_set_id: "change",
    });
    assert.equal(result.bundle_revision, 1);
    assert.equal(executionRuntime.observations[0].content, FROZEN_SKILL);
    const state = await reopened.readChangeSet("change");
    assert.equal(
      state.repository_harness_selection_revisions[0].confirmed_by,
      "human",
    );
    const unit = state.work_units.find(
      (candidate) => candidate.plan_revision === state.current_plan_revision,
    );
    assert.deepEqual(unit.candidate.changed_paths, ["feature.txt"]);
    assert.equal(
      await stat(
        path.join(unit.workspace.workspace_path, SKILL_PATH),
      ).catch(() => null),
      null,
    );
    assert.equal(
      await stat(
        path.join(unit.workspace.workspace_path, ".agents"),
      ).catch(() => null),
      null,
    );
    assert.equal(
      await stat(fixture.skillPath).catch(() => null),
      null,
    );
    const executionReference = state.run_references.find(
      (reference) => reference.operation === "execution",
    );
    const run = await reopened.runStore.read(executionReference.run_id);
    const evidence = await reopened.evidenceStore.read(
      run.runtime_evidence.evidence_id,
    );
    assert.equal(
      evidence.payload.repository_harness_selection.repositories[0]
        .content_digest,
      creation.repository_harness[0].content_digest,
    );
    const observation =
      evidence.payload.repository_harness_observation.repositories[0];
    assert.equal(observation.exact_base_resources.length, 1);
    assert.equal(observation.frozen_overlay_resources.length, 34);
    assert.deepEqual(observation.provider_discovery, {
      coverage: "unavailable",
      discovered_resources: [],
      loaded_resources: [],
    });
  });

  test("uses only semantic intersections from a tracked exact-base .worktreeinclude", async (t) => {
    const fixture = await createHarnessFixture(t, "manifest", {
      manifest: true,
      includeEnvironmentFile: true,
    });
    await Promise.all(
      Array.from({ length: 34 }, (_, index) =>
        writeFile(
          path.join(
            fixture.repository.path,
            `.env.${String(index).padStart(2, "0")}`,
          ),
          "SECRET=value\n",
          "utf8",
        ),
      ),
    );
    const service = await ChangeFleetService.open(
      serviceOptions(
        fixture,
        new ScriptedRuntime({
          plan: createOneRepositoryPlan(
            await writeCombinedCheckScript(fixture.root, 1),
          ),
        }),
      ),
    );
    await registerProject(service, fixture.repository.path);
    await service.reviseRepositoryWorkspacePolicy({
      idempotency_key: "policy",
      project_id: "project",
      repository_id: "api",
      policy: {
        selector: "exact_base_worktreeinclude",
        manifest_path: ".worktreeinclude",
      },
    });
    const creation = await service.createChangeSet({
      idempotency_key: "create",
      change_set_id: "change",
      project_id: "project",
      intent: { objective: "Use the manifest-selected Harness only" },
    });
    assert.deepEqual(
      creation.repository_harness[0].resolved_relative_paths,
      [SKILL_PATH],
    );
    const skipped = creation.repository_harness[0].skipped_resources;
    assert.equal(skipped.length, 33);
    assert.deepEqual(skipped[0], {
      path: ".env",
      reason: "outside_provider_semantic_roots",
    });
    assert.deepEqual(skipped.at(-1), {
      reason: "additional_nonsemantic_matches",
      count: 3,
    });
  });

  test("reuses Repository policy while each Harness revision freezes its own digest", async (t) => {
    const fixture = await createHarnessFixture(t, "revision");
    const runtime = new InspectingHarnessRuntime({
      plan: createOneRepositoryPlan(
        await writeCombinedCheckScript(fixture.root, 1),
      ),
    });
    const service = await ChangeFleetService.open(
      serviceOptions(fixture, runtime),
    );
    await registerAndConfigure(service, fixture.repository.path);
    const creation = await service.createChangeSet({
      idempotency_key: "create",
      change_set_id: "change",
      project_id: "project",
      intent: { objective: "Revise frozen Harness input" },
    });
    await service.planChangeSet({
      idempotency_key: "plan-1",
      change_set_id: "change",
    });

    await writeFile(fixture.skillPath, "second frozen revision\n", "utf8");
    await service.reviseRepositoryWorkspacePolicy({
      idempotency_key: "policy-2",
      project_id: "project",
      repository_id: "api",
      policy: {
        selector: "explicit_patterns",
        patterns: [".agents/skills/**"],
      },
    });
    assert.deepEqual(
      await service.createChangeSet({
        idempotency_key: "create",
        change_set_id: "change",
        project_id: "project",
        intent: { objective: "Revise frozen Harness input" },
      }),
      creation,
    );
    const revision = await service.reviseRepositoryHarnessSelection({
      idempotency_key: "harness-2",
      change_set_id: "change",
      current_repository_harness_selection_revision: 1,
    });
    assert.equal(revision.repository_harness_selection_revision, 2);
    assert.equal(revision.repositories[0].workspace_policy_revision, 2);
    assert.notEqual(
      revision.repositories[0].content_digest,
      creation.repository_harness[0].content_digest,
    );
    const revisedState = await service.readChangeSet("change");
    assert.equal(revisedState.current_plan_revision, null);
    assert.equal(revisedState.plans[0].status, "superseded");
    assert.deepEqual(
      revisedState.repository_harness_selection_revisions.map(
        (selection) => selection.status,
      ),
      ["superseded", "current"],
    );

    await service.planChangeSet({
      idempotency_key: "plan-2",
      change_set_id: "change",
    });
    assert.equal(
      runtime.observations.at(-1).content,
      "second frozen revision\n",
    );
    await assert.rejects(
      service.reviseRepositoryHarnessSelection({
        idempotency_key: "stale-harness",
        change_set_id: "change",
        current_repository_harness_selection_revision: 1,
      }),
      { code: "STALE_REPOSITORY_HARNESS_SELECTION_REVISION" },
    );

    const later = await service.createChangeSet({
      idempotency_key: "create-later",
      change_set_id: "later",
      project_id: "project",
      intent: { objective: "Reuse the current Repository policy" },
    });
    assert.equal(later.repository_harness[0].workspace_policy_revision, 2);
    assert.equal(
      later.repository_harness[0].content_digest,
      revision.repositories[0].content_digest,
    );
  });

  test("fails closed when execution mutates a frozen overlay", async (t) => {
    const fixture = await createHarnessFixture(t, "mutation");
    const runtime = new MutatingHarnessRuntime({
      plan: createOneRepositoryPlan(
        await writeCombinedCheckScript(fixture.root, 1),
      ),
    });
    const service = await ChangeFleetService.open(
      serviceOptions(fixture, runtime),
    );
    await registerAndConfigure(service, fixture.repository.path);
    await createPlanAndConfirm(service);

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute",
        change_set_id: "change",
      }),
      { code: "HARNESS_OVERLAY_MODIFIED" },
    );
    const state = await service.readChangeSet("change");
    assert.equal(state.candidates.length, 0);
    assert.equal(state.state, "failed");
    assert.equal(await readFile(fixture.skillPath, "utf8"), FROZEN_SKILL);
  });

  test("detects planning mutation and still removes the owned worktree", async (t) => {
    const fixture = await createHarnessFixture(t, "planning-mutation");
    const runtime = new MutatingPlanningHarnessRuntime({
      plan: createOneRepositoryPlan(
        await writeCombinedCheckScript(fixture.root, 1),
      ),
    });
    const service = await ChangeFleetService.open(
      serviceOptions(fixture, runtime),
    );
    await registerAndConfigure(service, fixture.repository.path);
    await service.createChangeSet({
      idempotency_key: "create",
      change_set_id: "change",
      project_id: "project",
      intent: { objective: "Keep planning Harness immutable" },
    });
    await assert.rejects(
      service.planChangeSet({
        idempotency_key: "plan",
        change_set_id: "change",
      }),
      { code: "HARNESS_OVERLAY_MODIFIED" },
    );
    const state = await service.readChangeSet("change");
    const run = await service.runStore.read(state.run_references[0].run_id);
    assert.equal(run.status, "failed");
    assert.equal(
      await stat(run.planning_workspaces[0].workspace_path).catch(
        () => null,
      ),
      null,
    );
  });

  test("retries an interrupted execution with the same frozen overlay", async (t) => {
    const fixture = await createHarnessFixture(t, "retry");
    const plan = createOneRepositoryPlan(
      await writeCombinedCheckScript(fixture.root, 1),
    );
    const firstRuntime = new InspectingHarnessRuntime({
      plan,
      interruptRepository: "api",
    });
    const first = await ChangeFleetService.open(
      serviceOptions(fixture, firstRuntime),
    );
    await registerAndConfigure(first, fixture.repository.path);
    await createPlanAndConfirm(first);
    await assert.rejects(
      first.executeChangeSet({
        idempotency_key: "execute",
        change_set_id: "change",
      }),
      { code: "CONTROLLER_INTERRUPTED" },
    );
    await writeFile(fixture.skillPath, "live checkout changed\n", "utf8");

    const secondRuntime = new InspectingHarnessRuntime({ plan });
    const reopened = await ChangeFleetService.open(
      serviceOptions(fixture, secondRuntime),
    );
    const result = await reopened.executeChangeSet({
      idempotency_key: "execute",
      change_set_id: "change",
    });
    assert.equal(result.bundle_revision, 1);
    assert.equal(
      secondRuntime.observations.find(
        (observation) => observation.operation === "execution",
      ).content,
      FROZEN_SKILL,
    );
    const state = await reopened.readChangeSet("change");
    const unit = state.work_units.find(
      (candidate) => candidate.plan_revision === state.current_plan_revision,
    );
    assert.deepEqual(
      unit.run_references.map((reference) => reference.status),
      ["abandoned", "completed"],
    );
  });

  test("rejects a declared durable private Harness change without writeback", async (t) => {
    const fixture = await createHarnessFixture(t, "private-change");
    const runtime = new DeclaredPrivateHarnessChangeRuntime({
      plan: createOneRepositoryPlan(
        await writeCombinedCheckScript(fixture.root, 1),
      ),
    });
    const service = await ChangeFleetService.open(
      serviceOptions(fixture, runtime),
    );
    await registerAndConfigure(service, fixture.repository.path);
    await createPlanAndConfirm(service);

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute",
        change_set_id: "change",
      }),
      { code: "NON_GIT_HARNESS_CHANGE_UNSUPPORTED" },
    );
    const state = await service.readChangeSet("change");
    assert.equal(state.candidates.length, 0);
    assert.equal(await readFile(fixture.skillPath, "utf8"), FROZEN_SKILL);
  });

  test("rejects non-semantic, missing, oversized, linked, and colliding local resources", async (t) => {
    const root = await createFixtureRoot(
      t,
      "changefleet-harness-boundaries-",
    );
    const fixture = await createGitRepository(root, "api");
    await writeFile(
      path.join(fixture.path, ".gitignore"),
      ".agents/skills/**\n.env\n",
      "utf8",
    );
    await git(fixture.path, ["add", ".gitignore"]);
    await git(fixture.path, ["commit", "-m", "ignore local Harness"]);
    const worker = new RepositoryWorker({
      workspaceRoot: path.join(root, "workspaces"),
    });
    const repository = await worker.inspectRegistration({
      repositoryId: "api",
      locator: fixture.path,
    });
    const baseSha = (await git(fixture.path, ["rev-parse", "HEAD"])).trim();
    await writeFile(path.join(fixture.path, ".env"), "SECRET=value\n");
    await assert.rejects(
      worker.resolveHarnessOverlay({
        repository,
        baseSha,
        policy: explicitPolicy([".env"]),
      }),
      { code: "UNSUPPORTED_HARNESS_RESOURCE" },
    );
    await assert.rejects(
      worker.resolveHarnessOverlay({
        repository,
        baseSha,
        policy: explicitPolicy([".agents/skills/missing/**"]),
      }),
      { code: "EMPTY_HARNESS_OVERLAY" },
    );

    const oversized = path.join(
      fixture.path,
      ".agents/skills/oversized/SKILL.md",
    );
    await mkdir(path.dirname(oversized), { recursive: true });
    await writeFile(oversized, Buffer.alloc(256 * 1024 + 1, 0x61));
    await assert.rejects(
      worker.resolveHarnessOverlay({
        repository,
        baseSha,
        policy: explicitPolicy([".agents/skills/oversized/**"]),
      }),
      { code: "HARNESS_OVERLAY_LIMIT_EXCEEDED" },
    );

    const countRoot = path.join(
      fixture.path,
      ".agents/skills/count",
    );
    await mkdir(countRoot, { recursive: true });
    await Promise.all(
      Array.from({ length: 129 }, (_, index) =>
        writeFile(path.join(countRoot, `${index}.txt`), "x"),
      ),
    );
    await assert.rejects(
      worker.resolveHarnessOverlay({
        repository,
        baseSha,
        policy: explicitPolicy([".agents/skills/count/**"]),
      }),
      { code: "HARNESS_OVERLAY_LIMIT_EXCEEDED" },
    );

    const totalRoot = path.join(
      fixture.path,
      ".agents/skills/total",
    );
    await mkdir(totalRoot, { recursive: true });
    await Promise.all(
      Array.from({ length: 9 }, (_, index) =>
        writeFile(
          path.join(totalRoot, `${index}.bin`),
          Buffer.alloc(240 * 1024, index),
        ),
      ),
    );
    await assert.rejects(
      worker.resolveHarnessOverlay({
        repository,
        baseSha,
        policy: explicitPolicy([".agents/skills/total/**"]),
      }),
      { code: "HARNESS_OVERLAY_LIMIT_EXCEEDED" },
    );

    const outside = path.join(root, "outside-skill.md");
    await writeFile(outside, "outside\n");
    const linked = path.join(
      fixture.path,
      ".agents/skills/linked/SKILL.md",
    );
    await mkdir(path.dirname(linked), { recursive: true });
    await symlink(outside, linked, "file");
    await assert.rejects(
      worker.resolveHarnessOverlay({
        repository,
        baseSha,
        policy: explicitPolicy([".agents/skills/linked/**"]),
      }),
      { code: "UNSAFE_HARNESS_PATH" },
    );

    await git(fixture.path, ["checkout", "-b", "tracked-harness"]);
    const collision = path.join(
      fixture.path,
      ".agents/skills/collision/SKILL.md",
    );
    await mkdir(path.dirname(collision), { recursive: true });
    await writeFile(collision, "tracked on selected base\n");
    await git(fixture.path, ["add", "-f", SKILL_PATH.replace("private", "collision")]);
    await git(fixture.path, ["commit", "-m", "tracked Harness base"]);
    const trackedBase = (
      await git(fixture.path, ["rev-parse", "HEAD"])
    ).trim();
    await git(fixture.path, ["checkout", "main"]);
    await mkdir(path.dirname(collision), { recursive: true });
    await writeFile(collision, "ignored local collision\n");
    await assert.rejects(
      worker.resolveHarnessOverlay({
        repository,
        baseSha: trackedBase,
        policy: explicitPolicy([".agents/skills/collision/**"]),
      }),
      { code: "HARNESS_OVERLAY_TRACKED_COLLISION" },
    );

    await assert.rejects(
      worker.resolveHarnessOverlay({
        repository,
        baseSha,
        policy: {
          revision: 2,
          purpose: "repository_harness",
          selector: "exact_base_worktreeinclude",
          patterns: [],
          manifest_path: ".worktreeinclude",
        },
      }),
      { code: "WORKTREEINCLUDE_NOT_TRACKED_AT_BASE" },
    );
  });
});

class InspectingHarnessRuntime extends ScriptedRuntime {
  constructor(options) {
    super(options);
    this.observations = [];
  }

  async invoke(invocation, options) {
    const repository = invocation.context_projection.repositories[0];
    const root =
      invocation.operation === "planning"
        ? repository.root_path
        : invocation.workspace.workspace_path;
    this.observations.push({
      operation: invocation.operation,
      content: await readFile(path.join(root, SKILL_PATH), "utf8"),
      resource: repository.harness_resources.find(
        (candidate) => candidate.path === SKILL_PATH,
      ),
    });
    return super.invoke(invocation, options);
  }
}

class MutatingHarnessRuntime extends ScriptedRuntime {
  async invoke(invocation, options) {
    const result = await super.invoke(invocation, options);
    if (invocation.operation === "execution") {
      await writeFile(
        path.join(invocation.workspace.workspace_path, SKILL_PATH),
        "mutated by Runtime\n",
        "utf8",
      );
    }
    return result;
  }
}

class MutatingPlanningHarnessRuntime extends ScriptedRuntime {
  async invoke(invocation, options) {
    const result = await super.invoke(invocation, options);
    if (invocation.operation === "planning") {
      const root = invocation.context_projection.repositories[0].root_path;
      await writeFile(
        path.join(root, SKILL_PATH),
        "mutated while planning\n",
        "utf8",
      );
    }
    return result;
  }
}

class DeclaredPrivateHarnessChangeRuntime extends ScriptedRuntime {
  async invoke(invocation, options) {
    const result = await super.invoke(invocation, options);
    if (invocation.operation === "execution") {
      result.outcome.changed_paths.push(SKILL_PATH);
    }
    return result;
  }
}

async function createHarnessFixture(
  t,
  name,
  { manifest = false, includeEnvironmentFile = false } = {},
) {
  const root = await createFixtureRoot(
    t,
    `changefleet-harness-${name}-`,
  );
  const repository = await createGitRepository(root, "api", {
    harness: true,
  });
  const ignored = [".agents/skills/**"];
  if (includeEnvironmentFile) ignored.push(".env*");
  await writeFile(
    path.join(repository.path, ".gitignore"),
    `${ignored.join("\n")}\n`,
    "utf8",
  );
  if (manifest) {
    await writeFile(
      path.join(repository.path, ".worktreeinclude"),
      ".agents/skills/**\n.env*\n",
      "utf8",
    );
  }
  await git(repository.path, ["add", ".gitignore"]);
  if (manifest) {
    await git(repository.path, ["add", ".worktreeinclude"]);
  }
  await git(repository.path, ["commit", "-m", "Harness selectors"]);
  const skillPath = path.join(repository.path, SKILL_PATH);
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, FROZEN_SKILL, "utf8");
  if (includeEnvironmentFile) {
    await writeFile(path.join(repository.path, ".env"), "SECRET=value\n");
  }
  return {
    root,
    repository,
    skillPath,
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
  };
}

function serviceOptions(fixture, runtime) {
  return {
    controlRoot: fixture.controlRoot,
    workspaceRoot: fixture.workspaceRoot,
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  };
}

function registerProject(service, repositoryPath) {
  return service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      repositories: [
        { repository_id: "api", locator: { path: repositoryPath } },
      ],
    },
  });
}

async function registerAndConfigure(service, repositoryPath) {
  await registerProject(service, repositoryPath);
  await service.reviseRepositoryWorkspacePolicy({
    idempotency_key: "policy",
    project_id: "project",
    repository_id: "api",
    policy: {
      selector: "explicit_patterns",
      patterns: [".agents/skills/**"],
    },
  });
}

async function createPlanAndConfirm(service) {
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: "change",
    project_id: "project",
    intent: { objective: "Exercise the private project Harness" },
  });
  const planned = await service.planChangeSet({
    idempotency_key: "plan",
    change_set_id: "change",
  });
  await service.confirmPlanRevision({
    idempotency_key: "confirm",
    change_set_id: "change",
    plan_revision: planned.plan_revision,
  });
}

function explicitPolicy(patterns) {
  return {
    revision: 1,
    purpose: "repository_harness",
    selector: "explicit_patterns",
    patterns,
    manifest_path: null,
  };
}
