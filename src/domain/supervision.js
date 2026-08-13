import { sha256, stableId } from "./canonical-json.js";
import { invariant } from "./errors.js";
import { bundleReviewAssessmentMatches } from "./bundle-review.js";

export const SUPERVISION_MODES = Object.freeze([
  "manual",
  "autonomous_until_review",
]);

export const DEFAULT_SUPERVISION_POLICY = Object.freeze({
  default_mode: "manual",
  max_execution_attempts_per_work_unit: 3,
  max_verification_attempts_per_work_unit: 3,
  max_feedback_cycles_per_work_unit: 2,
  max_elapsed_ms: 30 * 60 * 1_000,
});

const ACTION_TYPES = new Set([
  "dispatch_execution",
  "advance_work_unit_validation",
  "retry_execution",
  "retry_validation",
  "submit_feedback",
  "validate_and_assemble_bundle",
  "dispatch_bundle_review",
  "open_gate",
  "pause",
  "stop",
]);
const SUPERVISOR_TEXT_BYTES = 2 * 1_024;
const SUPERVISOR_EVIDENCE_LIMIT = 16;
const RETRYABLE_EXECUTION_CODES = new Set([
  "CODEX_CREDENTIALS_UNAVAILABLE",
  "CODEX_PROVIDER_FAILED",
  "CODEX_RUNTIME_OUTPUT_INVALID",
  "RUN_INTERRUPTED_AFTER_RESTART",
  "RUNTIME_CANCELLED",
  "RUNTIME_INTERRUPTED",
  "RUNTIME_IMPLEMENTATION_BLOCKED",
  "UNEXPECTED_RUNTIME_OUTCOME",
  "EMPTY_IMPLEMENTATION_RESULT",
]);

// 重试资格是一个领域规则；监督动作和确定性预检必须读取同一来源，避免恢复错误码漂移。
export function executionFailureIsRetryable(code) {
  return RETRYABLE_EXECUTION_CODES.has(code);
}

// Project 只给出自动运行的上限；省略策略时保持人工模式，绝不因迁移或升级静默启动 Agent。
export function normalizeSupervisionPolicy(input = null) {
  const policy = input ?? {};
  invariant(
    policy && typeof policy === "object" && !Array.isArray(policy),
    "INVALID_SUPERVISION_POLICY",
    "Project supervision policy must be one object",
  );
  assertAllowedKeys(policy, [
    "default_mode",
    "max_execution_attempts_per_work_unit",
    "max_verification_attempts_per_work_unit",
    "max_feedback_cycles_per_work_unit",
    "max_elapsed_ms",
  ], "INVALID_SUPERVISION_POLICY");
  const normalized = {
    default_mode: policy.default_mode ?? DEFAULT_SUPERVISION_POLICY.default_mode,
    max_execution_attempts_per_work_unit: positiveInteger(
      "max_execution_attempts_per_work_unit",
      policy.max_execution_attempts_per_work_unit ??
        DEFAULT_SUPERVISION_POLICY.max_execution_attempts_per_work_unit,
    ),
    max_verification_attempts_per_work_unit: positiveInteger(
      "max_verification_attempts_per_work_unit",
      policy.max_verification_attempts_per_work_unit ??
        DEFAULT_SUPERVISION_POLICY.max_verification_attempts_per_work_unit,
    ),
    max_feedback_cycles_per_work_unit: positiveInteger(
      "max_feedback_cycles_per_work_unit",
      policy.max_feedback_cycles_per_work_unit ??
        DEFAULT_SUPERVISION_POLICY.max_feedback_cycles_per_work_unit,
    ),
    max_elapsed_ms: positiveInteger(
      "max_elapsed_ms",
      policy.max_elapsed_ms ?? DEFAULT_SUPERVISION_POLICY.max_elapsed_ms,
    ),
  };
  invariant(
    SUPERVISION_MODES.includes(normalized.default_mode),
    "INVALID_SUPERVISION_POLICY",
    "Project supervision default mode is invalid",
  );
  return normalized;
}

