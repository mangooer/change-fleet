import { sha256, stableId } from "./canonical-json.js";
import { invariant } from "./errors.js";

export const VERIFICATION_ADMISSION_MODES = Object.freeze([
  "basic",
  "deterministic",
  "independent_review",
]);
export const VERIFICATION_REVIEW_DEPTHS = Object.freeze([
  "triage",
  "deep_review",
]);
export const VERIFICATION_VERDICTS = Object.freeze([
  "pass",
  "pass_with_notes",
  "changes_required",
  "human_decision_required",
]);

const MODE_RANK = new Map(
  VERIFICATION_ADMISSION_MODES.map((mode, index) => [mode, index]),
);
const ADMISSION_TRIGGERS = new Set([
  "scope_divergence",
  "unverified_boundaries",
]);
const DEFAULT_ATTEMPT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ATTEMPT_TIMEOUT_MS = 600_000;
const MAX_VERIFICATION_FINDINGS = 16;
const MAX_VERIFICATION_NOTES = 16;
const MAX_VERIFICATION_CHECKS = 8;
const MAX_VERIFICATION_OPTIONS = 8;

export function normalizeVerificationPolicy(input = {}) {
  // Project 策略只表达硬下限和资源边界，不尝试编码具体语言或文件的风险。
  const policy = input ?? {};
  invariant(
    isPlainObject(policy),
    "INVALID_VERIFICATION_POLICY",
    "Verification policy must be an object",
  );
  assertKnownFields(policy, [
    "minimum_mode",
    "default_attempt_timeout_ms",
    "max_attempt_timeout_ms",
    "escalation_triggers",
  ]);
  const defaultTimeout = positiveInteger(
    "default_attempt_timeout_ms",
    policy.default_attempt_timeout_ms ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
    "INVALID_VERIFICATION_POLICY",
  );
  const maximumTimeout = positiveInteger(
    "max_attempt_timeout_ms",
    policy.max_attempt_timeout_ms ?? DEFAULT_MAX_ATTEMPT_TIMEOUT_MS,
    "INVALID_VERIFICATION_POLICY",
  );
  invariant(
    defaultTimeout <= maximumTimeout,
    "INVALID_VERIFICATION_POLICY",
    "Default validation timeout cannot exceed the Project maximum",
  );
  return {
    minimum_mode: normalizeAdmissionMode(
      policy.minimum_mode ?? "basic",
      "INVALID_VERIFICATION_POLICY",
    ),
    default_attempt_timeout_ms: defaultTimeout,
    max_attempt_timeout_ms: maximumTimeout,
    escalation_triggers: normalizeTriggers(
      policy.escalation_triggers ?? ["scope_divergence"],
      "INVALID_VERIFICATION_POLICY",
    ),
  };
}

export function normalizeVerificationExpectation(input = undefined) {
  // 缺失值只用于读取旧 Plan；新 Runtime Schema 要求显式给出预期与理由。
  const expectation = input ?? {
    mode: "deterministic",
    rationale: "Legacy Plan keeps deterministic validation behavior.",
    escalation_triggers: ["scope_divergence"],
  };
  invariant(
    isPlainObject(expectation),
    "INVALID_VERIFICATION_EXPECTATION",
    "Verification expectation must be an object",
  );
  assertKnownFields(
    expectation,
    ["mode", "rationale", "escalation_triggers"],
    "INVALID_VERIFICATION_EXPECTATION",
  );
  invariant(
    typeof expectation.rationale === "string" &&
      expectation.rationale.trim().length > 0 &&
      Buffer.byteLength(expectation.rationale.trim(), "utf8") <= 2_048,
    "INVALID_VERIFICATION_EXPECTATION",
    "Verification expectation requires a bounded rationale",
  );
  return {
    mode: normalizeAdmissionMode(
      expectation.mode,
      "INVALID_VERIFICATION_EXPECTATION",
    ),
    rationale: expectation.rationale.trim(),
    escalation_triggers: normalizeTriggers(
      expectation.escalation_triggers,
      "INVALID_VERIFICATION_EXPECTATION",
    ),
  };
}

