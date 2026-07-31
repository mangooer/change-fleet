import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ChangeFleetError, invariant } from "../../domain/errors.js";
import { normalizeId } from "../../domain/model.js";

// 注册只读、执行只写受控 worktree；Candidate 身份始终绑定精确 base 与 commit SHA。
const execFileAsync = promisify(execFile);

export class RepositoryWorker {
  constructor({ workspaceRoot }) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  async inspectRegistration({ repositoryId, locator, defaultTargetRef = null }) {
    // 登记阶段只解析真实 Git 根目录和目标 ref，不清理或修改用户 checkout。
    normalizeId("repository_id", repositoryId);
    const configuredPath = path.resolve(locator);
    const configuredStat = await stat(configuredPath).catch(() => null);
    invariant(
      configuredStat?.isDirectory(),
      "INVALID_REPOSITORY_LOCATOR",
      `Repository locator is not a directory: ${configuredPath}`,
    );
    let root;
    try {
      root = await realpath(
        (
          await git(configuredPath, ["rev-parse", "--show-toplevel"])
        ).trim(),
      );
    } catch (error) {
      throw gitBoundaryError(
        error,
        "NOT_A_GIT_REPOSITORY",
        `Repository locator is not inside a Git worktree: ${configuredPath}`,
      );
    }
    const commonGitDirectory = await resolveCommonGitDirectory(root);
    const targetRef =
      defaultTargetRef === null
        ? await discoverCurrentRef(root)
        : normalizeTargetRef(defaultTargetRef);
    await resolveCommit(root, targetRef);
    const canonicalRemote = await git(root, ["remote", "get-url", "origin"])
      .then((value) => value.trim())
      .catch(() => null);
    return {
      repository_id: repositoryId,
      locator: {
        type: "local_path",
        path: configuredPath,
      },
      resolved_git_root: root,
      common_git_dir: commonGitDirectory,
      canonical_remote: canonicalRemote,
      default_target_ref: targetRef,
    };
  }

  async freezeBase(repository, targetRef = repository.default_target_ref) {
    const normalizedTarget = normalizeTargetRef(targetRef);
    const baseSha = await resolveCommit(
      repository.resolved_git_root,
      normalizedTarget,
    );
    return {
      repository_id: repository.repository_id,
      target_ref: normalizedTarget,
      base_sha: baseSha,
    };
  }

  async resolveRepositorySelection(
    repository,
    { branchRef = null, targetRef = null } = {},
  ) {
    // 未显式选分支时只读取此刻 checkout 的符号分支，绝不退回登记时缓存的默认值。
    const selectionSource = branchRef === null ? "current_checkout" : "caller";
    const selectedBranch =
      branchRef === null
        ? await discoverCurrentSelectionBranch(repository.resolved_git_root)
        : normalizeBranchRef(branchRef, "INVALID_BRANCH_REF");
    const normalizedTarget =
      targetRef === null
        ? selectedBranch
        : normalizeBranchRef(targetRef, "INVALID_TARGET_REF");
    const baseSha = await resolveCommit(
      repository.resolved_git_root,
      selectedBranch,
    );
    // 目标必须也是当前存在的本地分支；本阶段不接受 tag、任意 ref 或历史 commit。
    await resolveCommit(repository.resolved_git_root, normalizedTarget);
    return {
      repository_id: repository.repository_id,
      branch_ref: selectedBranch,
      resolved_base_sha: baseSha,
      target_ref: normalizedTarget,
      selection_source: selectionSource,
    };
  }

  async discoverHarness(repository, baseSha) {
    // Harness 从冻结提交读取，避免把用户未提交的本地说明混入本次规划。
    const resources = [];
    for (const resourcePath of ["AGENTS.md", "WORKFLOW.md"]) {
      try {
        const blobSha = (
          await git(repository.resolved_git_root, [
            "rev-parse",
            `${baseSha}:${resourcePath}`,
          ])
        ).trim();
        const bytes = Number.parseInt(
          (
            await git(repository.resolved_git_root, [
              "cat-file",
              "-s",
              blobSha,
            ])
          ).trim(),
          10,
        );
        resources.push({
          path: resourcePath,
          git_blob_sha: blobSha,
          bytes,
          locator: `${baseSha}:${resourcePath}`,
        });
      } catch (error) {
        if (error.code === "GIT_COMMIT_NOT_FOUND") throw error;
      }
    }
    return resources;
  }

