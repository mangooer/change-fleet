import {
  canonicalStringify,
  canonicalize,
  sha256,
  stableId,
} from "./canonical-json.js";
import { invariant } from "./errors.js";
import {
  createCheckIdentity,
  normalizeVerificationExpectation,
  normalizeVerificationPolicy,
  verificationReviewAllowsCandidate,
} from "./verification.js";
import { normalizePlanSupervision } from "./supervision.js";
import { normalizePlanBundleReview } from "./bundle-review.js";

// 领域模块保持纯函数：只验证输入与构造稳定身份，不读取 Git、文件或当前时间。
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HUMAN_DECISIONS = new Set(["accept", "reject", "request_revision"]);
const FEEDBACK_FINDING_LIMIT = 20;
const FEEDBACK_SUMMARY_BYTES = 2 * 1024;
const FEEDBACK_FINDING_BYTES = 2 * 1024;
const FEEDBACK_TOTAL_BYTES = 16 * 1024;
const FEEDBACK_ASSESSMENT_RATIONALE_BYTES = 1024;
const FEEDBACK_ASSESSMENT_TOTAL_BYTES = 16 * 1024;
const PLANNING_MESSAGE_BYTES = 16 * 1024;
const FEEDBACK_ASSESSMENT_DISPOSITIONS = new Set([
  "adopt",
  "adapt",
  "decline",
]);
const CHANGE_SET_CLOSURE_SUMMARY_BYTES = 2 * 1024;
const CHANGE_SET_CLOSURE_REASON_CODES = new Set([
  "no_longer_needed",
  "restart_on_new_base",
  "route_abandoned",
  "duplicate",
  "other",
]);

export function normalizeId(label, value) {
  invariant(
    typeof value === "string" && ID_PATTERN.test(value),
    "INVALID_ID",
    `${label} must match ${ID_PATTERN}`,
    { label, value },
  );
  return value;
}

export function normalizeChangeSetCloseRequest(input) {
  // 关闭是人工终态操作：严格字段集合可防止调用者误以为请求会复制或创建后继任务。
  assertExactFields(
    "ChangeSet close request",
    input,
    ["actor", "change_set_id", "idempotency_key", "reason"],
    "INVALID_CHANGE_SET_CLOSURE",
  );
  assertExactFields(
    "ChangeSet close reason",
    input.reason,
    ["code", "summary"],
    "INVALID_CHANGE_SET_CLOSURE",
  );
  invariant(
    CHANGE_SET_CLOSURE_REASON_CODES.has(input.reason.code),
    "INVALID_CHANGE_SET_CLOSURE",
    "ChangeSet close reason code is not supported",
  );
  return {
    idempotency_key: normalizeId("idempotency_key", input.idempotency_key),
    change_set_id: normalizeId("change_set_id", input.change_set_id),
    actor: normalizeId("actor", input.actor),
    reason: {
      code: input.reason.code,
      summary: boundedUtf8String(
        "reason.summary",
        input.reason.summary,
        CHANGE_SET_CLOSURE_SUMMARY_BYTES,
        "INVALID_CHANGE_SET_CLOSURE",
      ),
    },
  };
}

export function assertChangeSetMutable(state) {
  // abandoned 是不可逆业务终态；读和审计仍允许，所有后续变更必须失败关闭。
  invariant(
    !(
      state?.phase === "terminal" &&
      state?.terminal_outcome === "abandoned"
    ),
    "CHANGE_SET_ABANDONED",
    "Abandoned ChangeSet cannot be mutated",
    { change_set_id: state?.change_set_id ?? null },
  );
}

export function normalizeIntent(input, { revision, confirmedAt }) {
  invariant(
    input && typeof input === "object",
    "INVALID_INTENT",
    "ChangeIntent must be an object",
  );
  invariant(
    typeof input.objective === "string" && input.objective.trim().length > 0,
    "INVALID_INTENT",
    "ChangeIntent objective is required",
  );
  return {
    revision,
    objective: input.objective.trim(),
    rationale: normalizeOptionalString(input.rationale),
    constraints: normalizeStringArray(input.constraints),
    non_goals: normalizeStringArray(input.non_goals),
    acceptance_criteria: normalizeStringArray(input.acceptance_criteria),
    resolved_decisions: normalizeStringArray(input.resolved_decisions),
    open_questions: normalizeStringArray(input.open_questions),
    source: normalizeOptionalString(input.source),
    confirmed_at: confirmedAt,
  };
}

