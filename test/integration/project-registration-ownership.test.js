import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import {
  createFixtureRoot,
  createGitRepository,
  git,
} from "../support/git-fixture.js";
import {
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("Project Repository ownership", () => {
  test("rejects direct registration of one Git store across Projects", async (t) => {
    const fixture = await createOwnershipFixture(t, "direct");

    await registerProject(fixture.service, "owner", [
      repositoryInput("repository-owner", fixture.repository.path),
    ]);
    await assert.rejects(
      registerProject(fixture.service, "second-project", [
        repositoryInput("repository-alias", fixture.repository.path),
      ]),
      { code: "AMBIGUOUS_SHARED_REPOSITORY" },
    );

    assert.deepEqual(
      Object.keys((await fixture.service.controlStore.readCatalog()).projects),
      ["owner"],
    );
  });

  test("rejects root and nested-path aliases inside one Project request", async (t) => {
    const fixture = await createOwnershipFixture(t, "nested");
    const nestedPath = path.join(fixture.repository.path, "nested", "module");
    await mkdir(nestedPath, { recursive: true });

    await assert.rejects(
      registerProject(fixture.service, "aliased-project", [
        repositoryInput("main", fixture.repository.path),
        repositoryInput("nested", nestedPath),
      ]),
      { code: "AMBIGUOUS_SHARED_REPOSITORY" },
    );

    assert.deepEqual(
      (await fixture.service.controlStore.readCatalog()).projects,
      {},
    );
  });

  test("rejects a linked-worktree alias owned by another Project", async (t) => {
    const fixture = await createOwnershipFixture(t, "linked-worktree");
    const linkedPath = path.join(fixture.root, "linked");
    await git(fixture.repository.path, [
      "worktree",
      "add",
      "-b",
      "linked-test",
      linkedPath,
      fixture.repository.base_sha,
    ]);

    const owner = await registerProject(fixture.service, "owner", [
      repositoryInput("main", fixture.repository.path),
    ]);
    await assert.rejects(
      registerProject(fixture.service, "linked-project", [
        repositoryInput("linked", linkedPath),
      ]),
      { code: "AMBIGUOUS_SHARED_REPOSITORY" },
    );

    assert.equal(owner.repositories[0].resolved_git_root, fixture.repository.path);
  });

  test("allows independent clones that share one canonical remote", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-ownership-clones-");
    const source = await createGitRepository(root, "source");
    const remotePath = path.join(root, "remote.git");
    const firstClone = path.join(root, "clone-a");
    const secondClone = path.join(root, "clone-b");
    await git(root, ["clone", "--bare", source.path, remotePath]);
    await git(root, ["clone", remotePath, firstClone]);
    await git(root, ["clone", remotePath, secondClone]);
    const service = await openService(root);

    const first = await registerProject(service, "first-project", [
      repositoryInput("first", firstClone),
    ]);
    const second = await registerProject(service, "second-project", [
      repositoryInput("second", secondClone),
    ]);

    assert.equal(
      first.repositories[0].canonical_remote,
      second.repositories[0].canonical_remote,
    );
    assert.notEqual(
      first.repositories[0].common_git_dir,
      second.repositories[0].common_git_dir,
    );
  });
});

async function createOwnershipFixture(t, name) {
  const root = await createFixtureRoot(t, `changefleet-ownership-${name}-`);
  return {
    root,
    repository: await createGitRepository(root, "repository"),
    service: await openService(root),
  };
}

function openService(root) {
  return ChangeFleetService.open({
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
    runtime: new ScriptedRuntime({}),
    agentProfile: TEST_AGENT_PROFILE,
  });
}

function registerProject(service, projectId, repositories) {
  return service.registerProject({
    idempotency_key: `register-${projectId}`,
    project: {
      project_id: projectId,
      repositories,
    },
  });
}

function repositoryInput(repositoryId, repositoryPath) {
  return {
    repository_id: repositoryId,
    locator: { path: repositoryPath },
  };
}
