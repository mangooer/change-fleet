import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createDeliveryProjection,
  createDeliveryRequest,
  createGithubDeliveryBinding,
  deliveryBranchName,
  normalizeGithubPullRequest,
} from "../../src/domain/github-delivery.js";

const BASE_SHA = "a".repeat(40);
const CANDIDATE_SHA = "b".repeat(40);
const BUNDLE_HASH = "c".repeat(64);

describe("GitHub delivery domain", () => {
  test("normalizes one confirmed binding and rejects a mismatched remote", () => {
    const binding = createGithubDeliveryBinding({
      request: {
        github_repository: "Owner/Repository",
        push_remote: "origin",
      },
      normalizedRemote: "owner/repository",
      revision: 1,
      actor: "human",
      confirmedAt: "2026-08-03T00:00:00.000Z",
    });
    assert.equal(binding.github_repository, "owner/repository");
    assert.equal(binding.push_remote, "origin");
    assert.throws(
      () =>
        createGithubDeliveryBinding({
          request: {
            github_repository: "owner/repository",
            push_remote: "origin",
          },
          normalizedRemote: "other/repository",
          revision: 1,
          actor: "human",
          confirmedAt: "2026-08-03T00:00:00.000Z",
        }),
      { code: "GITHUB_REMOTE_IDENTITY_MISMATCH" },
    );
  });

  test("derives stable bounded request and branch identities", () => {
    const candidate = {
      candidate_id: "candidate-1",
      repository_id: "repo-1",
      target_ref: "refs/heads/main",
      base_sha: BASE_SHA,
      candidate_sha: CANDIDATE_SHA,
    };
    const bundle = {
      bundle_id: "bundle-1",
      revision: 1,
      bundle_hash: BUNDLE_HASH,
      candidates: [candidate],
    };
    const input = {
      changeSetId: "change-1",
      planRevision: 1,
      bundle,
      candidate,
      binding: {
        revision: 1,
        github_repository: "owner/repository",
        push_remote: "origin",
      },
      createdAt: "2026-08-03T00:00:00.000Z",
    };
    const first = createDeliveryRequest(input);
    const second = createDeliveryRequest(input);
    assert.deepEqual(first, second);
    assert.match(first.delivery_request_id, /^delivery-[0-9a-f]{24}$/u);
    assert.match(
      first.remote_branch,
      /^changefleet\/change-1\/repo-1\/b1-[0-9a-f]{12}$/u,
    );
    assert.equal(first.latest_observation_reference, null);
    assert.equal(first.observation_count, 0);
    assert.equal(
      deliveryBranchName({
        changeSetId: "change-1",
        repositoryId: "repo-1",
        bundleRevision: 1,
        bundleHash: BUNDLE_HASH,
      }),
      first.remote_branch,
    );
  });

  test("keeps Candidate and GitHub merge identities distinct in bounded projections", () => {
    const pullRequest = normalizeGithubPullRequest({
      number: 7,
      url: "https://github.com/owner/repository/pull/7",
      state: "MERGED",
      is_draft: false,
      head_sha: CANDIDATE_SHA,
      base_sha: BASE_SHA,
      merge_commit_sha: "d".repeat(40),
      merged_at: "2026-08-03T01:00:00.000Z",
      merged_by: "reviewer",
      merge_state_status: "CLEAN",
      mergeable: "MERGEABLE",
      review_decision: "APPROVED",
      checks: {
        total: 2,
        successful: 1,
        failed: 1,
        pending: 0,
        neutral: 0,
      },
    });
    const request = {
      delivery_request_id: "delivery-1",
      bundle_id: "bundle-current",
      bundle_revision: 1,
      repository_id: "repo-1",
      candidate_sha: CANDIDATE_SHA,
      target_ref: "refs/heads/main",
      state: "merged",
      integration_evidence_state: "current",
      remote_branch: "changefleet/change-1/repo-1/b1-abc",
      github_repository: "owner/repository",
      pull_request: pullRequest,
      last_error: null,
      updated_at: "2026-08-03T01:00:00.000Z",
    };
    const projection = createDeliveryProjection({
      change_set_id: "change-1",
      state: "done",
      bundles: [{ bundle_id: "bundle-current" }],
      delivery_requests: [
        { ...request, bundle_id: "bundle-old", delivery_request_id: "old" },
        request,
      ],
    });
    assert.equal(projection.delivery_count, 1);
    assert.equal(projection.historical_delivery_count, 1);
    assert.equal(projection.deliveries[0].candidate_sha, CANDIDATE_SHA);
    assert.equal(
      projection.deliveries[0].pull_request.merge_commit_sha,
      "d".repeat(40),
    );
    assert.notEqual(
      projection.deliveries[0].candidate_sha,
      projection.deliveries[0].pull_request.merge_commit_sha,
    );
  });
});
