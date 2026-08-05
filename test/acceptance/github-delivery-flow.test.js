import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { RuntimeAuditQueryService } from "../../src/application/runtime-audit-query-service.js";
import {
  createFixtureRoot,
  createGitRepository,
  git,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  FixtureBindingDeliveryGitAdapter,
  ScriptedGithubPullRequestAdapter,
} from "../support/scripted-github-delivery.js";
import {
  createOneRepositoryPlan,
  createTwoRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("GitHub pull-request delivery", () => {
  test("publishes one exact Candidate idempotently and reconciles a human merge after restart", async (t) => {
    const fixture = await createDeliveryFixture(t, ["api"]);
    const ready = await driveToDeliveryReady(fixture, "single-delivery");
    const privateBody = "private-pr-body-must-not-enter-control-state";
    const published = await fixture.service.publishDelivery({
      idempotency_key: "publish-1",
      change_set_id: ready.change_set_id,
      title: "Exact Candidate",
      body: privateBody,
    });
    assert.equal(published.state, "delivering");
    assert.deepEqual(published.counts, { open: 1 });
    assert.equal(fixture.github.createCount, 1);
    // PR 正文只用于本次外部调用；状态、投影和后续 Runtime 上下文都不能携带明文载荷。
    assert.doesNotMatch(JSON.stringify(published), new RegExp(privateBody, "u"));
    assert.doesNotMatch(
      JSON.stringify(
        await fixture.service.controlStore.readChangeSet(ready.change_set_id),
      ),
      new RegExp(privateBody, "u"),
    );
    const request = published.deliveries[0];
    assert.equal(
      await remoteSha(
        fixture.repositories.api.path,
        `refs/heads/${request.remote_branch}`,
      ),
      request.candidate_sha,
    );

    const retried = await fixture.service.publishDelivery({
      idempotency_key: "publish-2",
      change_set_id: ready.change_set_id,
    });
    assert.equal(retried.deliveries[0].pull_request.number, 1);
    assert.equal(fixture.github.createCount, 1);

    const mergeSha = await mergeCandidate(
      fixture.repositories.api,
      request.candidate_sha,
    );
    fixture.github.merge({
      githubRepository: request.github_repository,
      headBranch: request.remote_branch,
      targetRef: request.target_ref,
      mergeCommitSha: mergeSha,
    });
    // 模拟外部 PR 已创建后控制器在保存 provider locator 前丢失，重启必须先发现 PR 而非因目标移动失败。
    await fixture.service.controlStore.transactChangeSet(
      ready.change_set_id,
      (state) => {
        state.commands["publish-1"].status = "in_progress";
        delete state.commands["publish-1"].result;
        delete state.commands["publish-1"].completed_at;
        state.delivery_requests[0].pull_request = null;
        state.state = "delivering";
      },
    );
    const reopened = await ChangeFleetService.open(fixture.options);
    const recovered = await reopened.publishDelivery({
      idempotency_key: "publish-1",
      change_set_id: ready.change_set_id,
      title: "Exact Candidate",
      body: privateBody,
    });
    assert.equal(recovered.state, "done");
    assert.equal(fixture.github.createCount, 1);
    const completed = await reopened.refreshDelivery({
      idempotency_key: "refresh-1",
      change_set_id: ready.change_set_id,
    });
    assert.equal(completed.state, "done");
    assert.deepEqual(completed.counts, { merged: 1 });
    assert.equal(
      completed.deliveries[0].pull_request.merge_commit_sha,
      mergeSha,
    );
    assert.notEqual(mergeSha, request.candidate_sha);
    const completedState = await reopened.readChangeSet(ready.change_set_id);
    const audit = await new RuntimeAuditQueryService({
      controlStore: reopened.controlStore,
      runStore: reopened.runStore,
      evidenceStore: reopened.evidenceStore,
    }).getChangeSetAudit(ready.change_set_id);
    assert.deepEqual(audit.payload.outcomes.delivery, {
      unavailable: 0,
      current_bundle_id: completedState.bundles.at(-1).bundle_id,
      request_count: 1,
      states: { merged: 1 },
      merged_count: 1,
      complete: true,
      partial_merge: false,
    });
    assert.doesNotMatch(
      JSON.stringify(fixture.runtime.invocations),
      /delivery_request|pull_request|github_repository/u,
    );
  });

  test("keeps a cross-Repository partial merge explicit until every exact PR is merged", async (t) => {
    const fixture = await createDeliveryFixture(t, ["api", "web"]);
    const ready = await driveToDeliveryReady(fixture, "multi-delivery");
    const published = await fixture.service.publishDelivery({
      idempotency_key: "publish",
      change_set_id: ready.change_set_id,
    });
    assert.deepEqual(published.counts, { open: 2 });
    const [apiRequest, webRequest] = published.deliveries;
    const apiMerge = await mergeCandidate(
      fixture.repositories.api,
      apiRequest.candidate_sha,
    );
    fixture.github.merge({
      githubRepository: apiRequest.github_repository,
      headBranch: apiRequest.remote_branch,
      targetRef: apiRequest.target_ref,
      mergeCommitSha: apiMerge,
    });
    const partial = await fixture.service.refreshDelivery({
      idempotency_key: "refresh-attempt",
      change_set_id: ready.change_set_id,
    });
    assert.equal(partial.state, "delivering");
    assert.deepEqual(partial.counts, { merged: 1, open: 1 });

    const webMerge = await mergeCandidate(
      fixture.repositories.web,
      webRequest.candidate_sha,
    );
    fixture.github.merge({
      githubRepository: webRequest.github_repository,
      headBranch: webRequest.remote_branch,
      targetRef: webRequest.target_ref,
      mergeCommitSha: webMerge,
    });
    const complete = await fixture.service.refreshDelivery({
      idempotency_key: "refresh-attempt",
      change_set_id: ready.change_set_id,
    });
    assert.equal(complete.state, "done");
    assert.deepEqual(complete.counts, { merged: 2 });
  });

  test("fails closed for target movement, closed PR, and changed PR head", async (t) => {
    const staleFixture = await createDeliveryFixture(t, ["api"], "stale");
    const staleReady = await driveToDeliveryReady(
      staleFixture,
      "stale-delivery",
    );
    await moveTarget(staleFixture.repositories.api);
    await assert.rejects(
      staleFixture.service.publishDelivery({
        idempotency_key: "publish-stale",
        change_set_id: staleReady.change_set_id,
      }),
      { code: "DELIVERY_TARGET_MOVED" },
    );
    const staleState = await staleFixture.service.readDelivery({
      change_set_id: staleReady.change_set_id,
    });
    assert.equal(staleState.state, "decision_required");
    assert.deepEqual(staleState.counts, { integration_stale: 1 });

    const divergenceFixture = await createDeliveryFixture(
      t,
      ["api", "web"],
      "divergence",
    );
    const divergenceReady = await driveToDeliveryReady(
      divergenceFixture,
      "divergent-delivery",
    );
    const published = await divergenceFixture.service.publishDelivery({
      idempotency_key: "publish-divergence",
      change_set_id: divergenceReady.change_set_id,
    });
    const [apiRequest, webRequest] = published.deliveries;
    divergenceFixture.github.close({
      githubRepository: apiRequest.github_repository,
      headBranch: apiRequest.remote_branch,
      targetRef: apiRequest.target_ref,
    });
    divergenceFixture.github.divergeHead({
      githubRepository: webRequest.github_repository,
      headBranch: webRequest.remote_branch,
      targetRef: webRequest.target_ref,
      headSha: "f".repeat(40),
    });
    const divergent = await divergenceFixture.service.refreshDelivery({
      idempotency_key: "refresh-divergence",
      change_set_id: divergenceReady.change_set_id,
    });
    assert.equal(divergent.state, "decision_required");
    assert.deepEqual(divergent.counts, {
      closed_unmerged: 1,
      candidate_diverged: 1,
    });
  });
});

async function createDeliveryFixture(t, repositoryIds, suffix = "complete") {
  const root = await createFixtureRoot(
    t,
    `changefleet-github-${suffix}-`,
  );
  const repositories = {};
  for (const repositoryId of repositoryIds) {
    const repository = await createGitRepository(root, repositoryId);
    const bare = path.join(root, "remotes", `${repositoryId}.git`);
    await mkdir(bare, { recursive: true });
    await git(bare, ["init", "--bare", "--initial-branch=main"]);
    await git(repository.path, ["remote", "add", "origin", bare]);
    await git(repository.path, ["push", "origin", "main"]);
    repositories[repositoryId] = { ...repository, bare };
  }
  const combinedCheck = await writeCombinedCheckScript(
    root,
    repositoryIds.length,
  );
  const runtime = new ScriptedRuntime({
    plan:
      repositoryIds.length === 1
        ? createOneRepositoryPlan(combinedCheck)
        : createTwoRepositoryPlan(combinedCheck),
  });
  const github = new ScriptedGithubPullRequestAdapter({
    resolveRefs: async ({ githubRepository, headBranch, targetRef }) => {
      const repositoryId = githubRepository.split("/")[1];
      return {
        head_sha: await remoteSha(
          repositories[repositoryId].path,
          `refs/heads/${headBranch}`,
        ),
        base_sha: await remoteSha(
          repositories[repositoryId].path,
          targetRef,
        ),
      };
    },
  });
  const options = {
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
    deliveryGitAdapter: new FixtureBindingDeliveryGitAdapter(),
    githubPullRequestAdapter: github,
  };
  return {
    root,
    repositories,
    runtime,
    github,
    options,
    service: await ChangeFleetService.open(options),
  };
}

async function driveToDeliveryReady(fixture, changeSetId) {
  const repositoryIds = Object.keys(fixture.repositories).sort();
  await fixture.service.registerProject({
    idempotency_key: `register-${changeSetId}`,
    project: {
      project_id: `project-${changeSetId}`,
      repositories: repositoryIds.map((repositoryId) => ({
        repository_id: repositoryId,
        locator: { path: fixture.repositories[repositoryId].path },
      })),
    },
  });
  for (const repositoryId of repositoryIds) {
    await fixture.service.configureGithubDelivery({
      idempotency_key: `binding-${changeSetId}-${repositoryId}`,
      project_id: `project-${changeSetId}`,
      repository_id: repositoryId,
      github_repository: `fixture/${repositoryId}`,
      push_remote: "origin",
    });
  }
  await fixture.service.createChangeSet({
    idempotency_key: `create-${changeSetId}`,
    change_set_id: changeSetId,
    project_id: `project-${changeSetId}`,
    intent: { objective: `Deliver ${changeSetId}` },
  });
  const planned = await fixture.service.planChangeSet({
    idempotency_key: `plan-${changeSetId}`,
    change_set_id: changeSetId,
  });
  await fixture.service.confirmPlanRevision({
    idempotency_key: `confirm-${changeSetId}`,
    change_set_id: changeSetId,
    plan_revision: planned.plan_revision,
  });
  const execution = await fixture.service.executeChangeSet({
    idempotency_key: `execute-${changeSetId}`,
    change_set_id: changeSetId,
  });
  await fixture.service.recordBundleDecision({
    idempotency_key: `accept-${changeSetId}`,
    change_set_id: changeSetId,
    bundle_revision: execution.bundle_revision,
    bundle_hash: execution.bundle_hash,
    decision: "accept",
  });
  return { change_set_id: changeSetId, ...execution };
}

async function mergeCandidate(repository, candidateSha) {
  await git(repository.path, ["checkout", "main"]);
  await git(repository.path, [
    "merge",
    "--no-ff",
    candidateSha,
    "-m",
    `merge ${candidateSha.slice(0, 12)}`,
  ]);
  const mergeSha = (await git(repository.path, ["rev-parse", "HEAD"])).trim();
  await git(repository.path, ["push", "origin", "main"]);
  return mergeSha;
}

async function moveTarget(repository) {
  await git(repository.path, ["checkout", "main"]);
  await git(repository.path, [
    "commit",
    "--allow-empty",
    "-m",
    "move target",
  ]);
  await git(repository.path, ["push", "origin", "main"]);
}

async function remoteSha(repositoryPath, ref) {
  const output = await git(repositoryPath, [
    "ls-remote",
    "--refs",
    "origin",
    ref,
  ]);
  const [sha] = output.trim().split(/\s+/u);
  assert.match(sha, /^[0-9a-f]{40,64}$/u);
  return sha;
}