// Plan 固化本次真正获批的模式和预算；每一项都必须位于 Project 上限内。
export function normalizePlanSupervision(input, projectPolicy = null) {
  const policy = normalizeSupervisionPolicy(projectPolicy);
  const requested = input ?? {};
  invariant(
    requested && typeof requested === "object" && !Array.isArray(requested),
    "INVALID_PLAN_SUPERVISION",
    "Plan supervision must be one object",
  );
  assertAllowedKeys(requested, [
    "mode",
    "execution_attempt_limit_per_work_unit",
    "verification_attempt_limit_per_work_unit",
    "feedback_cycle_limit_per_work_unit",
    "elapsed_time_limit_ms",
  ], "INVALID_PLAN_SUPERVISION");
  const normalized = {
    mode: requested.mode ?? policy.default_mode,
    execution_attempt_limit_per_work_unit: positiveInteger(
      "execution_attempt_limit_per_work_unit",
      requested.execution_attempt_limit_per_work_unit ??
        policy.max_execution_attempts_per_work_unit,
    ),
    verification_attempt_limit_per_work_unit: positiveInteger(
      "verification_attempt_limit_per_work_unit",
      requested.verification_attempt_limit_per_work_unit ??
        policy.max_verification_attempts_per_work_unit,
    ),
    feedback_cycle_limit_per_work_unit: positiveInteger(
      "feedback_cycle_limit_per_work_unit",
      requested.feedback_cycle_limit_per_work_unit ??
        policy.max_feedback_cycles_per_work_unit,
    ),
    elapsed_time_limit_ms: positiveInteger(
      "elapsed_time_limit_ms",
      requested.elapsed_time_limit_ms ?? policy.max_elapsed_ms,
    ),
  };
  invariant(
    SUPERVISION_MODES.includes(normalized.mode),
    "INVALID_PLAN_SUPERVISION",
    "Plan supervision mode is invalid",
  );
  invariant(
    normalized.execution_attempt_limit_per_work_unit <=
        policy.max_execution_attempts_per_work_unit &&
      normalized.verification_attempt_limit_per_work_unit <=
        policy.max_verification_attempts_per_work_unit &&
      normalized.feedback_cycle_limit_per_work_unit <=
        policy.max_feedback_cycles_per_work_unit &&
      normalized.elapsed_time_limit_ms <= policy.max_elapsed_ms,
    "SUPERVISION_BUDGET_EXCEEDS_PROJECT_POLICY",
    "Plan supervision budget exceeds the Project ceiling",
  );
  return normalized;
}

// 监督时钟只累计控制器真实处于自主循环中的区间；人工审查、Gate 和暂停等待不消耗该预算。
export function startSupervisionClock(control, now) {
  const startedAt = supervisionTimestamp("active_started_at", now);
  control.active_elapsed_ms = accumulatedSupervisionTime(control);
  if (
    control.active_started_at === null ||
    control.active_started_at === undefined
  ) {
    control.active_started_at = startedAt;
  } else {
    supervisionTimestamp("active_started_at", control.active_started_at);
  }
  return control;
}

// 停止操作必须先固化当前区间，再清空起点；重复停止不会重复累计同一段时间。
export function stopSupervisionClock(control, now) {
  const stoppedAt = supervisionTimestamp("stopped_at", now);
  const accumulated = accumulatedSupervisionTime(control);
  if (
    control.active_started_at === null ||
    control.active_started_at === undefined
  ) {
    control.active_elapsed_ms = accumulated;
    control.active_started_at = null;
    return control;
  }
  const startedAt = supervisionTimestamp(
    "active_started_at",
    control.active_started_at,
  );
  control.active_elapsed_ms =
    accumulated + Math.max(0, Date.parse(stoppedAt) - Date.parse(startedAt));
  control.active_started_at = null;
  return control;
}

