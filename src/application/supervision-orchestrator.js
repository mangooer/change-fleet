import { mkdir } from "node:fs/promises";
import path from "node:path";

import { measureInitialContext } from "../adapters/runtime/runtime-port.js";
import { sha256 } from "../domain/canonical-json.js";
import {
  ChangeFleetError,
  attachSecondaryFailure,
  invariant,
  preserveSecondaryFailure,
} from "../domain/errors.js";
import {
  createAgentRunRecord,
  createRunReference,
  setWorkUnitPhase,
} from "../domain/lifecycle.js";
import {
  assertChangeSetMutable,
  normalizeId,
  normalizeRevisionFeedback,
} from "../domain/model.js";
import {
  assessInitialContext,
  createControlContract,
} from "../domain/runtime-context.js";
import {
  actionRequiresSupervisor,
  deriveSupervisionActionSet,
  deriveSupervisionProgress,
  normalizeSupervisorDecisionProposal,
  startSupervisionClock,
  stopSupervisionClock,
} from "../domain/supervision.js";
import { runTerminalStatusForError } from "./run-coordinator.js";
import {
  appendAgentSessionRun,
  requireAgentSession,
} from "../domain/agent-session.js";

// SupervisionOrchestrator 拥有自主监督的命令面与调度循环；执行、验证和 Bundle 编排仍由
// ChangeFleetService 通过注入回调提供，聚合权威不离开 ChangeFleetService。
export class SupervisionOrchestrator {
  constructor({
    controlStore,
    runStore,
    runCoordinator,
    runService,
    feedbackService,
    supervisionRuntime,
    supervisionAgentProfile,
    workspaceRoot,
    schedulerOwnerId,
    idFactory,
    now,
    applyIdempotentCommand,
    requireProject,
    currentPlan,
    currentRepositorySelection,
    currentRepositoryHarnessSelection,
    unitsForCurrentPlan,
    resolveValidationBlockers,
    reconcileInterruptedRuns,
    executeWorkUnit,
    resumeWorkUnitValidation,
    prepareRetryableExecutions,
    finalizeCurrentBundle,
    reviewCurrentBundle,
  }) {
    this.controlStore = controlStore;
    this.runStore = runStore;
    this.runCoordinator = runCoordinator;
    this.runService = runService;
    this.feedbackService = feedbackService;
    this.supervisionRuntime = supervisionRuntime;
    this.supervisionAgentProfile = supervisionAgentProfile;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.schedulerOwnerId = schedulerOwnerId;
    this.idFactory = idFactory;
    this.now = now;
    this.applyIdempotentCommand = applyIdempotentCommand;
    this.requireProject = requireProject;
    this.currentPlan = currentPlan;
    this.currentRepositorySelection = currentRepositorySelection;
    this.currentRepositoryHarnessSelection = currentRepositoryHarnessSelection;
    this.unitsForCurrentPlan = unitsForCurrentPlan;
    this.resolveValidationBlockers = resolveValidationBlockers;
    this.reconcileInterruptedRuns = reconcileInterruptedRuns;
    this.executeWorkUnit = executeWorkUnit;
    this.resumeWorkUnitValidation = resumeWorkUnitValidation;
    this.prepareRetryableExecutions = prepareRetryableExecutions;
    this.finalizeCurrentBundle = finalizeCurrentBundle;
    this.reviewCurrentBundle = reviewCurrentBundle;
  }