export function normalizeRepositorySelectionRequest(
  project,
  { planningRepositoryIds, repositorySelections },
) {
  // 领域层只规范化调用者表达的授权；当前分支和提交解析必须留给 Git 边界。
  const registeredRepositoryIds = new Set(
    project.repositories.map((repository) => repository.repository_id),
  );
  const requestedRepositoryIds =
    planningRepositoryIds === undefined
      ? [...registeredRepositoryIds]
      : normalizeIdArray(
          "planning_repository_ids",
          planningRepositoryIds,
        );
  invariant(
    requestedRepositoryIds.length > 0,
    "INVALID_REPOSITORY_SELECTION",
    "Repository selection requires at least one planning-visible Repository",
  );
  invariant(
    new Set(requestedRepositoryIds).size === requestedRepositoryIds.length,
    "INVALID_REPOSITORY_SELECTION",
    "Planning-visible Repository ids must be unique",
  );
  for (const repositoryId of requestedRepositoryIds) {
    invariant(
      registeredRepositoryIds.has(repositoryId),
      "REPOSITORY_NOT_REGISTERED",
      `Repository ${repositoryId} is not registered in this Project`,
      { repository_id: repositoryId },
    );
  }

  const rawSelections = repositorySelections ?? [];
  invariant(
    Array.isArray(rawSelections),
    "INVALID_REPOSITORY_SELECTION",
    "repository_selections must be an array",
  );
  const selectionsByRepository = new Map();
  for (const rawSelection of rawSelections) {
    invariant(
      rawSelection && typeof rawSelection === "object",
      "INVALID_REPOSITORY_SELECTION",
      "Each Repository selection must be an object",
    );
    const repositoryId = normalizeId(
      "repository_selection.repository_id",
      rawSelection.repository_id,
    );
    invariant(
      requestedRepositoryIds.includes(repositoryId),
      "REPOSITORY_NOT_PLANNING_VISIBLE",
      `Repository ${repositoryId} is not in the planning-visible set`,
      { repository_id: repositoryId },
    );
    invariant(
      !selectionsByRepository.has(repositoryId),
      "INVALID_REPOSITORY_SELECTION",
      `Repository ${repositoryId} has more than one selection`,
      { repository_id: repositoryId },
    );
    selectionsByRepository.set(repositoryId, {
      repository_id: repositoryId,
      branch_ref: normalizeOptionalSelectionRef(
        "repository_selection.branch_ref",
        rawSelection.branch_ref,
      ),
      target_ref: normalizeOptionalSelectionRef(
        "repository_selection.target_ref",
        rawSelection.target_ref,
      ),
    });
  }

  const repositoryIds = [...requestedRepositoryIds].sort();
  return {
    repository_ids: repositoryIds,
    repositories: repositoryIds.map(
      (repositoryId) =>
        selectionsByRepository.get(repositoryId) ?? {
          repository_id: repositoryId,
          branch_ref: null,
          target_ref: null,
        },
    ),
  };
}

export function normalizeCommand(
  input,
  label = "command",
  { defaultTimeoutMs = 120_000, maxTimeoutMs = 600_000 } = {},
) {
  invariant(
    input && typeof input === "object",
    "INVALID_COMMAND",
    `${label} is required`,
  );
  const command = {
    command_id: normalizeId(`${label}.command_id`, input.command_id),
    executable: requireString(`${label}.executable`, input.executable),
    argv: normalizeStringArray(input.argv),
    coverage_rationale: requireString(
      `${label}.coverage_rationale`,
      input.coverage_rationale,
    ),
    timeout_ms: normalizePositiveInteger(
      `${label}.timeout_ms`,
      input.timeout_ms,
      defaultTimeoutMs,
    ),
  };
  invariant(
    command.timeout_ms <= maxTimeoutMs,
    "VALIDATION_ATTEMPT_BUDGET_EXCEEDED",
    `${label}.timeout_ms exceeds the Project validation maximum`,
  );
  return command;
}

export function normalizeOptionalCommand(
  input,
  label = "command",
  options = {},
) {
  // null 表示计划明确判定当前没有适用的项目语义命令；不能用空对象或空命令冒充验证。
  return input === null ? null : normalizeCommand(input, label, options);
}