export function normalizeOperatorAdmissionMode(value) {
  return value === undefined || value === null
    ? null
    : normalizeAdmissionMode(value, "INVALID_VERIFICATION_ADMISSION");
}

export function createVerificationAdmissionDecision({
  checkpointId,
  projectPolicy,
  planExpectation,
  operatorMode = null,
  sourceReportedChangedPaths,
  actualChangedPaths,
  unverifiedBoundaries,
  createdAt,
}) {
  const policy = normalizeVerificationPolicy(projectPolicy);
  const expectation = normalizeVerificationExpectation(planExpectation);
  const requestedOperatorMode = normalizeOperatorAdmissionMode(operatorMode);
  const reportedPaths = normalizePaths(sourceReportedChangedPaths);
  const candidatePaths = normalizePaths(actualChangedPaths);
  const unresolvedBoundaries = Array.isArray(unverifiedBoundaries)
    ? unverifiedBoundaries.filter((item) => typeof item === "string")
    : [];
  const facts = {
    scope_divergence: !sameStringArray(reportedPaths, candidatePaths),
    unverified_boundaries: unresolvedBoundaries.length > 0,
  };
  const configuredTriggers = new Set([
    ...policy.escalation_triggers,
    ...expectation.escalation_triggers,
  ]);
  const triggeredEscalations = Object.entries(facts)
    .filter(([trigger, active]) => active && configuredTriggers.has(trigger))
    .map(([trigger]) => trigger)
    .sort();

  let mode = highestMode([
    policy.minimum_mode,
    expectation.mode,
    requestedOperatorMode,
  ]);
  if (triggeredEscalations.length > 0) mode = "independent_review";

  const reasons = [
    { code: "project_minimum", mode: policy.minimum_mode },
    { code: "plan_expectation", mode: expectation.mode },
  ];
  if (requestedOperatorMode !== null) {
    reasons.push({ code: "operator_request", mode: requestedOperatorMode });
  }
  for (const trigger of triggeredEscalations) {
    reasons.push({
      code: "triggered_escalation",
      trigger,
      mode: "independent_review",
    });
  }

  const identity = {
    checkpoint_id: normalizeCompactId(checkpointId),
    mode,
    project_policy: policy,
    plan_expectation: expectation,
    operator_mode: requestedOperatorMode,
    facts,
    reasons,
  };
  return {
    schema_version: 1,
    admission_id: stableId("verification-admission", identity),
    ...identity,
    created_at: requiredTimestamp(createdAt),
  };
}

export function createCheckIdentity(command) {
  const identity = {
    schema_version: 1,
    command_id: normalizeCompactId(command?.command_id),
    executable: requiredString("executable", command?.executable),
    argv: normalizeStringArray(command?.argv, "argv"),
    coverage_rationale: requiredString(
      "coverage_rationale",
      command?.coverage_rationale,
    ),
  };
  return {
    ...identity,
    check_identity_hash: sha256(identity),
  };
}