// 该纯函数只读取权威快照并给出下一组合法动作；它不读取文件、时间或 Runtime。
export function deriveSupervisionActionSet(changeSet, { now }) {
  const plan = currentPlan(changeSet);
  const snapshot = exactSnapshot(changeSet, plan);
  const snapshotId = sha256(snapshot);
  const progress = deriveSupervisionProgress(changeSet, { now, plan });
  const envelope = (type, subject = {}, details = {}) =>
    createActionEnvelope({
      type,
      subject,
      details,
      snapshot,
      snapshotId,
      progress,
    });

  if (!plan || plan.status !== "confirmed") {
    return actionSet(snapshotId, progress, [
      envelope("stop", {}, { reason: "plan_not_confirmed" }),
    ]);
  }
  if (plan.supervision.mode !== "autonomous_until_review") {
    return actionSet(snapshotId, progress, [
      envelope("stop", {}, { reason: "manual_mode" }),
    ]);
  }
  if (changeSet.supervision_control?.hold !== null) {
    return actionSet(snapshotId, progress, [
      envelope("pause", {}, {
        reason: changeSet.supervision_control.hold.reason,
      }),
    ]);
  }
  const openGate = (changeSet.gates ?? []).find((gate) => gate.status === "open");
  if (openGate) {
    return actionSet(snapshotId, progress, [
      envelope("stop", { gate_id: openGate.gate_id }, { reason: "gate_open" }),
    ]);
  }
  if (changeSet.phase === "review") {
    const bundle = (changeSet.bundles ?? []).at(-1) ?? null;
    const assessment = (changeSet.bundle_review_assessments ?? []).find(
      (item) =>
        item.assessment_id === changeSet.current_bundle_review_assessment_id,
    );
    if (plan.bundle_review?.mode === "independent") {
      if (bundleReviewAssessmentMatches(assessment, bundle, plan)) {
        return actionSet(snapshotId, progress, [
          envelope("stop", { bundle_id: bundle.bundle_id }, {
            reason:
              assessment.disposition === "pass"
                ? "bundle_review_recommended"
                : "bundle_review_gate_required",
          }),
        ]);
      }
      if (progress.elapsed.exhausted) {
        return actionSet(snapshotId, progress, [
          envelope("stop", { bundle_id: bundle?.bundle_id ?? null }, {
            reason: "elapsed_budget_exhausted",
          }),
        ]);
      }
      if (progress.bundle_review.exhausted) {
        return actionSet(snapshotId, progress, [
          envelope("open_gate", { bundle_id: bundle?.bundle_id ?? null }, {
            reason: "bundle_review_budget_exhausted",
          }),
        ]);
      }
      return actionSet(snapshotId, progress, [
        envelope("dispatch_bundle_review", {
          bundle_id: bundle?.bundle_id ?? null,
          bundle_revision: bundle?.revision ?? null,
          bundle_hash: bundle?.bundle_hash ?? null,
        }),
      ]);
    }
    return actionSet(snapshotId, progress, [
      envelope("stop", {}, { reason: "bundle_review_ready" }),
    ]);
  }
  if (changeSet.phase === "terminal") {
    return actionSet(snapshotId, progress, [
      envelope("stop", {}, { reason: "change_set_not_working" }),
    ]);
  }
  if (changeSet.phase !== "running") {
    return actionSet(snapshotId, progress, [
      envelope("stop", {}, { reason: "plan_or_authority_changed" }),
    ]);
  }
  if (progress.elapsed.exhausted) {
    return actionSet(snapshotId, progress, [
      envelope("stop", {}, { reason: "elapsed_budget_exhausted" }),
    ]);
  }
  if ((changeSet.run_references ?? []).some((run) => run.status === "running")) {
    return actionSet(snapshotId, progress, [
      envelope("stop", {}, { reason: "run_active" }),
    ]);
  }

  const units = currentUnits(changeSet);
  const scheduledExecution = units.find(
    (unit) =>
      unit.phase === "execution" &&
      unit.candidate === null &&
      unit.last_error?.code === "PROVIDER_RETRY_SCHEDULED",
  );
  if (scheduledExecution) {
    const budget = progress.work_units.find(
      (item) => item.work_unit_id === scheduledExecution.work_unit_id,
    );
    if (budget.execution.exhausted) {
      return actionSet(snapshotId, progress, [
        envelope("open_gate", workUnitSubject(scheduledExecution), {
          reason: "execution_budget_exhausted",
        }),
      ]);
    }
    // Supervisor 只授权一次重试；授权落库后，实际派发是唯一的确定性下一步。
    return actionSet(snapshotId, progress, [
      envelope("dispatch_execution", workUnitSubject(scheduledExecution), {
        reason: "provider_retry_scheduled",
      }),
    ]);
  }
  const validationFailure = units.find(
    (unit) =>
      unit.phase === "verification" &&
      unit.candidate === null &&
      unit.last_error?.validation_attempt_id,
  );
  if (validationFailure) {
    const budget = progress.work_units.find(
      (item) => item.work_unit_id === validationFailure.work_unit_id,
    );
    const subject = workUnitSubject(validationFailure);
    const actions = [];
    if (!budget.verification.exhausted) {
      actions.push(
        envelope("retry_validation", subject, {
          reason: validationFailure.last_error.code,
        }),
      );
    }
    if (!budget.feedback.effective_exhausted) {
      actions.push(
        envelope("submit_feedback", subject, {
          feedback: validationFailureFeedback(validationFailure),
        }),
      );
    }
    actions.push(
      envelope("open_gate", subject, {
        reason: "validation_failure_requires_routing",
      }),
    );
    return actionSet(snapshotId, progress, actions);
  }

  const failedExecution = units.find(
    (unit) =>
      unit.phase === "execution" &&
      unit.candidate === null &&
      unit.last_error &&
      unit.run_references.some(
        (reference) =>
          reference.operation === "execution" &&
          ["failed", "interrupted", "cancelled"].includes(reference.status),
      ),
  );
  if (failedExecution) {
    const budget = progress.work_units.find(
      (item) => item.work_unit_id === failedExecution.work_unit_id,
    );
    const subject = workUnitSubject(failedExecution);
    const actions = [];
    if (
      !budget.execution.exhausted &&
      executionFailureIsRetryable(failedExecution.last_error.code)
    ) {
      actions.push(
        envelope("retry_execution", subject, {
          reason: failedExecution.last_error.code,
        }),
      );
    }
    actions.push(
      envelope("open_gate", subject, {
        reason: "execution_failure_requires_routing",
      }),
    );
    return actionSet(snapshotId, progress, actions);
  }

  const combinedFailure = unresolvedBlockers(changeSet).find(
    (blocker) => blocker.validation_subject_hash,
  );
  if (combinedFailure) {
    // 联合检查没有独立无限预算；复用 Plan 的验证上限，耗尽后只允许升级为人工 Gate。
    const combinedBudget = progress.combined_validation;
    if (combinedBudget.exhausted) {
      return actionSet(snapshotId, progress, [
        envelope(
          "open_gate",
          { validation_subject_hash: combinedFailure.validation_subject_hash },
          { reason: "combined_validation_budget_exhausted" },
        ),
      ]);
    }
    return actionSet(snapshotId, progress, [
      envelope(
        "validate_and_assemble_bundle",
        { validation_subject_hash: combinedFailure.validation_subject_hash },
        { reason: "retry_combined_validation" },
      ),
      envelope("open_gate", {}, {
        reason: "combined_validation_failure_requires_routing",
      }),
    ]);
  }

  const incomplete = units.filter((unit) => unit.phase !== "complete");
  if (incomplete.length === 0) {
    return actionSet(snapshotId, progress, [
      envelope("validate_and_assemble_bundle", {}, {}),
    ]);
  }
  const dispatchable = incomplete.filter(
    (unit) =>
      ["execution", "verification"].includes(unit.phase),
  );
  const readyExecution = dispatchable.find((unit) => unit.phase === "execution");
  if (readyExecution) {
    const budget = progress.work_units.find(
      (item) => item.work_unit_id === readyExecution.work_unit_id,
    );
    if (budget.execution.exhausted) {
      return actionSet(snapshotId, progress, [
        envelope("stop", workUnitSubject(readyExecution), {
          reason: "execution_budget_exhausted",
        }),
      ]);
    }
    return actionSet(snapshotId, progress, [
      envelope("dispatch_execution", workUnitSubject(readyExecution), {}),
    ]);
  }
  const readyVerification = dispatchable.find(
    (unit) => unit.phase === "verification",
  );
  if (readyVerification) {
    const budget = progress.work_units.find(
      (item) => item.work_unit_id === readyVerification.work_unit_id,
    );
    if (budget.verification.exhausted) {
      return actionSet(snapshotId, progress, [
        envelope("stop", workUnitSubject(readyVerification), {
          reason: "verification_budget_exhausted",
        }),
      ]);
    }
    return actionSet(snapshotId, progress, [
      envelope(
        "advance_work_unit_validation",
        workUnitSubject(readyVerification),
        {},
      ),
    ]);
  }
  return actionSet(snapshotId, progress, [
    envelope("open_gate", {}, { reason: "work_unit_not_dispatchable" }),
  ]);
}

