import { HARNESS_SELECTION_MODES } from "../domain/repository-harness.js";
import { invariant } from "../domain/errors.js";
import {
  currentPlanWorkUnits,
  setChangeSetPhase,
  setWorkUnitPhase,
} from "../domain/lifecycle.js";
import { stopSupervisionClock } from "../domain/supervision.js";

// RunRecoveryService 统一解释控制器丢失；不同 operation 只提供资源清理适配。
export class RunRecoveryService {
  constructor({
    controlStore,
    runStore,
    harnessSnapshotStore,
    repositoryWorker,
    recordRuntimeEvidence,
    idFactory,
    now,
  }) {
    this.controlStore = controlStore;
    this.runStore = runStore;
    this.harnessSnapshotStore = harnessSnapshotStore;
    this.repositoryWorker = repositoryWorker;
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
    if (operations.has("integration")) {
      await this.reconcileIntegration(changeSetId);
    }
  }

  async reconcilePlanning(changeSetId, project) {
    await this.reconcileReferences({
      changeSetId,
      project,
      label: "Planning",
      prepare: (state) => {
        return {
          references: state.run_references
            .filter(
              (reference) =>
                reference.operation === "planning" &&
                reference.status === "running",
            )
            .map((reference) => ({
              run_id: reference.run_id,
              work_unit_id: null,
            })),
          // 规划 Run 只借用 ChangeSet 的持久 TaskWorkspace；控制器中断不能删除它。
          cleanup: null,
        };
      },
      applyResults: (current, results) => {
        for (const result of results) {
          setReferenceStatus(
            current.run_references,
            result.run_id,
            result.status,
          );
          if (result.status === "failed") {
            current.blockers.push({
              code: result.error_code,
              run_id: result.run_id,
            });
          }
        }
        setChangeSetPhase(current, "planning");
      },
    });
  }

  async reconcileExecution(changeSetId) {
    await this.reconcileReferences({
      changeSetId,
      label: "Execution",
      assertNoAmbiguous: false,
      prepare: (state) => ({
        references: currentPlanWorkUnits(state).flatMap((workUnit) =>
          runningReference(workUnit, "execution", workUnit.work_unit_id),
        ),
        cleanup: null,
      }),
      applyResults: (current, results) => {
        for (const result of results) {
          const workUnit = currentPlanWorkUnits(current).find(
            (unit) => unit.work_unit_id === result.work_unit_id,
          );
          setReferenceStatus(
            workUnit.run_references,
            result.run_id,
            result.status,
          );
          setReferenceStatus(
            current.run_references,
            result.run_id,
            result.status,
          );
          if (result.status === "interrupted") {
            setWorkUnitPhase(workUnit, "execution");
            workUnit.last_error = {
              code: "RUN_INTERRUPTED_AFTER_RESTART",
              run_id: result.run_id,
            };
          } else {
            workUnit.last_error = {
              code: result.error_code,
              run_id: result.run_id,
            };
            current.blockers.push({
              code: result.error_code,
              work_unit_id: result.work_unit_id,
              run_id: result.run_id,
            });
          }
        }
        setChangeSetPhase(current, "running");
      },
    });
  }

  async reconcileVerification(changeSetId, project) {
    await this.reconcileReferences({
      changeSetId,
      project,
      label: "Verification",
      prepare: (state) => {
        const harnessSelection = currentHarnessSelection(state);
        return {
          references: currentPlanWorkUnits(state).flatMap((workUnit) =>
            runningReference(workUnit, "verification", workUnit.work_unit_id),
          ),
          cleanup: async ({ run, reference }) => {
            const workUnit = currentPlanWorkUnits(state).find(
              (unit) => unit.work_unit_id === reference.work_unit_id,
            );
            const repository = requireRepository(
              project,
              workUnit.repository_id,
            );
            const selectedHarness = harnessSelection.repositories.find(
              (item) => item.repository_id === workUnit.repository_id,
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
              workspace: run.verification_workspace,
              harnessSnapshot: overlaySnapshot,
            });
          },
        };
      },
      applyResults: (current, results) => {
        for (const result of results) {
          const workUnit = currentPlanWorkUnits(current).find(
            (unit) => unit.work_unit_id === result.work_unit_id,
          );
          setReferenceStatus(
            workUnit.run_references,
            result.run_id,
            result.status,
          );
          setReferenceStatus(
            current.run_references,
            result.run_id,
            result.status,
          );
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
        setChangeSetPhase(current, "running");
      },
    });
  }