export function normalizeVerificationOutcome(
  input,
  { projectPolicy, existingCommandIds = [] },
) {
  // Verification 输出是控制输入而不是事实；先做严格边界归一化，再由确定性证据决定能否晋升。
  invariant(
    isPlainObject(input),
    "INVALID_VERIFICATION_OUTCOME",
    "Verification outcome must be an object",
  );
  assertKnownFields(
    input,
    [
      "type",
      "review_depth",
      "verdict",
      "summary",
      "findings",
      "notes",
      "human_decision",
      "requested_checks",
    ],
    "INVALID_VERIFICATION_OUTCOME",
  );
  invariant(
    input.type === "verification_completed",
    "INVALID_VERIFICATION_OUTCOME",
    "Verification outcome type must be verification_completed",
  );
  invariant(
    VERIFICATION_REVIEW_DEPTHS.includes(input.review_depth),
    "INVALID_VERIFICATION_OUTCOME",
    "Verification review depth must be triage or deep_review",
  );
  invariant(
    VERIFICATION_VERDICTS.includes(input.verdict),
    "INVALID_VERIFICATION_OUTCOME",
    "Verification verdict is invalid",
  );

  const findings = normalizeVerificationFindings(input.findings);
  const notes = normalizeVerificationNotes(input.notes);
  const humanDecision = normalizeVerificationHumanDecision(
    input.human_decision,
  );
  const requestedChecks = normalizeVerificationCheckRequests(
    input.requested_checks,
    {
      projectPolicy,
      existingCommandIds,
    },
  );

  if (input.verdict === "pass") {
    invariant(
      findings.length === 0 && notes.length === 0 && humanDecision === null,
      "INVALID_VERIFICATION_OUTCOME",
      "A pass verdict cannot contain findings, notes, or a human decision",
    );
  }
  if (input.verdict === "pass_with_notes") {
    invariant(
      findings.length === 0 && notes.length > 0 && humanDecision === null,
      "INVALID_VERIFICATION_OUTCOME",
      "pass_with_notes requires notes and cannot contain blocking findings",
    );
  }
  if (input.verdict === "changes_required") {
    invariant(
      findings.length > 0 && humanDecision === null && requestedChecks.length === 0,
      "INVALID_VERIFICATION_OUTCOME",
      "changes_required requires findings and cannot request conditional checks",
    );
  }
  if (input.verdict === "human_decision_required") {
    invariant(
      findings.length === 0 && humanDecision !== null && requestedChecks.length === 0,
      "INVALID_VERIFICATION_OUTCOME",
      "human_decision_required requires one bounded question",
    );
  }

  return {
    type: "verification_completed",
    review_depth: input.review_depth,
    verdict: input.verdict,
    summary: boundedString(
      "verification.summary",
      input.summary,
      4_096,
      "INVALID_VERIFICATION_OUTCOME",
    ),
    findings,
    notes,
    human_decision: humanDecision,
    requested_checks: requestedChecks,
  };
}

export function createVerificationReview({
  admissionId,
  checkpoint,
  runId,
  outcome,
  validationAttemptIds,
  checkStatus,
  reviewScope = "initial",
  sourceReviewId = null,
  correctionRunId = null,
  createdAt,
}) {
  // Review 只保存有界结论和不可变尝试引用；完整 Provider 证据继续留在 Run/EvidenceStore。
  invariant(
    ["not_required", "passed", "failed"].includes(checkStatus),
    "INVALID_VERIFICATION_REVIEW",
    "Verification check status is invalid",
  );
  invariant(
    Array.isArray(validationAttemptIds),
    "INVALID_VERIFICATION_REVIEW",
    "Verification review requires validation attempt references",
  );
  const attemptIds = validationAttemptIds.map((id) => normalizeCompactId(id));
  invariant(
    new Set(attemptIds).size === attemptIds.length,
    "INVALID_VERIFICATION_REVIEW",
    "Verification validation attempts must be unique",
  );
  invariant(
    outcome.requested_checks.length === 0
      ? checkStatus === "not_required"
      : ["passed", "failed"].includes(checkStatus) &&
          attemptIds.length > 0 &&
          attemptIds.length <= outcome.requested_checks.length,
    "INVALID_VERIFICATION_REVIEW",
    "Verification check status does not match requested checks",
  );
  invariant(
    reviewScope === "initial" || reviewScope === "focused",
    "INVALID_VERIFICATION_REVIEW",
    "Verification review scope must be initial or focused",
  );
  invariant(
    reviewScope === "initial"
      ? sourceReviewId === null && correctionRunId === null
      : typeof sourceReviewId === "string" &&
          typeof correctionRunId === "string",
    "INVALID_VERIFICATION_REVIEW",
    "Focused verification requires exact source review and correction Run lineage",
  );
  const subject = {
    repository_id: normalizeCompactId(checkpoint.repository_id),
    target_ref: requiredString("target_ref", checkpoint.target_ref),
    base_sha: requiredCommitSha("base_sha", checkpoint.base_sha),
    candidate_sha: requiredCommitSha(
      "candidate_sha",
      checkpoint.candidate_sha,
    ),
  };
  const identity = {
    admission_id: normalizeCompactId(admissionId),
    checkpoint_id: normalizeCompactId(checkpoint.checkpoint_id),
    run_id: normalizeCompactId(runId),
    subject,
    review_depth: outcome.review_depth,
    verdict: outcome.verdict,
    findings: outcome.findings,
    notes: outcome.notes,
    human_decision: outcome.human_decision,
    requested_checks: outcome.requested_checks.map(createCheckIdentity),
    validation_attempt_ids: attemptIds,
    check_status: checkStatus,
    review_scope: reviewScope,
    source_review_id:
      sourceReviewId === null ? null : normalizeCompactId(sourceReviewId),
    correction_run_id:
      correctionRunId === null ? null : normalizeCompactId(correctionRunId),
  };
  return {
    schema_version: 1,
    review_id: stableId("verification-review", identity),
    ...identity,
    summary: outcome.summary,
    created_at: requiredTimestamp(createdAt),
  };
}