export function deriveSupervisionProgress(changeSet, { now, plan = null } = {}) {
  const current = plan ?? currentPlan(changeSet);
  const limits = current?.supervision ?? normalizePlanSupervision(null);
  const elapsedMs = activeSupervisionTime(changeSet.supervision_control, now);
  const combinedAttempts = (changeSet.validation_attempts ?? []).filter(
    (attempt) => attempt.kind === "combined_validation",
  );
  const combinedSubject =
    unresolvedBlockers(changeSet)
      .map((blocker) => blocker.validation_subject_hash)
      .filter(Boolean)
      .at(-1) ?? combinedAttempts.at(-1)?.subject_id ?? null;
  const combinedAttemptCount = combinedSubject
    ? combinedAttempts.filter((attempt) => attempt.subject_id === combinedSubject)
        .length
    : 0;
  const bundle = (changeSet.bundles ?? []).at(-1) ?? null;
  const bundleReviewAttemptCount = bundle
    ? (changeSet.run_references ?? []).filter(
        (reference) =>
          reference.operation === "review" &&
          reference.bundle_id === bundle.bundle_id,
      ).length
    : 0;
  return {
    mode: current?.supervision?.mode ?? "manual",
    plan_revision: current?.revision ?? null,
    hold: structuredClone(changeSet.supervision_control?.hold ?? null),
    elapsed: {
      used_ms: elapsedMs,
      limit_ms: limits.elapsed_time_limit_ms,
      remaining_ms: Math.max(0, limits.elapsed_time_limit_ms - elapsedMs),
      exhausted: elapsedMs >= limits.elapsed_time_limit_ms,
    },
    combined_validation: {
      subject_id: combinedSubject,
      ...budgetCounter(
        combinedAttemptCount,
        limits.verification_attempt_limit_per_work_unit,
      ),
    },
    bundle_review: {
      bundle_id: bundle?.bundle_id ?? null,
      ...budgetCounter(
        bundleReviewAttemptCount,
        current?.bundle_review?.attempt_limit ?? 1,
      ),
    },
    work_units: currentUnits(changeSet).map((unit) => {
      const executionAttempts = unit.run_references.filter(
        (reference) => reference.operation === "execution",
      ).length;
      const verificationAttempts =
        unit.run_references.filter(
          (reference) => reference.operation === "verification",
        ).length + (unit.validation_attempt_ids ?? []).length;
      const feedbackCycles = unit.run_references.filter(
        (reference) =>
          reference.operation === "execution" &&
          reference.trigger === "feedback",
      ).length;
      const execution = budgetCounter(
        executionAttempts,
        limits.execution_attempt_limit_per_work_unit,
      );
      const feedback = budgetCounter(
        feedbackCycles,
        limits.feedback_cycle_limit_per_work_unit,
      );
      return {
        work_unit_id: unit.work_unit_id,
        execution,
        verification: budgetCounter(
          verificationAttempts,
          limits.verification_attempt_limit_per_work_unit,
        ),
        // Feedback Run 同时属于 execution Run；有效容量取两个独立上限的交集。
        feedback: {
          ...feedback,
          effective_remaining: Math.min(
            feedback.remaining,
            execution.remaining,
          ),
          effective_exhausted: feedback.exhausted || execution.exhausted,
          blocked_by: feedback.exhausted
            ? "feedback_cycle"
            : execution.exhausted
              ? "execution_attempt"
              : null,
        },
      };
    }),
  };
}

