import { sha256, stableId } from "./canonical-json.js";
import { invariant } from "./errors.js";

export const VERIFICATION_ADMISSION_MODES = Object.freeze([
  "basic",
  "deterministic",
  "independent_review",
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
        : "plan_default",
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
