import { sha256, stableId } from "./canonical-json.js";
import { invariant } from "./errors.js";

export const BUNDLE_REVIEW_MODES = Object.freeze(["none", "independent"]);

export const DEFAULT_BUNDLE_REVIEW_POLICY = Object.freeze({
  default_mode: "none",
  default_agent_profile_id: null,
  default_agent_profile_revision: null,
  max_attempts: 2,
});

const DISPOSITIONS = new Set(["pass", "feedback", "gate"]);
const SEVERITIES = new Set(["blocking", "advisory"]);
const CATEGORIES = new Set([
  "confirmed_intent",
  "cross_repository",
  "correctness",
  "security",
  "data",
  "compatibility",
  "scope",
  "evidence",
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FINDING_LIMIT = 16;
const EVIDENCE_LIMIT = 16;
const TEXT_BYTES = 2 * 1024;
const TOTAL_TEXT_BYTES = 16 * 1024;

// Project 只声明默认值和硬上限；缺省策略绝不静默启动会产生费用的 Review Runtime。
export function normalizeBundleReviewPolicy(input = null) {
  const policy = input ?? {};
  invariant(
    isPlainObject(policy),
    "INVALID_BUNDLE_REVIEW_POLICY",
    "Project Bundle review policy must be one object",
  );
  assertAllowedKeys(policy, [
    "default_mode",
    "default_agent_profile_id",
    "default_agent_profile_revision",
    "max_attempts",
  ], "INVALID_BUNDLE_REVIEW_POLICY");
  const normalized = {
    default_mode:
      policy.default_mode ?? DEFAULT_BUNDLE_REVIEW_POLICY.default_mode,
    default_agent_profile_id: optionalId(
      "default_agent_profile_id",
      policy.default_agent_profile_id ??
        DEFAULT_BUNDLE_REVIEW_POLICY.default_agent_profile_id,
      "INVALID_BUNDLE_REVIEW_POLICY",
    ),
    default_agent_profile_revision: optionalPositiveInteger(
      "default_agent_profile_revision",
      policy.default_agent_profile_revision ??
        DEFAULT_BUNDLE_REVIEW_POLICY.default_agent_profile_revision,
      "INVALID_BUNDLE_REVIEW_POLICY",
    ),
    max_attempts: positiveInteger(
      "max_attempts",
      policy.max_attempts ?? DEFAULT_BUNDLE_REVIEW_POLICY.max_attempts,
      "INVALID_BUNDLE_REVIEW_POLICY",
    ),
  };
  invariant(
    BUNDLE_REVIEW_MODES.includes(normalized.default_mode),
    "INVALID_BUNDLE_REVIEW_POLICY",
    "Project Bundle review default mode is invalid",
  );
  invariant(
    (normalized.default_agent_profile_id === null) ===
      (normalized.default_agent_profile_revision === null),
    "INVALID_BUNDLE_REVIEW_POLICY",
    "Project Bundle review AgentProfile id and revision must be configured together",
  );
  invariant(
    normalized.default_mode === "none" ||
      (normalized.default_agent_profile_id !== null &&
        normalized.default_agent_profile_revision !== null),
    "INVALID_BUNDLE_REVIEW_POLICY",
    "Independent Bundle review requires one default AgentProfile id",
  );
  return normalized;
}

// Plan 冻结本次真正授权的模式、Profile 和尝试数；迁移输入可显式强制 none。
export function normalizePlanBundleReview(input = null, projectPolicy = null) {
  const policy = normalizeBundleReviewPolicy(projectPolicy);
  const requested = input ?? {};
  invariant(
    isPlainObject(requested),
    "INVALID_PLAN_BUNDLE_REVIEW",
    "Plan Bundle review must be one object",
  );
  assertAllowedKeys(requested, [
    "mode",
    "agent_profile_id",
    "agent_profile_revision",
    "attempt_limit",
  ], "INVALID_PLAN_BUNDLE_REVIEW");
  const mode = requested.mode ?? policy.default_mode;
  invariant(
    BUNDLE_REVIEW_MODES.includes(mode),
    "INVALID_PLAN_BUNDLE_REVIEW",
    "Plan Bundle review mode is invalid",
  );
  const agentProfileId = optionalId(
    "agent_profile_id",
    requested.agent_profile_id ?? policy.default_agent_profile_id,
    "INVALID_PLAN_BUNDLE_REVIEW",
  );
  const attemptLimit = positiveInteger(
    "attempt_limit",
    requested.attempt_limit ?? policy.max_attempts,
    "INVALID_PLAN_BUNDLE_REVIEW",
  );
  const agentProfileRevision = optionalPositiveInteger(
    "agent_profile_revision",
    requested.agent_profile_revision ??
      policy.default_agent_profile_revision,
    "INVALID_PLAN_BUNDLE_REVIEW",
  );
  invariant(
    attemptLimit <= policy.max_attempts,
    "BUNDLE_REVIEW_BUDGET_EXCEEDS_PROJECT_POLICY",
    "Plan Bundle review attempt limit exceeds the Project ceiling",
  );
  if (mode === "none") {
    invariant(
      requested.agent_profile_id === undefined ||
        requested.agent_profile_id === null,
      "INVALID_PLAN_BUNDLE_REVIEW",
      "Disabled Bundle review cannot select an AgentProfile",
    );
    invariant(
      requested.agent_profile_revision === undefined ||
        requested.agent_profile_revision === null,
      "INVALID_PLAN_BUNDLE_REVIEW",
      "Disabled Bundle review cannot select an AgentProfile revision",
    );
    return {
      mode,
      agent_profile_id: null,
      agent_profile_revision: null,
      attempt_limit: attemptLimit,
    };
  }
  invariant(
    agentProfileId !== null &&
      agentProfileRevision !== null &&
      agentProfileId === policy.default_agent_profile_id &&
      agentProfileRevision === policy.default_agent_profile_revision,
    "INVALID_PLAN_BUNDLE_REVIEW",
    "Independent Bundle review must use the Project-authorized AgentProfile",
  );
  return {
    mode,
    agent_profile_id: agentProfileId,
    agent_profile_revision: agentProfileRevision,
    attempt_limit: attemptLimit,
  };
}

// Runtime 输出先在领域层收紧，再允许应用层写入 Feedback、Gate 或通过建议。
export function normalizeBundleReviewOutcome(
  input,
  { bundle, plan, workUnits, evidenceReferenceIds = null },
) {
  invariant(
    isPlainObject(input) && input.type === "bundle_review_completed",
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    "Bundle review must return bundle_review_completed",
  );
  assertAllowedKeys(input, [
    "type",
    "disposition",
    "summary",
    "findings",
    "human_decision",
  ], "INVALID_BUNDLE_REVIEW_OUTCOME");
  invariant(
    DISPOSITIONS.has(input.disposition),
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    "Bundle review disposition is invalid",
  );
  invariant(
    Array.isArray(input.findings) && input.findings.length <= FINDING_LIMIT,
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    "Bundle review findings exceed the bounded limit",
  );
  const workUnitsById = new Map(
    workUnits.map((unit) => [unit.work_unit_id, unit]),
  );
  const bundleRepositories = new Set(
    bundle.candidates.map((candidate) => candidate.repository_id),
  );
  const findingIds = new Set();
  const allowedEvidenceReferences = new Set(
    evidenceReferenceIds ?? bundleEvidenceReferenceIds(bundle),
  );
  const findings = input.findings.map((finding) => {
    invariant(
      isPlainObject(finding),
      "INVALID_BUNDLE_REVIEW_OUTCOME",
      "Each Bundle review finding must be one object",
    );
    assertAllowedKeys(finding, [
      "finding_id",
      "severity",
      "category",
      "message",
      "evidence_reference_ids",
      "repository_ids",
      "work_unit_ids",
    ], "INVALID_BUNDLE_REVIEW_OUTCOME");
    const findingId = requiredId(
      "finding_id",
      finding.finding_id,
      "INVALID_BUNDLE_REVIEW_OUTCOME",
    );
    invariant(
      !findingIds.has(findingId),
      "INVALID_BUNDLE_REVIEW_OUTCOME",
      "Bundle review finding ids must be unique",
    );
    findingIds.add(findingId);
    invariant(
      SEVERITIES.has(finding.severity) && CATEGORIES.has(finding.category),
      "INVALID_BUNDLE_REVIEW_OUTCOME",
      "Bundle review finding severity or category is invalid",
    );
    const repositoryIds = boundedIdArray(
      "repository_ids",
      finding.repository_ids,
    );
    const workUnitIds = boundedIdArray(
      "work_unit_ids",
      finding.work_unit_ids,
    );
    invariant(
      repositoryIds.every((id) => bundleRepositories.has(id)) &&
        workUnitIds.every((id) => workUnitsById.has(id)),
      "INVALID_BUNDLE_REVIEW_OUTCOME",
      "Bundle review finding targets an unauthorized subject",
    );
    for (const workUnitId of workUnitIds) {
      invariant(
        repositoryIds.includes(workUnitsById.get(workUnitId).repository_id),
        "INVALID_BUNDLE_REVIEW_OUTCOME",
        "Bundle review WorkUnit target must include its Repository target",
      );
    }
    const evidenceReferences = boundedReferenceArray(
      finding.evidence_reference_ids,
    );
    invariant(
      evidenceReferences.every((id) => allowedEvidenceReferences.has(id)),
      "INVALID_BUNDLE_REVIEW_OUTCOME",
      "Bundle review finding cites evidence outside the exact review subject",
    );
    return {
      finding_id: findingId,
      severity: finding.severity,
      category: finding.category,
      message: boundedString("finding.message", finding.message),
      evidence_reference_ids: evidenceReferences,
      repository_ids: repositoryIds,
      work_unit_ids: workUnitIds,
    };
  });
  const blocking = findings.filter((finding) => finding.severity === "blocking");
  const humanDecision = normalizeHumanDecision(input.human_decision);
  if (input.disposition === "pass") {
    invariant(
      blocking.length === 0 && humanDecision === null,
      "INVALID_BUNDLE_REVIEW_OUTCOME",
      "A passage recommendation cannot contain blocking findings or a Gate",
    );
  } else if (input.disposition === "feedback") {
    invariant(
      blocking.length > 0 &&
        blocking.every((finding) => finding.work_unit_ids.length > 0) &&
        humanDecision === null,
      "INVALID_BUNDLE_REVIEW_OUTCOME",
      "Feedback requires blocking findings with exact WorkUnit targets",
    );
  } else {
    invariant(
      humanDecision !== null,
      "INVALID_BUNDLE_REVIEW_OUTCOME",
      "A Bundle review Gate requires one bounded human decision",
    );
  }
  const summary = boundedString("summary", input.summary);
  invariant(
    Buffer.byteLength(summary, "utf8") +
        findings.reduce(
          (total, finding) =>
            total + Buffer.byteLength(finding.message, "utf8"),
          0,
        ) <=
      TOTAL_TEXT_BYTES,
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    "Bundle review text exceeds the total bounded size",
  );
  return {
    type: "bundle_review_completed",
    disposition: input.disposition,
    summary,
    findings,
    human_decision: humanDecision,
    subject: createBundleReviewSubject({ bundle, plan }),
  };
}

export function createBundleReviewSubject({ bundle, plan }) {
  const subject = {
    schema_version: 1,
    plan_revision: plan.revision,
    bundle_id: bundle.bundle_id,
    bundle_revision: bundle.revision,
    bundle_hash: bundle.bundle_hash,
    candidates: bundle.candidates
      .map((candidate) => ({
        repository_id: candidate.repository_id,
        base_sha: candidate.base_sha,
        candidate_sha: candidate.candidate_sha,
      }))
      .sort((left, right) =>
        left.repository_id.localeCompare(right.repository_id),
      ),
  };
  return { ...subject, subject_digest: sha256(subject) };
}

export function createBundleReviewAssessment({
  bundle,
  plan,
  runId,
  agentProfile,
  outcome,
  createdAt,
  evidenceReferenceIds = null,
}) {
  const normalized = normalizeBundleReviewOutcome(outcome, {
    bundle,
    plan,
    workUnits: plan.work_units,
    evidenceReferenceIds,
  });
  const identity = {
    subject: normalized.subject,
    run_id: runId,
    agent_profile_id: agentProfile.profile_id,
    agent_profile_revision: agentProfile.revision,
  };
  return {
    assessment_id: stableId("bundle-review-assessment", identity),
    ...normalized.subject,
    run_id: runId,
    agent_profile: structuredClone(agentProfile),
    disposition: normalized.disposition,
    summary: normalized.summary,
    findings: structuredClone(normalized.findings),
    human_decision: structuredClone(normalized.human_decision),
    created_at: createdAt,
  };
}

function bundleEvidenceReferenceIds(bundle) {
  return [
    bundle.combined_validation_evidence?.evidence_id,
    ...(bundle.candidates ?? []).flatMap((candidate) => [
      candidate.repository_evidence?.evidence_id,
      candidate.verification_admission_id,
      candidate.verification_review_id,
    ]),
  ].filter(Boolean);
}

export function bundleReviewAssessmentMatches(assessment, bundle, plan) {
  if (!assessment || !bundle || !plan) return false;
  const subject = createBundleReviewSubject({ bundle, plan });
  return (
    assessment.plan_revision === subject.plan_revision &&
    assessment.bundle_id === subject.bundle_id &&
    assessment.bundle_revision === subject.bundle_revision &&
    assessment.bundle_hash === subject.bundle_hash &&
    assessment.subject_digest === subject.subject_digest &&
    assessment.agent_profile?.profile_id ===
      plan.bundle_review?.agent_profile_id &&
    assessment.agent_profile?.revision ===
      plan.bundle_review?.agent_profile_revision
  );
}

export function bundleReviewAllowsHumanDecision(assessment, bundle, plan) {
  return (
    bundleReviewAssessmentMatches(assessment, bundle, plan) &&
    // 显式 Gate 已把不确定性呈现给最终人类；它不能自动通过，但不阻断人工决定。
    ["pass", "gate"].includes(assessment.disposition)
  );
}

export function blockingFeedbackByWorkUnit(assessment) {
  const grouped = new Map();
  for (const finding of assessment.findings) {
    if (finding.severity !== "blocking") continue;
    for (const workUnitId of finding.work_unit_ids) {
      const findings = grouped.get(workUnitId) ?? [];
      findings.push({ finding_id: finding.finding_id, text: finding.message });
      grouped.set(workUnitId, findings);
    }
  }
  return grouped;
}

function normalizeHumanDecision(input) {
  if (input === null) return null;
  invariant(
    isPlainObject(input),
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    "Bundle review human decision must be one object or null",
  );
  assertAllowedKeys(input, ["question", "options"], "INVALID_BUNDLE_REVIEW_OUTCOME");
  invariant(
    Array.isArray(input.options) &&
      input.options.length >= 2 &&
      input.options.length <= 8,
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    "Bundle review human decision requires 2-8 options",
  );
  const options = input.options.map((option) =>
    boundedString("human_decision.option", option),
  );
  invariant(
    new Set(options).size === options.length,
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    "Bundle review human decision options must be distinct",
  );
  return {
    question: boundedString("human_decision.question", input.question),
    options,
  };
}

function boundedIdArray(label, input) {
  invariant(
    Array.isArray(input) && input.length <= FINDING_LIMIT,
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    `${label} must be a bounded array`,
  );
  const values = input.map((value) =>
    requiredId(label, value, "INVALID_BUNDLE_REVIEW_OUTCOME"),
  );
  invariant(
    new Set(values).size === values.length,
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    `${label} must not contain duplicates`,
  );
  return values;
}

function boundedReferenceArray(input) {
  invariant(
    Array.isArray(input) && input.length <= EVIDENCE_LIMIT,
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    "Bundle review evidence references are invalid",
  );
  return input.map((value) =>
    boundedString("evidence_reference_id", value, 512),
  );
}

function boundedString(label, value, maxBytes = TEXT_BYTES) {
  invariant(
    typeof value === "string" &&
      value.trim().length > 0 &&
      Buffer.byteLength(value.trim(), "utf8") <= maxBytes,
    "INVALID_BUNDLE_REVIEW_OUTCOME",
    `${label} must be non-empty and bounded`,
  );
  return value.trim();
}

function positiveInteger(label, value, code) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    code,
    `${label} must be a positive integer`,
  );
  return value;
}

function optionalId(label, value, code) {
  if (value === null || value === undefined) return null;
  return requiredId(label, value, code);
}

function optionalPositiveInteger(label, value, code) {
  if (value === null || value === undefined) return null;
  return positiveInteger(label, value, code);
}

function requiredId(label, value, code) {
  invariant(
    typeof value === "string" && ID_PATTERN.test(value),
    code,
    `${label} must be one stable logical id`,
  );
  return value;
}

function assertAllowedKeys(value, keys, code) {
  const allowed = new Set(keys);
  invariant(
    Object.keys(value).every((key) => allowed.has(key)),
    code,
    "Bundle review input contains an unsupported field",
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
