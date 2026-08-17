import { sha256, stableId } from "../domain/canonical-json.js";
import { invariant, preserveSecondaryFailure } from "../domain/errors.js";
import { HARNESS_SELECTION_MODES } from "../domain/repository-harness.js";
import {
  createTaskWorkspaceRecord,
  requireTaskWorkspace,
} from "../domain/task-workspace.js";

// 该组件只管理 TaskWorkspace 的物理资源和只读边界；ChangeSet 生命周期仍由应用服务裁决。
export class TaskWorkspaceManager {
  constructor({
    controlStore,
    repositoryWorker,
    harnessSnapshotStore,
    now,
  }) {
    this.controlStore = controlStore;
    this.repositoryWorker = repositoryWorker;
    this.harnessSnapshotStore = harnessSnapshotStore;
    this.now = now;
  }

  async prepare({
    changeSetId,
    project,
    repositorySelection,
    repositoryHarnessSelection,
    agentProfile,
    agentSessionAssignments = null,
    createdAt,
  }) {
    // 先完整准备所有仓库，再返回可持久化记录；部分失败会回收已经创建的 worktree。
    const taskWorkspaceId = stableId("task-workspace", {
      change_set_id: changeSetId,
    });
    const prepared = [];
    try {
      for (const selected of repositorySelection.repositories) {
        const repository = requireRepository(project, selected.repository_id);
        const harnessSelection = repositoryHarnessSelection.repositories.find(
          (candidate) => candidate.repository_id === selected.repository_id,
        );
        invariant(
          harnessSelection,
          "TASK_WORKSPACE_REPOSITORY_MISMATCH",
          `Repository ${selected.repository_id} is not available for TaskWorkspace preparation`,
        );
        let workspace =
          await this.repositoryWorker.prepareTaskRepositoryWorkspace({
            repository,
            targetRef: selected.target_ref,
            baseSha: selected.resolved_base_sha,
            taskWorkspaceId,
            workspaceId: stableId("repository-workspace", {
              task_workspace_id: taskWorkspaceId,
              repository_id: selected.repository_id,
              repository_selection_revision: repositorySelection.revision,
              repository_harness_selection_revision:
                repositoryHarnessSelection.revision,
            }),
            branchRef: `refs/heads/changefleet/${stableId("task-branch", {
              task_workspace_id: taskWorkspaceId,
              repository_id: selected.repository_id,
              repository_selection_revision: repositorySelection.revision,
              repository_harness_selection_revision:
                repositoryHarnessSelection.revision,
            })}`,
          });
        prepared.push(workspace);
        if (
          harnessSelection.mode ===
          HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
        ) {
          workspace = await this.repositoryWorker.materializeHarnessOverlay({
            repository,
            workspace,
            snapshot: await this.harnessSnapshotStore.read(
              harnessSelection.artifact_reference,
            ),
          });
          prepared[prepared.length - 1] = workspace;
        }
      }
    } catch (error) {
      await preserveSecondaryFailure(error, "task_workspace_cleanup", () =>
        this.releasePrepared({
          project,
          taskWorkspace: {
            repositories: prepared.map((workspace) => ({
              repository_id: workspace.repository_id,
              workspace,
            })),
          },
        }),
      );
      throw error;
    }
    return createTaskWorkspaceRecord({
      changeSetId,
      agentProfile,
      agentSessionAssignments,
      repositorySelection,
      repositoryHarnessSelection,
      repositoryWorkspaces: prepared,
      createdAt,
    });
  }

  async releasePrepared({ project, taskWorkspace }) {
    // 当前和已退役 generation 都属于同一任务；终态回收必须覆盖两者且保持幂等。
    const errors = [];
    const resources = [
      ...(taskWorkspace.repositories ?? []),
      ...(taskWorkspace.retired_repository_workspaces ?? []),
    ];
    for (const item of resources) {
      try {
        await this.repositoryWorker.cleanupTaskRepositoryWorkspace({
          repository: requireRepository(project, item.repository_id),
          workspace: item.workspace,
        });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw errors[0];
  }

  async releaseResources(changeSetId) {
    // 终态只回收可替换资源；逻辑身份、Git 主体和审计事实继续留在 Control Store。
    const [state, catalog] = await Promise.all([
      this.controlStore.readChangeSet(changeSetId),
      this.controlStore.readCatalog(),
    ]);
    const taskWorkspace = requireTaskWorkspace(state);
    if (taskWorkspace.resources_released_at !== null) {
      return taskWorkspace.resources_released_at;
    }
    invariant(
      state.phase === "terminal",
      "TASK_WORKSPACE_RELEASE_NOT_ALLOWED",
      "TaskWorkspace resources may be released only after terminal delivery or abandonment",
    );
    const project = requireProject(catalog, state.project_id);
    await this.releasePrepared({ project, taskWorkspace });
    const releasedAt = this.now();
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const currentWorkspace = requireTaskWorkspace(current);
      currentWorkspace.resources_released_at ??= releasedAt;
      for (const session of currentWorkspace.agent_sessions) {
        if (session.status === "active") {
          session.status = "closed";
          session.closed_at = releasedAt;
        }
      }
      current.updated_at = this.now();
    });
    return releasedAt;
  }

  async assertUnchanged({
    project,
    repositoryWorkspaces,
    repositoryHarnessSelection,
    beforeSnapshots,
    errorCode,
    errorMessage,
  }) {
    // Provider 即使以异常退出，也不能绕过只读边界：先验证私有 Harness，再比较 Git 主体。
    for (const candidate of repositoryWorkspaces) {
      const harnessSelection = repositoryHarnessSelection.repositories.find(
        (item) => item.repository_id === candidate.repository_id,
      );
      if (
        harnessSelection?.mode !==
        HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
      ) {
        continue;
      }
      await this.repositoryWorker.verifyHarnessOverlay({
        repository: requireRepository(project, candidate.repository_id),
        workspace: candidate.workspace,
        snapshot: await this.harnessSnapshotStore.read(
          harnessSelection.artifact_reference,
        ),
      });
    }
    const afterSnapshots = await Promise.all(
      repositoryWorkspaces.map((candidate) =>
        this.repositoryWorker.inspectTaskRepositoryWorkspace({
          repository: requireRepository(project, candidate.repository_id),
          workspace: candidate.workspace,
        }),
      ),
    );
    invariant(
      sha256(afterSnapshots) === sha256(beforeSnapshots),
      errorCode,
      errorMessage,
      { before: beforeSnapshots, after: afterSnapshots },
    );
  }

  async captureSnapshots({ project, repositoryWorkspaces }) {
    return Promise.all(
      repositoryWorkspaces.map((candidate) =>
        this.repositoryWorker.inspectTaskRepositoryWorkspace({
          repository: requireRepository(project, candidate.repository_id),
          workspace: candidate.workspace,
        }),
      ),
    );
  }
}

function requireProject(catalog, projectId) {
  const project = catalog.projects[projectId];
  invariant(project, "PROJECT_NOT_FOUND", `Project ${projectId} is not registered`);
  return project;
}

function requireRepository(project, repositoryId) {
  const repository = project.repositories.find(
    (candidate) => candidate.repository_id === repositoryId,
  );
  invariant(
    repository,
    "REPOSITORY_NOT_REGISTERED",
    `Repository ${repositoryId} is not registered in Project ${project.project_id}`,
  );
  return repository;
}