export function normalizePlanContent(
  input,
  {
    project,
    bases,
    intentRevision,
    repositorySelectionRevision,
    repositoryHarnessSelectionRevision,
    revisionFeedback = null,
  },
) {
  invariant(
    input && typeof input === "object",
    "INVALID_PLAN",
    "Runtime planning outcome must contain a plan object",
  );
  invariant(
    // 项目目录是授权上限，不是每次变更都必须覆盖的执行清单。
    Array.isArray(input.work_units) && input.work_units.length >= 1,
    "INVALID_PLAN",
    "A ChangePlan requires at least one WorkUnit",
  );
  invariant(
    Number.isSafeInteger(repositorySelectionRevision) &&
      repositorySelectionRevision > 0,
    "INVALID_REPOSITORY_SELECTION_REVISION",
    "A ChangePlan requires one positive Repository selection revision",
  );
  invariant(
    Number.isSafeInteger(repositoryHarnessSelectionRevision) &&
      repositoryHarnessSelectionRevision > 0,
    "INVALID_REPOSITORY_HARNESS_SELECTION_REVISION",
    "A ChangePlan requires one positive Repository Harness selection revision",
  );

  const authorizedRepositories = new Set(
    project.repositories.map((repository) => repository.repository_id),
  );
  const verificationPolicy = normalizeVerificationPolicy(
    project.verification_policy,
  );
  const seenUnits = new Set();
  const seenRepositories = new Set();
  const workUnits = input.work_units.map((workUnit) => {
    const workUnitId = normalizeId("work_unit_id", workUnit.work_unit_id);
    const repositoryId = normalizeId(
      "repository_id",
      workUnit.repository_id,
    );
    invariant(
      !seenUnits.has(workUnitId),
      "DUPLICATE_WORK_UNIT",
      `Duplicate WorkUnit id ${workUnitId}`,
    );
    invariant(
      authorizedRepositories.has(repositoryId),
      "SCOPE_EXPANSION_REQUIRED",
      `Repository ${repositoryId} is not authorized for this Project`,
      { requested_repository_id: repositoryId },
    );
    invariant(
      !seenRepositories.has(repositoryId),
      "DUPLICATE_REPOSITORY_WORK_UNIT",
      `The first slice allows one WorkUnit per Repository: ${repositoryId}`,
    );
    invariant(
      bases[repositoryId],
      "MISSING_FROZEN_BASE",
      `No frozen base exists for Repository ${repositoryId}`,
    );
    seenUnits.add(workUnitId);
    seenRepositories.add(repositoryId);
    return {
      work_unit_id: workUnitId,
      repository_id: repositoryId,
      task: requireString("work_unit.task", workUnit.task),
      dependencies: normalizeIdArray(
        "work_unit.dependencies",
        workUnit.dependencies,
      ),
      target_ref: bases[repositoryId].target_ref,
      base_sha: bases[repositoryId].base_sha,
      repository_selection_revision: repositorySelectionRevision,
      repository_harness_selection_revision:
        repositoryHarnessSelectionRevision,
      repository_check: normalizeOptionalCommand(
        workUnit.repository_check,
        `${workUnitId}.repository_check`,
        {
          defaultTimeoutMs: verificationPolicy.default_attempt_timeout_ms,
          maxTimeoutMs: verificationPolicy.max_attempt_timeout_ms,
        },
      ),
      repository_check_rationale: requireString(
        `${workUnitId}.repository_check_rationale`,
        workUnit.repository_check_rationale,
      ),
    };
  });

  validateDependencyGraph(workUnits);

  const plannedRepositories = [...seenRepositories].sort();
  invariant(
    plannedRepositories.length > 0,
    "INCOMPLETE_REPOSITORY_SCOPE",
    "A ChangePlan must cover at least one explicitly authorized Repository",
    { plannedRepositories },
  );

  return {
    intent_revision: intentRevision,
    repository_selection_revision: repositorySelectionRevision,
    repository_harness_selection_revision:
      repositoryHarnessSelectionRevision,
    rationale: normalizeOptionalString(input.rationale),
    // 人类反馈是待评估的审查主张；计划必须逐项记录判断，不能把它静默当成事实或忽略。
    revision_feedback_assessments: normalizeRevisionFeedbackAssessments(
      input.revision_feedback_assessments,
      revisionFeedback,
    ),
    work_units: workUnits,
    combined_check: normalizeOptionalCommand(
      input.combined_check,
      "combined_check",
      {
        defaultTimeoutMs: verificationPolicy.default_attempt_timeout_ms,
        maxTimeoutMs: verificationPolicy.max_attempt_timeout_ms,
      },
    ),
    combined_check_rationale: requireString(
      "combined_check_rationale",
      input.combined_check_rationale,
    ),
    verification_expectation: normalizeVerificationExpectation(
      input.verification_expectation,
    ),
    bundle_review: normalizePlanBundleReview(
      input.bundle_review,
      project.bundle_review_policy,
    ),
    supervision: normalizePlanSupervision(
      input.supervision,
      project.supervision_policy,
    ),
    risks: normalizeStringArray(input.risks),
    unverified_boundaries: normalizeStringArray(input.unverified_boundaries),
  };
}

