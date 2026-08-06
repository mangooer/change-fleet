import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ChangeFleetError, invariant } from "../../domain/errors.js";
import { normalizeId } from "../../domain/model.js";
import {
  HARNESS_POLICY_SELECTORS,
  harnessSelectorDigest,
} from "../../domain/repository-harness.js";

// 注册只读、执行只写受控 worktree；Candidate 身份始终绑定精确 base 与 commit SHA。
const execFileAsync = promisify(execFile);

const MAX_HARNESS_FILES = 128;
const MAX_HARNESS_FILE_BYTES = 256 * 1024;
const MAX_HARNESS_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_REPORTED_SKIPPED_HARNESS_RESOURCES = 32;

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
      // 登记只保存无凭据定位；真实认证继续由宿主 Git/gh 管理。
      .then((value) => redactRemoteCredentials(value.trim()))
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
    // Harness 从冻结提交读取，只投影路径、Git 身份和大小，不把正文主动塞进上下文。
    await assertCommitExists(repository.resolved_git_root, baseSha);
    const entries = splitNull(
      await git(repository.resolved_git_root, [
        "ls-tree",
        "-r",
        "-z",
        "--full-tree",
        baseSha,
        "--",
        "AGENTS.md",
        "AGENTS.override.md",
        "WORKFLOW.md",
        ".agents/skills",
      ]),
    );
    const resources = [];
    for (const entry of entries) {
      const match = entry.match(
        /^(?<mode>[0-7]{6}) blob (?<sha>[0-9a-f]{40,64})\t(?<path>.+)$/u,
      );
      invariant(
        match?.groups,
        "INVALID_GIT_TREE_ENTRY",
        `Cannot parse Harness tree entry: ${entry}`,
      );
      const resourcePath = normalizeRelativeGitPath(match.groups.path);
      const bytes = Number.parseInt(
        (
          await git(repository.resolved_git_root, [
            "cat-file",
            "-s",
            match.groups.sha,
          ])
        ).trim(),
        10,
      );
      resources.push({
        path: resourcePath,
        source: "exact_base",
        git_blob_sha: match.groups.sha,
        bytes,
        executable: match.groups.mode === "100755",
        locator: `${baseSha}:${resourcePath}`,
      });
    }
    return resources.sort((left, right) => left.path.localeCompare(right.path));
  }

  async resolveHarnessOverlay({ repository, baseSha, policy }) {
    // 仅在 ChangeSet 选择阶段读取注册 checkout；后续 Run 只能消费持久化快照。
    await assertCommitExists(repository.resolved_git_root, baseSha);
    const patterns =
      policy.selector === HARNESS_POLICY_SELECTORS.EXACT_BASE_WORKTREEINCLUDE
        ? await readTrackedWorktreeinclude(
            repository.resolved_git_root,
            baseSha,
            policy.manifest_path,
          )
        : [...policy.patterns];
    const selectorDigest = harnessSelectorDigest(policy, patterns);
    const ignoredPaths = splitNull(
      await git(repository.resolved_git_root, [
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--",
      ]),
    );
    const matchedPaths = ignoredPaths
      .map(normalizeRelativeGitPath)
      .filter((relativePath) => matchesGitIgnorePatterns(relativePath, patterns))
      .sort();
    const skippedResources = [];
    let skippedResourceCount = 0;
    const selectedPaths = [];
    for (const relativePath of matchedPaths) {
      if (!isEligibleCodexHarnessPath(relativePath)) {
        if (
          policy.selector ===
          HARNESS_POLICY_SELECTORS.EXACT_BASE_WORKTREEINCLUDE
        ) {
          skippedResourceCount += 1;
          if (
            skippedResources.length <
            MAX_REPORTED_SKIPPED_HARNESS_RESOURCES
          ) {
            skippedResources.push({
              path: relativePath,
              reason: "outside_provider_semantic_roots",
            });
          }
          continue;
        }
        throw new ChangeFleetError(
          "UNSUPPORTED_HARNESS_RESOURCE",
          `Explicit Harness policy selected an unsupported path: ${relativePath}`,
          { path: relativePath },
        );
      }
      invariant(
        !isForbiddenHarnessPath(relativePath),
        "UNSUPPORTED_HARNESS_RESOURCE",
        `Harness path is reserved for settings, secrets, or cache data: ${relativePath}`,
        { path: relativePath },
      );
      selectedPaths.push(relativePath);
    }
    if (skippedResourceCount > skippedResources.length) {
      // 跳过项只保留有界样本和诚实总数，避免宽泛 manifest 把大量文件名塞进聚合与上下文。
      skippedResources.push({
        reason: "additional_nonsemantic_matches",
        count: skippedResourceCount - skippedResources.length,
      });
    }
    invariant(
      selectedPaths.length > 0,
      "EMPTY_HARNESS_OVERLAY",
      `Repository ${repository.repository_id} Harness policy matched no eligible ignored files`,
      {
        repository_id: repository.repository_id,
        skipped_resources: skippedResources,
      },
    );
    invariant(
      selectedPaths.length <= MAX_HARNESS_FILES,
      "HARNESS_OVERLAY_LIMIT_EXCEEDED",
      `Harness overlay exceeds ${MAX_HARNESS_FILES} files`,
      { file_count: selectedPaths.length, limit: MAX_HARNESS_FILES },
    );

    const files = [];
    let totalBytes = 0;
    for (const relativePath of selectedPaths) {
      invariant(
        !(await pathExistsAtCommit(
          repository.resolved_git_root,
          baseSha,
          relativePath,
        )),
        "HARNESS_OVERLAY_TRACKED_COLLISION",
        `Harness overlay collides with tracked exact-base content: ${relativePath}`,
        { path: relativePath, base_sha: baseSha },
      );
      const absolutePath = await assertContainedRegularFile(
        repository.resolved_git_root,
        relativePath,
      );
      const fileStat = await stat(absolutePath);
      invariant(
        fileStat.size <= MAX_HARNESS_FILE_BYTES,
        "HARNESS_OVERLAY_LIMIT_EXCEEDED",
        `Harness file exceeds ${MAX_HARNESS_FILE_BYTES} bytes: ${relativePath}`,
        {
          path: relativePath,
          bytes: fileStat.size,
          limit: MAX_HARNESS_FILE_BYTES,
        },
      );
      totalBytes += fileStat.size;
      invariant(
        totalBytes <= MAX_HARNESS_TOTAL_BYTES,
        "HARNESS_OVERLAY_LIMIT_EXCEEDED",
        `Harness overlay exceeds ${MAX_HARNESS_TOTAL_BYTES} bytes`,
        { bytes: totalBytes, limit: MAX_HARNESS_TOTAL_BYTES },
      );
      const content = await readFile(absolutePath);
      invariant(
        content.byteLength === fileStat.size,
        "HARNESS_SOURCE_CHANGED",
        `Harness source changed while snapshotting: ${relativePath}`,
        { path: relativePath },
      );
      files.push({
        relative_path: relativePath,
        content,
        executable: (fileStat.mode & 0o111) !== 0,
      });
    }
    return {
      selector_digest: selectorDigest,
      patterns,
      files,
      skipped_resources: skippedResources,
    };
  }

  async materializeHarnessOverlay({ repository, workspace, snapshot }) {
    // 快照只恢复到控制面拥有的 worktree，存在的部分恢复不会被覆盖，而会按篡改处理。
    assertSnapshotMatchesWorkspace(workspace, snapshot);
    await this.assertWorkspaceOwnership(repository, workspace.workspace_path);
    const existing = [];
    for (const file of snapshot.files) {
      const target = safeWorkspaceTarget(
        workspace.workspace_path,
        file.relative_path,
      );
      if (await lstat(target).catch(() => null)) existing.push(target);
    }
    if (existing.length > 0) {
      await this.verifyHarnessOverlay({ repository, workspace, snapshot });
      return workspaceWithHarness(workspace, snapshot);
    }

    for (const file of snapshot.files) {
      const target = safeWorkspaceTarget(
        workspace.workspace_path,
        file.relative_path,
      );
      await assertSafeWorkspaceParents(workspace.workspace_path, target);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, { flag: "wx" });
      if (process.platform !== "win32" && file.executable) {
        await chmod(target, 0o755);
      }
    }
    await this.verifyHarnessOverlay({ repository, workspace, snapshot });
    return workspaceWithHarness(workspace, snapshot);
  }

  async verifyHarnessOverlay({ repository, workspace, snapshot }) {
    // 候选发布前必须证明每个 overlay 字节未变，且语义根下没有额外的未跟踪输入。
    assertSnapshotMatchesWorkspace(workspace, snapshot);
    await this.assertWorkspaceOwnership(repository, workspace.workspace_path);
    const selected = new Set(
      snapshot.files.map((file) => file.relative_path),
    );
    for (const file of snapshot.files) {
      const target = safeWorkspaceTarget(
        workspace.workspace_path,
        file.relative_path,
      );
      const targetStat = await lstat(target).catch(() => null);
      invariant(
        targetStat?.isFile() && !targetStat.isSymbolicLink(),
        "HARNESS_OVERLAY_MODIFIED",
        `Harness overlay file is missing or replaced: ${file.relative_path}`,
        { path: file.relative_path },
      );
      invariant(
        process.platform === "win32" ||
          ((targetStat.mode & 0o111) !== 0) === file.executable,
        "HARNESS_OVERLAY_MODIFIED",
        `Harness overlay executable mode changed: ${file.relative_path}`,
        { path: file.relative_path },
      );
      const content = await readFile(target);
      invariant(
        content.equals(file.content),
        "HARNESS_OVERLAY_MODIFIED",
        `Harness overlay file changed: ${file.relative_path}`,
        { path: file.relative_path },
      );
    }

    const untracked = new Set([
      ...splitNull(
        await git(workspace.workspace_path, [
          "ls-files",
          "-z",
          "--others",
          "--exclude-standard",
          "--",
        ]),
      ),
      ...splitNull(
        await git(workspace.workspace_path, [
          "ls-files",
          "-z",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--",
        ]),
      ),
    ]);
    const added = [...untracked]
      .map(normalizeRelativeGitPath)
      .filter(
        (relativePath) =>
          isEligibleCodexHarnessPath(relativePath) &&
          !selected.has(relativePath),
      )
      .sort();
    invariant(
      added.length === 0,
      "HARNESS_OVERLAY_MODIFIED",
      "Harness overlay roots contain additional untracked content",
      { added_paths: added },
    );
    return {
      content_digest: snapshot.content_digest,
      paths: [...selected].sort(),
    };
  }

  async verifyAndRemoveHarnessOverlay({ repository, workspace, snapshot }) {
    await this.verifyHarnessOverlay({ repository, workspace, snapshot });
    const directories = new Set();
    for (const file of snapshot.files) {
      const target = safeWorkspaceTarget(
        workspace.workspace_path,
        file.relative_path,
      );
      await unlink(target);
      let directory = path.dirname(target);
      while (!samePath(directory, workspace.workspace_path)) {
        directories.add(directory);
        directory = path.dirname(directory);
      }
    }
    for (const directory of [...directories].sort(
      (left, right) => right.length - left.length,
    )) {
      await rmdir(directory).catch((error) => {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) {
          throw error;
        }
      });
    }
    for (const file of snapshot.files) {
      const target = safeWorkspaceTarget(
        workspace.workspace_path,
        file.relative_path,
      );
      invariant(
        !(await lstat(target).catch(() => null)),
        "HARNESS_OVERLAY_CLEANUP_FAILED",
        `Harness overlay path remains after cleanup: ${file.relative_path}`,
        { path: file.relative_path },
      );
    }
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

  async prepareVerificationWorkspace({
    repository,
    candidateSha,
    harnessBaseSha = candidateSha,
    workspaceId,
  }) {
    // 独立验证使用 Candidate commit 的一次性 detached worktree，绝不复用执行 Agent 的工作区。
    normalizeId("workspace_id", workspaceId);
    const workspacePath = this.verificationWorkspacePath(
      repository.repository_id,
      workspaceId,
    );
    await assertCommitExists(repository.resolved_git_root, candidateSha);

    const workspaceStat = await stat(workspacePath).catch(() => null);
    if (!workspaceStat) {
      await mkdir(path.dirname(workspacePath), { recursive: true });
      await git(repository.resolved_git_root, ["worktree", "prune"]);
      await git(repository.resolved_git_root, [
        "worktree",
        "add",
        "--detach",
        workspacePath,
        candidateSha,
      ]);
    } else {
      invariant(
        workspaceStat.isDirectory(),
        "WORKSPACE_PATH_CONFLICT",
        `Verification workspace path is not a directory: ${workspacePath}`,
      );
    }

    const workspace = {
      workspace_kind: "verification",
      workspace_id: workspaceId,
      workspace_path: workspacePath,
      repository_id: repository.repository_id,
      base_sha: candidateSha,
      harness_base_sha: harnessBaseSha,
    };
    await this.preflightVerificationWorkspace({ repository, workspace });
    return workspace;
  }

  async preflightVerificationWorkspace({ repository, workspace }) {
    // Runtime 返回后和每个权威检查后都验证 HEAD 与 clean 状态，写入不会污染 Candidate。
    invariant(
      workspace?.workspace_kind === "verification" &&
        workspace.repository_id === repository.repository_id,
      "INVALID_VERIFICATION_WORKSPACE",
      "Verification workspace does not match its Repository",
    );
    await this.assertWorkspaceOwnership(repository, workspace.workspace_path);
    const currentHead = await resolveCommit(workspace.workspace_path, "HEAD");
    invariant(
      currentHead === workspace.base_sha,
      "VERIFICATION_WORKSPACE_HEAD_CHANGED",
      `Verification workspace HEAD changed from ${workspace.base_sha} to ${currentHead}`,
    );
    const status = await workspaceStatus(workspace.workspace_path);
    invariant(
      status.length === 0,
      "VERIFICATION_WORKSPACE_MODIFIED",
      "Read-only verification modified its exact-Candidate workspace",
      { changed_entries: status },
    );
    return {
      repository_id: repository.repository_id,
      candidate_sha: currentHead,
      clean: true,
    };
  }

  async preflightExecutionRetry({
    repository,
    workspace,
    baseSha,
    targetRef,
  }) {
    // 语义重试只复用仍在精确 base 的干净受控工作区；这里绝不 reset、stash 或删除部分修改。
    invariant(
      workspace?.repository_id === repository.repository_id &&
        workspace.base_sha === baseSha &&
        workspace.target_ref === targetRef &&
        typeof workspace.workspace_id === "string" &&
        workspace.workspace_id.length > 0,
      "EXECUTION_RETRY_SUBJECT_MISMATCH",
      "Execution retry workspace does not match the exact Repository and base",
    );
    await this.assertWorkspaceOwnership(repository, workspace.workspace_path);
    const currentHead = await resolveCommit(workspace.workspace_path, "HEAD");
    invariant(
      currentHead === baseSha,
      "EXECUTION_RETRY_HEAD_MOVED",
      `Execution retry workspace is at ${currentHead}, expected ${baseSha}`,
    );
    invariant(
      (await workspaceStatus(workspace.workspace_path)).length === 0,
      "EXECUTION_RETRY_WORKSPACE_DIRTY",
      "Execution retry workspace contains partial changes",
    );
    return {
      repository_id: repository.repository_id,
      workspace_id: workspace.workspace_id,
      base_sha: baseSha,
    };
  }

  async cleanupPlanningWorkspace({
    repository,
    workspace,
    harnessSnapshot = null,
  }) {
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
    let harnessError = null;
    if (harnessSnapshot) {
      try {
        await this.verifyAndRemoveHarnessOverlay({
          repository,
          workspace,
          snapshot: harnessSnapshot,
        });
      } catch (error) {
        harnessError = error;
      }
    }
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
    if (harnessError) throw harnessError;
  }

  async cleanupVerificationWorkspace({
    repository,
    workspace,
    harnessSnapshot = null,
  }) {
    // 即使只读契约被违反也先安全删除一次性 worktree，再把违规作为验证失败返回。
    invariant(
      workspace?.workspace_kind === "verification",
      "INVALID_VERIFICATION_WORKSPACE",
      "Only a verification workspace may use the verification cleanup path",
    );
    const workspaceStat = await stat(workspace.workspace_path).catch(
      () => null,
    );
    if (!workspaceStat) {
      await git(repository.resolved_git_root, ["worktree", "prune"]);
      return;
    }
    await this.assertWorkspaceOwnership(repository, workspace.workspace_path);
    const currentHead = await resolveCommit(workspace.workspace_path, "HEAD");
    let harnessError = null;
    if (harnessSnapshot) {
      try {
        await this.verifyAndRemoveHarnessOverlay({
          repository,
          workspace,
          snapshot: harnessSnapshot,
        });
      } catch (error) {
        harnessError = error;
      }
    }
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
      "VERIFICATION_WORKSPACE_HEAD_CHANGED",
      `Verification workspace HEAD changed from ${workspace.base_sha} to ${currentHead}`,
    );
    invariant(
      status.length === 0,
      "VERIFICATION_WORKSPACE_MODIFIED",
      "Read-only verification or its requested check modified the exact-Candidate workspace",
      { changed_entries: status },
    );
    if (harnessError) throw harnessError;
  }

  async publishCandidate({
    // Runtime 只能修改文件，Candidate commit 由控制面在确认 HEAD 未移动后统一发布。
    repository,
    workspace,
    expectedHead,
    baseSha = expectedHead,
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
      candidateSha === baseSha
        ? []
        : splitLines(
            await git(workspace.workspace_path, [
              "diff",
              "--name-only",
              `${baseSha}..${candidateSha}`,
            ]),
          );
    const roundChangedPaths =
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
      base_sha: baseSha,
      candidate_sha: candidateSha,
      workspace_id: workspace.workspace_id,
      workspace_path: workspace.workspace_path,
      changed_paths: changedPaths,
      // 修正复用原始 base，但聚焦复审还需要本轮旧 Candidate 到新 Candidate 的真实差异。
      round_changed_paths: roundChangedPaths,
      // no_change 只比较本轮起点；correction 可以保留原始 Candidate base 身份。
      no_change: candidateSha === expectedHead,
    };
    await this.preflightCandidate({ repository, candidate });
    return candidate;
  }

  async recoverPublishedCandidate({
    repository,
    workspace,
    baseSha,
    candidateSha,
  }) {
    // 旧记录恢复只重建已存在的精确 Git 主体，不提交、reset 或采用脏文件。
    invariant(
      workspace?.repository_id === repository.repository_id &&
        workspace.base_sha === baseSha,
      "LEGACY_RECOVERY_SUBJECT_MISMATCH",
      "Legacy recovery workspace does not match the exact Repository and base",
    );
    const changedPaths = await changedPathsBetween(
      workspace.workspace_path,
      baseSha,
      candidateSha,
    );
    const candidate = {
      repository_id: repository.repository_id,
      target_ref: workspace.target_ref,
      base_sha: baseSha,
      candidate_sha: candidateSha,
      workspace_id: workspace.workspace_id,
      workspace_path: workspace.workspace_path,
      changed_paths: changedPaths,
      no_change: candidateSha === baseSha,
    };
    await this.preflightCandidate({ repository, candidate });
    return candidate;
  }

  async preflightCandidate({ repository, candidate }) {
    // 验证前后复用此检查，防止命令成功但同时篡改 Candidate 工作区。
    invariant(
      candidate.repository_id === repository.repository_id,
      "CANDIDATE_REPOSITORY_MISMATCH",
      "Candidate repository identity does not match its registered Repository",
    );
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
    const computedChangedPaths = await changedPathsBetween(
      candidate.workspace_path,
      candidate.base_sha,
      candidate.candidate_sha,
    );
    invariant(
      JSON.stringify([...candidate.changed_paths].sort()) ===
        JSON.stringify(computedChangedPaths),
      "CANDIDATE_CHANGED_PATHS_MISMATCH",
      "Candidate changed paths do not match the exact Git subject",
      {
        recorded_changed_paths: [...candidate.changed_paths].sort(),
        computed_changed_paths: computedChangedPaths,
      },
    );
    return {
      repository_id: candidate.repository_id,
      base_sha: candidate.base_sha,
      candidate_sha: candidate.candidate_sha,
      clean: true,
      changed_paths: computedChangedPaths,
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

  verificationWorkspacePath(repositoryId, workspaceId) {
    normalizeId("repository_id", repositoryId);
    const candidate = path.resolve(
      this.workspaceRoot,
      "_verification",
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

async function changedPathsBetween(repositoryRoot, baseSha, candidateSha) {
  if (baseSha === candidateSha) return [];
  return splitLines(
    await git(repositoryRoot, [
      "diff",
      "--name-only",
      `${baseSha}..${candidateSha}`,
    ]),
  ).sort();
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

async function readTrackedWorktreeinclude(
  repositoryRoot,
  baseSha,
  manifestPath,
) {
  let content;
  try {
    content = await git(repositoryRoot, [
      "show",
      `${baseSha}:${manifestPath}`,
    ]);
  } catch (error) {
    throw gitBoundaryError(
      error,
      "WORKTREEINCLUDE_NOT_TRACKED_AT_BASE",
      `${manifestPath} is not tracked at exact base ${baseSha}`,
    );
  }
  const patterns = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(normalizeManifestPattern);
  invariant(
    patterns.length > 0,
    "EMPTY_WORKTREEINCLUDE",
    `${manifestPath} contains no usable patterns`,
  );
  return patterns;
}

function normalizeManifestPattern(pattern) {
  const normalized = pattern.replaceAll("\\", "/");
  const value = normalized.startsWith("!")
    ? normalized.slice(1)
    : normalized;
  invariant(
    value.length > 0 &&
      !value.includes("\0") &&
      !value.startsWith("../") &&
      value !== ".." &&
      !value.match(/^[A-Za-z]:\//u),
    "UNSAFE_REPOSITORY_HARNESS_PATTERN",
    `Unsafe .worktreeinclude pattern: ${pattern}`,
    { pattern },
  );
  return normalized;
}

function matchesGitIgnorePatterns(relativePath, patterns) {
  let selected = false;
  for (const rawPattern of patterns) {
    const negated = rawPattern.startsWith("!");
    const pattern = negated ? rawPattern.slice(1) : rawPattern;
    if (matchesGitIgnorePattern(relativePath, pattern)) {
      selected = !negated;
    }
  }
  return selected;
}

function matchesGitIgnorePattern(relativePath, rawPattern) {
  const anchored = rawPattern.startsWith("/");
  let pattern = anchored ? rawPattern.slice(1) : rawPattern;
  if (pattern.endsWith("/")) pattern = `${pattern}**`;
  const directoryPrefix = pattern.replace(/\/\*\*$/u, "");
  if (
    directoryPrefix &&
    (relativePath === directoryPrefix ||
      relativePath.startsWith(`${directoryPrefix}/`))
  ) {
    return true;
  }
  try {
    if (path.matchesGlob(relativePath, pattern)) return true;
    if (!anchored && !pattern.includes("/")) {
      return relativePath
        .split("/")
        .some((segment) => path.matchesGlob(segment, pattern));
    }
    return !anchored && path.matchesGlob(relativePath, `**/${pattern}`);
  } catch (error) {
    throw new ChangeFleetError(
      "INVALID_REPOSITORY_HARNESS_PATTERN",
      `Invalid Repository Harness pattern: ${rawPattern}`,
      { pattern: rawPattern, cause_message: error.message },
    );
  }
}

function normalizeRelativeGitPath(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  invariant(
    normalized.length > 0 &&
      !normalized.includes("\0") &&
      !path.posix.isAbsolute(normalized) &&
      !normalized.split("/").includes(".."),
    "UNSAFE_HARNESS_PATH",
    `Harness path must remain relative to the Repository root: ${value}`,
    { path: value },
  );
  return normalized;
}

function isEligibleCodexHarnessPath(relativePath) {
  return (
    relativePath === "AGENTS.override.md" ||
    relativePath.startsWith(".agents/skills/")
  );
}

function isForbiddenHarnessPath(relativePath) {
  const segments = relativePath.toLowerCase().split("/");
  const basename = segments.at(-1);
  return (
    segments.some((segment) =>
      [
        ".git",
        ".cache",
        "cache",
        "__pycache__",
        "node_modules",
      ].includes(segment),
    ) ||
    basename === ".mcp.json" ||
    basename === "auth.json" ||
    basename === "credentials.json" ||
    basename === "settings.json" ||
    basename === "settings.local.json" ||
    basename === ".env" ||
    basename.startsWith(".env.")
  );
}

async function pathExistsAtCommit(repositoryRoot, baseSha, relativePath) {
  try {
    await git(repositoryRoot, [
      "cat-file",
      "-e",
      `${baseSha}:${relativePath}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function assertContainedRegularFile(repositoryRoot, relativePath) {
  const root = await realpath(repositoryRoot);
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  invariant(
    isStrictlyContainedOrEqual(root, absolutePath),
    "UNSAFE_HARNESS_PATH",
    `Harness path escapes the registered Repository: ${relativePath}`,
    { path: relativePath },
  );
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const currentStat = await lstat(current).catch(() => null);
    invariant(
      currentStat && !currentStat.isSymbolicLink(),
      "UNSAFE_HARNESS_PATH",
      `Harness path contains a missing path or filesystem link: ${relativePath}`,
      { path: relativePath },
    );
  }
  const fileStat = await lstat(absolutePath);
  invariant(
    fileStat.isFile() && !fileStat.isSymbolicLink(),
    "UNSUPPORTED_HARNESS_RESOURCE",
    `Harness overlay accepts regular files only: ${relativePath}`,
    { path: relativePath },
  );
  const resolved = await realpath(absolutePath);
  invariant(
    isStrictlyContainedOrEqual(root, resolved),
    "UNSAFE_HARNESS_PATH",
    `Harness path resolves outside the registered Repository: ${relativePath}`,
    { path: relativePath },
  );
  return resolved;
}

function safeWorkspaceTarget(workspaceRoot, relativePath) {
  const normalized = normalizeRelativeGitPath(relativePath);
  const target = path.resolve(workspaceRoot, ...normalized.split("/"));
  invariant(
    isStrictlyContainedOrEqual(path.resolve(workspaceRoot), target) &&
      !samePath(workspaceRoot, target),
    "UNSAFE_HARNESS_PATH",
    `Harness target escapes its owned workspace: ${relativePath}`,
    { path: relativePath },
  );
  return target;
}

async function assertSafeWorkspaceParents(workspaceRoot, target) {
  const relative = path.relative(workspaceRoot, path.dirname(target));
  let current = path.resolve(workspaceRoot);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const currentStat = await lstat(current).catch(() => null);
    invariant(
      !currentStat ||
        (currentStat.isDirectory() && !currentStat.isSymbolicLink()),
      "UNSAFE_HARNESS_PATH",
      `Harness target parent is not a safe directory: ${current}`,
      { path: current },
    );
  }
}

function assertSnapshotMatchesWorkspace(workspace, snapshot) {
  const expectedHarnessBase = workspace.harness_base_sha ?? workspace.base_sha;
  invariant(
    snapshot &&
      snapshot.repository_id === workspace.repository_id &&
      snapshot.resolved_base_sha === expectedHarnessBase,
    "HARNESS_SNAPSHOT_WORKSPACE_MISMATCH",
    "Harness snapshot does not match the exact Repository workspace",
    {
      workspace_repository_id: workspace.repository_id,
      workspace_base_sha: expectedHarnessBase,
      snapshot_repository_id: snapshot?.repository_id,
      snapshot_base_sha: snapshot?.resolved_base_sha,
    },
  );
}

function workspaceWithHarness(workspace, snapshot) {
  return {
    ...workspace,
    harness_overlay: {
      snapshot_id: snapshot.snapshot_id,
      snapshot_hash: snapshot.snapshot_hash,
      content_digest: snapshot.content_digest,
      paths: snapshot.files
        .map((file) => file.relative_path)
        .sort(),
    },
  };
}

function isStrictlyContainedOrEqual(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
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

function splitNull(value) {
  return value
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean);
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function redactRemoteCredentials(value) {
  try {
    const parsed = new URL(value);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return value;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
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