  async startSupervision({ idempotency_key, change_set_id, actor = "human" }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("actor", actor);
    await this.controlStore.transactChangeSet(change_set_id, (state) =>
      this.applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "startSupervision",
        input: { change_set_id, actor },
        perform: () => {
          assertAutonomousPlanCurrent(state, this.currentPlan);
          invariant(
            state.supervision_control?.hold === null,
            "SUPERVISION_HELD",
            "Supervision is held and must be resumed explicitly",
          );
          state.supervision_control.last_stop_reason = null;
          state.supervision_control.updated_at = this.now();
          state.updated_at = this.now();
          return {
            change_set_id,
            plan_revision: state.current_plan_revision,
            status: "started",
          };
        },
      }),
    );
    return this.runAutonomousSupervision(change_set_id);
  }

  async pauseSupervision({
    idempotency_key,
    change_set_id,
    actor = "human",
    reason = "operator_hold",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("actor", actor);
    invariant(
      typeof reason === "string" && reason.trim().length > 0,
      "INVALID_SUPERVISION_HOLD",
      "A supervision hold requires one reason",
    );
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      this.applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "pauseSupervision",
        input: { change_set_id, actor, reason: reason.trim() },
        perform: () => {
          assertAutonomousPlanCurrent(state, this.currentPlan);
          const heldAt = this.now();
          state.supervision_control.hold = {
            hold_id: this.idFactory("hold"),
            reason: reason.trim(),
            actor,
            held_at: heldAt,
          };
          state.supervision_control.last_stop_reason = "operator_hold";
          state.supervision_control.updated_at = heldAt;
          state.updated_at = heldAt;
          return {
            change_set_id,
            status: "paused",
            hold: structuredClone(state.supervision_control.hold),
          };
        },
      }),
    );
  }

  async resumeSupervision({ idempotency_key, change_set_id, actor = "human" }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("actor", actor);
    await this.controlStore.transactChangeSet(change_set_id, (state) =>
      this.applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "resumeSupervision",
        input: { change_set_id, actor },
        perform: () => {
          assertAutonomousPlanCurrent(state, this.currentPlan);
          const resumedAt = this.now();
          state.supervision_control.hold = null;
          state.supervision_control.last_stop_reason = null;
          state.supervision_control.updated_at = resumedAt;
          state.updated_at = resumedAt;
          return { change_set_id, status: "resumed", resumed_at: resumedAt };
        },
      }),
    );
    return this.runAutonomousSupervision(change_set_id);
  }

  async readSupervisionProgress({ change_set_id }) {
    normalizeId("change_set_id", change_set_id);
    const state = await this.controlStore.readChangeSet(change_set_id);
    const actionSet = deriveSupervisionActionSet(state, { now: this.now() });
    return {
      change_set_id,
      phase: state.phase,
      activity: actionSet.actions[0]?.type ?? "stop",
      last_stop_reason:
        state.supervision_control?.last_stop_reason ??
        actionSet.actions[0]?.details?.reason ??
        null,
      progress: actionSet.progress,
      offered_actions: actionSet.actions.map(projectSupervisionAction),
    };
  }

  async runAutonomousSupervision(changeSetId) {
    const catalog = await this.controlStore.readCatalog();
    const initial = await this.controlStore.readChangeSet(changeSetId);
    assertAutonomousPlanCurrent(initial, this.currentPlan);
    await this.reconcileInterruptedRuns(changeSetId, {
      project: this.requireProject(catalog, initial.project_id),
    });
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      assertAutonomousPlanCurrent(state, this.currentPlan);
      const startedAt = this.now();
      startSupervisionClock(state.supervision_control, startedAt);
      state.supervision_control.last_stop_reason = null;
      state.supervision_control.updated_at = startedAt;
      state.updated_at = startedAt;
    });

    let previousFailure = null;
    for (let step = 0; step < 256; step += 1) {
      const state = await this.controlStore.readChangeSet(changeSetId);
      const actionSet = deriveSupervisionActionSet(state, { now: this.now() });
      let selectedAction;
      let supervisorRunId = null;
      if (actionRequiresSupervisor(actionSet)) {
        const decision = await this.invokeSupervisorDecision(
          state,
          actionSet,
        );
        selectedAction = decision.action;
        supervisorRunId = decision.run_id;
      } else {
        [selectedAction] = actionSet.actions;
      }
      invariant(
        selectedAction,
        "SUPERVISION_NO_AUTHORIZED_ACTION",
        "Supervision policy produced no authorized action",
      );
      if (["stop", "pause"].includes(selectedAction.type)) {
        const reason = selectedAction.details.reason;
        await this.recordSupervisionStop(changeSetId, reason);
        return this.supervisionResult(changeSetId, reason);
      }

      try {
        await this.executeSupervisionAction(changeSetId, selectedAction);
        previousFailure = null;
        if (supervisorRunId) {
          await this.recordSupervisorDisposition(supervisorRunId, {
            disposition: "executed",
            actionId: selectedAction.action_id,
          });
        }
      } catch (error) {
        if (supervisorRunId) {
          await preserveSecondaryFailure(
            error,
            "supervisor_disposition_persistence",
            () =>
              this.recordSupervisorDisposition(supervisorRunId, {
                disposition: "rejected",
                actionId: selectedAction.action_id,
                errorCode: error.code ?? "UNEXPECTED_ERROR",
              }),
          );
        }
        if (error.code === "CONTROLLER_INTERRUPTED") throw error;
        // 人工中断是明确停止信号；不能把它自动解释成一次可重试 Provider 故障。
        if (error.code === "RUNTIME_INTERRUPTED") {
          await this.recordSupervisionStop(
            changeSetId,
            "operator_interrupted",
          );
          return this.supervisionResult(
            changeSetId,
            "operator_interrupted",
          );
        }
        const afterFailure = await this.controlStore.readChangeSet(changeSetId);
        const next = deriveSupervisionActionSet(afterFailure, { now: this.now() });
        const failureIdentity = `${selectedAction.action_id}:${error.code ?? "UNEXPECTED_ERROR"}`;
        if (
          previousFailure === failureIdentity ||
          next.actions.some(
            (action) =>
              action.action_id === selectedAction.action_id &&
              !["stop", "pause", "open_gate"].includes(action.type),
          )
        ) {
          const reason = `action_failed:${error.code ?? "UNEXPECTED_ERROR"}`;
          await this.recordSupervisionStop(changeSetId, reason);
          return this.supervisionResult(changeSetId, reason);
        }
        previousFailure = failureIdentity;
      }
    }
    await this.recordSupervisionStop(
      changeSetId,
      "controller_dispatch_limit_reached",
    );
    return this.supervisionResult(
      changeSetId,
      "controller_dispatch_limit_reached",
    );
  }

  async executeSupervisionAction(changeSetId, offeredAction) {
    const schedulerLock = await this.controlStore.acquireSchedulerLock(
      this.schedulerOwnerId,
    );
    try {
      const current = await this.controlStore.readChangeSet(changeSetId);
      const currentSet = deriveSupervisionActionSet(current, { now: this.now() });
      const action = currentSet.actions.find(
        (candidate) => candidate.action_id === offeredAction.action_id,
      );
      invariant(
        action &&
          action.type === offeredAction.type &&
          action.budget_identity === offeredAction.budget_identity,
        "STALE_SUPERVISION_ACTION",
        "Supervision action is no longer authorized by the current snapshot",
      );
      const workUnitId = action.subject.work_unit_id ?? null;
      if (action.type === "dispatch_execution") {
        const unit = this.unitsForCurrentPlan(current).find(
          (candidate) => candidate.work_unit_id === workUnitId,
        );
        return this.executeWorkUnit(changeSetId, workUnitId, {
          feedbackSourceId: unit.pending_feedback_id,
        });
      }
      if (
        action.type === "advance_work_unit_validation" ||
        action.type === "retry_validation"
      ) {
        return this.resumeWorkUnitValidation(changeSetId, workUnitId);
      }
      if (action.type === "retry_execution") {
        await this.prepareRetryableExecutions(
          changeSetId,
          action.idempotency_key,
          "supervisor",
        );
        return { status: "retry_scheduled", work_unit_id: workUnitId };
      }
      if (action.type === "submit_feedback") {
        return this.recordSupervisionFeedback(changeSetId, action);
      }
      if (action.type === "validate_and_assemble_bundle") {
        return this.finalizeCurrentBundle(changeSetId);
      }
      if (action.type === "dispatch_bundle_review") {
        return this.reviewCurrentBundle(changeSetId);
      }
      if (action.type === "open_gate") {
        return this.openSupervisionGate(changeSetId, action);
      }
      throw new ChangeFleetError(
        "UNSUPPORTED_SUPERVISION_ACTION",
        `Supervision action ${action.type} has no executor`,
      );
    } finally {
      await schedulerLock.release();
    }
  }

  async invokeSupervisorDecision(state, actionSet) {
    const plan = this.currentPlan(state);
    const repositorySelection = this.currentRepositorySelection(state);
    const repositoryHarnessSelection =
      this.currentRepositoryHarnessSelection(state);
    const attempt =
      state.run_references.filter(
        (reference) => reference.operation === "supervision",
      ).length + 1;
    const runId = this.idFactory("run");
    const workspacePath = path.join(
      this.workspaceRoot,
      ".changefleet-supervision",
      state.change_set_id,
    );
    const controlContract = createControlContract({
      operation: "supervision",
      changeSetId: state.change_set_id,
      planRevision: plan.revision,
      repositorySelectionRevision: repositorySelection.revision,
      repositoryHarnessSelectionRevision: repositoryHarnessSelection.revision,
      authorizedRepositories: repositorySelection.repositories.map(
        (repository) => repository.repository_id,
      ),
      allowedOutcomes: ["supervisor_decision_proposal"],
      humanGates: ["bounded_supervision_route"],
    });
    const contextProjection = createSupervisionProjection(
      state,
      plan,
      repositorySelection,
      repositoryHarnessSelection,
      actionSet,
      workspacePath,
      this.unitsForCurrentPlan,
    );
    const invocation = {
      operation: "supervision",
      agent_profile: this.supervisionAgentProfile,
      control_contract: controlContract,
      context_projection: contextProjection,
      capabilities: contextProjection.capability,
      workspace: null,
      signal: null,
    };
    const contextEvidence = assessInitialContext({
      controlContract,
      contextProjection,
      agentProfile: this.supervisionAgentProfile,
      runtimeMeasurement: await measureInitialContext(
        this.supervisionRuntime,
        invocation,
      ),
    });
    const createdAt = this.now();
    const agentSession = requireAgentSession(
      state.task_workspace,
      this.supervisionAgentProfile,
      "supervision",
    );
    await this.runStore.create(
      createAgentRunRecord({
        runId,
        changeSetId: state.change_set_id,
        workUnitId: null,
        operation: "supervision",
        trigger: attempt === 1 ? "initial" : "retry",
        attempt,
        agentProfile: this.supervisionAgentProfile,
        continuationOfRunId:
          state.run_references
            .filter((reference) => reference.operation === "supervision")
            .at(-1)?.run_id ?? null,
        repositoryHarnessSelection: null,
        repositoryHarnessObservation: null,
        contextEvidence,
        contextProjectionIdentity: {
          schema_version: contextProjection.schema_version,
          digest: sha256(contextProjection),
        },
        createdAt,
        extra: {
          agent_session_id: agentSession.agent_session_id,
        },
      }),
    );
    await this.controlStore.transactChangeSet(state.change_set_id, (current) => {
      invariant(
        current.current_plan_revision === plan.revision,
        "STALE_SUPERVISION_ACTION",
        "Plan changed before Supervisor dispatch",
      );
      const reference = createRunReference({
          runId,
          operation: "supervision",
          trigger: attempt === 1 ? "initial" : "retry",
          plan_revision: plan.revision,
          work_unit_id: null,
          attempt,
          offered_action_ids: actionSet.actions.map(
            (action) => action.action_id,
          ),
          agent_session_id: agentSession.agent_session_id,
        });
      current.run_references.push(
        reference,
      );
      appendAgentSessionRun(
        current.task_workspace,
        agentSession.agent_session_id,
        reference,
      );
      current.updated_at = this.now();
    });

    let providerEvidence = null;
    let observedProposal = null;
    let proposalArtifact = null;
    try {
      // 目录只在 Runtime 即将调用时创建，前置契约或存储失败不会留下空工作区。
      await mkdir(workspacePath, { recursive: true });
      const result = await this.runCoordinator.invoke(
        this.supervisionRuntime,
        runId,
        invocation,
      );
      providerEvidence = result.provider_evidence;
      observedProposal = result.outcome;
      const proposal = normalizeSupervisorDecisionProposal(result.outcome, {
        offeredActions: actionSet.actions,
        projectionDigest: actionSet.projection_digest,
      });
      proposalArtifact = await this.runStore.writeJsonArtifact(
        runId,
        "supervisor-proposal",
        proposal,
      );
      await this.runService.cleanupSupervisionWorkspace(workspacePath);
      await this.runCoordinator.completeAttempt({
        runId,
        invocation,
        providerEvidence,
        eventPayload: proposal,
        runOutcome: {
          type: proposal.type,
          selected_action_id: proposal.action_id,
          offered_action_ids: actionSet.actions.map((action) => action.action_id),
          proposal_artifact: proposalArtifact,
          disposition: "pending_revalidation",
          disposition_error_code: null,
        },
      });
      await this.runService.markRunReference(
        state.change_set_id,
        runId,
        "completed",
      );
      return {
        run_id: runId,
        action: actionSet.actions.find(
          (action) => action.action_id === proposal.action_id,
        ),
      };
    } catch (caughtError) {
      const error = caughtError;
      try {
        await this.runService.cleanupSupervisionWorkspace(workspacePath);
      } catch (cleanupError) {
        attachSecondaryFailure(error, "supervision_workspace_cleanup", cleanupError);
      }
      // 该错误表示控制器已消失；保留 running Run，交给下一实例统一结算，避免伪造一次 Provider 失败。
      if (error.code === "CONTROLLER_INTERRUPTED") throw error;
      if (observedProposal && proposalArtifact === null) {
        // 无效建议也保留有界审计信封；不能把未经验证的完整模型输出写入聚合状态。
        try {
          proposalArtifact = await this.runStore.writeJsonArtifact(
            runId,
            "rejected-supervisor-proposal",
            boundedRejectedSupervisorProposal(observedProposal),
          );
        } catch (artifactError) {
          attachSecondaryFailure(error, "rejected_proposal_artifact", artifactError);
        }
      }
      providerEvidence = error.runtime_evidence ?? providerEvidence;
      await this.runCoordinator.failAttempt({
        runId,
        invocation,
        providerEvidence,
        error,
        errorCode: error.code ?? "INVALID_SUPERVISOR_PROPOSAL",
      });
      if (proposalArtifact) {
        await this.runStore.update(runId, (run) => {
          run.outcome.proposal_artifact = proposalArtifact;
          run.outcome.disposition = "rejected";
          run.outcome.disposition_error_code =
            error.code ?? "INVALID_SUPERVISOR_PROPOSAL";
        });
      }
      await this.runService.markRunReference(
        state.change_set_id,
        runId,
        runTerminalStatusForError(error),
      );
      throw error;
    }
  }

  async recordSupervisorDisposition(
    runId,
    { disposition, actionId, errorCode = null },
  ) {
    await this.runStore.update(runId, (run) => {
      run.outcome.disposition = disposition;
      run.outcome.disposition_error_code = errorCode;
      invariant(
        run.outcome.selected_action_id === actionId,
        "SUPERVISOR_ACTION_NOT_OFFERED",
        "Supervisor disposition action does not match its proposal",
      );
    });
  }

  async recordSupervisionFeedback(changeSetId, action) {
    return this.controlStore.transactChangeSet(changeSetId, (state) => {
      const unit = this.unitsForCurrentPlan(state).find(
        (candidate) =>
          candidate.work_unit_id === action.subject.work_unit_id,
      );
      invariant(
        unit?.phase === "verification" &&
          unit.candidate === null &&
          unit.candidate_checkpoint_id === action.subject.checkpoint_id &&
          unit.last_error?.validation_attempt_id ===
            action.subject.validation_attempt_id,
        "STALE_SUPERVISION_ACTION",
        "Validation Feedback subject changed before it was recorded",
      );
      const feedback = this.feedbackService.record(state, {
        source: "validation",
        target: {
          change_set_id: changeSetId,
          plan_revision: state.current_plan_revision,
          work_unit_id: unit.work_unit_id,
          checkpoint_id: unit.candidate_checkpoint_id,
          validation_attempt_id: action.subject.validation_attempt_id,
        },
        content: normalizeRevisionFeedback(action.details.feedback),
        createdAt: this.now(),
      });
      setWorkUnitPhase(unit, "execution");
      unit.pending_feedback_id = feedback.feedback_id;
      unit.last_error = null;
      this.resolveValidationBlockers(state, {
        workUnitId: unit.work_unit_id,
        resolvedAt: this.now(),
      });
      state.updated_at = this.now();
      return {
        status: "feedback_recorded",
        feedback_id: feedback.feedback_id,
        work_unit_id: unit.work_unit_id,
      };
    });
  }

  async openSupervisionGate(changeSetId, action) {
    return this.controlStore.transactChangeSet(changeSetId, (state) => {
      const existing = state.gates.find(
        (gate) =>
          gate.status === "open" &&
          gate.supervision_action_id === action.action_id,
      );
      if (existing) return structuredClone(existing);
      // action_id 约束控制事实而不是一次人类交互；历史 Gate 已解决后，相同事实再次
      // 升级必须创建新的开放 Gate，不能用旧记录吞掉本次等待边界。
      const createdAt = this.now();
      const bundleReviewFailure =
        action.details.reason === "bundle_review_budget_exhausted";
      const bundle = bundleReviewFailure ? state.bundles.at(-1) ?? null : null;
      const gate = {
        gate_id: this.idFactory("gate"),
        kind: bundleReviewFailure
          ? "bundle_review_failure"
          : "supervision_decision",
        status: "open",
        change_set_id: changeSetId,
        work_unit_id: action.subject.work_unit_id ?? null,
        verification_review_id: null,
        supervision_action_id: action.action_id,
        bundle_id: bundle?.bundle_id ?? null,
        bundle_revision: bundle?.revision ?? null,
        bundle_hash: bundle?.bundle_hash ?? null,
        bundle_review_assessment_id: null,
        request: {
          question: `Autonomous progress stopped: ${action.details.reason}.`,
          options: bundleReviewFailure
            ? ["request_plan_revision", "close_changeset"]
            : ["resume", "keep_paused"],
        },
        created_at: createdAt,
      };
      state.gates.push(gate);
      stopSupervisionClock(state.supervision_control, createdAt);
      if (!bundleReviewFailure) {
        state.supervision_control.hold = {
          hold_id: this.idFactory("hold"),
          reason: action.details.reason,
          actor: "supervisor",
          held_at: createdAt,
        };
      }
      state.supervision_control.last_stop_reason = "gate_open";
      state.supervision_control.updated_at = createdAt;
      state.updated_at = createdAt;
      return structuredClone(gate);
    });
  }

  async recordSupervisionStop(changeSetId, reason) {
    await this.controlStore.transactChangeSet(changeSetId, (state) => {
      if (!state.supervision_control) return;
      const stoppedAt = this.now();
      stopSupervisionClock(state.supervision_control, stoppedAt);
      state.supervision_control.last_stop_reason = reason;
      state.supervision_control.updated_at = stoppedAt;
      state.updated_at = stoppedAt;
    });
  }

  async supervisionResult(changeSetId, reason) {
    const state = await this.controlStore.readChangeSet(changeSetId);
    const assessment = (state.bundle_review_assessments ?? []).find(
      (item) =>
        item.assessment_id === state.current_bundle_review_assessment_id,
    );
    return {
      change_set_id: changeSetId,
      plan_revision: state.current_plan_revision,
      phase: state.phase,
      status: ["bundle_review_ready", "bundle_review_recommended"].includes(
        reason,
      )
        ? "review_ready"
        : ["gate_open", "bundle_review_gate_required"].includes(reason)
          ? "human_input_required"
          : "stopped",
      stop_reason: reason,
      bundle:
        state.phase === "review"
          ? structuredClone(state.bundles.at(-1) ?? null)
          : null,
      bundle_review_assessment:
        assessment === undefined ? null : structuredClone(assessment),
      progress: deriveSupervisionProgress(state, { now: this.now() }),
    };
  }
}