export function verificationReviewAllowsCandidate(review) {
  return Boolean(
    review &&
      ["pass", "pass_with_notes"].includes(review.verdict) &&
      ["not_required", "passed"].includes(review.check_status),
  );
}

export function normalizeValidationAttemptBudgetRequests(input = []) {
  invariant(
    Array.isArray(input),
    "INVALID_VALIDATION_ATTEMPT_BUDGET",
    "Validation attempt budgets must be an array",
  );
  const seen = new Set();
  return input.map((request) => {
    invariant(
      isPlainObject(request),
      "INVALID_VALIDATION_ATTEMPT_BUDGET",
      "Each validation attempt budget must be an object",
    );
    assertKnownFields(
      request,
      ["kind", "work_unit_id", "command_id", "timeout_ms"],
      "INVALID_VALIDATION_ATTEMPT_BUDGET",
    );
    invariant(
      request.kind === "repository_validation" ||
        request.kind === "combined_validation",
      "INVALID_VALIDATION_ATTEMPT_BUDGET",
      "Validation attempt budget kind is invalid",
    );
    const workUnitId =
      request.kind === "repository_validation"
        ? normalizeCompactId(request.work_unit_id)
        : null;
    invariant(
      request.kind === "repository_validation" ||
        request.work_unit_id === null ||
        request.work_unit_id === undefined,
      "INVALID_VALIDATION_ATTEMPT_BUDGET",
      "Combined validation budget cannot name a WorkUnit",
    );
    const normalized = {
      kind: request.kind,
      work_unit_id: workUnitId,
      command_id: normalizeCompactId(request.command_id),
      timeout_ms: positiveInteger(
        "timeout_ms",
        request.timeout_ms,
        "INVALID_VALIDATION_ATTEMPT_BUDGET",
      ),
    };
    const selector = `${normalized.kind}:${workUnitId ?? "combined"}`;
    invariant(
      !seen.has(selector),
      "INVALID_VALIDATION_ATTEMPT_BUDGET",
      `Duplicate validation attempt budget for ${selector}`,
    );
    seen.add(selector);
    return normalized;
  });
}

export function selectValidationAttemptBudgetRequest(
  requests,
  { kind, workUnitId = null, commandId },
) {
  const match = requests.find(
    (request) =>
      request.kind === kind && request.work_unit_id === workUnitId,
  );
  if (!match) return null;
  invariant(
    match.command_id === commandId,
    "VALIDATION_CHECK_IDENTITY_MISMATCH",
    "Attempt budget does not name the unchanged validation check",
    { expected_command_id: commandId, requested_command_id: match.command_id },
  );
  return match;
}

export function assertValidationAttemptBudgetRequestsMatchPlan(requests, plan) {
  // 命令开始前一次性拒绝悬空选择器，避免调用者误以为预算已经作用于某个检查。
  for (const request of requests) {
    const command =
      request.kind === "combined_validation"
        ? plan.combined_check
        : plan.work_units.find(
            (unit) => unit.work_unit_id === request.work_unit_id,
          )?.repository_check;
    invariant(
      command,
      "INVALID_VALIDATION_ATTEMPT_BUDGET",
      "Validation attempt budget does not match a current Plan check",
    );
    invariant(
      command.command_id === request.command_id,
      "VALIDATION_CHECK_IDENTITY_MISMATCH",
      "Attempt budget does not name the unchanged validation check",
      {
        expected_command_id: command.command_id,
        requested_command_id: request.command_id,
      },
    );
  }
}

