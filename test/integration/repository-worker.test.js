import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
    const workspace = await worker.prepareTaskRepositoryWorkspace({
      repository,
      targetRef: base.target_ref,
      baseSha: base.base_sha,
      taskWorkspaceId: "task-workspace-1",
      workspaceId: "workspace-1",
      branchRef: "refs/heads/changefleet/task-workspace-1",
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
    await assert.rejects(
      worker.preflightCandidate({
        repository,
        candidate: { ...candidate, changed_paths: [] },
      }),
      { code: "CANDIDATE_CHANGED_PATHS_MISMATCH" },
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
    const workspace = await worker.prepareTaskRepositoryWorkspace({
      repository: second,
      targetRef: secondBase.target_ref,
      baseSha: secondBase.base_sha,
      taskWorkspaceId: "task-workspace-foreign",
      workspaceId: "foreign",
      branchRef: "refs/heads/changefleet/task-workspace-foreign",
    });
    await assert.rejects(
      worker.assertWorkspaceOwnership(first, workspace.workspace_path),
      { code: "FOREIGN_WORKSPACE" },
    );
  });

  test("keeps Bundle-review identity logical while using a short deterministic physical path", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-review-path-");
    const repositoryFixture = await createGitRepository(root, "api");
    const longRelativePath = path.join(
      `component-${"a".repeat(44)}`,
      `implementation-${"b".repeat(42)}.txt`,
    );
    await mkdir(path.dirname(path.join(repositoryFixture.path, longRelativePath)), {
      recursive: true,
    });
    await writeFile(
      path.join(repositoryFixture.path, longRelativePath),
      "long tracked review fixture\n",
      "utf8",
    );
    await git(repositoryFixture.path, ["add", "-A"]);
    await git(repositoryFixture.path, ["commit", "-m", "add long tracked path"]);

    const workspaceRoot = path.join(root, "workspaces");
    const worker = new RepositoryWorker({ workspaceRoot });
    const repository = await worker.inspectRegistration({
      repositoryId: "api",
      locator: repositoryFixture.path,
    });
    const candidateSha = (
      await git(repositoryFixture.path, ["rev-parse", "HEAD"])
    ).trim();
    const logicalWorkspaceId = `r${"x".repeat(127)}`;
    const formerPhysicalPath = path.resolve(
      workspaceRoot,
      "_verification",
      "api",
      logicalWorkspaceId,
    );

    const workspace = await worker.prepareBundleReviewWorkspace({
      repository,
      candidateSha,
      workspaceId: logicalWorkspaceId,
    });

    assert.equal(workspace.workspace_id, logicalWorkspaceId);
    assert.match(path.basename(workspace.workspace_path), /^br-[a-f0-9]{24}$/u);
    assert.equal(workspace.workspace_path.includes(logicalWorkspaceId), false);
    assert.ok(path.join(formerPhysicalPath, longRelativePath).length > 260);
    assert.ok(
      path.join(workspace.workspace_path, longRelativePath).length <
        path.join(formerPhysicalPath, longRelativePath).length,
    );
    assert.equal(
      await readFile(path.join(workspace.workspace_path, longRelativePath), "utf8"),
      "long tracked review fixture\n",
    );

    await worker.cleanupVerificationWorkspace({ repository, workspace });
    assert.equal(await stat(workspace.workspace_path).catch(() => null), null);

    const recreated = await worker.prepareBundleReviewWorkspace({
      repository,
      candidateSha,
      workspaceId: logicalWorkspaceId,
    });
    assert.equal(recreated.workspace_path, workspace.workspace_path);
    await worker.cleanupVerificationWorkspace({ repository, workspace: recreated });
  });

  test("maps temporary worktree preparation failure to one stable diagnostic", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-review-failure-");
    const repositoryFixture = await createGitRepository(root, "api");
    const workspaceRoot = path.join(root, "workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(path.join(workspaceRoot, "_review"), "path conflict\n", "utf8");
    const worker = new RepositoryWorker({ workspaceRoot });
    const repository = await worker.inspectRegistration({
      repositoryId: "api",
      locator: repositoryFixture.path,
    });

    await assert.rejects(
      worker.prepareBundleReviewWorkspace({
        repository,
        candidateSha: repositoryFixture.base_sha,
        workspaceId: "bundle-review-failure",
      }),
      (error) => {
        assert.equal(error.code, "WORKSPACE_CHECKOUT_FAILED");
        assert.deepEqual(
          { stage: error.details.stage, rule: error.details.rule },
          {
            stage: "workspace_preparation",
            rule: "create_parent_directory",
          },
        );
        assert.notEqual(error.code, 128);
        return true;
      },
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

  test("does not persist credentials embedded in an HTTP origin", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-remote-redaction-");
    const fixture = await createGitRepository(root, "api");
    await git(fixture.path, [
      "remote",
      "add",
      "origin",
      "https://user:secret@github.com/Owner/Repository.git?token=hidden",
    ]);
    const worker = new RepositoryWorker({
      workspaceRoot: path.join(root, "workspaces"),
    });
    const repository = await worker.inspectRegistration({
      repositoryId: "api",
      locator: fixture.path,
    });
    assert.equal(
      repository.canonical_remote,
      "https://github.com/Owner/Repository.git",
    );
    assert.doesNotMatch(JSON.stringify(repository), /secret|hidden/u);
  });
});
