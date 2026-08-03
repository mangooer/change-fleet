import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { RepositoryWorker } from "../../src/adapters/git/repository-worker.js";
import {
  createFixtureRoot,
  createGitRepository,
  git,
} from "../support/git-fixture.js";

describe("RepositoryWorker", () => {
  test("registers read-only, excludes dirty checkout state, and publishes an exact Candidate", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-git-");
    const repositoryFixture = await createGitRepository(root, "api", {
      harness: true,
    });
    const trackedSkillDirectory = path.join(
      repositoryFixture.path,
      ".agents",
      "skills",
      "review",
    );
    await mkdir(trackedSkillDirectory, { recursive: true });
    await writeFile(
      path.join(trackedSkillDirectory, "SKILL.md"),
      "# Review skill\n\nInspect the exact candidate.\n",
      "utf8",
    );
    await git(repositoryFixture.path, ["add", ".agents/skills/review/SKILL.md"]);
    await git(repositoryFixture.path, ["commit", "-m", "add tracked skill"]);
    await writeFile(
      path.join(repositoryFixture.path, "baseline.txt"),
      "dirty host content\n",
      "utf8",
    );
    await writeFile(
      path.join(repositoryFixture.path, "host-only.txt"),
      "untracked host content\n",
      "utf8",
    );
    const statusBefore = await git(repositoryFixture.path, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    const worker = new RepositoryWorker({
      workspaceRoot: path.join(root, "workspaces"),
    });
    const repository = await worker.inspectRegistration({
      repositoryId: "api",
      locator: repositoryFixture.path,
    });
    assert.equal(
      await git(repositoryFixture.path, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]),
      statusBefore,
    );
    const base = await worker.freezeBase(repository);
    assert.deepEqual(
      (await worker.discoverHarness(repository, base.base_sha)).map(
        (resource) => [resource.path, resource.source],
      ),
      [
        [".agents/skills/review/SKILL.md", "exact_base"],
        ["AGENTS.md", "exact_base"],
      ],
    );
    const workspace = await worker.prepareWorkspace({
      repository,
      targetRef: base.target_ref,
      baseSha: base.base_sha,
      workspaceId: "workspace-1",
    });
    assert.equal(
      await git(workspace.workspace_path, ["show", "HEAD:baseline.txt"]),
      "api committed baseline\n",
    );
    await assert.rejects(
      import("node:fs/promises").then(({ readFile }) =>
        readFile(path.join(workspace.workspace_path, "host-only.txt")),
      ),
      { code: "ENOENT" },
    );
    await writeFile(
      path.join(workspace.workspace_path, "feature.txt"),
      "api feature\n",
      "utf8",
    );
    const candidate = await worker.publishCandidate({
      repository,
      workspace,
      expectedHead: base.base_sha,
      message: "candidate",
    });
    assert.notEqual(candidate.candidate_sha, base.base_sha);
    assert.deepEqual(candidate.changed_paths, ["feature.txt"]);
    assert.equal(
      (await worker.preflightCandidate({ repository, candidate })).clean,
      true,
    );
    await assert.rejects(
      worker.preflightCandidate({
        repository,
        candidate: {
          ...candidate,
          candidate_sha: "f".repeat(40),
        },
      }),
      { code: "CANDIDATE_HEAD_MISMATCH" },
    );

    await writeFile(
      path.join(workspace.workspace_path, "after.txt"),
      "dirty\n",
      "utf8",
    );
    await assert.rejects(
      worker.preflightCandidate({ repository, candidate }),
      { code: "DIRTY_CANDIDATE_WORKSPACE" },
    );
  });

  test("rejects non-Git locators and foreign workspaces", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-git-boundary-");
    const plain = path.join(root, "plain");
    await mkdir(plain);
    const worker = new RepositoryWorker({
      workspaceRoot: path.join(root, "workspaces"),
    });
    await assert.rejects(
      worker.inspectRegistration({
        repositoryId: "plain",
        locator: plain,
      }),
      { code: "NOT_A_GIT_REPOSITORY" },
    );

    const firstFixture = await createGitRepository(root, "first");
    const secondFixture = await createGitRepository(root, "second");
    const first = await worker.inspectRegistration({
      repositoryId: "first",
      locator: firstFixture.path,
    });
    const second = await worker.inspectRegistration({
      repositoryId: "second",
      locator: secondFixture.path,
    });
    const secondBase = await worker.freezeBase(second);
    const workspace = await worker.prepareWorkspace({
      repository: second,
      targetRef: secondBase.target_ref,
      baseSha: secondBase.base_sha,
      workspaceId: "foreign",
    });
    await assert.rejects(
      worker.assertWorkspaceOwnership(first, workspace.workspace_path),
      { code: "FOREIGN_WORKSPACE" },
    );
  });

  test("resolves explicit or current local branches and rejects an omitted detached branch", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-branch-selection-");
    const fixture = await createGitRepository(root, "api");
    const worker = new RepositoryWorker({
      workspaceRoot: path.join(root, "workspaces"),
    });
    const repository = await worker.inspectRegistration({
      repositoryId: "api",
      locator: fixture.path,
    });

    await git(fixture.path, ["checkout", "-b", "feature"]);
    await writeFile(path.join(fixture.path, "feature-base.txt"), "feature\n");
    await git(fixture.path, ["add", "feature-base.txt"]);
    await git(fixture.path, ["commit", "-m", "feature base"]);
    const featureSha = (await git(fixture.path, ["rev-parse", "HEAD"])).trim();

    assert.deepEqual(
      await worker.resolveRepositorySelection(repository),
      {
        repository_id: "api",
        branch_ref: "refs/heads/feature",
        resolved_base_sha: featureSha,
        target_ref: "refs/heads/feature",
        selection_source: "current_checkout",
      },
    );
    assert.deepEqual(
      await worker.resolveRepositorySelection(repository, {
        branchRef: "feature",
        targetRef: "main",
      }),
      {
        repository_id: "api",
        branch_ref: "refs/heads/feature",
        resolved_base_sha: featureSha,
        target_ref: "refs/heads/main",
        selection_source: "caller",
      },
    );

    await git(fixture.path, ["checkout", "--detach", fixture.base_sha]);
    await assert.rejects(
      worker.resolveRepositorySelection(repository),
      { code: "REPOSITORY_BRANCH_SELECTION_REQUIRED" },
    );
    assert.equal(
      (
        await worker.resolveRepositorySelection(repository, {
          branchRef: "main",
        })
      ).resolved_base_sha,
      fixture.base_sha,
    );
  });
});