export function createConfirmedPlan(
  content,
  {
    revision,
    confirmedAt,
    agentProfile,
    planningRunId,
    sourceMessageId,
    sourceContentDigest,
  },
) {
  // Plan revision 只在人工确认精确消息时创建；规划消息本身不占用 revision。
  invariant(
    Number.isSafeInteger(revision) && revision > 0,
    "INVALID_PLAN_REVISION",
    "A confirmed ChangePlan requires one positive revision",
  );
  normalizeId("planning_run_id", planningRunId);
  normalizeId("source_message_id", sourceMessageId);
  invariant(
    typeof sourceContentDigest === "string" &&
      /^[0-9a-f]{64}$/u.test(sourceContentDigest),
    "INVALID_PLAN_MESSAGE_DIGEST",
    "A confirmed ChangePlan requires the exact planning message digest",
  );
  return {
    revision,
    ...structuredClone(content),
    created_at: confirmedAt,
    status: "confirmed",
    confirmed_at: confirmedAt,
    agent_profile: structuredClone(agentProfile),
    planning_run_id: planningRunId,
    source_message_id: sourceMessageId,
    source_content_digest: sourceContentDigest,
  };
}

export function normalizePlanningMessageText(value, label = "message") {
  // 单次对话输入和输出都必须有界；完整历史留在 Run artifact，不进入启动上下文。
  return boundedUtf8String(
    label,
    value,
    PLANNING_MESSAGE_BYTES,
    "INVALID_PLANNING_MESSAGE",
  );
}

export function createValidationSubject(changeSet, plan, candidates) {
  const exactCandidates = candidates
    .map(candidateIdentity)
    .sort(compareByRepositoryId);
  const subject = {
    schema_version: 1,
    change_set_id: changeSet.change_set_id,
    plan_revision: plan.revision,
    candidates: exactCandidates,
    // 尝试超时不属于语义检查身份；未选择命令时，显式理由仍属于本次精确选择。
    required_check:
      plan.combined_check === null
        ? null
        : createCheckIdentity(plan.combined_check),
    check_selection_rationale: plan.combined_check_rationale,
  };
  return {
    ...subject,
    validation_subject_hash: sha256(subject),
  };
}

export function createCandidate({
  repositoryId,
  targetRef,
  baseSha,
  candidateSha,
  workspaceId,
  workspacePath,
  changedPaths,
  repositoryEvidence,
  verificationAdmissionId = null,
  verificationReviewId = null,
}) {
  const identity = {
    repository_id: repositoryId,
    target_ref: targetRef,
    base_sha: baseSha,
    candidate_sha: candidateSha,
  };
  return {
    candidate_id: stableId("candidate", identity),
    ...identity,
    workspace_id: workspaceId,
    workspace_path: workspacePath,
    changed_paths: [...changedPaths].sort(),
    repository_evidence: repositoryEvidence,
    verification_admission_id:
      verificationAdmissionId === null
        ? null
        : normalizeId("verification_admission_id", verificationAdmissionId),
    verification_review_id:
      verificationReviewId === null
        ? null
        : normalizeId("verification_review_id", verificationReviewId),
  };
}

export function createCandidateCheckpoint({
  changeSetId,
  intentRevision,
  planRevision,
  repositorySelectionRevision,
  repositoryHarnessSelectionRevision,
  workUnitId,
  repositoryId,
  targetRef,
  baseSha,
  candidateSha,
  workspaceId,
  workspacePath,
  changedPaths,
  sourceRunId,
  provenance = "automatic",
  createdAt,
}) {
  // Checkpoint 只冻结已发布 Git 主体；验证通过前不能借此获得 Candidate 权限。
  const identity = {
    change_set_id: normalizeId("change_set_id", changeSetId),
    intent_revision: requirePositiveInteger("intent_revision", intentRevision),
    plan_revision: requirePositiveInteger("plan_revision", planRevision),
    repository_selection_revision: requirePositiveInteger(
      "repository_selection_revision",
      repositorySelectionRevision,
    ),
    repository_harness_selection_revision: requirePositiveInteger(
      "repository_harness_selection_revision",
      repositoryHarnessSelectionRevision,
    ),
    work_unit_id: normalizeId("work_unit_id", workUnitId),
    repository_id: normalizeId("repository_id", repositoryId),
    target_ref: requireString("target_ref", targetRef),
    base_sha: requireCommitSha("base_sha", baseSha),
    candidate_sha: requireCommitSha("candidate_sha", candidateSha),
    workspace_id: normalizeId("workspace_id", workspaceId),
    source_run_id: normalizeId("source_run_id", sourceRunId),
  };
  invariant(
    provenance === "automatic",
    "INVALID_CANDIDATE_CHECKPOINT",
    "CandidateCheckpoint provenance is invalid",
  );
  return {
    schema_version: 1,
    checkpoint_id: stableId("candidate-checkpoint", identity),
    ...identity,
    workspace_path: requireString("workspace_path", workspacePath),
    changed_paths: normalizeUniqueStringArray(changedPaths),
    provenance,
    created_at: requireString("created_at", createdAt),
  };
}

