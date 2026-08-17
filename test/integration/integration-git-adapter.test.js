import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { IntegrationGitAdapter } from "../../src/adapters/git/integration-git-adapter.js";
import { createGitRepository, git } from "../support/git-fixture.js";

describe("integration Git observer", () => {
  test("preflights a missing publication ref and observes only the exact pushed Candidate", async (t) => {
    const fixture = await createRemoteFixture(t);
    const adapter = new IntegrationGitAdapter();
    const destinationRef = "refs/heads/changefleet/change-1/api";

    const preflight = await adapter.preflight({
      repository: fixture.repository,
      actionKind: "publish_exact_candidate",
      pushRemote: "origin",
      destinationRef,
      targetRef: "refs/heads/main",
      baseSha: fixture.baseSha,
      candidateSha: fixture.candidateSha,
    });
    assert.equal(preflight.observed_destination_sha, null);
    assert.equal(preflight.already_satisfied, false);

    await git(fixture.repository.resolved_git_root, [
      "push",
      "origin",
      `${fixture.candidateSha}:${destinationRef}`,
    ]);
    assert.deepEqual(
      await adapter.observeResult({
        repository: fixture.repository,
        pushRemote: "origin",
        destinationRef,
        candidateSha: fixture.candidateSha,
      }),
      {
        destination_ref: destinationRef,
        observed_destination_sha: fixture.candidateSha,
      },
    );
  });

  test("accepts only an exact-base fast-forward target and detects later movement", async (t) => {
    const fixture = await createRemoteFixture(t);
    const adapter = new IntegrationGitAdapter();
    const request = {
      repository: fixture.repository,
      actionKind: "fast_forward_target",
      pushRemote: "origin",
      destinationRef: "refs/heads/main",
      targetRef: "refs/heads/main",
      baseSha: fixture.baseSha,
      candidateSha: fixture.candidateSha,
    };
    assert.equal(
      (await adapter.preflight(request)).observed_destination_sha,
      fixture.baseSha,
    );

    await git(fixture.sourcePath, ["checkout", "main"]);
    await writeFile(path.join(fixture.sourcePath, "moved.txt"), "moved\n");
    await git(fixture.sourcePath, ["add", "moved.txt"]);
    await git(fixture.sourcePath, ["commit", "-m", "move target"]);
    await git(fixture.sourcePath, ["push", "origin", "main"]);
    await assert.rejects(adapter.preflight(request), {
      code: "INTEGRATION_TARGET_MOVED",
    });
  });
});

async function createRemoteFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "changefleet-integration-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await createGitRepository(root, "api");
  const barePath = path.join(root, "api.git");
  await mkdir(barePath, { recursive: true });
  await git(barePath, ["init", "--bare", "--initial-branch=main"]);
  await git(source.path, ["remote", "add", "origin", barePath]);
  await git(source.path, ["push", "origin", "main"]);
  await git(source.path, ["checkout", "-b", "candidate"]);
  await writeFile(path.join(source.path, "candidate.txt"), "candidate\n");
  await git(source.path, ["add", "candidate.txt"]);
  await git(source.path, ["commit", "-m", "candidate"]);
  const candidateSha = (await git(source.path, ["rev-parse", "HEAD"])).trim();
  return {
    sourcePath: source.path,
    repository: { resolved_git_root: source.path },
    baseSha: source.base_sha,
    candidateSha,
  };
}
