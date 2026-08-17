import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { sha256 } from "../../domain/canonical-json.js";
import { ChangeFleetError, invariant } from "../../domain/errors.js";
import {
  normalizeBranchRef,
  normalizeIntegrationActionKind,
  normalizePushRemote,
} from "../../domain/integration.js";

const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u;

// Runtime performs the granted action; this adapter owns only exact preflight and independent result observation.
export class IntegrationGitAdapter {
  async preflight({
    repository,
    actionKind,
    pushRemote,
    destinationRef,
    targetRef,
    baseSha,
    candidateSha,
  }) {
    const kind = normalizeIntegrationActionKind(actionKind);
    const remote = normalizePushRemote(pushRemote);
    const destination = normalizeBranchRef(destinationRef);
    normalizeBranchRef(targetRef);
    assertCommit(baseSha);
    assertCommit(candidateSha);
    await Promise.all([
      assertLocalCommit(repository.resolved_git_root, baseSha),
      assertLocalCommit(repository.resolved_git_root, candidateSha),
    ]);
    if (kind === "fast_forward_target") {
      invariant(
        destination === targetRef,
        "INVALID_INTEGRATION_DESTINATION",
        "Fast-forward destination must equal the exact target ref",
      );
      await assertAncestor(repository.resolved_git_root, baseSha, candidateSha);
    } else {
      invariant(
        destination !== targetRef,
        "INVALID_INTEGRATION_DESTINATION",
        "Publication destination must not equal the target ref",
      );
    }
    const observed = await this.readRemoteRef({
      repository,
      pushRemote: remote,
      ref: destination,
      allowMissing: kind === "publish_exact_candidate",
    });
    if (kind === "publish_exact_candidate") {
      invariant(
        observed === null || observed === candidateSha,
        "INTEGRATION_DESTINATION_DIVERGED",
        "Publication destination points at another commit",
        { expected_sha: candidateSha, observed_sha: observed },
      );
    } else {
      invariant(
        observed === baseSha || observed === candidateSha,
        "INTEGRATION_TARGET_MOVED",
        "Fast-forward target moved after the action was offered",
        { expected_base_sha: baseSha, observed_sha: observed },
      );
    }
    return {
      action_kind: kind,
      push_remote: remote,
      destination_ref: destination,
      observed_destination_sha: observed,
      already_satisfied: observed === candidateSha,
    };
  }

  async observeResult({ repository, pushRemote, destinationRef, candidateSha }) {
    const observed = await this.readRemoteRef({
      repository,
      pushRemote,
      ref: destinationRef,
    });
    invariant(
      observed === candidateSha,
      "INTEGRATION_RESULT_DIVERGED",
      "Remote destination does not equal the exact granted Candidate",
      { expected_sha: candidateSha, observed_sha: observed },
    );
    return {
      destination_ref: destinationRef,
      observed_destination_sha: observed,
    };
  }

  async readRemoteRef({ repository, pushRemote, ref, allowMissing = false }) {
    const remote = normalizePushRemote(pushRemote);
    const branchRef = normalizeBranchRef(ref);
    const result = await gitResult(repository.resolved_git_root, [
      "ls-remote",
      "--refs",
      "--exit-code",
      remote,
      branchRef,
    ]);
    if (result.exit_code === 2 && allowMissing) return null;
    if (result.exit_code === 2) {
      throw gitError(
        "INTEGRATION_DESTINATION_NOT_FOUND",
        `Integration destination ${branchRef} does not exist`,
        result,
      );
    }
    if (result.exit_code !== 0) {
      throw gitError(
        "INTEGRATION_REMOTE_READ_FAILED",
        "Cannot read the exact integration destination",
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
      "Integration observer expected one exact remote ref",
      { observed_count: rows.length },
    );
    const [sha, observedRef] = rows[0].split(/\s+/u);
    invariant(
      COMMIT_PATTERN.test(sha) && observedRef === branchRef,
      "INVALID_GIT_REMOTE_RESPONSE",
      "Remote returned an invalid integration ref observation",
    );
    return sha;
  }
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
      `Cannot resolve integration commit ${sha}`,
      result,
    );
  }
}

async function assertAncestor(repositoryRoot, baseSha, candidateSha) {
  const result = await gitResult(repositoryRoot, [
    "merge-base",
    "--is-ancestor",
    baseSha,
    candidateSha,
  ]);
  invariant(
    result.exit_code === 0,
    "INTEGRATION_NOT_FAST_FORWARD",
    "Candidate is not a fast-forward descendant of the granted base",
  );
}

function assertCommit(value) {
  invariant(
    typeof value === "string" && COMMIT_PATTERN.test(value),
    "INVALID_COMMIT_SHA",
    "Integration commit SHA is invalid",
  );
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
      "INTEGRATION_GIT_COMMAND_FAILED",
      "Integration Git observation could not be started",
      { reason: "spawn_failed" },
    );
  }
}

function gitError(code, message, result) {
  const stderr = String(result.stderr ?? "");
  return new ChangeFleetError(code, message, {
    exit_code: result.exit_code,
    stderr_sha256: sha256(stderr),
    stderr_bytes: Buffer.byteLength(stderr),
  });
}
