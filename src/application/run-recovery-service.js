import { HARNESS_SELECTION_MODES } from "../domain/repository-harness.js";
import { invariant } from "../domain/errors.js";
import { setChangeSetPhase, setWorkUnitPhase } from "../domain/lifecycle.js";

// RunRecoveryService 统一解释控制器丢失；不同 operation 只提供资源清理适配。
export class RunRecoveryService {
  constructor({
    controlStore,
    runStore,
    harnessSnapshotStore,
    repositoryWorker,
    cleanupPlanningWorkspaces,
    recordRuntimeEvidence,
    idFactory,
    now,
  }) {
    this.controlStore = controlStore;
    this.runStore = runStore;
    this.harnessSnapshotStore = harnessSnapshotStore;
    this.repositoryWorker = repositoryWorker;
    this.cleanupPlanningWorkspaces = cleanupPlanningWorkspaces;
    this.recordRuntimeEvidence = recordRuntimeEvidence;
    this.idFactory = idFactory;
    this.now = now;
  }

  async reconcile(changeSetId, { project = null } = {}) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    const operations = new Set(
      state.run_references
        .filter((reference) => reference.status === "running")
        .map((reference) => reference.operation),
    );
    if (operations.size === 0) return;

    let currentProject = project;
    if (
      (operations.has("planning") ||
        operations.has("verification") ||
        operations.has("review")) &&
      !currentProject
    ) {
      const catalog = await this.controlStore.readCatalog();
      currentProject = requireProject(catalog, state.project_id);
    }
    if (operations.has("planning")) {
      await this.reconcilePlanning(changeSetId, currentProject);
    }
    if (operations.has("verification")) {
      await this.reconcileVerification(changeSetId, currentProject);
    }
    if (operations.has("review")) {
      await this.reconcileReview(changeSetId, currentProject);
    }
    if (operations.has("execution")) {
      await this.reconcileExecution(changeSetId);
    }
    if (operations.has("supervision")) {
      await this.reconcileSupervision(changeSetId);
    }
  }

  async reconcilePlanning(changeSetId, project) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    const references = state.run_references.filter(
      (reference) =>
        reference.operation === "planning" && reference.status === "running",
    );
    if (references.length === 0) return;
    const repositories = new Map(
      project.repositories.map((repository) => [repository.repository_id, repository]),
    );
    const results = [];
    for (const reference of references) {
      const run = await this.runStore.read(reference.run_id);
      if (!recoverableRunningRun(run)) {
        results.push(ambiguousResult(run.run_id));
        continue;
      }
      let cleanupError = null;
      try {
        await this.cleanupPlanningWorkspaces({
          planningWorkspaces: run.planning_workspaces ?? [],
          projectRepositories: repositories,
        });
      } catch (error) {
        cleanupError = error;
      }
      await this.interruptRecoveredRun(run, cleanupError);
      results.push(recoveryResult(run.run_id, cleanupError));
    }
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      for (const result of results) {
        setReferenceStatus(current.run_references, result.run_id, result.status);
        if (result.status === "failed") {
          current.blockers.push({ code: result.error_code, run_id: result.run_id });
        }
      }
      setChangeSetPhase(current, "planning");
      current.updated_at = this.now();
    });
    assertNoAmbiguousRecovery(results, "Planning");
  }

  async reconcileExecution(changeSetId) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    const workUnits = currentPlanWorkUnits(state).filter((workUnit) =>
      workUnit.run_references.some(
        (reference) =>
          reference.operation === "execution" && reference.status === "running",
      ),
    );
    if (workUnits.length === 0) return;
    const results = [];
    for (const workUnit of workUnits) {
      const reference = workUnit.run_references
        .filter((item) => item.operation === "execution" && item.status === "running")
        .at(-1);
      const run = await this.runStore.read(reference.run_id);
      if (!recoverableRunningRun(run)) {
        results.push({ ...ambiguousResult(run.run_id), work_unit_id: workUnit.work_unit_id });
        continue;
      }
      await this.interruptRecoveredRun(run, null);
      results.push({
        ...recoveryResult(run.run_id, null),
        work_unit_id: workUnit.work_unit_id,
      });
    }
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      for (const result of results) {
        const workUnit = currentPlanWorkUnits(current).find(
          (unit) => unit.work_unit_id === result.work_unit_id,
        );
        setReferenceStatus(workUnit.run_references, result.run_id, result.status);
        setReferenceStatus(current.run_references, result.run_id, result.status);
        if (result.status === "interrupted") {
          setWorkUnitPhase(workUnit, "execution");
          workUnit.last_error = {
            code: "RUN_INTERRUPTED_AFTER_RESTART",
            run_id: result.run_id,
          };
        } else {
          workUnit.last_error = { code: result.error_code, run_id: result.run_id };
          current.blockers.push({
            code: result.error_code,
            work_unit_id: result.work_unit_id,
            run_id: result.run_id,
          });
        }
      }
      setChangeSetPhase(current, "working");
      current.updated_at = this.now();
    });
  }

  async reconcileVerification(changeSetId, project) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    const workUnits = currentPlanWorkUnits(state).filter((workUnit) =>
      workUnit.run_references.some(
        (reference) =>
          reference.operation === "verification" && reference.status === "running",
      ),
    );
    if (workUnits.length === 0) return;
    const harnessSelection = currentHarnessSelection(state);
    const results = [];
    for (const workUnit of workUnits) {
      const reference = workUnit.run_references
        .filter((item) => item.operation === "verification" && item.status === "running")
        .at(-1);
      const run = await this.runStore.read(reference.run_id);
      if (!recoverableRunningRun(run)) {
        results.push({ ...ambiguousResult(run.run_id), work_unit_id: workUnit.work_unit_id });
        continue;
      }
      const repository = requireRepository(project, workUnit.repository_id);
      const selectedHarness = harnessSelection.repositories.find(
        (item) => item.repository_id === workUnit.repository_id,
      );
      const overlaySnapshot =
        selectedHarness?.mode === HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
          ? await this.harnessSnapshotStore.read(selectedHarness.artifact_reference)
          : null;
      let cleanupError = null;
      try {
        await this.repositoryWorker.cleanupVerificationWorkspace({
          repository,
          workspace: run.verification_workspace,
          harnessSnapshot: overlaySnapshot,
        });
      } catch (error) {
        cleanupError = error;
      }
      await this.interruptRecoveredRun(run, cleanupError);
      results.push({
        ...recoveryResult(run.run_id, cleanupError),
        work_unit_id: workUnit.work_unit_id,
      });
    }
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      for (const result of results) {
        const workUnit = currentPlanWorkUnits(current).find(
          (unit) => unit.work_unit_id === result.work_unit_id,
        );
        setReferenceStatus(workUnit.run_references, result.run_id, result.status);
        setReferenceStatus(current.run_references, result.run_id, result.status);
        workUnit.last_error = {
          code:
            result.status === "interrupted"
              ? "VERIFICATION_RUN_INTERRUPTED_AFTER_RESTART"
              : result.error_code,
          run_id: result.run_id,
        };
        if (result.status === "failed") {
          current.blockers.push({
            code: result.error_code,
            work_unit_id: result.work_unit_id,
            run_id: result.run_id,
          });
        }
      }
      setChangeSetPhase(current, "working");
      current.updated_at = this.now();
    });
    assertNoAmbiguousRecovery(results, "Verification");
  }

  async reconcileSupervision(changeSetId) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    const references = state.run_references.filter(
      (reference) =>
        reference.operation === "supervision" && reference.status === "running",
    );
    if (references.length === 0) return;
    const results = [];
    for (const reference of references) {
      const run = await this.runStore.read(reference.run_id);
      if (!recoverableRunningRun(run)) {
        results.push(ambiguousResult(run.run_id));
        continue;
      }
      // Supervisor 不持有仓库工作区或外部写资源，恢复只需结算同一个通用 Run。
      await this.interruptRecoveredRun(run, null);
      results.push(recoveryResult(run.run_id, null));
    }
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      for (const result of results) {
        setReferenceStatus(current.run_references, result.run_id, result.status);
      }
      if (current.supervision_control) {
        current.supervision_control.last_stop_reason = "controller_restart";
        current.supervision_control.updated_at = this.now();
      }
      current.updated_at = this.now();
    });
    assertNoAmbiguousRecovery(results, "Supervision");
  }

  async reconcileReview(changeSetId, project) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    const references = state.run_references.filter(
      (reference) =>
        reference.operation === "review" && reference.status === "running",
    );
    if (references.length === 0) return;
    const harnessSelection = currentHarnessSelection(state);
    const results = [];
    for (const reference of references) {
      const run = await this.runStore.read(reference.run_id);
      if (!recoverableRunningRun(run)) {
        results.push(ambiguousResult(run.run_id));
        continue;
      }
      let cleanupError = null;
      for (const workspace of [...(run.review_workspaces ?? [])].reverse()) {
        try {
          const repository = requireRepository(project, workspace.repository_id);
          const selectedHarness = harnessSelection.repositories.find(
            (item) => item.repository_id === workspace.repository_id,
          );
          const overlaySnapshot =
            selectedHarness?.mode ===
            HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
              ? await this.harnessSnapshotStore.read(
                  selectedHarness.artifact_reference,
                )
              : null;
          await this.repositoryWorker.cleanupVerificationWorkspace({
            repository,
            workspace,
            harnessSnapshot: overlaySnapshot,
          });
        } catch (error) {
          cleanupError ??= error;
        }
      }
      await this.interruptRecoveredRun(run, cleanupError);
      results.push(recoveryResult(run.run_id, cleanupError));
    }
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      for (const result of results) {
        setReferenceStatus(current.run_references, result.run_id, result.status);
        if (result.status === "failed") {
          current.blockers.push({
            code: result.error_code,
            run_id: result.run_id,
          });
        }
      }
      current.current_bundle_review_assessment_id = null;
      current.bundle_review_last_error = {
        code:
          results.find((result) => result.status === "failed")?.error_code ??
          "REVIEW_RUN_INTERRUPTED_AFTER_RESTART",
        run_id: results.at(-1)?.run_id ?? null,
      };
      setChangeSetPhase(current, "review");
      current.updated_at = this.now();
    });
    assertNoAmbiguousRecovery(results, "Bundle review");
  }

  async interruptRecoveredRun(run, cleanupError) {
    const completedAt = this.now();
    await this.recordRuntimeEvidence({
      runId: run.run_id,
      invocation: null,
      providerEvidence: null,
      terminal: {
        status: "interrupted",
        outcome_type: "controller_restart",
        error_code: cleanupError?.code ?? null,
        completed_at: completedAt,
      },
    });
    await this.runStore.update(run.run_id, (current) => {
      current.status = "interrupted";
      current.completed_at = completedAt;
      current.outcome = { type: "controller_restart" };
    });
    await this.runStore.appendEvent(run.run_id, {
      event_id: this.idFactory("event"),
      type: "run.interrupted",
      at: completedAt,
      payload: {
        reason: "controller_restart",
        cleanup_error: cleanupError?.code ?? null,
      },
    });
  }
}