export function createValidationAttempt({
  kind,
  subjectId,
  attempt,
  status,
  evidence,
  errorCode = null,
  checkIdentity,
  requestedBudget,
  effectiveBudget,
  budgetSource,
  budgetLimit,
  environmentIdentity,
  startedAt,
  completedAt,
}) {
  // 聚合只保存有界尝试索引；完整输出继续由不可变 EvidenceStore 外置。
  invariant(
    [
      "repository_validation",
      "combined_validation",
      "verification_check",
    ].includes(kind),
    "INVALID_VALIDATION_ATTEMPT",
    "Validation attempt kind is invalid",
  );
  invariant(
    status === "passed" || status === "failed",
    "INVALID_VALIDATION_ATTEMPT",
    "Validation attempt status is invalid",
  );
  validateEvidenceReference(evidence, "validation attempt evidence");
  const normalizedAttempt = requirePositiveInteger("attempt", attempt);
  const normalizedSubjectId = normalizeId("validation_subject_id", subjectId);
  const hasSemanticCheck = checkIdentity !== null;
  if (hasSemanticCheck) {
    invariant(
      checkIdentity?.check_identity_hash ===
        createCheckIdentity(checkIdentity).check_identity_hash,
      "INVALID_VALIDATION_ATTEMPT",
      "Validation attempt check identity is invalid",
    );
    validateAttemptBudgetMetadata({
      requestedBudget,
      effectiveBudget,
      budgetSource,
      budgetLimit,
      environmentIdentity,
    });
  } else {
    // 结构预检是真实的验证尝试，但没有项目命令，因此不能伪造命令身份或进程预算。
    invariant(
      requestedBudget === null &&
        effectiveBudget === null &&
        budgetSource === null &&
        budgetLimit === null,
      "INVALID_VALIDATION_ATTEMPT",
      "Structural validation cannot carry semantic command budget metadata",
    );
    validateValidationEnvironmentIdentity(environmentIdentity);
  }
  const startedMs = Date.parse(requireString("started_at", startedAt));
  const completedMs = Date.parse(requireString("completed_at", completedAt));
  invariant(
    Number.isFinite(startedMs) && Number.isFinite(completedMs) && completedMs >= startedMs,
    "INVALID_VALIDATION_ATTEMPT",
    "Validation attempt timestamps are invalid",
  );
  const identity = {
    kind,
    subject_id: normalizedSubjectId,
    attempt: normalizedAttempt,
    evidence_id: evidence.evidence_id,
    ...(hasSemanticCheck
      ? {
          check_identity_hash: checkIdentity.check_identity_hash,
          effective_budget: effectiveBudget,
        }
      : {}),
  };
  return {
    validation_attempt_id: stableId("validation-attempt", identity),
    kind,
    subject_id: normalizedSubjectId,
    attempt: normalizedAttempt,
    status,
    evidence: structuredClone(evidence),
    check_identity: structuredClone(checkIdentity),
    requested_budget: structuredClone(requestedBudget),
    effective_budget: structuredClone(effectiveBudget),
    budget_source:
      budgetSource === null
        ? null
        : requireString("budget_source", budgetSource),
    budget_limit: structuredClone(budgetLimit),
    environment_identity: structuredClone(environmentIdentity),
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: completedMs - startedMs,
    error_code: errorCode === null ? null : normalizeId("error_code", errorCode),
    created_at: completedAt,
  };
}

