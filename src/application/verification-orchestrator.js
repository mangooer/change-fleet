import { measureInitialContext } from "../adapters/runtime/runtime-port.js";
import { sha256 } from "../domain/canonical-json.js";
import {
  ChangeFleetError,
  invariant,
  preserveSecondaryFailure,
} from "../domain/errors.js";
import {
  createAgentRunRecord,
  createRunReference,
  setChangeSetPhase,
  setWorkUnitPhase,
} from "../domain/lifecycle.js";
import {
  createCandidate,
  createValidationAttempt,
  normalizeRevisionFeedbackAssessments,
} from "../domain/model.js";
import { HARNESS_SELECTION_MODES } from "../domain/repository-harness.js";
import {
  assessInitialContext,
  createContextProjection,
  createControlContract,
} from "../domain/runtime-context.js";
import {
  admissionModeAtLeast,
  createCheckIdentity,
  createVerificationAdmissionDecision,
  createVerificationReview,
  normalizeVerificationOutcome,
  resolveValidationAttemptBudget,
  selectValidationAttemptBudgetRequest,
  validationEnvironmentIdentity,
  verificationReviewAllowsCandidate,
} from "../domain/verification.js";
import { runTerminalStatusForError } from "./run-coordinator.js";

// VerificationOrchestrator 拥有验证执行机制：请求检查、仓库检查和合并检查的尝试执行与
// 证据落盘。Runtime 派发流（admission 与独立复核）仍由 ChangeFleetService 驱动，待后续
// 切片迁入同一边界。
export class VerificationOrchestrator {
  constructor({
    controlStore,
    runStore,
    repositoryValidator,
    combinedValidator,
    repositoryWorker,
    harnessSnapshotStore,
    runCoordinator,
    feedbackService,
    verificationRuntime,
    verificationAgentProfile,
    idFactory,
    now,
    currentPlan,
    currentRepositorySelection,
    currentRepositoryHarnessSelection,
    unitsForCurrentPlan,
    requireProject,
    requireRepository,
    resolveValidationBlockers,
    stableErrorCode,
    verificationReviewAsRevisionFeedback,
    harnessSelectionForContext,
    harnessResourcesForContext,
    overlayHarnessResources,
    repositoryHarnessObservation,
  }) {
    this.controlStore = controlStore;
    this.runStore = runStore;
    this.repositoryValidator = repositoryValidator;
    this.combinedValidator = combinedValidator;
    this.repositoryWorker = repositoryWorker;
    this.harnessSnapshotStore = harnessSnapshotStore;
    this.runCoordinator = runCoordinator;
    this.feedbackService = feedbackService;
    this.verificationRuntime = verificationRuntime;
    this.verificationAgentProfile = verificationAgentProfile;
    this.idFactory = idFactory;
    this.now = now;
    this.currentPlan = currentPlan;
    this.currentRepositorySelection = currentRepositorySelection;
    this.currentRepositoryHarnessSelection = currentRepositoryHarnessSelection;
    this.unitsForCurrentPlan = unitsForCurrentPlan;
    this.requireProject = requireProject;
    this.requireRepository = requireRepository;
    this.resolveValidationBlockers = resolveValidationBlockers;
    this.stableErrorCode = stableErrorCode;
    this.verificationReviewAsRevisionFeedback =
      verificationReviewAsRevisionFeedback;
    this.harnessSelectionForContext = harnessSelectionForContext;
    this.harnessResourcesForContext = harnessResourcesForContext;
    this.overlayHarnessResources = overlayHarnessResources;
    this.repositoryHarnessObservation = repositoryHarnessObservation;
  }

  async executeVerificationRequestedChecks({
    changeSetId,
    workUnitId,
    checkpoint,
    repository,
    workspace,
    commands,
    projectPolicy,
  }) {
    const attemptIds = [];
    let failedError = null;
    let failedAttemptId = null;
    let missingEvidence = false;
    for (const command of commands) {
      const before = await this.controlStore.readChangeSet(changeSetId);
      const checkIdentity = createCheckIdentity(command);
      const attemptNumber =
        before.validation_attempts.filter(
          (attempt) =>
            attempt.kind === "verification_check" &&
            attempt.subject_id === checkpoint.checkpoint_id &&
            attempt.check_identity?.check_identity_hash ===
              checkIdentity.check_identity_hash,
        ).length + 1;
      const attemptBudget = resolveValidationAttemptBudget({
        command,
        projectPolicy,
        commandSource: "verification_request",
      });
      const environmentIdentity = validationEnvironmentIdentity();
      const startedAt = this.now();
      let evidence;
      let commandError = null;
      try {
        evidence = await this.repositoryValidator.validate({
          repository,
          candidate: {
            ...checkpoint,
            workspace_id: workspace.workspace_id,
            workspace_path: workspace.workspace_path,
          },
          command: {
            ...command,
            timeout_ms: attemptBudget.effective.timeout_ms,
          },
          checkIdentity,
          attemptBudget,
          environmentIdentity,
          evidenceKind: "verification_check",
        });
      } catch (error) {
        commandError = error;
        evidence = error.details?.evidence ?? null;
      }
      const completedAt = this.now();
      const attempt = evidence
        ? createValidationAttempt({
            kind: "verification_check",
            subjectId: checkpoint.checkpoint_id,
            attempt: attemptNumber,
            status: commandError ? "failed" : "passed",
            evidence,
            errorCode: this.stableErrorCode(commandError),
            checkIdentity,
            requestedBudget: attemptBudget.requested,
            effectiveBudget: attemptBudget.effective,
            budgetSource: attemptBudget.source,
            budgetLimit: attemptBudget.limit,
            environmentIdentity,
            startedAt,
            completedAt,
          })
        : null;
      if (attempt) {
        await this.controlStore.transactChangeSet(changeSetId, (current) => {
          const unit = this.unitsForCurrentPlan(current).find(
            (item) => item.work_unit_id === workUnitId,
          );
          current.validation_attempts.push(attempt);
          unit.validation_attempt_ids.push(attempt.validation_attempt_id);
          current.updated_at = this.now();
        });
        attemptIds.push(attempt.validation_attempt_id);
      }
      if (commandError) {
        failedError ??= commandError;
        failedAttemptId ??= attempt?.validation_attempt_id ?? null;
        missingEvidence ||= attempt === null;
        if (
          [
            "CANDIDATE_HEAD_MISMATCH",
            "DIRTY_CANDIDATE_WORKSPACE",
            "CANDIDATE_CHANGED_PATHS_MISMATCH",
            "VERIFICATION_WORKSPACE_HEAD_CHANGED",
            "VERIFICATION_WORKSPACE_MODIFIED",
          ].includes(commandError.code)
        ) {
          break;
        }
      }
    }
    return { attemptIds, failedError, failedAttemptId, missingEvidence };
  }

