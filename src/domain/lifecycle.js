import { invariant } from "./errors.js";

export const CHANGE_SET_PHASES = Object.freeze([
  "planning",
  "running",
  "review",
  "terminal",
]);

export const CHANGE_SET_TERMINAL_OUTCOMES = Object.freeze([
  "done",
  "abandoned",
]);

export const WORK_UNIT_PHASES = Object.freeze([
  "execution",
  "verification",
  "complete",
]);

export const WORK_UNIT_DISPOSITIONS = Object.freeze([
  "current",
  "superseded",
  "excluded",
]);

export const AGENT_RUN_OPERATIONS = Object.freeze([
  "planning",
  "execution",
  "verification",
  "supervision",
  "review",
]);

export const AGENT_RUN_STATUSES = Object.freeze([
  "queued",
  "running",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);

export const RUN_TRIGGERS = Object.freeze([
  "initial",
  "feedback",
  "retry",
  "recovery",
]);

export const PRESENTATION_ACTIVITIES = Object.freeze([
  "ready",
  "running",
  "waiting",
  "blocked",
  "complete",
]);

const CHANGE_SET_PHASE_SET = new Set(CHANGE_SET_PHASES);
const TERMINAL_OUTCOME_SET = new Set(CHANGE_SET_TERMINAL_OUTCOMES);
const WORK_UNIT_PHASE_SET = new Set(WORK_UNIT_PHASES);
const WORK_UNIT_DISPOSITION_SET = new Set(WORK_UNIT_DISPOSITIONS);
const RUN_OPERATION_SET = new Set(AGENT_RUN_OPERATIONS);
const RUN_STATUS_SET = new Set(AGENT_RUN_STATUSES);
const RUN_TRIGGER_SET = new Set(RUN_TRIGGERS);
const CHANGE_SET_TRANSITIONS = Object.freeze({
  planning: new Set(["planning", "running", "terminal"]),
  running: new Set(["planning", "running", "review", "terminal"]),
  review: new Set(["running", "review", "terminal"]),
  terminal: new Set(["terminal"]),
});
const WORK_UNIT_TRANSITIONS = Object.freeze({
  execution: new Set(["execution", "verification"]),
  verification: new Set(["execution", "verification", "complete"]),
  complete: new Set(["execution", "complete"]),
});
const RUN_STATUS_TRANSITIONS = Object.freeze({
  queued: new Set(["queued", "running", "interrupted", "cancelled"]),
  running: new Set([
    "running",
    "completed",
    "failed",
    "interrupted",
    "cancelled",
  ]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  interrupted: new Set(["interrupted"]),
  cancelled: new Set(["cancelled"]),
});

// 生命周期字段只表达正交事实；等待、阻塞和失败由关联记录投影，不能再拼进 phase 名称。
export function assertChangeSetLifecycle(changeSet) {
  invariant(
    CHANGE_SET_PHASE_SET.has(changeSet?.phase),
    "INVALID_CHANGE_SET_PHASE",
    `ChangeSet phase is invalid: ${String(changeSet?.phase)}`,
  );
  invariant(
    changeSet.phase === "terminal"
      ? TERMINAL_OUTCOME_SET.has(changeSet.terminal_outcome)
      : changeSet.terminal_outcome === null,
    "INVALID_CHANGE_SET_PHASE",
    "Only a terminal ChangeSet may carry one terminal outcome",
  );
}

export function assertWorkUnitLifecycle(workUnit) {
  invariant(
    WORK_UNIT_PHASE_SET.has(workUnit?.phase),
    "INVALID_WORK_UNIT_PHASE",
    `WorkUnit phase is invalid: ${String(workUnit?.phase)}`,
  );
  invariant(
    WORK_UNIT_DISPOSITION_SET.has(workUnit?.disposition),
    "INVALID_WORK_UNIT_DISPOSITION",
    `WorkUnit disposition is invalid: ${String(workUnit?.disposition)}`,
  );
}

export function assertAgentRunLifecycle(run) {
  invariant(
    RUN_OPERATION_SET.has(run?.operation),
    "INVALID_RUN_OPERATION",
    `Run operation is invalid: ${String(run?.operation)}`,
  );
  invariant(
    RUN_STATUS_SET.has(run?.status),
    "INVALID_RUN_STATUS",
    `Run status is invalid: ${String(run?.status)}`,
  );
  invariant(
    RUN_TRIGGER_SET.has(run?.trigger),
    "INVALID_RUN_TRIGGER",
    `Run trigger is invalid: ${String(run?.trigger)}`,
  );
}

export function setChangeSetPhase(changeSet, phase, terminalOutcome = null) {
  const previousPhase = changeSet.phase;
  invariant(
    CHANGE_SET_TRANSITIONS[previousPhase]?.has(phase) ?? false,
    "INVALID_CHANGE_SET_TRANSITION",
    `ChangeSet cannot move from ${String(previousPhase)} to ${String(phase)}`,
  );
  invariant(
    phase !== "terminal" ||
      terminalOutcome === "abandoned" ||
      previousPhase === "review" ||
      (previousPhase === "terminal" &&
        changeSet.terminal_outcome === terminalOutcome),
    "INVALID_CHANGE_SET_TRANSITION",
    "Only an accepted review with completed delivery may produce terminal done",
  );
  changeSet.phase = phase;
  changeSet.terminal_outcome = terminalOutcome;
  assertChangeSetLifecycle(changeSet);
}

export function setWorkUnitPhase(workUnit, phase) {
  const previousPhase = workUnit.phase;
  invariant(
    WORK_UNIT_TRANSITIONS[previousPhase]?.has(phase) ?? false,
    "INVALID_WORK_UNIT_TRANSITION",
    `WorkUnit cannot move from ${String(previousPhase)} to ${String(phase)}`,
  );
  workUnit.phase = phase;
  assertWorkUnitLifecycle(workUnit);
}

export function supersedeWorkUnit(workUnit) {
  workUnit.disposition = "superseded";
  assertWorkUnitLifecycle(workUnit);
}

export function isCurrentWorkUnit(workUnit) {
  return workUnit?.disposition === "current";
}

export function currentWorkUnits(changeSet) {
  return (changeSet?.work_units ?? []).filter(isCurrentWorkUnit);
}

export function currentPlanWorkUnits(state) {
  return (state.work_units ?? []).filter(
    (workUnit) =>
      workUnit.plan_revision === state.current_plan_revision &&
      workUnit.disposition === "current",
  );
}

export function runReferenceIsActive(reference) {
  return ["queued", "running"].includes(reference?.status);
}

export function createRunReference({
  runId,
  operation,
  trigger,
  attempt = undefined,
  status = "running",
  ...extra
}) {
  // 扩展字段先写入，随后由权威身份和生命周期字段覆盖，调用者不能伪造 Run 引用。
  const reference = {
    ...extra,
    run_id: runId,
    operation,
    trigger,
    ...(attempt === undefined ? {} : { attempt }),
    status,
  };
  assertAgentRunLifecycle(reference);
  return reference;
}

export function createAgentRunRecord({
  runId,
  changeSetId,
  workUnitId,
  operation,
  trigger,
  attempt,
  agentProfile,
  continuationOfRunId,
  repositoryHarnessSelection,
  repositoryHarnessObservation,
  contextEvidence,
  contextProjectionIdentity,
  createdAt,
  extra = {},
}) {
  // operation 专属字段可以扩展记录，但不得覆盖通用 Run 身份、状态或证据槽位。
  const run = {
    ...extra,
    schema_version: 1,
    run_id: runId,
    change_set_id: changeSetId,
    work_unit_id: workUnitId,
    operation,
    trigger,
    continuation_of_run_id: continuationOfRunId,
    attempt,
    status: "running",
    agent_profile: agentProfile,
    repository_harness_selection: repositoryHarnessSelection,
    repository_harness_observation: repositoryHarnessObservation,
    context_evidence: contextEvidence,
    context_projection_identity: contextProjectionIdentity,
    runtime_evidence: null,
    created_at: createdAt,
    completed_at: null,
    outcome: null,
  };
  assertAgentRunLifecycle(run);
  return run;
}

export function assertAgentRunTransition(previous, next) {
  assertAgentRunLifecycle(next);
  invariant(
    previous.operation === next.operation &&
      previous.trigger === next.trigger &&
      previous.run_id === next.run_id,
    "INVALID_RUN_TRANSITION",
    "Run identity, operation, and trigger are immutable",
  );
  invariant(
    RUN_STATUS_TRANSITIONS[previous.status]?.has(next.status) ?? false,
    "INVALID_RUN_TRANSITION",
    `Run cannot move from ${String(previous.status)} to ${String(next.status)}`,
  );
}

// 普通界面状态完全由权威事实派生，不会反向写回聚合。
export function derivePresentationActivity(changeSet, workUnit = null) {
  if (changeSet.phase === "terminal") return "complete";
  const runReferences = workUnit?.run_references ?? changeSet.run_references ?? [];
  if (runReferences.some(runReferenceIsActive)) return "running";
  const subjectId = workUnit?.work_unit_id ?? null;
  if (
    (changeSet.gates ?? []).some(
      (gate) =>
        gate.status === "open" &&
        (subjectId === null || gate.work_unit_id === subjectId),
    )
  ) {
    return "waiting";
  }
  if (
    (changeSet.blockers ?? []).some(
      (blocker) =>
        blocker.resolved_at == null &&
        (subjectId === null || blocker.work_unit_id === subjectId),
    )
  ) {
    return "blocked";
  }
  if (workUnit?.phase === "complete") return "complete";
  return "ready";
}