function assertAutonomousPlanCurrent(state, currentPlan) {
  assertChangeSetMutable(state);
  const plan = currentPlan(state);
  invariant(
    plan?.status === "confirmed" &&
      plan.supervision?.mode === "autonomous_until_review" &&
      state.supervision_control?.plan_revision === plan.revision,
    "AUTONOMOUS_PLAN_CONFIRMATION_REQUIRED",
    "Current confirmed Plan does not authorize autonomous supervision",
  );
  return plan;
}

function projectSupervisionAction(action) {
  return {
    action_id: action.action_id,
    type: action.type,
    plan_revision: action.plan_revision,
    repository_selection_revision: action.repository_selection_revision,
    repository_harness_selection_revision:
      action.repository_harness_selection_revision,
    subject: structuredClone(action.subject),
    preconditions: [...action.preconditions],
    budget_identity: action.budget_identity,
    idempotency_key: action.idempotency_key,
    details: structuredClone(action.details),
  };
}

function createSupervisionProjection(
  state,
  plan,
  repositorySelection,
  repositoryHarnessSelection,
  actionSet,
  workspacePath,
  unitsForCurrentPlan,
) {
  // Supervisor 只看当前控制快照和有界失败摘要；日志、diff、transcript、成本总量均留在审计面。
  return {
    schema_version: 2,
    operation: "supervision",
    change_set_id: state.change_set_id,
    projection_digest: actionSet.projection_digest,
    confirmed_intent: {
      revision: state.current_intent_revision,
      objective: state.intents.find(
        (intent) => intent.revision === state.current_intent_revision,
      )?.objective,
    },
    plan: {
      revision: plan.revision,
      status: plan.status,
      // Supervisor 只需语义目标和已过滤的 action_set，不必重复内部执行配置。
      ...structuredClone(plan.semantic_plan),
    },
    repository_selection: {
      revision: repositorySelection.revision,
      repositories: repositorySelection.repositories.map((repository) => ({
        repository_id: repository.repository_id,
        target_ref: repository.target_ref,
        resolved_base_sha: repository.resolved_base_sha,
      })),
    },
    repository_harness_selection: {
      revision: repositoryHarnessSelection.revision,
      repositories: repositoryHarnessSelection.repositories.map(
        (repository) => ({
          repository_id: repository.repository_id,
          resolved_base_sha: repository.resolved_base_sha,
          mode: repository.mode,
        }),
      ),
    },
    work_units: unitsForCurrentPlan(state).map((unit) => ({
      work_unit_id: unit.work_unit_id,
      repository_id: unit.repository_id,
      phase: unit.phase,
      candidate_checkpoint_id: unit.candidate_checkpoint_id,
      candidate_id: unit.candidate?.candidate_id ?? null,
      pending_feedback_id: unit.pending_feedback_id,
      last_error: structuredClone(unit.last_error),
    })),
    relevant_evidence: [
      ...(state.validation_attempts ?? [])
        .filter((attempt) => attempt.status === "failed")
        .slice(-8)
        .map((attempt) => ({
          kind: attempt.kind,
          validation_attempt_id: attempt.validation_attempt_id,
          subject_id: attempt.subject_id,
          error_code: attempt.error_code ?? null,
          evidence_id: attempt.evidence?.evidence_id ?? null,
        })),
      ...state.run_references
        .filter((reference) =>
          ["failed", "interrupted", "cancelled"].includes(reference.status),
        )
        .slice(-8)
        .map((reference) => ({
          kind: "run",
          run_id: reference.run_id,
          operation: reference.operation,
          work_unit_id: reference.work_unit_id ?? null,
          status: reference.status,
        })),
    ],
    open_feedback: (state.feedback_records ?? [])
      .filter((feedback) =>
        unitsForCurrentPlan(state).some(
          (unit) => unit.pending_feedback_id === feedback.feedback_id,
        ),
      )
      .map((feedback) => ({
        feedback_id: feedback.feedback_id,
        source: feedback.source,
        target: structuredClone(feedback.target),
        summary: feedback.content.summary,
      })),
    open_gates: (state.gates ?? [])
      .filter((gate) => gate.status === "open")
      .map((gate) => ({
        gate_id: gate.gate_id,
        kind: gate.kind,
        work_unit_id: gate.work_unit_id ?? null,
      })),
    hold: structuredClone(state.supervision_control?.hold ?? null),
    remaining_budget: structuredClone(actionSet.progress),
    offered_actions: actionSet.actions.map(projectSupervisionAction),
    capability: {
      mode: "read_only",
      paths: [workspacePath],
      typed_operations_only: true,
    },
  };
}

function boundedRejectedSupervisorProposal(input) {
  const boundedText = (value, maxBytes = 2 * 1_024) => {
    if (typeof value !== "string") return null;
    const encoded = Buffer.from(value, "utf8");
    if (encoded.length <= maxBytes) return value;
    return encoded
      .subarray(0, maxBytes)
      .toString("utf8")
      .replace(/\uFFFD$/u, "");
  };
  return {
    schema_version: 1,
    type: boundedText(input?.type, 128),
    action_id: boundedText(input?.action_id, 256),
    projection_digest: boundedText(input?.projection_digest, 128),
    rationale: boundedText(input?.rationale),
    expected_result: boundedText(input?.expected_result),
    evidence_reference_ids: Array.isArray(input?.evidence_reference_ids)
      ? input.evidence_reference_ids
          .slice(0, 16)
          .map((reference) => boundedText(reference, 256))
      : [],
  };
}
