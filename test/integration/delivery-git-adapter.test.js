import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import {
  DeliveryGitAdapter,
  normalizeGithubRemote,
} from "../../src/adapters/git/delivery-git-adapter.js";
import {
  createFixtureRoot,
  createGitRepository,
  git,
} from "../support/git-fixture.js";

describe("delivery Git adapter", () => {
  test("publishes one exact SHA without overwriting a different remote branch", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-delivery-git-");
    const repository = await createGitRepository(root, "api");
    const bare = path.join(root, "api.git");
    await mkdir(bare, { recursive: true });
    await git(bare, ["init", "--bare", "--initial-branch=main"]);
    await git(repository.path, ["remote", "add", "origin", bare]);
    await git(repository.path, ["push", "origin", "main"]);
    await git(repository.path, ["checkout", "-b", "candidate"]);
    await git(repository.path, [
      "commit",
      "--allow-empty",
      "-m",
      "candidate",
    ]);
    const candidateSha = (
      await git(repository.path, ["rev-parse", "HEAD"])
    ).trim();
    const adapter = new DeliveryGitAdapter();
    const registered = {
      repository_id: "api",
      resolved_git_root: repository.path,
    };

    assert.equal(
      await adapter.readRemoteRef({
        repository: registered,
        pushRemote: "origin",
        ref: "refs/heads/main",
      }),
      repository.base_sha,
    );
    await assert.rejects(
      adapter.readRemoteRef({
        repository: registered,
        pushRemote: "origin",
        ref: "refs/heads/missing-target",
      }),
      { code: "DELIVERY_TARGET_NOT_FOUND" },
    );
    const first = await adapter.publishExactCandidate({
      repository: registered,
      pushRemote: "origin",
      candidateSha,
      remoteBranch: "changefleet/change/api/b1-abcdef",
    });
    assert.equal(first.reused, false);
    const retry = await adapter.publishExactCandidate({
      repository: registered,
      pushRemote: "origin",
      candidateSha,
      remoteBranch: "changefleet/change/api/b1-abcdef",
    });
    assert.equal(retry.reused, true);

    await git(repository.path, [
      "push",
      "--force",
      "origin",
      `${repository.base_sha}:refs/heads/changefleet/change/api/b1-abcdef`,
    ]);
    await assert.rejects(
      adapter.publishExactCandidate({
        repository: registered,
        pushRemote: "origin",
        candidateSha,
        remoteBranch: "changefleet/change/api/b1-abcdef",
      }),
      { code: "DELIVERY_BRANCH_DIVERGED" },
    );
  });

  test("verifies exact target reachability and normalizes supported GitHub remotes", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-delivery-reach-");
    const repository = await createGitRepository(root, "api");
    const bare = path.join(root, "api.git");
    await mkdir(bare, { recursive: true });
    await git(bare, ["init", "--bare", "--initial-branch=main"]);
    await git(repository.path, ["remote", "add", "origin", bare]);
    await git(repository.path, ["push", "origin", "main"]);
    const adapter = new DeliveryGitAdapter();
    assert.equal(
      await adapter.verifyRemoteContains({
        repository: { resolved_git_root: repository.path },
        pushRemote: "origin",
        targetRef: "refs/heads/main",
        commitSha: repository.base_sha,
      }),
      true,
    );
    assert.equal(
      normalizeGithubRemote("https://github.com/Owner/Repository.git"),
      "owner/repository",
    );
    assert.equal(
      normalizeGithubRemote("git@github.com:Owner/Repository.git"),
      "owner/repository",
    );
    assert.throws(
      () => normalizeGithubRemote("https://gitlab.com/owner/repository.git"),
      { code: "UNSUPPORTED_GITHUB_REMOTE" },
    );
  });
});