function recoverableRunningRun(run) {
  return run?.status === "running" && !run.runtime_evidence;
}

function recoveryResult(runId, error) {
  return {
    run_id: runId,
    status: error ? "failed" : "interrupted",
    error_code: error?.code ?? null,
  };
}

function ambiguousResult(runId) {
  return {
    run_id: runId,
    status: "failed",
    error_code: "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
  };
}

function assertNoAmbiguousRecovery(results, label) {
  const failed = results.find((result) => result.status === "failed");
  invariant(
    !failed,
    failed?.error_code ?? "AMBIGUOUS_TERMINAL_RUN_RECOVERY",
    `${label} Run ${String(failed?.run_id)} could not be recovered safely`,
  );
}

function setReferenceStatus(references, runId, status) {
  const reference = references.find((item) => item.run_id === runId);
  if (reference) reference.status = status;
}

function currentPlanWorkUnits(state) {
  return (state.work_units ?? []).filter(
    (workUnit) =>
      workUnit.plan_revision === state.current_plan_revision &&
      workUnit.disposition === "current",
  );
}

function currentHarnessSelection(state) {
  const selection = state.repository_harness_selection_revisions.find(
    (item) => item.revision === state.current_repository_harness_selection_revision,
  );
  invariant(
    selection?.status === "current",
    "INVALID_REPOSITORY_HARNESS_SELECTION_REVISION",
    "ChangeSet has no current Repository Harness selection revision",
  );
  return selection;
}

function requireProject(catalog, projectId) {
  const project = catalog.projects[projectId];
  invariant(project, "PROJECT_NOT_FOUND", `Project ${projectId} does not exist`);
  return project;
}

function requireRepository(project, repositoryId) {
  const repository = project.repositories.find(
    (item) => item.repository_id === repositoryId,
  );
  invariant(
    repository,
    "REPOSITORY_NOT_REGISTERED",
    `Repository ${repositoryId} is not registered`,
  );
  return repository;
}
