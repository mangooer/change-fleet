import { invariant } from "../domain/errors.js";
import { createValidationAttempt } from "../domain/model.js";
import {
  createCheckIdentity,
  resolveValidationAttemptBudget,
  selectValidationAttemptBudgetRequest,
  validationEnvironmentIdentity,
} from "../domain/verification.js";

// VerificationOrchestrator 拥有验证执行机制：请求检查、仓库检查和合并检查的尝试执行与
// 证据落盘。Runtime 派发流（admission 与独立复核）仍由 ChangeFleetService 驱动，待后续
// 切片迁入同一边界。
export class VerificationOrchestrator {
  constructor({
    controlStore,
    repositoryValidator,
    combinedValidator,
    now,
    unitsForCurrentPlan,
    resolveValidationBlockers,
    stableErrorCode,
  }) {
    this.controlStore = controlStore;
    this.repositoryValidator = repositoryValidator;
    this.combinedValidator = combinedValidator;
    this.now = now;
    this.unitsForCurrentPlan = unitsForCurrentPlan;
    this.resolveValidationBlockers = resolveValidationBlockers;
    this.stableErrorCode = stableErrorCode;
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
    const checkIdentity = createCheckIdentity(workUnit.repository_check);
    const latestState = await this.controlStore.readChangeSet(changeSetId);
    const passedAttempt = latestState.validation_attempts.find(
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
    const budgetRequest = selectValidationAttemptBudgetRequest(
      attemptBudgetRequests,
      {
        kind: "repository_validation",
        workUnitId,
        commandId: workUnit.repository_check.command_id,
      },
    );
    const attemptBudget = resolveValidationAttemptBudget({
      command: workUnit.repository_check,
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
        command: {
          ...workUnit.repository_check,
          timeout_ms: attemptBudget.effective.timeout_ms,
        },
        checkIdentity,
        attemptBudget,
        environmentIdentity,
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
            requestedBudget: attemptBudget.requested,
            effectiveBudget: attemptBudget.effective,
            budgetSource: attemptBudget.source,
            budgetLimit: attemptBudget.limit,
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
      requestedBudget: attemptBudget.requested,
      effectiveBudget: attemptBudget.effective,
      budgetSource: attemptBudget.source,
      budgetLimit: attemptBudget.limit,
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
  }) {
    const before = await this.controlStore.readChangeSet(changeSetId);
    const attemptNumber =
      before.validation_attempts.filter(
        (attempt) =>
          attempt.kind === "combined_validation" &&
          attempt.subject_id === subject.validation_subject_hash,
      ).length + 1;
    const checkIdentity = createCheckIdentity(command);
    const attemptBudget = resolveValidationAttemptBudget({
      command,
      projectPolicy,
      request: budgetRequest,
    });
    const environmentIdentity = validationEnvironmentIdentity();
    const startedAt = this.now();
    try {
      const evidence = await this.combinedValidator.validate({
        subject,
        candidates,
        repositories,
        command: {
          ...command,
          timeout_ms: attemptBudget.effective.timeout_ms,
        },
        checkIdentity,
        attemptBudget,
        environmentIdentity,
      });
      const completedAt = this.now();
      const attempt = createValidationAttempt({
        kind: "combined_validation",
        subjectId: subject.validation_subject_hash,
        attempt: attemptNumber,
        status: "passed",
        evidence,
        checkIdentity,
        requestedBudget: attemptBudget.requested,
        effectiveBudget: attemptBudget.effective,
        budgetSource: attemptBudget.source,
        budgetLimit: attemptBudget.limit,
        environmentIdentity,
        startedAt,
        completedAt,
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
            requestedBudget: attemptBudget.requested,
            effectiveBudget: attemptBudget.effective,
            budgetSource: attemptBudget.source,
            budgetLimit: attemptBudget.limit,
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
}