export function resolveValidationAttemptBudget({
  command,
  projectPolicy,
  request = null,
  commandSource = "plan_default",
}) {
  const policy = normalizeVerificationPolicy(projectPolicy);
  const planTimeout =
    command.timeout_ms ?? policy.default_attempt_timeout_ms;
  const effectiveTimeout = request?.timeout_ms ?? planTimeout;
  positiveInteger(
    "effective_timeout_ms",
    effectiveTimeout,
    "INVALID_VALIDATION_ATTEMPT_BUDGET",
  );
  invariant(
    effectiveTimeout <= policy.max_attempt_timeout_ms,
    "VALIDATION_ATTEMPT_BUDGET_EXCEEDED",
    "Validation attempt timeout exceeds the frozen Project maximum",
    {
      requested_timeout_ms: request?.timeout_ms ?? null,
      effective_timeout_ms: effectiveTimeout,
      max_timeout_ms: policy.max_attempt_timeout_ms,
    },
  );
  return {
    requested: {
      timeout_ms: request?.timeout_ms ?? null,
    },
    effective: {
      timeout_ms: effectiveTimeout,
    },
    source: request
      ? "operator"
      : command.timeout_ms === undefined
        ? "project_default"
        : commandSource,
    limit: {
      max_timeout_ms: policy.max_attempt_timeout_ms,
    },
  };
}

export function validationEnvironmentIdentity() {
  return {
    platform: process.platform,
    architecture: process.arch,
    controller_node_version: process.version,
  };
}

export function admissionModeAtLeast(left, right) {
  return modeRank(left) >= modeRank(right);
}

function highestMode(modes) {
  return modes.filter(Boolean).sort((left, right) => modeRank(right) - modeRank(left))[0];
}

function modeRank(mode) {
  invariant(
    MODE_RANK.has(mode),
    "INVALID_VERIFICATION_ADMISSION",
    `Unsupported verification admission mode ${String(mode)}`,
  );
  return MODE_RANK.get(mode);
}

function normalizeAdmissionMode(value, code) {
  invariant(
    MODE_RANK.has(value),
    code,
    `Unsupported verification admission mode ${String(value)}`,
  );
  return value;
}

function normalizeTriggers(input, code) {
  invariant(Array.isArray(input), code, "Escalation triggers must be an array");
  const triggers = input.map((trigger) => {
    invariant(
      ADMISSION_TRIGGERS.has(trigger),
      code,
      `Unsupported verification escalation trigger ${String(trigger)}`,
    );
    return trigger;
  });
  invariant(
    new Set(triggers).size === triggers.length,
    code,
    "Verification escalation triggers must be unique",
  );
  return triggers.sort();
}

function normalizePaths(input) {
  invariant(
    Array.isArray(input),
    "INVALID_VERIFICATION_ADMISSION",
    "Changed paths must be an array",
  );
  return [...new Set(input.map((item) => requiredString("changed_path", item).replaceAll("\\", "/")))].sort();
}

function normalizeStringArray(input, label) {
  invariant(Array.isArray(input), "INVALID_CHECK_IDENTITY", `${label} must be an array`);
  return input.map((item) => requiredString(label, item));
}