  async prepareWorkspace({
    repository,
    targetRef,
    baseSha,
    workspaceId,
  }) {
    normalizeId("workspace_id", workspaceId);
    const workspacePath = this.workspacePath(
      repository.repository_id,
      workspaceId,
    );
    await assertCommitExists(repository.resolved_git_root, baseSha);

    const workspaceStat = await stat(workspacePath).catch(() => null);
    if (!workspaceStat) {
      await mkdir(path.dirname(workspacePath), { recursive: true });
      await git(repository.resolved_git_root, ["worktree", "prune"]);
      await git(repository.resolved_git_root, [
        "worktree",
        "add",
        "--detach",
        workspacePath,
        baseSha,
      ]);
    } else {
      invariant(
        workspaceStat.isDirectory(),
        "WORKSPACE_PATH_CONFLICT",
        `Workspace path is not a directory: ${workspacePath}`,
      );
    }

    await this.assertWorkspaceOwnership(repository, workspacePath);
    const currentHead = await resolveCommit(workspacePath, "HEAD");
    invariant(
      currentHead === baseSha,
      "WORKSPACE_BASE_MISMATCH",
      `Workspace ${workspaceId} is at ${currentHead}, expected ${baseSha}`,
    );
    return {
      workspace_id: workspaceId,
      workspace_path: workspacePath,
      repository_id: repository.repository_id,
      target_ref: targetRef,
      base_sha: baseSha,
    };
  }

  async preparePlanningWorkspace({ repository, baseSha, workspaceId }) {
    // 规划也使用控制面拥有的 detached worktree，绝不把登记 checkout 当成冻结基线视图。
    normalizeId("workspace_id", workspaceId);
    const workspacePath = this.planningWorkspacePath(
      repository.repository_id,
      workspaceId,
    );
    await assertCommitExists(repository.resolved_git_root, baseSha);

    const workspaceStat = await stat(workspacePath).catch(() => null);
    if (!workspaceStat) {
      await mkdir(path.dirname(workspacePath), { recursive: true });
      await git(repository.resolved_git_root, ["worktree", "prune"]);
      await git(repository.resolved_git_root, [
        "worktree",
        "add",
        "--detach",
        workspacePath,
        baseSha,
      ]);
    } else {
      invariant(
        workspaceStat.isDirectory(),
        "WORKSPACE_PATH_CONFLICT",
        `Planning workspace path is not a directory: ${workspacePath}`,
      );
    }

    await this.assertWorkspaceOwnership(repository, workspacePath);
    const currentHead = await resolveCommit(workspacePath, "HEAD");
    invariant(
      currentHead === baseSha,
      "WORKSPACE_BASE_MISMATCH",
      `Planning workspace ${workspaceId} is at ${currentHead}, expected ${baseSha}`,
    );
    invariant(
      (await workspaceStatus(workspacePath)).length === 0,
      "DIRTY_PLANNING_WORKSPACE",
      `Planning workspace ${workspaceId} must start clean`,
    );
    return {
      workspace_kind: "planning",
      workspace_id: workspaceId,
      workspace_path: workspacePath,
      repository_id: repository.repository_id,
      base_sha: baseSha,
    };
  }

  async cleanupPlanningWorkspace({ repository, workspace }) {
    // 所有权验证通过后才允许删除；HEAD 或 clean 违规仍会先安全移除，再把违规报告给控制层。
    invariant(
      workspace?.workspace_kind === "planning",
      "INVALID_PLANNING_WORKSPACE",
      "Only a planning workspace may use the planning cleanup path",
    );
    const workspaceStat = await stat(workspace.workspace_path).catch(
      () => null,
    );
    if (!workspaceStat) {
      // 重启可能发生在 worktree 已删除、Run 尚未落终态之间；prune 后把缺失视为幂等清理完成。
      await git(repository.resolved_git_root, ["worktree", "prune"]);
      return;
    }
    await this.assertWorkspaceOwnership(repository, workspace.workspace_path);
    const currentHead = await resolveCommit(workspace.workspace_path, "HEAD");
    const status = await workspaceStatus(workspace.workspace_path);
    await git(repository.resolved_git_root, [
      "worktree",
      "remove",
      "--force",
      workspace.workspace_path,
    ]);
    await git(repository.resolved_git_root, ["worktree", "prune"]);
    invariant(
      currentHead === workspace.base_sha,
      "PLANNING_WORKSPACE_HEAD_CHANGED",
      `Planning workspace HEAD changed from ${workspace.base_sha} to ${currentHead}`,
    );
    invariant(
      status.length === 0,
      "PLANNING_WORKSPACE_MODIFIED",
      "Read-only planning modified its exact-base workspace",
      { changed_entries: status },
    );
  }

