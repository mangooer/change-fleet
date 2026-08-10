import { rm } from "node:fs/promises";
import path from "node:path";

import { invariant } from "../domain/errors.js";
import { currentPlanWorkUnits } from "../domain/lifecycle.js";
import { runTerminalStatusForError } from "./run-coordinator.js";

// ChangeSetRunService 拥有 Run 与命令生命周期的共享叶子操作；聚合权威仍在 ChangeFleetService。
export class ChangeSetRunService {
  constructor({
    controlStore,
    runStore,
    repositoryWorker,
    harnessSnapshotStore,
    workspaceRoot,
    idFactory,
    now,
  }) {
    this.controlStore = controlStore;
    this.runStore = runStore;
    this.repositoryWorker = repositoryWorker;
    this.harnessSnapshotStore = harnessSnapshotStore;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.idFactory = idFactory;
    this.now = now;
  }

  async appendRuntimeEvent(runId, event) {
    invariant(
      event &&
        typeof event.type === "string" &&
        event.payload &&
        typeof event.payload === "object",
      "INVALID_RUNTIME_EVENT",
      "Runtime event must contain a type and bounded payload",
    );
    await this.runStore.appendEvent(runId, {
      event_id: this.idFactory("event"),
      type: event.type,
      at: this.now(),
      payload: event.payload,
    });
  }

  async markRunReference(changeSetId, runId, status) {
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const reference = state.run_references.find(
        (candidate) => candidate.run_id === runId,
      );
      if (reference?.status === "running") reference.status = status;
      state.updated_at = this.now();
    });
  }

  async failWorkUnit(changeSetId, workUnitId, error, runId = null) {
    const status = runTerminalStatusForError(error);
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const workUnit = currentPlanWorkUnits(state).find(
        (candidate) => candidate.work_unit_id === workUnitId,
      );
      workUnit.last_error = {
        code: error.code ?? "UNEXPECTED_ERROR",
        message: error.message,
      };
      const latestRunReference = runId
        ? workUnit.run_references.find(
            (reference) => reference.run_id === runId,
          )
        : workUnit.run_references.at(-1);
      if (latestRunReference?.status === "running") {
        latestRunReference.status = status;
        const aggregateReference = state.run_references.find(
          (reference) => reference.run_id === latestRunReference.run_id,
        );
        if (aggregateReference) aggregateReference.status = status;
      }
      if (status === "failed") {
        state.blockers.push({
          code: error.code ?? "UNEXPECTED_ERROR",
          work_unit_id: workUnitId,
        });
      }
      state.updated_at = this.now();
    });
  }

  async blockWorkUnit(changeSetId, workUnitId, error, runId = null) {
    // Provider 正常结束但无法完成语义工作时保留 completed Run，WorkUnit 单独进入可审计阻塞态。
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const workUnit = currentPlanWorkUnits(state).find(
        (candidate) => candidate.work_unit_id === workUnitId,
      );
      workUnit.last_error = {
        code: error.code,
        message: error.message,
        blocker_code: error.details?.blocker_code ?? null,
        run_id: runId,
      };
      state.blockers.push({
        code: error.code,
        work_unit_id: workUnitId,
        blocker_code: error.details?.blocker_code ?? null,
        run_id: runId,
      });
      state.updated_at = this.now();
    });
  }

  async markCommandFailed(changeSetId, idempotencyKey, error) {
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      const command = state.commands[idempotencyKey];
      if (!command || command.status !== "in_progress") return;
      command.status = "failed";
      command.failed_at = this.now();
      command.error = {
        code: error.code ?? "UNEXPECTED_ERROR",
        message: error.message,
      };
      if (
        state.phase !== "terminal" &&
        runTerminalStatusForError(error) === "failed"
      ) {
        if (
          !state.blockers.some(
            (blocker) =>
              blocker.code === command.error.code &&
              blocker.command_id === idempotencyKey,
          )
        ) {
          state.blockers.push({
            code: command.error.code,
            command_id: idempotencyKey,
          });
        }
      }
      state.updated_at = this.now();
    });
  }

  async cleanupPlanningWorkspaces({ planningWorkspaces, projectRepositories }) {
    // 逐个清理并保留首个错误，避免一个仓库异常导致其余临时 worktree 永久泄漏。
    let firstError = null;
    for (const workspace of [...planningWorkspaces].reverse()) {
      const repository = projectRepositories.get(workspace.repository_id);
      let harnessSnapshot = null;
      if (workspace.harness_overlay) {
        try {
          harnessSnapshot = await this.harnessSnapshotStore.read(
            workspace.harness_overlay,
          );
        } catch (error) {
          firstError ??= error;
        }
      }
      try {
        await this.repositoryWorker.cleanupPlanningWorkspace({
          repository,
          workspace,
          harnessSnapshot,
        });
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  async cleanupSupervisionWorkspace(workspacePath) {
    const supervisionRoot = path.resolve(
      this.workspaceRoot,
      ".changefleet-supervision",
    );
    const resolvedWorkspace = path.resolve(workspacePath);
    invariant(
      resolvedWorkspace.startsWith(`${supervisionRoot}${path.sep}`),
      "INVALID_SUPERVISION_WORKSPACE",
      "Supervision workspace must remain inside the owned supervision root",
    );
    await rm(resolvedWorkspace, { recursive: true, force: true });
  }
}