function activeSupervisionTime(control, now) {
  const accumulated = accumulatedSupervisionTime(control);
  if (
    control?.active_started_at === null ||
    control?.active_started_at === undefined
  ) {
    return accumulated;
  }
  const startedAt = Date.parse(
    supervisionTimestamp("active_started_at", control.active_started_at),
  );
  const observedAt = Date.parse(supervisionTimestamp("observed_at", now));
  return accumulated + Math.max(0, observedAt - startedAt);
}

function accumulatedSupervisionTime(control) {
  const elapsed = control?.active_elapsed_ms ?? 0;
  invariant(
    Number.isSafeInteger(elapsed) && elapsed >= 0,
    "INVALID_SUPERVISION_CLOCK",
    "Accumulated supervision time must be a non-negative integer",
  );
  return elapsed;
}

function supervisionTimestamp(label, value) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)),
    "INVALID_SUPERVISION_CLOCK",
    `Supervision ${label} must be an ISO timestamp`,
  );
  return value;
}

export function normalizeSupervisorDecisionProposal(
  input,
  { offeredActions, projectionDigest },
) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "INVALID_SUPERVISOR_PROPOSAL",
    "Supervisor decision proposal must be one object",
  );
  invariant(
    input.type === "supervisor_decision_proposal" &&
      typeof input.action_id === "string",
    "INVALID_SUPERVISOR_PROPOSAL",
    "Supervisor proposal requires one offered action id",
  );
  const action = offeredActions.find(
    (candidate) => candidate.action_id === input.action_id,
  );
  invariant(
    action,
    "SUPERVISOR_ACTION_NOT_OFFERED",
    "Supervisor selected an action outside the offered set",
  );
  invariant(
    input.projection_digest === projectionDigest,
    "STALE_SUPERVISOR_PROPOSAL",
    "Supervisor proposal does not bind the current projection",
  );
  invariant(
    Array.isArray(input.evidence_reference_ids) &&
      input.evidence_reference_ids.length <= SUPERVISOR_EVIDENCE_LIMIT &&
      input.evidence_reference_ids.every(
        (reference) => typeof reference === "string" && reference.length > 0,
      ),
    "INVALID_SUPERVISOR_PROPOSAL",
    "Supervisor evidence references are invalid",
  );
  return {
    type: input.type,
    action_id: action.action_id,
    projection_digest: projectionDigest,
    rationale: boundedString("rationale", input.rationale),
    expected_result: boundedString("expected_result", input.expected_result),
    evidence_reference_ids: [...input.evidence_reference_ids],
  };
}