  async publishCandidate({
    // Runtime 只能修改文件，Candidate commit 由控制面在确认 HEAD 未移动后统一发布。
    repository,
    workspace,
    expectedHead,
    message,
  }) {
    await this.assertWorkspaceOwnership(repository, workspace.workspace_path);
    const headBefore = await resolveCommit(workspace.workspace_path, "HEAD");
    invariant(
      headBefore === expectedHead,
      "UNEXPECTED_WORKSPACE_HEAD",
      `Workspace HEAD ${headBefore} differs from expected ${expectedHead}`,
    );

    const statusBefore = await workspaceStatus(workspace.workspace_path);
    if (statusBefore.length > 0) {
      await git(workspace.workspace_path, ["add", "-A"]);
      await git(workspace.workspace_path, [
        "-c",
        "user.name=ChangeFleet",
        "-c",
        "user.email=changefleet@local.invalid",
        "commit",
        "-m",
        message,
      ]);
    }

    const candidateSha = await resolveCommit(workspace.workspace_path, "HEAD");
    const changedPaths =
      candidateSha === expectedHead
        ? []
        : splitLines(
            await git(workspace.workspace_path, [
              "diff",
              "--name-only",
              `${expectedHead}..${candidateSha}`,
            ]),
          );
    const candidate = {
      repository_id: repository.repository_id,
      target_ref: workspace.target_ref,
      base_sha: expectedHead,
      candidate_sha: candidateSha,
      workspace_id: workspace.workspace_id,
      workspace_path: workspace.workspace_path,
      changed_paths: changedPaths,
      no_change: candidateSha === expectedHead,
    };
    await this.preflightCandidate({ repository, candidate });
    return candidate;
  }

  async preflightCandidate({ repository, candidate }) {
    // 验证前后复用此检查，防止命令成功但同时篡改 Candidate 工作区。
    await this.assertWorkspaceOwnership(repository, candidate.workspace_path);
    const currentHead = await resolveCommit(candidate.workspace_path, "HEAD");
    invariant(
      currentHead === candidate.candidate_sha,
      "CANDIDATE_HEAD_MISMATCH",
      `Candidate workspace is at ${currentHead}, expected ${candidate.candidate_sha}`,
    );
    invariant(
      (await workspaceStatus(candidate.workspace_path)).length === 0,
      "DIRTY_CANDIDATE_WORKSPACE",
      `Candidate workspace contains tracked, staged, or untracked changes`,
    );
    await assertCommitExists(
      repository.resolved_git_root,
      candidate.base_sha,
    );
    await assertCommitExists(
      repository.resolved_git_root,
      candidate.candidate_sha,
    );
    try {
      await git(repository.resolved_git_root, [
        "merge-base",
        "--is-ancestor",
        candidate.base_sha,
        candidate.candidate_sha,
      ]);
    } catch (error) {
      throw gitBoundaryError(
        error,
        "CANDIDATE_BASE_NOT_ANCESTOR",
        `Candidate ${candidate.candidate_sha} does not descend from ${candidate.base_sha}`,
      );
    }
    return {
      repository_id: candidate.repository_id,
      base_sha: candidate.base_sha,
      candidate_sha: candidate.candidate_sha,
      clean: true,
      changed_paths: [...candidate.changed_paths],
    };
  }

  async assertWorkspaceOwnership(repository, workspacePath) {
    this.assertContainedWorkspace(workspacePath);
    let workspaceRoot;
    try {
      workspaceRoot = await realpath(
        (
          await git(workspacePath, ["rev-parse", "--show-toplevel"])
        ).trim(),
      );
    } catch (error) {
      throw gitBoundaryError(
        error,
        "INVALID_WORKSPACE",
        `Workspace is not an attached Git worktree: ${workspacePath}`,
      );
    }
    invariant(
      samePath(workspaceRoot, await realpath(workspacePath)),
      "WORKSPACE_ROOT_MISMATCH",
      `Workspace path does not identify its Git top-level: ${workspacePath}`,
    );
    const commonGitDirectory = await resolveCommonGitDirectory(workspacePath);
    invariant(
      samePath(commonGitDirectory, repository.common_git_dir),
      "FOREIGN_WORKSPACE",
      `Workspace ${workspacePath} belongs to a different Git repository`,
    );
  }

