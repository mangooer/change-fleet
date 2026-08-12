import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ChangeFleetError, invariant } from "../../domain/errors.js";
import { sha256 } from "../../domain/canonical-json.js";
import {
  branchNameFromTargetRef,
  normalizeGithubDeliveryBindingRequest,
} from "../../domain/github-delivery.js";

const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u;
const DELIVERY_BRANCH_PATTERN = /^changefleet\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

// 此适配器只执行已授权交付所需的 Git 远端读写，不负责 PR、状态机或人类决策。
export class DeliveryGitAdapter {
  async inspectBinding({ repository, pushRemote, githubRepository }) {
    const normalized = normalizeGithubDeliveryBindingRequest({
      github_repository: githubRepository,
      push_remote: pushRemote,
    });
    const remoteUrl = (
      await git(repository.resolved_git_root, [
        "remote",
        "get-url",
        "--push",
        normalized.push_remote,
      ])
    ).trim();
    const observed = normalizeGithubRemote(remoteUrl);
    invariant(
      observed === normalized.github_repository,
      "GITHUB_REMOTE_IDENTITY_MISMATCH",
      "Configured Git push remote does not match the GitHub repository",
      {
        expected: normalized.github_repository,
        observed,
      },
    );
    return {
      normalized_remote: observed,
      remote_url: remoteUrl,
    };
  }

  async readRemoteRef({ repository, pushRemote, ref, allowMissing = false }) {
    assertRemoteName(pushRemote);
    assertBranchRef(ref);
    const result = await gitResult(repository.resolved_git_root, [
      "ls-remote",
      "--refs",
      "--exit-code",
      pushRemote,
      ref,
    ]);
    if (result.exit_code === 2 && allowMissing) return null;
    if (result.exit_code === 2) {
      throw gitError(
        "DELIVERY_TARGET_NOT_FOUND",
        `Delivery target ${ref} does not exist on remote ${pushRemote}`,
        result,
      );
    }
    if (result.exit_code !== 0) {
      throw gitError(
        "GIT_REMOTE_READ_FAILED",
        `Cannot read remote ref ${ref}`,
        result,
      );
    }
    const rows = result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    invariant(
      rows.length === 1,
      "AMBIGUOUS_GIT_REMOTE_REF",
      `Expected one exact remote ref for ${ref}`,
      { ref, observed_count: rows.length },
    );
    const [sha, observedRef] = rows[0].split(/\s+/u);
    invariant(
      COMMIT_PATTERN.test(sha) && observedRef === ref,
      "INVALID_GIT_REMOTE_RESPONSE",
      `Remote returned an invalid exact ref for ${ref}`,
    );
    return sha;
  }

  async publishExactCandidate({
    repository,
    pushRemote,
    candidateSha,
    remoteBranch,
  }) {
    assertRemoteName(pushRemote);
    assertCommit(candidateSha);
    assertDeliveryBranch(remoteBranch);
    await assertLocalCommit(repository.resolved_git_root, candidateSha);
    const branchRef = `refs/heads/${remoteBranch}`;
    const existing = await this.readRemoteRef({
      repository,
      pushRemote,
      ref: branchRef,
      allowMissing: true,
    });
    if (existing !== null) {
      invariant(
        existing === candidateSha,
        "DELIVERY_BRANCH_DIVERGED",
        "Delivery branch already points at a different commit",
        { expected_sha: candidateSha, observed_sha: existing },
      );
      return { branch_ref: branchRef, candidate_sha: candidateSha, reused: true };
    }
    const result = await gitResult(repository.resolved_git_root, [
      "push",
      "--porcelain",
      pushRemote,
      `${candidateSha}:${branchRef}`,
    ]);
    if (result.exit_code !== 0) {
      throw gitError(
        "DELIVERY_GIT_PUSH_FAILED",
        `Cannot publish exact Candidate to ${branchRef}`,
        result,
      );
    }
    const observed = await this.readRemoteRef({
      repository,
      pushRemote,
      ref: branchRef,
    });
    invariant(
      observed === candidateSha,
      "DELIVERY_BRANCH_DIVERGED",
      "Published delivery branch does not point at the exact Candidate",
      { expected_sha: candidateSha, observed_sha: observed },
    );
    return { branch_ref: branchRef, candidate_sha: candidateSha, reused: false };
  }