  async ensureRepositoryValidationPassed({
    changeSetId,
    workUnitId,
    workUnit,
    checkpoint,
    repository,
    projectPolicy,
    attemptBudgetRequests,
  }) {
    const command = workUnit.repository_check;
    const checkIdentity = command === null ? null : createCheckIdentity(command);
    const latestState = await this.controlStore.readChangeSet(changeSetId);
    // 项目命令身份不变时可复用昂贵证据；结构预检没有命令身份，晋升前必须重新执行。
    const passedAttempt =
      checkIdentity === null
        ? null
        : latestState.validation_attempts.find(
            (attempt) =>
              attempt.kind === "repository_validation" &&
              attempt.subject_id === checkpoint.checkpoint_id &&
              attempt.status === "passed" &&
              attempt.check_identity?.check_identity_hash ===
                checkIdentity.check_identity_hash,
          );
    if (passedAttempt) {
      // Checkpoint 与 check identity 都未改变时复用不可变证据，不因后续验证失败而重复昂贵命令。
      return structuredClone(passedAttempt.evidence);
    }

    const attemptNumber =
      latestState.validation_attempts.filter(
        (attempt) =>
          attempt.kind === "repository_validation" &&
          attempt.subject_id === checkpoint.checkpoint_id,
      ).length + 1;
    const budgetRequest =
      command === null
        ? null
        : selectValidationAttemptBudgetRequest(attemptBudgetRequests, {
            kind: "repository_validation",
            workUnitId,
            commandId: command.command_id,
          });
    const attemptBudget =
      command === null
        ? null
        : resolveValidationAttemptBudget({
            command,
            projectPolicy,
            request: budgetRequest,
          });
    const environmentIdentity = validationEnvironmentIdentity();
    const startedAt = this.now();

    let repositoryEvidence;
    try {
      repositoryEvidence = await this.repositoryValidator.validate({
        repository,
        candidate: checkpoint,
        command:
          command === null
            ? null
            : {
                ...command,
                timeout_ms: attemptBudget.effective.timeout_ms,
              },
        checkIdentity,
        attemptBudget,
        environmentIdentity,
        selectionRationale: workUnit.repository_check_rationale,
      });
    } catch (error) {
      const completedAt = this.now();
      const errorCode = this.stableErrorCode(error) ?? "UNEXPECTED_ERROR";
      const evidence = error.details?.evidence ?? null;
      const attempt = evidence
        ? createValidationAttempt({
            kind: "repository_validation",
            subjectId: checkpoint.checkpoint_id,
            attempt: attemptNumber,
            status: "failed",
            evidence,
            errorCode,
            checkIdentity,
            requestedBudget: attemptBudget?.requested ?? null,
            effectiveBudget: attemptBudget?.effective ?? null,
            budgetSource: attemptBudget?.source ?? null,
            budgetLimit: attemptBudget?.limit ?? null,
            environmentIdentity,
            startedAt,
            completedAt,
          })
        : null;
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = this.unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        invariant(
          unit?.candidate_checkpoint_id === checkpoint.checkpoint_id,
          "CANDIDATE_CHECKPOINT_SUBJECT_MISMATCH",
          "CandidateCheckpoint changed while validation was running",
        );
        if (attempt) {
          current.validation_attempts.push(attempt);
          unit.validation_attempt_ids.push(attempt.validation_attempt_id);
        }
        unit.last_error = {
          code: errorCode,
          message: error.message,
          validation_attempt_id: attempt?.validation_attempt_id ?? null,
        };
        current.blockers.push({
          code: errorCode,
          work_unit_id: workUnitId,
          checkpoint_id: checkpoint.checkpoint_id,
          validation_attempt_id: attempt?.validation_attempt_id ?? null,
        });
        current.updated_at = this.now();
      });
      throw error;
    }

    const completedAt = this.now();
    const attempt = createValidationAttempt({
      kind: "repository_validation",
      subjectId: checkpoint.checkpoint_id,
      attempt: attemptNumber,
      status: "passed",
      evidence: repositoryEvidence,
      checkIdentity,
      requestedBudget: attemptBudget?.requested ?? null,
      effectiveBudget: attemptBudget?.effective ?? null,
      budgetSource: attemptBudget?.source ?? null,
      budgetLimit: attemptBudget?.limit ?? null,
      environmentIdentity,
      startedAt,
      completedAt,
    });
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const unit = this.unitsForCurrentPlan(current).find(
        (item) => item.work_unit_id === workUnitId,
      );
      invariant(
        unit?.candidate_checkpoint_id === checkpoint.checkpoint_id &&
          unit.candidate === null,
        "CANDIDATE_CHECKPOINT_SUBJECT_MISMATCH",
        "CandidateCheckpoint changed before validation evidence was recorded",
      );
      current.validation_attempts.push(attempt);
      unit.validation_attempt_ids.push(attempt.validation_attempt_id);
      unit.last_error = null;
      this.resolveValidationBlockers(current, {
        workUnitId,
        resolvedAt: this.now(),
      });
      current.updated_at = this.now();
    });
    return repositoryEvidence;
  }

  async validateCombinedCandidates({
    changeSetId,
    subject,
    candidates,
    repositories,
    command,
    projectPolicy,
    budgetRequest,
    selectionRationale,
  }) {
    const hasCommand = command !== null;
    const before = await this.controlStore.readChangeSet(changeSetId);
    const attemptNumber =
      before.validation_attempts.filter(
        (attempt) =>
          attempt.kind === "combined_validation" &&
          attempt.subject_id === subject.validation_subject_hash,
      ).length + 1;
    const checkIdentity = hasCommand ? createCheckIdentity(command) : null;
    // 结构尝试参与统一失败预算，但不携带并不存在的进程超时预算。
    const attemptBudget = hasCommand
      ? resolveValidationAttemptBudget({
          command,
          projectPolicy,
          request: budgetRequest,
        })
      : null;
    const environmentIdentity = validationEnvironmentIdentity();
    const startedAt = this.now();
    try {
      const evidence = await this.combinedValidator.validate({
        subject,
        candidates,
        repositories,
        command: hasCommand
          ? {
              ...command,
              timeout_ms: attemptBudget.effective.timeout_ms,
            }
          : null,
        checkIdentity,
        attemptBudget,
        environmentIdentity,
        selectionRationale,
      });
      const attempt = createValidationAttempt({
        kind: "combined_validation",
        subjectId: subject.validation_subject_hash,
        attempt: attemptNumber,
        status: "passed",
        evidence,
        checkIdentity,
        requestedBudget: attemptBudget?.requested ?? null,
        effectiveBudget: attemptBudget?.effective ?? null,
        budgetSource: attemptBudget?.source ?? null,
        budgetLimit: attemptBudget?.limit ?? null,
        environmentIdentity,
        startedAt,
        completedAt: this.now(),
      });
      await this.controlStore.transactChangeSet(changeSetId, (state) => {
        state.validation_attempts.push(attempt);
        this.resolveValidationBlockers(state, {
          validationSubjectHash: subject.validation_subject_hash,
          resolvedAt: this.now(),
        });
        state.updated_at = this.now();
      });
      return evidence;
    } catch (error) {
      const completedAt = this.now();
      const errorCode = this.stableErrorCode(error) ?? "UNEXPECTED_ERROR";
      const evidence = error.details?.evidence ?? null;
      const attempt = evidence
        ? createValidationAttempt({
            kind: "combined_validation",
            subjectId: subject.validation_subject_hash,
            attempt: attemptNumber,
            status: "failed",
            evidence,
            errorCode,
            checkIdentity,
            requestedBudget: attemptBudget?.requested ?? null,
            effectiveBudget: attemptBudget?.effective ?? null,
            budgetSource: attemptBudget?.source ?? null,
            budgetLimit: attemptBudget?.limit ?? null,
            environmentIdentity,
            startedAt,
            completedAt,
          })
        : null;
      await this.controlStore.transactChangeSet(changeSetId, (state) => {
        if (attempt) state.validation_attempts.push(attempt);
        state.blockers.push({
          code: errorCode,
          validation_subject_hash: subject.validation_subject_hash,
          validation_attempt_id: attempt?.validation_attempt_id ?? null,
        });
        state.updated_at = this.now();
      });
      throw error;
    }
  }

  async resumeWorkUnitValidation(
    changeSetId,
    workUnitId,
    { operatorAdmissionMode = null, attemptBudgetRequests = [] } = {},
  ) {
    // 恢复只消费持久化 Checkpoint，不创建 Run，也不调用 Runtime。
    const state = await this.controlStore.readChangeSet(changeSetId);
    const plan = this.currentPlan(state);
    const repositorySelection = this.currentRepositorySelection(state);
    const repositoryHarnessSelection =
      this.currentRepositoryHarnessSelection(state);
    const workUnit = this.unitsForCurrentPlan(state).find(
      (unit) => unit.work_unit_id === workUnitId,
    );
    invariant(
      workUnit &&
        workUnit.phase === "verification" &&
        workUnit.disposition === "current" &&
        workUnit.candidate_checkpoint_id &&
        !workUnit.candidate,
      "CANDIDATE_CHECKPOINT_NOT_RESUMABLE",
      `WorkUnit ${workUnitId} has no resumable CandidateCheckpoint`,
    );
    const checkpoint = state.candidate_checkpoints.find(
      (item) => item.checkpoint_id === workUnit.candidate_checkpoint_id,
    );
    invariant(
      checkpoint &&
        checkpoint.change_set_id === changeSetId &&
        checkpoint.intent_revision === plan.intent_revision &&
        checkpoint.plan_revision === plan.revision &&
        checkpoint.repository_selection_revision ===
          repositorySelection.revision &&
        checkpoint.repository_harness_selection_revision ===
          repositoryHarnessSelection.revision &&
        checkpoint.work_unit_id === workUnitId &&
        checkpoint.repository_id === workUnit.repository_id &&
        checkpoint.target_ref === workUnit.target_ref &&
        checkpoint.base_sha === workUnit.base_sha &&
        checkpoint.workspace_id === workUnit.workspace?.workspace_id &&
        checkpoint.workspace_path === workUnit.workspace?.workspace_path,
      "CANDIDATE_CHECKPOINT_SUBJECT_MISMATCH",
      "CandidateCheckpoint does not match the current exact WorkUnit authority",
    );
    // 无 Git 变化的反馈执行会复用旧 Checkpoint，但本轮验证仍必须绑定最新完成的执行 Run。
    const verificationSourceReference = workUnit.run_references
      .filter(
        (reference) =>
          reference.operation === "execution" &&
          reference.status === "completed",
      )
      .at(-1);
    const sourceRun = await this.runStore.read(
      verificationSourceReference?.run_id ?? checkpoint.source_run_id,
    );
    invariant(
      sourceRun.change_set_id === changeSetId &&
        sourceRun.work_unit_id === workUnitId &&
        sourceRun.status === "completed" &&
        sourceRun.outcome?.type === "implementation_completed" &&
        (sourceRun.run_id === checkpoint.source_run_id ||
          (sourceRun.trigger === "feedback" &&
            sourceRun.outcome.no_change === true &&
            sourceRun.outcome.published_candidate_sha ===
              checkpoint.candidate_sha)),
      "CANDIDATE_CHECKPOINT_RUN_MISMATCH",
      "CandidateCheckpoint source Run is not the exact completed implementation",
    );
    let admission = (state.verification_admissions ?? []).find(
      (item) => item.admission_id === workUnit.verification_admission_id,
    );
    if (admission) {
      invariant(
        operatorAdmissionMode === null ||
          admissionModeAtLeast(admission.mode, operatorAdmissionMode),
        "VERIFICATION_ADMISSION_ALREADY_DECIDED",
        "The immutable admission decision cannot be elevated after validation began",
      );
    } else {
      admission = createVerificationAdmissionDecision({
        checkpointId: checkpoint.checkpoint_id,
        projectPolicy: state.verification_policy,
        planExpectation: plan.verification_expectation,
        // 验证反馈触发的新执行仍需独立复核，但它只是准入策略，不是新的生命周期状态。
        operatorMode:
          sourceRun.trigger === "feedback" &&
          state.feedback_records.find(
            (feedback) => feedback.feedback_id === sourceRun.feedback_source_id,
          )?.source === "verification"
            ? "independent_review"
            : operatorAdmissionMode,
        sourceReportedChangedPaths:
          sourceRun.outcome.reported_changed_paths ?? checkpoint.changed_paths,
        actualChangedPaths: checkpoint.changed_paths,
        unverifiedBoundaries: plan.unverified_boundaries,
        createdAt: this.now(),
      });
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = this.unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        invariant(
          unit?.candidate_checkpoint_id === checkpoint.checkpoint_id &&
            unit.verification_admission_id === null,
          "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
          "CandidateCheckpoint changed before verification admission",
        );
        current.verification_admissions.push(admission);
        unit.verification_admission_id = admission.admission_id;
        current.updated_at = this.now();
      });
    }
    const catalog = await this.controlStore.readCatalog();
    const project = this.requireProject(catalog, state.project_id);
    const repository = project.repositories.find(
      (item) => item.repository_id === checkpoint.repository_id,
    );
    const repositoryEvidence = await this.ensureRepositoryValidationPassed({
      changeSetId,
      workUnitId,
      workUnit,
      checkpoint,
      repository,
      projectPolicy: state.verification_policy,
      attemptBudgetRequests,
    });
    let verificationFocus = null;
    const sourceFeedback = state.feedback_records.find(
      (feedback) => feedback.feedback_id === sourceRun.feedback_source_id,
    );
    if (sourceFeedback?.source === "verification") {
      // 反馈引用只缩小当前验证输入，不会创建另一套复核生命周期。
      const sourceReview = state.verification_reviews.find(
        (review) =>
          review.review_id === sourceFeedback.target.verification_review_id,
      );
      const sourceCheckpoint = state.candidate_checkpoints.find(
        (candidate) =>
          candidate.checkpoint_id === sourceReview?.checkpoint_id,
      );
      invariant(
        sourceReview?.verdict === "changes_required" &&
          sourceCheckpoint &&
          sourceRun.operation === "execution" &&
          sourceRun.status === "completed" &&
          sourceRun.outcome?.type === "implementation_completed",
        "FEEDBACK_LINEAGE_MISMATCH",
        "Verification feedback requires one exact completed execution lineage",
      );
      normalizeRevisionFeedbackAssessments(
        sourceRun.outcome.revision_feedback_assessments,
        this.verificationReviewAsRevisionFeedback(sourceReview),
      );
      verificationFocus = {
        feedbackRecord: sourceFeedback,
        sourceReview,
        sourceCheckpoint,
        feedbackRun: sourceRun,
      };
    } else {
      const pendingFeedback = state.feedback_records.find(
        (feedback) => feedback.feedback_id === workUnit.pending_feedback_id,
      );
      if (pendingFeedback) {
        verificationFocus = {
          feedbackRecord: pendingFeedback,
          sourceReview: null,
          sourceCheckpoint: checkpoint,
          feedbackRun: null,
        };
      }
    }
    let verificationReview = null;
    if (admission.mode === "independent_review") {
      verificationReview = await this.ensureIndependentVerificationPassed({
        changeSetId,
        workUnitId,
        checkpoint,
        admission,
        repositoryEvidence,
        focus: verificationFocus,
      });
      const afterReview = await this.controlStore.readChangeSet(changeSetId);
      const afterReviewUnit = this.unitsForCurrentPlan(afterReview).find(
        (unit) => unit.work_unit_id === workUnitId,
      );
      if (afterReviewUnit.pending_feedback_id !== null) {
        return {
          status: "feedback_required",
          feedback_id: afterReviewUnit.pending_feedback_id,
          verification_review_id: verificationReview.review_id,
        };
      }
      if (verificationReview.verdict === "changes_required") {
        const current = await this.controlStore.readChangeSet(changeSetId);
        const currentUnit = this.unitsForCurrentPlan(current).find(
          (unit) => unit.work_unit_id === workUnitId,
        );
        return {
          status: "feedback_required",
          feedback_id: currentUnit.pending_feedback_id,
          verification_review_id: verificationReview.review_id,
        };
      }
      if (verificationReview.verdict === "human_decision_required") {
        const current = await this.controlStore.readChangeSet(changeSetId);
        const gate = current.gates.find(
          (item) =>
            item.status === "open" &&
            item.verification_review_id === verificationReview.review_id,
        );
        return {
          status: "human_input_required",
          gate_id: gate?.gate_id ?? null,
          verification_review_id: verificationReview.review_id,
        };
      }
    }
    const candidate = createCandidate({
      repositoryId: checkpoint.repository_id,
      targetRef: checkpoint.target_ref,
      baseSha: checkpoint.base_sha,
      candidateSha: checkpoint.candidate_sha,
      workspaceId: checkpoint.workspace_id,
      workspacePath: checkpoint.workspace_path,
      changedPaths: checkpoint.changed_paths,
      repositoryEvidence,
      verificationAdmissionId: admission.admission_id,
      verificationReviewId: verificationReview?.review_id ?? null,
    });
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const unit = this.unitsForCurrentPlan(current).find(
        (item) => item.work_unit_id === workUnitId,
      );
      invariant(
        unit?.candidate_checkpoint_id === checkpoint.checkpoint_id &&
          unit.phase === "verification" &&
          (!verificationReview ||
            unit.verification_review_id === verificationReview.review_id) &&
          unit.candidate === null,
        "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
        "CandidateCheckpoint changed before Candidate promotion",
      );
      setWorkUnitPhase(unit, "complete");
      unit.candidate = candidate;
      unit.last_error = null;
      current.candidates.push(candidate);
      this.resolveValidationBlockers(current, {
        workUnitId,
        resolvedAt: this.now(),
      });
      setChangeSetPhase(current, "running");
      current.updated_at = this.now();
    });
    return candidate;
  }

  async ensureIndependentVerificationPassed({
    changeSetId,
    workUnitId,
    checkpoint,
    admission,
    repositoryEvidence,
    focus = null,
  }) {
    let state = await this.controlStore.readChangeSet(changeSetId);
    // 反馈复核只是带精确 lineage 的 verification Run，不是另一套生命周期。
    const reviewScope = focus === null ? "initial" : "feedback";
    const existingReview = state.verification_reviews
      .filter(
        (review) =>
          review.admission_id === admission.admission_id &&
          review.checkpoint_id === checkpoint.checkpoint_id &&
          (review.review_scope ?? "initial") === reviewScope &&
          (reviewScope === "initial" ||
            review.feedback_id === focus.feedbackRecord.feedback_id),
      )
      .at(-1);
    if (verificationReviewAllowsCandidate(existingReview)) {
      return structuredClone(existingReview);
    }
    if (
      existingReview &&
      ["changes_required", "human_decision_required"].includes(
        existingReview.verdict,
      )
    ) {
      return structuredClone(existingReview);
    }

    const catalog = await this.controlStore.readCatalog();
    const project = this.requireProject(catalog, state.project_id);
    const repository = this.requireRepository(project, checkpoint.repository_id);
    const plan = this.currentPlan(state);
    const repositorySelection = this.currentRepositorySelection(state);
    const repositoryHarnessSelection =
      this.currentRepositoryHarnessSelection(state);
    const selectedRepository = repositorySelection.repositories.find(
      (item) => item.repository_id === checkpoint.repository_id,
    );
    const selectedHarness = repositoryHarnessSelection.repositories.find(
      (item) => item.repository_id === checkpoint.repository_id,
    );
    invariant(
      selectedRepository &&
        selectedHarness?.resolved_base_sha === checkpoint.base_sha,
      "REPOSITORY_HARNESS_SELECTION_MISMATCH",
      "Verification subject no longer matches the frozen Repository authority",
    );
    const workUnit = this.unitsForCurrentPlan(state).find(
      (item) => item.work_unit_id === workUnitId,
    );
    const sourceRun = await this.runStore.read(checkpoint.source_run_id);
    const attempt =
      workUnit.run_references.filter(
        (reference) => reference.operation === "verification",
      ).length + 1;
    const runId = this.idFactory("run");
    let workspace = null;
    let overlaySnapshot = null;

    try {
      workspace = await this.repositoryWorker.prepareVerificationWorkspace({
        repository,
        candidateSha: checkpoint.candidate_sha,
        harnessBaseSha: checkpoint.base_sha,
        workspaceId: `verification-${runId}`,
      });
      if (
        selectedHarness.mode ===
        HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
      ) {
        overlaySnapshot = await this.harnessSnapshotStore.read(
          selectedHarness.artifact_reference,
        );
        workspace = {
          ...workspace,
          harness_overlay: {
            ...selectedHarness.artifact_reference,
            paths: [...selectedHarness.resolved_relative_paths],
          },
        };
        workspace = await this.repositoryWorker.materializeHarnessOverlay({
          repository,
          workspace,
          snapshot: overlaySnapshot,
        });
      }
    } catch (error) {
      if (workspace) {
        await preserveSecondaryFailure(
          error,
          "verification_workspace_cleanup",
          () =>
            this.repositoryWorker.cleanupVerificationWorkspace({
              repository,
              workspace,
              harnessSnapshot: overlaySnapshot,
            }),
        );
      }
      throw error;
    }

    let exactCandidateHarness;
    try {
      exactCandidateHarness = await this.repositoryWorker.discoverHarness(
        repository,
        checkpoint.candidate_sha,
      );
    } catch (error) {
      await preserveSecondaryFailure(
        error,
        "verification_workspace_cleanup",
        () =>
          this.repositoryWorker.cleanupVerificationWorkspace({
            repository,
            workspace,
            harnessSnapshot: overlaySnapshot,
          }),
      );
      throw error;
    }
    const frozenOverlayHarness = this.overlayHarnessResources(overlaySnapshot);
    const availableHarness = [
      ...exactCandidateHarness,
      ...frozenOverlayHarness,
    ];
    const harnessObservation = this.repositoryHarnessObservation({
      repositoryId: repository.repository_id,
      exactBaseResources: exactCandidateHarness,
      overlayResources: frozenOverlayHarness,
    });
    const run = createAgentRunRecord({
      runId,
      changeSetId,
      workUnitId,
      operation: "verification",
      trigger: focus === null ? "initial" : "feedback",
      attempt,
      agentProfile: this.verificationAgentProfile,
      continuationOfRunId:
        workUnit.run_references
          .filter((reference) => reference.operation === "verification")
          .at(-1)?.run_id ?? null,
      repositoryHarnessSelection: {
        revision: repositoryHarnessSelection.revision,
        repositories: [this.harnessSelectionForContext(selectedHarness)],
      },
      repositoryHarnessObservation: {
        repositories: [harnessObservation],
      },
      contextEvidence: null,
      contextProjectionIdentity: null,
      createdAt: this.now(),
      extra: {
        feedback_source_id: focus?.feedbackRecord.feedback_id ?? null,
        verification_workspace: workspace,
      },
    });
    try {
      await this.runStore.create(run);
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = this.unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        invariant(
          unit?.candidate_checkpoint_id === checkpoint.checkpoint_id &&
            unit.verification_admission_id === admission.admission_id &&
            unit.candidate === null,
          "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
          "Verification subject changed before Runtime dispatch",
        );
        unit.run_references.push(
          createRunReference({
            runId,
            operation: "verification",
            trigger: focus === null ? "initial" : "feedback",
            feedback_source_id: focus?.feedbackRecord.feedback_id ?? null,
            attempt,
            review_scope: reviewScope,
            source_review_id: focus?.sourceReview?.review_id ?? null,
          }),
        );
        current.run_references.push(
          createRunReference({
            runId,
            operation: "verification",
            trigger: focus === null ? "initial" : "feedback",
            plan_revision: plan.revision,
            work_unit_id: workUnitId,
            verification_admission_id: admission.admission_id,
            review_scope: reviewScope,
            source_review_id: focus?.sourceReview?.review_id ?? null,
            attempt,
          }),
        );
        setChangeSetPhase(current, "running");
        current.updated_at = this.now();
      });
    } catch (error) {
      await preserveSecondaryFailure(
        error,
        "verification_workspace_cleanup",
        () =>
          this.repositoryWorker.cleanupVerificationWorkspace({
            repository,
            workspace,
            harnessSnapshot: overlaySnapshot,
          }),
      );
      throw error;
    }

    state = await this.controlStore.readChangeSet(changeSetId);
    const currentUnit = this.unitsForCurrentPlan(state).find(
      (item) => item.work_unit_id === workUnitId,
    );
    const controlContract = createControlContract({
      operation: "verification",
      changeSetId,
      planRevision: plan.revision,
      repositorySelectionRevision: repositorySelection.revision,
      repositoryHarnessSelectionRevision:
        repositoryHarnessSelection.revision,
      workUnitId,
      authorizedRepositories: [checkpoint.repository_id],
      allowedOutcomes: ["verification_completed"],
      humanGates: ["candidate_bundle_acceptance"],
    });
    const contextProjection = createContextProjection({
      operation: "verification",
      changeSet: state,
      plan,
      repositorySelection,
      repositoryHarnessSelection,
      workUnit: currentUnit,
      repositories: [
        {
          repository_id: repository.repository_id,
          branch_ref: selectedRepository.branch_ref,
          target_ref: checkpoint.target_ref,
          base_sha: checkpoint.base_sha,
          candidate_sha: checkpoint.candidate_sha,
          root_path: workspace.workspace_path,
          harness_selection: this.harnessSelectionForContext(selectedHarness),
          ...this.harnessResourcesForContext(availableHarness),
        },
      ],
      capability: {
        mode: "read_only",
        paths: [workspace.workspace_path],
      },
      requiredEvidence: [
        "exact_candidate_diff",
        "repository_validation_evidence",
        "structured_verification_outcome",
        ...(focus === null ? [] : ["current_feedback"]),
        ...(focus?.feedbackRun ? ["feedback_execution_lineage"] : []),
      ],
      feedback: focus?.feedbackRecord ?? null,
      verificationPolicy: state.verification_policy,
      verification: {
        admission: structuredClone(admission),
        candidate: {
          checkpoint_id: checkpoint.checkpoint_id,
          repository_id: checkpoint.repository_id,
          target_ref: checkpoint.target_ref,
          base_sha: checkpoint.base_sha,
          candidate_sha: checkpoint.candidate_sha,
          changed_paths: [...checkpoint.changed_paths],
        },
        source_execution: {
          run_id: sourceRun.run_id,
          outcome_type: sourceRun.outcome?.type ?? null,
          summary: sourceRun.outcome?.summary ?? null,
          reported_changed_paths:
            sourceRun.outcome?.reported_changed_paths ?? [],
        },
        repository_validation: {
          mode:
            workUnit.repository_check === null
              ? "structural_preflight"
              : "project_command",
          selection_rationale: workUnit.repository_check_rationale,
          evidence: structuredClone(repositoryEvidence),
        },
        completed_checks:
          workUnit.repository_check === null
            ? []
            : [
                {
                  check: structuredClone(workUnit.repository_check),
                  status: "passed",
                  evidence: structuredClone(repositoryEvidence),
                },
              ],
        // combined check 只有全部仓库 Candidate 就绪后才能执行；显式标为未来门禁，
        // 避免只读 verifier 把控制器尚未到达的阶段误判成证据缺失。
        combined_check_selection: {
          selection_rationale: plan.combined_check_rationale,
          scheduled: plan.combined_check !== null,
        },
        scheduled_later_checks:
          plan.combined_check === null
            ? []
            : [
                {
                  stage: "candidate_bundle_assembly",
                  status: "scheduled",
                  check: structuredClone(plan.combined_check),
                },
              ],
        focus:
          focus?.sourceReview && focus?.feedbackRun
            ? {
                source_review: {
                  review_id: focus.sourceReview.review_id,
                  checkpoint_id: focus.sourceReview.checkpoint_id,
                  summary: focus.sourceReview.summary,
                  findings: structuredClone(focus.sourceReview.findings),
                  candidate: {
                    candidate_sha: focus.sourceCheckpoint.candidate_sha,
                    changed_paths: [
                      ...focus.sourceCheckpoint.changed_paths,
                    ],
                  },
                },
                feedback_execution: {
                  run_id: focus.feedbackRun.run_id,
                  reported_changed_paths:
                    focus.feedbackRun.outcome.reported_changed_paths ?? [],
                  actual_changed_paths:
                    focus.feedbackRun.outcome.actual_changed_paths ?? [],
                  candidate_sha:
                    focus.feedbackRun.outcome.published_candidate_sha ??
                    checkpoint.candidate_sha,
                  revision_feedback_assessments: structuredClone(
                    focus.feedbackRun.outcome
                      .revision_feedback_assessments ?? [],
                  ),
                },
              }
            : null,
      },
      historyReferences: [],
    });
    const invocation = {
      operation: "verification",
      agent_profile: this.verificationAgentProfile,
      control_contract: controlContract,
      context_projection: contextProjection,
      capabilities: contextProjection.capability,
      workspace,
      signal: null,
    };
    let outcome = null;
    let providerEvidence = null;
    let runtimeError = null;
    let checkResult = {
      attemptIds: [],
      failedError: null,
      missingEvidence: false,
    };
    try {
      const contextEvidence = assessInitialContext({
        controlContract,
        contextProjection,
        agentProfile: this.verificationAgentProfile,
        runtimeMeasurement: await measureInitialContext(
          this.verificationRuntime,
          invocation,
        ),
      });
      await this.runStore.update(runId, (current) => {
        current.context_evidence = contextEvidence;
        current.context_projection_identity = {
          schema_version: contextProjection.schema_version,
          digest: sha256(contextProjection),
        };
      });
      const result = await this.runCoordinator.invoke(
        this.verificationRuntime,
        runId,
        invocation,
      );
      providerEvidence = result.provider_evidence;
      outcome = normalizeVerificationOutcome(result.outcome, {
        projectPolicy: state.verification_policy,
        existingCommandIds: [
          ...plan.work_units.map(
            (item) => item.repository_check?.command_id,
          ),
          plan.combined_check?.command_id,
        ].filter(Boolean),
      });
      await this.repositoryWorker.preflightVerificationWorkspace({
        repository,
        workspace,
      });
      checkResult = await this.executeVerificationRequestedChecks({
        changeSetId,
        workUnitId,
        checkpoint,
        repository,
        workspace,
        commands: outcome.requested_checks,
        projectPolicy: state.verification_policy,
      });
      invariant(
        !checkResult.missingEvidence,
        "MISSING_REQUIRED_EVIDENCE",
        "A verification-requested check failed without immutable evidence",
      );
    } catch (error) {
      runtimeError = error;
      providerEvidence = error.runtime_evidence ?? providerEvidence;
    }
    // 进程级中断保留 running Run 和一次性工作区，下一控制器据此执行确定性放弃与重试。
    if (runtimeError?.code === "CONTROLLER_INTERRUPTED") {
      throw runtimeError;
    }
    try {
      await this.repositoryWorker.cleanupVerificationWorkspace({
        repository,
        workspace,
        harnessSnapshot: overlaySnapshot,
      });
    } catch (error) {
      runtimeError ??= error;
    }

    if (runtimeError) {
      await this.runCoordinator.failAttempt({
        runId,
        invocation,
        providerEvidence,
        error: runtimeError,
      });
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = this.unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        unit.run_references.find(
          (reference) => reference.run_id === runId,
        ).status = runTerminalStatusForError(runtimeError);
        const reference = current.run_references.find(
          (item) => item.run_id === runId,
        );
        reference.status = runTerminalStatusForError(runtimeError);
        unit.last_error = {
          code: runtimeError.code ?? "UNEXPECTED_ERROR",
          message: runtimeError.message,
          run_id: runId,
        };
        if (runTerminalStatusForError(runtimeError) === "failed") {
          current.blockers.push({
            code: runtimeError.code ?? "UNEXPECTED_ERROR",
            work_unit_id: workUnitId,
            checkpoint_id: checkpoint.checkpoint_id,
            verification_admission_id: admission.admission_id,
            run_id: runId,
          });
        }
        current.updated_at = this.now();
      });
      throw runtimeError;
    }

    const completedAt = await this.runCoordinator.completeAttempt({
      runId,
      invocation,
      providerEvidence,
      eventPayload: outcome,
      runOutcome: {
        type: outcome.type,
        review_depth: outcome.review_depth,
        verdict: outcome.verdict,
        summary: outcome.summary,
      },
    });

    const checkStatus =
      outcome.requested_checks.length === 0
        ? "not_required"
        : checkResult.failedError
          ? "failed"
          : "passed";
    const review = createVerificationReview({
      admissionId: admission.admission_id,
      checkpoint,
      runId,
      outcome,
      validationAttemptIds: checkResult.attemptIds,
      checkStatus,
      reviewScope,
      sourceReviewId: focus?.sourceReview?.review_id ?? null,
      feedbackRunId: focus?.feedbackRun?.run_id ?? null,
      feedbackId: focus?.feedbackRecord.feedback_id ?? null,
      createdAt: completedAt,
    });
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const unit = this.unitsForCurrentPlan(current).find(
        (item) => item.work_unit_id === workUnitId,
      );
      invariant(
        unit?.phase === "verification" &&
          unit.candidate_checkpoint_id === checkpoint.checkpoint_id,
        "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
        "Verification subject changed before its result was recorded",
      );
      unit.run_references.find(
        (item) => item.run_id === runId,
      ).status = "completed";
      const reference = current.run_references.find(
        (item) => item.run_id === runId,
      );
      reference.status = "completed";
      current.verification_reviews.push(review);
      unit.verification_review_id = review.review_id;
      if (
        focus &&
        unit.pending_feedback_id === focus.feedbackRecord.feedback_id
      ) {
        unit.pending_feedback_id = null;
        if (current.current_feedback_id === focus.feedbackRecord.feedback_id) {
          this.feedbackService.clear(current);
        }
      }
      if (checkResult.failedError) {
        unit.last_error = {
          code: "VERIFICATION_CHECK_FAILED",
          message: checkResult.failedError.message,
          verification_review_id: review.review_id,
          validation_attempt_id: checkResult.failedAttemptId,
        };
        current.blockers.push({
          code: "VERIFICATION_CHECK_FAILED",
          work_unit_id: workUnitId,
          checkpoint_id: checkpoint.checkpoint_id,
          verification_review_id: review.review_id,
        });
      } else if (review.verdict === "changes_required") {
        const feedback = this.feedbackService.record(current, {
          source: "verification",
          target: {
            change_set_id: changeSetId,
            plan_revision: current.current_plan_revision,
            work_unit_id: workUnitId,
            checkpoint_id: checkpoint.checkpoint_id,
            verification_review_id: review.review_id,
          },
          content: this.verificationReviewAsRevisionFeedback(review),
          createdAt: this.now(),
        });
        setWorkUnitPhase(unit, "execution");
        unit.pending_feedback_id = feedback.feedback_id;
        unit.last_error = null;
        setChangeSetPhase(current, "running");
      } else if (review.verdict === "human_decision_required") {
        const gate = {
          gate_id: this.idFactory("gate"),
          kind: "verification_decision",
          status: "open",
          change_set_id: changeSetId,
          work_unit_id: workUnitId,
          checkpoint_id: checkpoint.checkpoint_id,
          verification_review_id: review.review_id,
          request: structuredClone(review.human_decision),
          created_at: this.now(),
        };
        current.gates.push(gate);
        unit.last_error = null;
      } else {
        unit.last_error = null;
        this.resolveValidationBlockers(current, {
          workUnitId,
          resolvedAt: this.now(),
        });
      }
      current.updated_at = this.now();
    });

    if (checkResult.failedError) {
      throw new ChangeFleetError(
        "VERIFICATION_CHECK_FAILED",
        "An independent verification check failed for the exact Candidate",
        { verification_review_id: review.review_id },
      );
    }
    if (review.verdict === "changes_required") {
      return review;
    }
    return review;
  }
}