function normalizeVerificationFindings(input) {
  invariant(
    Array.isArray(input) && input.length <= MAX_VERIFICATION_FINDINGS,
    "INVALID_VERIFICATION_OUTCOME",
    `Verification findings must contain at most ${MAX_VERIFICATION_FINDINGS} items`,
  );
  const categories = new Set([
    "confirmed_intent",
    "repository_authority",
    "correctness",
    "security",
    "data",
    "compatibility",
    "scope",
    "evidence",
  ]);
  const seen = new Set();
  return input.map((finding) => {
    invariant(
      isPlainObject(finding),
      "INVALID_VERIFICATION_OUTCOME",
      "Each verification finding must be an object",
    );
    assertKnownFields(
      finding,
      ["finding_id", "category", "message", "path"],
      "INVALID_VERIFICATION_OUTCOME",
    );
    const findingId = normalizeCompactId(finding.finding_id);
    invariant(
      !seen.has(findingId) && categories.has(finding.category),
      "INVALID_VERIFICATION_OUTCOME",
      "Verification finding id or category is invalid",
    );
    seen.add(findingId);
    return {
      finding_id: findingId,
      category: finding.category,
      message: boundedString(
        "verification.finding.message",
        finding.message,
        4_096,
        "INVALID_VERIFICATION_OUTCOME",
      ),
      path: normalizeOptionalRelativePath(finding.path),
    };
  });
}

function normalizeVerificationNotes(input) {
  invariant(
    Array.isArray(input) && input.length <= MAX_VERIFICATION_NOTES,
    "INVALID_VERIFICATION_OUTCOME",
    `Verification notes must contain at most ${MAX_VERIFICATION_NOTES} items`,
  );
  const seen = new Set();
  return input.map((note) => {
    invariant(
      isPlainObject(note),
      "INVALID_VERIFICATION_OUTCOME",
      "Each verification note must be an object",
    );
    assertKnownFields(
      note,
      ["note_id", "message"],
      "INVALID_VERIFICATION_OUTCOME",
    );
    const noteId = normalizeCompactId(note.note_id);
    invariant(
      !seen.has(noteId),
      "INVALID_VERIFICATION_OUTCOME",
      "Verification note ids must be unique",
    );
    seen.add(noteId);
    return {
      note_id: noteId,
      message: boundedString(
        "verification.note.message",
        note.message,
        2_048,
        "INVALID_VERIFICATION_OUTCOME",
      ),
    };
  });
}

function normalizeVerificationHumanDecision(input) {
  if (input === null) return null;
  invariant(
    isPlainObject(input),
    "INVALID_VERIFICATION_OUTCOME",
    "Verification human decision must be an object or null",
  );
  assertKnownFields(
    input,
    ["question", "options"],
    "INVALID_VERIFICATION_OUTCOME",
  );
  invariant(
    Array.isArray(input.options) &&
      input.options.length >= 2 &&
      input.options.length <= MAX_VERIFICATION_OPTIONS,
    "INVALID_VERIFICATION_OUTCOME",
    `Verification human decision requires 2-${MAX_VERIFICATION_OPTIONS} options`,
  );
  const options = input.options.map((option) =>
    boundedString(
      "verification.human_decision.option",
      option,
      1_024,
      "INVALID_VERIFICATION_OUTCOME",
    ),
  );
  invariant(
    new Set(options).size === options.length,
    "INVALID_VERIFICATION_OUTCOME",
    "Verification human decision options must be unique",
  );
  return {
    question: boundedString(
      "verification.human_decision.question",
      input.question,
      4_096,
      "INVALID_VERIFICATION_OUTCOME",
    ),
    options,
  };
}