function validateAttemptBudgetMetadata({
  requestedBudget,
  effectiveBudget,
  budgetSource,
  budgetLimit,
  environmentIdentity,
}) {
  // 尝试记录必须自足，审计读取不需要重新解释当时的 Project 或 Plan 默认值。
  invariant(
    requestedBudget &&
      Object.keys(requestedBudget).length === 1 &&
      (requestedBudget.timeout_ms === null ||
        (Number.isSafeInteger(requestedBudget.timeout_ms) &&
          requestedBudget.timeout_ms > 0)),
    "INVALID_VALIDATION_ATTEMPT",
    "Validation attempt requested budget is invalid",
  );
  invariant(
    effectiveBudget &&
      Object.keys(effectiveBudget).length === 1 &&
      Number.isSafeInteger(effectiveBudget.timeout_ms) &&
      effectiveBudget.timeout_ms > 0,
    "INVALID_VALIDATION_ATTEMPT",
    "Validation attempt effective budget is invalid",
  );
  invariant(
    [
      "operator",
      "plan_default",
      "project_default",
      "verification_request",
    ].includes(budgetSource),
    "INVALID_VALIDATION_ATTEMPT",
    "Validation attempt budget source is invalid",
  );
  invariant(
    budgetLimit &&
      Object.keys(budgetLimit).length === 1 &&
      Number.isSafeInteger(budgetLimit.max_timeout_ms) &&
      budgetLimit.max_timeout_ms >= effectiveBudget.timeout_ms,
    "INVALID_VALIDATION_ATTEMPT",
    "Validation attempt budget limit is invalid",
  );
  validateValidationEnvironmentIdentity(environmentIdentity);
}

function validateValidationEnvironmentIdentity(environmentIdentity) {
  invariant(
    environmentIdentity &&
      ["platform", "architecture", "controller_node_version"].every(
        (key) =>
          typeof environmentIdentity[key] === "string" &&
          environmentIdentity[key].length > 0,
      ),
    "INVALID_VALIDATION_ATTEMPT",
    "Validation attempt environment identity is invalid",
  );
}

export function createCandidateBundle({
  changeSet,
  plan,
  candidates,
  combinedEvidence,
  createdAt,
}) {
  invariant(
    candidates.length === plan.work_units.length,
    "INCOMPLETE_CANDIDATE_SET",
    "CandidateBundle requires one Candidate for every current WorkUnit",
  );
  const expectedRepositories = plan.work_units
    .map((workUnit) => workUnit.repository_id)
    .sort();
  const candidateRepositories = candidates
    .map((candidate) => candidate.repository_id)
    .sort();
  invariant(
    JSON.stringify(expectedRepositories) ===
      JSON.stringify(candidateRepositories),
    "INCOMPLETE_CANDIDATE_SET",
    "CandidateBundle Candidate repositories do not match the current plan",
  );
  for (const candidate of candidates) {
    validateEvidenceReference(
      candidate.repository_evidence,
      `${candidate.repository_id} repository evidence`,
    );
    const admission = changeSet.verification_admissions.find(
      (item) => item.admission_id === candidate.verification_admission_id,
    );
    invariant(
      admission,
      "INVALID_VERIFICATION_ADMISSION",
      "Candidate must bind an available verification admission",
    );
    invariant(
      admission.mode !== "independent_review" ||
        candidate.verification_review_id !== null,
      "INVALID_VERIFICATION_REVIEW",
      "Independent review admission requires a passing review",
    );
    if (candidate.verification_review_id !== null) {
      const review = changeSet.verification_reviews.find(
        (item) => item.review_id === candidate.verification_review_id,
      );
      invariant(
        review &&
          review.admission_id === admission.admission_id &&
          review.subject.repository_id === candidate.repository_id &&
          review.subject.base_sha === candidate.base_sha &&
          review.subject.candidate_sha === candidate.candidate_sha &&
          verificationReviewAllowsCandidate(review),
        "INVALID_VERIFICATION_REVIEW",
        "Candidate independent review does not bind a passing exact subject",
      );
    }
  }
  validateEvidenceReference(combinedEvidence, "combined validation evidence");
  const sortedCandidates = [...candidates].sort(compareByRepositoryId);
  const revision = changeSet.bundles.length + 1;
  const identity = {
    schema_version: 1,
    change_set_id: changeSet.change_set_id,
    intent_revision: plan.intent_revision,
    plan_revision: plan.revision,
    revision,
    candidates: sortedCandidates.map((candidate) => ({
      ...candidateIdentity(candidate),
      candidate_id: candidate.candidate_id,
      repository_evidence: candidate.repository_evidence,
      verification_admission_id: candidate.verification_admission_id,
      verification_review_id: candidate.verification_review_id,
    })),
    combined_validation_evidence: combinedEvidence,
    missing_work_units: [],
    blocked_work_units: [],
    superseded_work_units: [],
    excluded_work_units: [],
    unverified_risks: [...plan.unverified_boundaries],
  };
  // 创建时间不属于审核主体，重算同一精确内容时 Bundle hash 必须保持不变。
  const bundleHash = sha256(identity);
  return {
    ...identity,
    bundle_id: stableId("bundle", { revision, bundleHash }),
    bundle_hash: bundleHash,
    created_at: createdAt,
  };
}