  async reconcileSupervision(changeSetId) {
    await this.reconcileReferences({
      changeSetId,
      label: "Supervision",
      prepare: (state) => ({
        references: state.run_references
          .filter(
            (reference) =>
              reference.operation === "supervision" &&
              reference.status === "running",
          )
          .map((reference) => ({
            run_id: reference.run_id,
            work_unit_id: null,
          })),
        cleanup: null,
      }),
      applyResults: (current, results) => {
        for (const result of results) {
          setReferenceStatus(
            current.run_references,
            result.run_id,
            result.status,
          );
        }
        if (current.supervision_control) {
          const recoveredAt = this.now();
          stopSupervisionClock(current.supervision_control, recoveredAt);
          current.supervision_control.last_stop_reason = "controller_restart";
          current.supervision_control.updated_at = recoveredAt;
        }
      },
    });
  }

  async reconcileReview(changeSetId, project) {
    await this.reconcileReferences({
      changeSetId,
      project,
      label: "Bundle review",
      prepare: (state) => {
        const harnessSelection = currentHarnessSelection(state);
        return {
          references: state.run_references
            .filter(
              (reference) =>
                reference.operation === "review" &&
                reference.status === "running",
            )
            .map((reference) => ({
              run_id: reference.run_id,
              work_unit_id: null,
            })),
          cleanup: async ({ run }) => {
            let cleanupError = null;
            for (const workspace of [
              ...(run.review_workspaces ?? []),
            ].reverse()) {
              try {
                const repository = requireRepository(
                  project,
                  workspace.repository_id,
                );
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
            if (cleanupError) throw cleanupError;
          },
        };
      },
      applyResults: (current, results) => {
        for (const result of results) {
          setReferenceStatus(
            current.run_references,
            result.run_id,
            result.status,
          );
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
      },
    });
  }

  async reconcileIntegration(changeSetId) {
    await this.reconcileReferences({
      changeSetId,
      label: "Integration",
      prepare: (state) => ({
        references: state.run_references
          .filter(
            (reference) =>
              reference.operation === "integration" &&
              reference.status === "running",
          )
          .map((reference) => ({
            run_id: reference.run_id,
            work_unit_id: null,
            action_grant_id: reference.action_grant_id,
          })),
        cleanup: null,
      }),
      applyResults: (current, results) => {
        for (const result of results) {
          setReferenceStatus(
            current.run_references,
            result.run_id,
            result.status,
          );
          const reference = current.run_references.find(
            (candidate) => candidate.run_id === result.run_id,
          );
          const session = current.task_workspace.agent_sessions.find(
            (candidate) =>
              candidate.agent_session_id === reference?.agent_session_id,
          );
          setReferenceStatus(
            session?.run_references ?? [],
            result.run_id,
            result.status,
          );
          const grant = current.action_grants.find(
            (candidate) =>
              candidate.action_grant_id === reference?.action_grant_id,
          );
          if (grant) {
            grant.status =
              result.status === "interrupted" &&
              grant.attempt_count < grant.maximum_attempts &&
              Date.parse(grant.expires_at) > Date.parse(this.now())
                ? "granted"
                : "failed";
            grant.last_error = {
              code:
                result.status === "interrupted"
                  ? "INTEGRATION_RUN_INTERRUPTED_AFTER_RESTART"
                  : result.error_code,
              run_id: result.run_id,
              at: this.now(),
            };
          }
        }
        setChangeSetPhase(current, "review");
      },
    });
  }

  async reconcileReferences({
    changeSetId,
    project = null,
    label,
    prepare,
    applyResults,
    assertNoAmbiguous = true,
  }) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    const { references, cleanup } = prepare(state);
    if (references.length === 0) return;
    const results = [];
    for (const reference of references) {
      const run = await this.runStore.read(reference.run_id);
      if (!recoverableRunningRun(run)) {
        results.push({
          ...ambiguousResult(run.run_id),
          work_unit_id: reference.work_unit_id ?? null,
        });
        continue;
      }
      let cleanupError = null;
      if (cleanup) {
        try {
          await cleanup({ run, reference, project });
        } catch (error) {
          cleanupError = error;
        }
      }
      await this.interruptRecoveredRun(run, cleanupError);
      results.push({
        ...recoveryResult(run.run_id, cleanupError),
        work_unit_id: reference.work_unit_id ?? null,
        action_grant_id: reference.action_grant_id ?? null,
      });
    }
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      applyResults(current, results);
      current.updated_at = this.now();
    });
    if (assertNoAmbiguous) {
      assertNoAmbiguousRecovery(results, label);
    }
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

function currentHarnessSelection(state) {
  const selection = state.repository_harness_selection_revisions.find(
    (item) =>
      item.revision === state.current_repository_harness_selection_revision,
  );
  invariant(
    selection?.status === "current",
    "INVALID_REPOSITORY_HARNESS_SELECTION_REVISION",
    "ChangeSet has no current Repository Harness selection revision",
  );
  return selection;
}

function runningReference(workUnit, operation, workUnitId) {
  const references = workUnit.run_references.filter(
    (reference) =>
      reference.operation === operation && reference.status === "running",
  );
  if (references.length === 0) return [];
  return [
    {
      run_id: references.at(-1).run_id,
      work_unit_id: workUnitId,
    },
  ];
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
