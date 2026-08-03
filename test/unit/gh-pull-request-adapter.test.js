import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { GhPullRequestAdapter } from "../../src/adapters/github/gh-pull-request-adapter.js";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

describe("gh pull-request adapter", () => {
  test("uses structured argv and reduces check rollup to bounded counts", async () => {
    const calls = [];
    const adapter = new GhPullRequestAdapter({
      commandRunner: async (command) => {
        calls.push(command);
        return success(JSON.stringify([rawPullRequest()]));
      },
    });
    const pullRequest = await adapter.findPullRequest({
      githubRepository: "Owner/Repository",
      headBranch: "changefleet/change/repo/b1-hash",
      targetRef: "refs/heads/main",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].executable, "gh");
    assert.deepEqual(calls[0].argv.slice(0, 4), [
      "pr",
      "list",
      "--repo",
      "owner/repository",
    ]);
    assert.deepEqual(pullRequest.checks, {
      total: 4,
      successful: 1,
      failed: 1,
      pending: 1,
      neutral: 1,
    });
    assert.equal(pullRequest.head_sha, HEAD_SHA);
  });

  test("creates with explicit head/base and recovers the normalized PR", async () => {
    const calls = [];
    const adapter = new GhPullRequestAdapter({
      commandRunner: async (command) => {
        calls.push(command);
        return command.command_id === "github-pr-create"
          ? success("https://github.com/owner/repository/pull/7\n")
          : success(JSON.stringify([rawPullRequest()]));
      },
    });
    const pullRequest = await adapter.createPullRequest({
      githubRepository: "owner/repository",
      headBranch: "changefleet/change/repo/b1-hash",
      targetRef: "refs/heads/main",
      title: "Exact Candidate",
      body: "Bounded body",
    });
    assert.equal(pullRequest.number, 7);
    const create = calls.find(
      (command) => command.command_id === "github-pr-create",
    );
    assert.equal(create.argv[create.argv.indexOf("--head") + 1], "changefleet/change/repo/b1-hash");
    assert.equal(create.argv[create.argv.indexOf("--base") + 1], "main");
    assert.equal(create.argv.includes("--merge"), false);
  });

  test("returns a typed bounded provider failure", async () => {
    const adapter = new GhPullRequestAdapter({
      commandRunner: async () => ({
        ...success(""),
        exit_code: 1,
        stderr: "provider failed ".repeat(1_000),
      }),
    });
    await assert.rejects(
      adapter.readPullRequest({
        githubRepository: "owner/repository",
        number: 7,
      }),
      (error) => {
        assert.equal(error.code, "GITHUB_COMMAND_FAILED");
        assert.equal(error.details.stderr_bytes, 16_000);
        assert.match(error.details.stderr_sha256, /^[0-9a-f]{64}$/u);
        assert.equal(Object.hasOwn(error.details, "stderr"), false);
        return true;
      },
    );
  });
});

function rawPullRequest() {
  return {
    number: 7,
    url: "https://github.com/owner/repository/pull/7",
    state: "OPEN",
    isDraft: false,
    headRefOid: HEAD_SHA,
    baseRefOid: BASE_SHA,
    mergeCommit: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    mergedAt: null,
    mergedBy: null,
    reviewDecision: "APPROVED",
    statusCheckRollup: [
      { conclusion: "SUCCESS" },
      { conclusion: "FAILURE" },
      { status: "IN_PROGRESS" },
      { conclusion: "SKIPPED" },
    ],
  };
}

function success(stdout) {
  return {
    command_id: "fixture",
    executable: "gh",
    argv: [],
    exit_code: 0,
    signal: null,
    timed_out: false,
    output_overflow: false,
    stdout,
    stderr: "",
  };
}