  async verifyRemoteContains({
    repository,
    pushRemote,
    targetRef,
    commitSha,
  }) {
    assertRemoteName(pushRemote);
    assertBranchRef(targetRef);
    assertCommit(commitSha);
    const fetch = await gitResult(repository.resolved_git_root, [
      "fetch",
      "--no-tags",
      "--quiet",
      pushRemote,
      targetRef,
    ]);
    if (fetch.exit_code !== 0) {
      throw gitError(
        "GIT_REMOTE_READ_FAILED",
        `Cannot fetch delivery target ${targetRef}`,
        fetch,
      );
    }
    const ancestry = await gitResult(repository.resolved_git_root, [
      "merge-base",
      "--is-ancestor",
      commitSha,
      "FETCH_HEAD",
    ]);
    if (ancestry.exit_code === 0) return true;
    if (ancestry.exit_code === 1) return false;
    throw gitError(
      "DELIVERY_RESULT_VERIFICATION_FAILED",
      "Cannot verify the GitHub merge result against the remote target",
      ancestry,
    );
  }
}

export function normalizeGithubRemote(value) {
  const remote = String(value ?? "").trim();
  const patterns = [
    /^https:\/\/github\.com\/(?<repository>[^/]+\/[^/]+?)(?:\.git)?$/iu,
    /^git@github\.com:(?<repository>[^/]+\/[^/]+?)(?:\.git)?$/iu,
    /^ssh:\/\/git@github\.com\/(?<repository>[^/]+\/[^/]+?)(?:\.git)?$/iu,
  ];
  const repository = patterns
    .map((pattern) => remote.match(pattern)?.groups?.repository)
    .find(Boolean);
  invariant(
    repository,
    "UNSUPPORTED_GITHUB_REMOTE",
    "Git push remote is not a supported GitHub URL",
  );
  return normalizeGithubDeliveryBindingRequest({
    github_repository: repository,
    push_remote: "validated",
  }).github_repository;
}

function assertRemoteName(value) {
  normalizeGithubDeliveryBindingRequest({
    github_repository: "owner/repository",
    push_remote: value,
  });
}

function assertDeliveryBranch(value) {
  invariant(
    typeof value === "string" && DELIVERY_BRANCH_PATTERN.test(value),
    "INVALID_DELIVERY_BRANCH",
    "Delivery branch name is invalid",
  );
}

function assertBranchRef(value) {
  branchNameFromTargetRef(value);
}

function assertCommit(value) {
  invariant(
    typeof value === "string" && COMMIT_PATTERN.test(value),
    "INVALID_COMMIT_SHA",
    "Delivery commit SHA is invalid",
  );
}

async function assertLocalCommit(repositoryRoot, sha) {
  const result = await gitResult(repositoryRoot, [
    "cat-file",
    "-e",
    `${sha}^{commit}`,
  ]);
  if (result.exit_code !== 0) {
    throw gitError(
      "GIT_COMMIT_NOT_FOUND",
      `Cannot resolve delivery Candidate ${sha}`,
      result,
    );
  }
}

async function git(cwd, arguments_) {
  const result = await gitResult(cwd, arguments_);
  if (result.exit_code !== 0) {
    throw gitError("GIT_DELIVERY_COMMAND_FAILED", "Git delivery command failed", result);
  }
  return result.stdout;
}

async function gitResult(cwd, arguments_) {
  try {
    const { stdout, stderr } = await execFileAsync("git", arguments_, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { exit_code: 0, stdout, stderr: stderr ?? "" };
  } catch (error) {
    if (typeof error?.code === "number") {
      return {
        exit_code: error.code,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      };
    }
    throw new ChangeFleetError(
      "GIT_DELIVERY_COMMAND_FAILED",
      "Git delivery command could not be started",
      { reason: "spawn_failed" },
    );
  }
}

function gitError(code, message, result) {
  const stderr = String(result.stderr ?? "");
  return new ChangeFleetError(code, message, {
    exit_code: result.exit_code,
    // 远端错误可能回显含凭据 URL；只保留摘要和大小供精确比对，绝不回传正文。
    stderr_sha256: sha256(stderr),
    stderr_bytes: Buffer.byteLength(stderr),
  });
}