  workspacePath(repositoryId, workspaceId) {
    normalizeId("repository_id", repositoryId);
    const candidate = path.resolve(
      this.workspaceRoot,
      repositoryId,
      workspaceId,
    );
    this.assertContainedWorkspace(candidate);
    return candidate;
  }

  planningWorkspacePath(repositoryId, workspaceId) {
    normalizeId("repository_id", repositoryId);
    const candidate = path.resolve(
      this.workspaceRoot,
      "_planning",
      repositoryId,
      workspaceId,
    );
    this.assertContainedWorkspace(candidate);
    return candidate;
  }

  assertContainedWorkspace(workspacePath) {
    const resolved = path.resolve(workspacePath);
    const relative = path.relative(this.workspaceRoot, resolved);
    invariant(
      relative.length > 0 &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative),
      "UNSAFE_WORKSPACE_PATH",
      `Workspace path must stay below ${this.workspaceRoot}`,
      { workspace_path: resolved },
    );
  }
}

async function discoverCurrentRef(repositoryRoot) {
  try {
    return normalizeTargetRef(
      (
        await git(repositoryRoot, ["symbolic-ref", "-q", "HEAD"])
      ).trim(),
    );
  } catch (error) {
    throw gitBoundaryError(
      error,
      "DEFAULT_TARGET_REF_REQUIRED",
      "A detached registered checkout requires an explicit default target ref",
    );
  }
}

async function discoverCurrentSelectionBranch(repositoryRoot) {
  try {
    return normalizeBranchRef(
      (
        await git(repositoryRoot, ["symbolic-ref", "--quiet", "HEAD"])
      ).trim(),
      "REPOSITORY_BRANCH_SELECTION_REQUIRED",
    );
  } catch (error) {
    throw gitBoundaryError(
      error,
      "REPOSITORY_BRANCH_SELECTION_REQUIRED",
      "A detached checkout requires an explicit Repository branch selection",
    );
  }
}

function normalizeTargetRef(targetRef) {
  invariant(
    typeof targetRef === "string" && targetRef.trim().length > 0,
    "INVALID_TARGET_REF",
    "Target ref is required",
  );
  const normalized = targetRef.trim();
  return normalized.startsWith("refs/")
    ? normalized
    : `refs/heads/${normalized}`;
}

function normalizeBranchRef(branchRef, errorCode) {
  invariant(
    typeof branchRef === "string" && branchRef.trim().length > 0,
    errorCode,
    "A non-empty local branch ref is required",
  );
  const normalized = branchRef.trim();
  invariant(
    !normalized.startsWith("refs/") ||
      normalized.startsWith("refs/heads/"),
    errorCode,
    `Only local branch refs are supported: ${normalized}`,
    { branch_ref: normalized },
  );
  return normalized.startsWith("refs/heads/")
    ? normalized
    : `refs/heads/${normalized}`;
}

async function resolveCommonGitDirectory(repositoryRoot) {
  const value = (
    await git(repositoryRoot, ["rev-parse", "--git-common-dir"])
  ).trim();
  return realpath(path.resolve(repositoryRoot, value));
}

async function resolveCommit(repositoryRoot, ref) {
  try {
    return (
      await git(repositoryRoot, ["rev-parse", "--verify", `${ref}^{commit}`])
    ).trim();
  } catch (error) {
    throw gitBoundaryError(
      error,
      "GIT_COMMIT_NOT_FOUND",
      `Cannot resolve ${ref} to a commit in ${repositoryRoot}`,
    );
  }
}

async function assertCommitExists(repositoryRoot, sha) {
  invariant(
    typeof sha === "string" && /^[0-9a-f]{40,64}$/.test(sha),
    "INVALID_COMMIT_SHA",
    `Invalid commit SHA ${sha}`,
  );
  await resolveCommit(repositoryRoot, sha);
}

async function workspaceStatus(workspacePath) {
  return splitLines(
    await git(workspacePath, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
  );
}

async function git(cwd, arguments_) {
  try {
    const { stdout } = await execFileAsync("git", arguments_, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    error.git_arguments = arguments_;
    error.git_cwd = cwd;
    throw error;
  }
}

function splitLines(value) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function gitBoundaryError(error, code, message) {
  if (error instanceof ChangeFleetError) return error;
  const wrapped = new ChangeFleetError(code, message, {
    cwd: error.git_cwd,
    arguments: error.git_arguments,
    stderr: error.stderr?.trim(),
  });
  wrapped.cause = error;
  return wrapped;
}