export function actionRequiresSupervisor(actionSet) {
  return actionSet.actions.length > 1;
}

function createActionEnvelope({
  type,
  subject,
  details,
  snapshot,
  snapshotId,
  progress,
}) {
  invariant(ACTION_TYPES.has(type), "INVALID_SUPERVISION_ACTION", "Action type is invalid");
  const budgetDigest = sha256(budgetIdentity(progress));
  const identity = {
    snapshot_id: snapshotId,
    budget_identity: budgetDigest,
    type,
    subject,
    details,
  };
  return {
    action_id: stableId("supervision-action", identity),
    type,
    plan_revision: snapshot.plan_revision,
    repository_selection_revision: snapshot.repository_selection_revision,
    repository_harness_selection_revision:
      snapshot.repository_harness_selection_revision,
    subject: structuredClone(subject),
    preconditions: [
      `phase=${snapshot.phase}`,
      `plan_revision=${String(snapshot.plan_revision)}`,
      `snapshot=${snapshotId}`,
    ],
    budget_identity: budgetDigest,
    idempotency_key: stableId("supervision-command", identity),
    details: structuredClone(details),
  };
}

function exactSnapshot(changeSet, plan) {
  return {
    change_set_id: changeSet.change_set_id,
    phase: changeSet.phase,
    terminal_outcome: changeSet.terminal_outcome,
    plan_revision: changeSet.current_plan_revision,
    plan_status: plan?.status ?? null,
    supervision: structuredClone(plan?.supervision ?? null),
    bundle_review: structuredClone(plan?.bundle_review ?? null),
    repository_selection_revision:
      changeSet.current_repository_selection_revision,
    repository_harness_selection_revision:
      changeSet.current_repository_harness_selection_revision,
    work_units: currentUnits(changeSet).map((unit) => ({
      work_unit_id: unit.work_unit_id,
      phase: unit.phase,
      disposition: unit.disposition,
      candidate_checkpoint_id: unit.candidate_checkpoint_id,
      candidate_id: unit.candidate?.candidate_id ?? null,
      pending_feedback_id: unit.pending_feedback_id,
      last_error: structuredClone(unit.last_error),
      run_references: unit.run_references.map((reference) => ({
        run_id: reference.run_id,
        operation: reference.operation,
        trigger: reference.trigger,
        status: reference.status,
      })),
      validation_attempt_ids: [...(unit.validation_attempt_ids ?? [])],
    })),
    unresolved_blockers: unresolvedBlockers(changeSet).map((blocker) => ({
      code: blocker.code,
      work_unit_id: blocker.work_unit_id ?? null,
      validation_attempt_id: blocker.validation_attempt_id ?? null,
      validation_subject_hash: blocker.validation_subject_hash ?? null,
    })),
    open_gate_ids: (changeSet.gates ?? [])
      .filter((gate) => gate.status === "open")
      .map((gate) => gate.gate_id),
    bundle: structuredClone((changeSet.bundles ?? []).at(-1) ?? null),
    bundle_review_assessment: structuredClone(
      (changeSet.bundle_review_assessments ?? []).find(
        (assessment) =>
          assessment.assessment_id ===
          changeSet.current_bundle_review_assessment_id,
      ) ?? null,
    ),
    hold: structuredClone(changeSet.supervision_control?.hold ?? null),
  };
}