function normalizeVerificationCheckRequests(
  input,
  { projectPolicy, existingCommandIds },
) {
  invariant(
    Array.isArray(input) && input.length <= MAX_VERIFICATION_CHECKS,
    "INVALID_VERIFICATION_OUTCOME",
    `Verification requested checks must contain at most ${MAX_VERIFICATION_CHECKS} items`,
  );
  const policy = normalizeVerificationPolicy(projectPolicy);
  const reserved = new Set(existingCommandIds.map(normalizeCompactId));
  const seen = new Set();
  return input.map((command) => {
    invariant(
      isPlainObject(command),
      "INVALID_VERIFICATION_OUTCOME",
      "Each verification check request must be an object",
    );
    assertKnownFields(
      command,
      ["command_id", "executable", "argv", "coverage_rationale", "timeout_ms"],
      "INVALID_VERIFICATION_OUTCOME",
    );
    const commandId = normalizeCompactId(command.command_id);
    invariant(
      !reserved.has(commandId) && !seen.has(commandId),
      "INVALID_VERIFICATION_OUTCOME",
      "Verification check ids must be unique and additional to Plan checks",
    );
    seen.add(commandId);
    invariant(
      Array.isArray(command.argv) && command.argv.length <= 64,
      "INVALID_VERIFICATION_OUTCOME",
      "Verification check argv is invalid",
    );
    const argv = command.argv.map((argument) =>
      boundedString(
        "verification.check.argv",
        argument,
        4_096,
        "INVALID_VERIFICATION_OUTCOME",
        { allowEmpty: true },
      ),
    );
    invariant(
      Buffer.byteLength(JSON.stringify(argv), "utf8") <= 32_768,
      "INVALID_VERIFICATION_OUTCOME",
      "Verification check argv exceeds the total size limit",
    );
    const timeout =
      command.timeout_ms ?? policy.default_attempt_timeout_ms;
    positiveInteger(
      "verification.check.timeout_ms",
      timeout,
      "INVALID_VERIFICATION_OUTCOME",
    );
    invariant(
      timeout <= policy.max_attempt_timeout_ms,
      "INVALID_VERIFICATION_OUTCOME",
      "Verification check timeout exceeds the frozen Project maximum",
    );
    return {
      command_id: commandId,
      executable: boundedString(
        "verification.check.executable",
        command.executable,
        1_024,
        "INVALID_VERIFICATION_OUTCOME",
      ),
      argv,
      coverage_rationale: boundedString(
        "verification.check.coverage_rationale",
        command.coverage_rationale,
        2_048,
        "INVALID_VERIFICATION_OUTCOME",
      ),
      timeout_ms: timeout,
    };
  });
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function assertKnownFields(input, fields, code = "INVALID_VERIFICATION_POLICY") {
  const allowed = new Set(fields);
  invariant(
    Object.keys(input).every((field) => allowed.has(field)),
    code,
    "Verification input contains an unsupported field",
  );
}

function positiveInteger(label, value, code) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    code,
    `${label} must be a positive integer`,
  );
  return value;
}

function normalizeCompactId(value) {
  invariant(
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value),
    "INVALID_ID",
    "Identifier format is invalid",
  );
  return value;
}

function requiredString(label, value) {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    "INVALID_CHECK_IDENTITY",
    `${label} must be a non-empty string`,
  );
  return value.trim();
}

function boundedString(
  label,
  value,
  maximumBytes,
  code,
  { allowEmpty = false } = {},
) {
  invariant(
    typeof value === "string" && (allowEmpty || value.trim().length > 0),
    code,
    `${label} must be ${allowEmpty ? "a string" : "a non-empty string"}`,
  );
  const normalized = allowEmpty ? value : value.trim();
  invariant(
    Buffer.byteLength(normalized, "utf8") <= maximumBytes,
    code,
    `${label} exceeds ${maximumBytes} bytes`,
  );
  return normalized;
}

function normalizeOptionalRelativePath(value) {
  if (value === null) return null;
  const normalized = boundedString(
    "verification.finding.path",
    value,
    1_024,
    "INVALID_VERIFICATION_OUTCOME",
  ).replaceAll("\\", "/");
  invariant(
    !normalized.startsWith("/") &&
      !/^[A-Za-z]:/u.test(normalized) &&
      !normalized.split("/").includes(".."),
    "INVALID_VERIFICATION_OUTCOME",
    "Verification finding path must be repository-relative",
  );
  return normalized;
}

function requiredCommitSha(label, value) {
  invariant(
    typeof value === "string" && /^[0-9a-f]{40}$/u.test(value),
    "INVALID_VERIFICATION_REVIEW",
    `${label} must be a full lowercase Git commit SHA`,
  );
  return value;
}

function requiredTimestamp(value) {
  invariant(
    typeof value === "string" && value.length > 0,
    "INVALID_VERIFICATION_ADMISSION",
    "Verification admission requires a timestamp",
  );
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