export function normalizeHumanDecision(value) {
  invariant(
    HUMAN_DECISIONS.has(value),
    "INVALID_HUMAN_DECISION",
    `Decision must be one of ${[...HUMAN_DECISIONS].join(", ")}`,
  );
  return value;
}

export function normalizeRevisionFeedback(input) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "INVALID_REVISION_FEEDBACK",
    "Request revision feedback must be one object",
  );
  const summary = boundedUtf8String(
    "revision_feedback.summary",
    input.summary,
    FEEDBACK_SUMMARY_BYTES,
  );
  invariant(
    Array.isArray(input.findings) &&
      input.findings.length >= 1 &&
      input.findings.length <= FEEDBACK_FINDING_LIMIT,
    "INVALID_REVISION_FEEDBACK",
    `Revision feedback requires 1-${FEEDBACK_FINDING_LIMIT} findings`,
  );
  const seen = new Set();
  const findings = input.findings.map((finding) => {
    invariant(
      finding && typeof finding === "object" && !Array.isArray(finding),
      "INVALID_REVISION_FEEDBACK",
      "Each revision finding must be one object",
    );
    const findingId = normalizeId("finding_id", finding.finding_id);
    invariant(
      !seen.has(findingId),
      "INVALID_REVISION_FEEDBACK",
      `Duplicate revision finding ${findingId}`,
    );
    seen.add(findingId);
    return {
      finding_id: findingId,
      text: boundedUtf8String(
        "revision_feedback.finding.text",
        finding.text,
        FEEDBACK_FINDING_BYTES,
      ),
    };
  });
  const normalized = { summary, findings };
  invariant(
    Buffer.byteLength(canonicalStringify(normalized)) <= FEEDBACK_TOTAL_BYTES,
    "INVALID_REVISION_FEEDBACK",
    `Revision feedback exceeds ${FEEDBACK_TOTAL_BYTES} bytes`,
  );
  return normalized;
}

export function normalizeRevisionFeedbackAssessments(input, feedback) {
  const findings = feedback?.findings ?? [];
  if (findings.length === 0) {
    invariant(
      input === undefined || (Array.isArray(input) && input.length === 0),
      "INVALID_PLAN",
      "A plan without revision feedback cannot contain feedback assessments",
    );
    return [];
  }

  invariant(
    Array.isArray(input) && input.length === findings.length,
    "INVALID_PLAN",
    "A revised plan must assess every current feedback finding exactly once",
  );
  const expectedIds = new Set(findings.map((finding) => finding.finding_id));
  const assessmentsById = new Map();
  for (const assessment of input) {
    assertExactFields(
      "Revision feedback assessment",
      assessment,
      ["disposition", "finding_id", "rationale"],
      "INVALID_PLAN",
    );
    const findingId = normalizeId(
      "revision_feedback_assessment.finding_id",
      assessment.finding_id,
    );
    invariant(
      expectedIds.has(findingId) && !assessmentsById.has(findingId),
      "INVALID_PLAN",
      `Revision feedback assessment ${findingId} is missing, unknown, or duplicated`,
    );
    invariant(
      FEEDBACK_ASSESSMENT_DISPOSITIONS.has(assessment.disposition),
      "INVALID_PLAN",
      "Revision feedback assessment disposition must be adopt, adapt, or decline",
    );
    assessmentsById.set(findingId, {
      finding_id: findingId,
      disposition: assessment.disposition,
      rationale: boundedUtf8String(
        "revision_feedback_assessment.rationale",
        assessment.rationale,
        FEEDBACK_ASSESSMENT_RATIONALE_BYTES,
        "INVALID_PLAN",
      ),
    });
  }

  // 按反馈原顺序持久化，确保同一语义不会因 Provider 输出顺序不同而改变计划身份。
  const normalized = findings.map((finding) =>
    assessmentsById.get(finding.finding_id),
  );
  invariant(
    Buffer.byteLength(canonicalStringify(normalized)) <=
      FEEDBACK_ASSESSMENT_TOTAL_BYTES,
    "INVALID_PLAN",
    `Revision feedback assessments exceed ${FEEDBACK_ASSESSMENT_TOTAL_BYTES} bytes`,
  );
  return normalized;
}

export function commandFingerprint(command, input) {
  return sha256({ command, input: canonicalize(input) });
}

export function candidateIdentity(candidate) {
  return {
    repository_id: candidate.repository_id,
    target_ref: candidate.target_ref,
    base_sha: candidate.base_sha,
    candidate_sha: candidate.candidate_sha,
  };
}