function budgetIdentity(progress) {
  return {
    mode: progress.mode,
    plan_revision: progress.plan_revision,
    hold: progress.hold,
    elapsed: {
      limit_ms: progress.elapsed.limit_ms,
      exhausted: progress.elapsed.exhausted,
    },
    combined_validation: progress.combined_validation,
    bundle_review: progress.bundle_review,
    work_units: progress.work_units,
  };
}

function actionSet(snapshotId, progress, actions) {
  return {
    snapshot_id: snapshotId,
    projection_digest: sha256({ snapshot_id: snapshotId, progress, actions }),
    progress,
    actions,
  };
}

function currentPlan(changeSet) {
  return (
    (changeSet.plans ?? []).find(
      (plan) => plan.revision === changeSet.current_plan_revision,
    ) ?? null
  );
}

function currentUnits(changeSet) {
  return (changeSet.work_units ?? []).filter(
    (unit) =>
      unit.plan_revision === changeSet.current_plan_revision &&
      unit.disposition === "current",
  );
}

function unresolvedBlockers(changeSet) {
  return (changeSet.blockers ?? []).filter(
    (blocker) => blocker.resolved_at === undefined,
  );
}

function workUnitSubject(unit) {
  return {
    work_unit_id: unit.work_unit_id,
    repository_id: unit.repository_id,
    checkpoint_id: unit.candidate_checkpoint_id,
    validation_attempt_id: unit.last_error?.validation_attempt_id ?? null,
  };
}

function validationFailureFeedback(unit) {
  return {
    summary: `Exact validation failed for WorkUnit ${unit.work_unit_id}.`,
    findings: [
      {
        finding_id: `validation-${unit.last_error.validation_attempt_id}`,
        text: `${unit.last_error.code}: ${unit.last_error.message}`,
      },
    ],
  };
}

function budgetCounter(used, limit) {
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
  };
}

function positiveInteger(label, value) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "INVALID_SUPERVISION_BUDGET",
    `${label} must be a positive integer`,
  );
  return value;
}

function assertAllowedKeys(input, keys, code) {
  // 策略字段本身就是授权面；未知字段必须失败，不能被静默忽略成似乎已经生效。
  const allowed = new Set(keys);
  invariant(
    Object.keys(input).every((key) => allowed.has(key)),
    code,
    "Supervision input contains an unsupported field",
  );
}

function boundedString(label, value) {
  invariant(
    typeof value === "string" &&
      value.trim().length > 0 &&
      Buffer.byteLength(value.trim()) <= SUPERVISOR_TEXT_BYTES,
    "INVALID_SUPERVISOR_PROPOSAL",
    `Supervisor ${label} is invalid`,
  );
  return value.trim();
}