function validateDependencyGraph(workUnits) {
  const units = new Map(
    workUnits.map((workUnit) => [workUnit.work_unit_id, workUnit]),
  );
  for (const workUnit of workUnits) {
    for (const dependency of workUnit.dependencies) {
      invariant(
        units.has(dependency),
        "UNKNOWN_WORK_UNIT_DEPENDENCY",
        `${workUnit.work_unit_id} depends on unknown WorkUnit ${dependency}`,
      );
      invariant(
        dependency !== workUnit.work_unit_id,
        "WORK_UNIT_DEPENDENCY_CYCLE",
        `${workUnit.work_unit_id} cannot depend on itself`,
      );
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(workUnitId) {
    if (visited.has(workUnitId)) return;
    invariant(
      !visiting.has(workUnitId),
      "WORK_UNIT_DEPENDENCY_CYCLE",
      `WorkUnit dependency cycle includes ${workUnitId}`,
    );
    visiting.add(workUnitId);
    for (const dependency of units.get(workUnitId).dependencies) {
      visit(dependency);
    }
    visiting.delete(workUnitId);
    visited.add(workUnitId);
  }
  for (const workUnitId of units.keys()) visit(workUnitId);
}

function normalizeStringArray(value) {
  if (value === undefined) return [];
  invariant(Array.isArray(value), "INVALID_STRING_ARRAY", "Expected an array");
  return value.map((item) => requireString("array item", item));
}

function normalizeUniqueStringArray(value) {
  invariant(Array.isArray(value), "INVALID_STRING_ARRAY", "Expected an array");
  const normalized = value.map((item) => requireString("array item", item));
  invariant(
    new Set(normalized).size === normalized.length,
    "DUPLICATE_STRING",
    "String array cannot contain duplicates",
  );
  return normalized.sort();
}

function normalizeIdArray(label, value) {
  if (value === undefined) return [];
  invariant(Array.isArray(value), "INVALID_ID_ARRAY", `${label} must be an array`);
  const normalized = value.map((item) => normalizeId(label, item));
  invariant(
    new Set(normalized).size === normalized.length,
    "DUPLICATE_ID",
    `${label} cannot contain duplicates`,
  );
  return normalized;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null || value === "") return null;
  return requireString("value", value);
}

function normalizeOptionalSelectionRef(label, value) {
  // 显式给出的空 ref 是无效输入；只有真正省略时才允许应用层读取当前分支或默认目标。
  if (value === undefined || value === null) return null;
  invariant(
    typeof value === "string" && value.trim().length > 0,
    "INVALID_REPOSITORY_SELECTION",
    `${label} must be a non-empty string when provided`,
  );
  return value.trim();
}

function requireString(label, value) {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    "INVALID_STRING",
    `${label} must be a non-empty string`,
  );
  return value.trim();
}

function boundedUtf8String(
  label,
  value,
  maximumBytes,
  errorCode = "INVALID_REVISION_FEEDBACK",
) {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    errorCode,
    `${label} must be a non-empty string`,
  );
  const normalized = value.trim();
  invariant(
    Buffer.byteLength(normalized) <= maximumBytes,
    errorCode,
    `${label} exceeds ${maximumBytes} bytes`,
  );
  return normalized;
}

function assertExactFields(label, value, expectedFields, errorCode) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    errorCode,
    `${label} must be one object`,
  );
  const actualFields = Object.keys(value).sort();
  invariant(
    JSON.stringify(actualFields) === JSON.stringify(expectedFields),
    errorCode,
    `${label} fields are invalid`,
    { expected_fields: expectedFields, actual_fields: actualFields },
  );
}

function requirePositiveInteger(label, value) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "INVALID_POSITIVE_INTEGER",
    `${label} must be a positive integer`,
  );
  return value;
}

function requireCommitSha(label, value) {
  invariant(
    typeof value === "string" && /^[0-9a-f]{40}$/u.test(value),
    "INVALID_COMMIT_SHA",
    `${label} must be a full lowercase Git commit SHA`,
  );
  return value;
}

function normalizePositiveInteger(label, value, defaultValue) {
  if (value === undefined) return defaultValue;
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "INVALID_POSITIVE_INTEGER",
    `${label} must be a positive integer`,
  );
  return value;
}

function compareByRepositoryId(left, right) {
  return left.repository_id.localeCompare(right.repository_id);
}

function validateEvidenceReference(reference, label) {
  invariant(
    reference &&
      typeof reference.evidence_id === "string" &&
      /^[0-9a-f]{64}$/u.test(reference.evidence_hash),
    "MISSING_REQUIRED_EVIDENCE",
    `${label} must contain an immutable evidence id and SHA-256 hash`,
  );
}
