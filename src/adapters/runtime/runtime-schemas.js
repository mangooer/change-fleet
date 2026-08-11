const STRING_ARRAY_SCHEMA = Object.freeze({
  type: "array",
  items: { type: "string" },
});

const COMMAND_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    command_id: { type: "string" },
    executable: { type: "string" },
    argv: STRING_ARRAY_SCHEMA,
    coverage_rationale: { type: "string" },
    timeout_ms: { type: "integer", minimum: 1 },
  },
  // OpenAI 严格结构要求 properties 中的字段全部进入 required；领域层仍可为非 Provider 输入补默认预算。
  required: [
    "command_id",
    "executable",
    "argv",
    "coverage_rationale",
    "timeout_ms",
  ],
  additionalProperties: false,
});

const VERIFICATION_EXPECTATION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["basic", "deterministic", "independent_review"],
    },
    rationale: { type: "string" },
    escalation_triggers: {
      type: "array",
      items: {
        type: "string",
        enum: ["scope_divergence", "unverified_boundaries"],
      },
    },
  },
  required: ["mode", "rationale", "escalation_triggers"],
  additionalProperties: false,
});

const PLAN_SUPERVISION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["manual", "autonomous_until_review"],
    },
    execution_attempt_limit_per_work_unit: { type: "integer", minimum: 1 },
    verification_attempt_limit_per_work_unit: { type: "integer", minimum: 1 },
    feedback_cycle_limit_per_work_unit: { type: "integer", minimum: 1 },
    elapsed_time_limit_ms: { type: "integer", minimum: 1 },
  },
  required: [
    "mode",
    "execution_attempt_limit_per_work_unit",
    "verification_attempt_limit_per_work_unit",
    "feedback_cycle_limit_per_work_unit",
    "elapsed_time_limit_ms",
  ],
  additionalProperties: false,
});

const PLAN_BUNDLE_REVIEW_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    mode: { type: "string", enum: ["none", "independent"] },
    agent_profile_id: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    agent_profile_revision: {
      anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
    },
    attempt_limit: { type: "integer", minimum: 1 },
  },
  required: [
    "mode",
    "agent_profile_id",
    "agent_profile_revision",
    "attempt_limit",
  ],
  additionalProperties: false,
});

const REVISION_FEEDBACK_ASSESSMENT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    finding_id: { type: "string" },
    disposition: { type: "string", enum: ["adopt", "adapt", "decline"] },
    rationale: { type: "string" },
  },
  required: ["finding_id", "disposition", "rationale"],
  additionalProperties: false,
});

const PLAN_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    rationale: { anyOf: [{ type: "string" }, { type: "null" }] },
    revision_feedback_assessments: {
      type: "array",
      items: REVISION_FEEDBACK_ASSESSMENT_SCHEMA,
    },
    work_units: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          work_unit_id: { type: "string" },
          repository_id: { type: "string" },
          task: { type: "string" },
          dependencies: STRING_ARRAY_SCHEMA,
          repository_check: {
            anyOf: [COMMAND_SCHEMA, { type: "null" }],
          },
          repository_check_rationale: { type: "string" },
        },
        required: [
          "work_unit_id",
          "repository_id",
          "task",
          "dependencies",
          "repository_check",
          "repository_check_rationale",
        ],
        additionalProperties: false,
      },
    },
    combined_check: {
      anyOf: [COMMAND_SCHEMA, { type: "null" }],
    },
    combined_check_rationale: { type: "string" },
    verification_expectation: VERIFICATION_EXPECTATION_SCHEMA,
    bundle_review: PLAN_BUNDLE_REVIEW_SCHEMA,
    supervision: PLAN_SUPERVISION_SCHEMA,
    risks: STRING_ARRAY_SCHEMA,
    unverified_boundaries: STRING_ARRAY_SCHEMA,
  },
  required: [
    "rationale",
    "revision_feedback_assessments",
    "work_units",
    "combined_check",
    "combined_check_rationale",
    "verification_expectation",
    "bundle_review",
    "supervision",
    "risks",
    "unverified_boundaries",
  ],
  additionalProperties: false,
});

const REPOSITORY_SELECTION_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    planning_repository_ids: STRING_ARRAY_SCHEMA,
    repository_selections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          repository_id: { type: "string" },
          branch_ref: { anyOf: [{ type: "string" }, { type: "null" }] },
          target_ref: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["repository_id", "branch_ref", "target_ref"],
        additionalProperties: false,
      },
    },
    rationale: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: [
    "planning_repository_ids",
    "repository_selections",
    "rationale",
  ],
  additionalProperties: false,
});

// 顶层保持一个严格 object，避免 Provider 对根级联合类型支持不一致。
export const PLANNING_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["conversation_message", "repository_selection_change_request"],
    },
    message: {
      anyOf: [
        {
          type: "object",
          properties: {
            text: { type: "string" },
            plan: { anyOf: [PLAN_SCHEMA, { type: "null" }] },
          },
          required: ["text", "plan"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    request: {
      anyOf: [REPOSITORY_SELECTION_REQUEST_SCHEMA, { type: "null" }],
    },
  },
  required: ["type", "message", "request"],
  additionalProperties: false,
});

export const EXECUTION_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [
        "implementation_completed",
        "implementation_blocked",
        "plan_invalidation_required",
      ],
    },
    summary: { type: "string" },
    changed_paths: STRING_ARRAY_SCHEMA,
    blocker: {
      anyOf: [
        {
          type: "object",
          properties: {
            code: { type: "string" },
            message: { type: "string" },
          },
          required: ["code", "message"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    revision_feedback_assessments: {
      type: "array",
      items: REVISION_FEEDBACK_ASSESSMENT_SCHEMA,
    },
  },
  required: [
    "type",
    "summary",
    "changed_paths",
    "blocker",
    "revision_feedback_assessments",
  ],
  additionalProperties: false,
});

const VERIFICATION_FINDING_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    finding_id: { type: "string" },
    category: {
      type: "string",
      enum: [
        "confirmed_intent",
        "repository_authority",
        "correctness",
        "security",
        "data",
        "compatibility",
        "scope",
        "evidence",
      ],
    },
    message: { type: "string" },
    path: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["finding_id", "category", "message", "path"],
  additionalProperties: false,
});

const VERIFICATION_NOTE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    note_id: { type: "string" },
    message: { type: "string" },
  },
  required: ["note_id", "message"],
  additionalProperties: false,
});

const HUMAN_DECISION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    question: { type: "string" },
    options: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 8,
    },
  },
  required: ["question", "options"],
  additionalProperties: false,
});

const EMPTY_FINDINGS_SCHEMA = Object.freeze({
  type: "array",
  items: VERIFICATION_FINDING_SCHEMA,
  maxItems: 0,
});

const BOUNDED_FINDINGS_SCHEMA = Object.freeze({
  type: "array",
  items: VERIFICATION_FINDING_SCHEMA,
  minItems: 1,
  maxItems: 16,
});

const EMPTY_NOTES_SCHEMA = Object.freeze({
  type: "array",
  items: VERIFICATION_NOTE_SCHEMA,
  maxItems: 0,
});

const BOUNDED_NOTES_SCHEMA = Object.freeze({
  type: "array",
  items: VERIFICATION_NOTE_SCHEMA,
  maxItems: 16,
});

const REQUIRED_NOTES_SCHEMA = Object.freeze({
  type: "array",
  items: VERIFICATION_NOTE_SCHEMA,
  minItems: 1,
  maxItems: 16,
});

const EMPTY_CHECKS_SCHEMA = Object.freeze({
  type: "array",
  items: COMMAND_SCHEMA,
  maxItems: 0,
});

const BOUNDED_CHECKS_SCHEMA = Object.freeze({
  type: "array",
  items: COMMAND_SCHEMA,
  maxItems: 8,
});

function verificationAssessmentSchema({
  verdict,
  findings,
  notes,
  humanDecision,
  requestedChecks,
}) {
  return Object.freeze({
    type: "object",
    properties: {
      verdict: { type: "string", enum: [verdict] },
      findings,
      notes,
      human_decision: humanDecision,
      requested_checks: requestedChecks,
    },
    required: [
      "verdict",
      "findings",
      "notes",
      "human_decision",
      "requested_checks",
    ],
    additionalProperties: false,
  });
}

// Verdict 联合放在顶层 object 的属性内：既保持 OpenAI 严格输出的根 object，
// 又让 Provider 不可能生成“通过但携带阻塞 findings”这类领域层必然拒绝的形状。
const VERIFICATION_ASSESSMENT_SCHEMA = Object.freeze({
  anyOf: [
    verificationAssessmentSchema({
      verdict: "pass",
      findings: EMPTY_FINDINGS_SCHEMA,
      notes: EMPTY_NOTES_SCHEMA,
      humanDecision: { type: "null" },
      requestedChecks: BOUNDED_CHECKS_SCHEMA,
    }),
    verificationAssessmentSchema({
      verdict: "pass_with_notes",
      findings: EMPTY_FINDINGS_SCHEMA,
      notes: REQUIRED_NOTES_SCHEMA,
      humanDecision: { type: "null" },
      requestedChecks: BOUNDED_CHECKS_SCHEMA,
    }),
    verificationAssessmentSchema({
      verdict: "changes_required",
      findings: BOUNDED_FINDINGS_SCHEMA,
      notes: BOUNDED_NOTES_SCHEMA,
      humanDecision: { type: "null" },
      requestedChecks: EMPTY_CHECKS_SCHEMA,
    }),
    verificationAssessmentSchema({
      verdict: "human_decision_required",
      findings: EMPTY_FINDINGS_SCHEMA,
      notes: BOUNDED_NOTES_SCHEMA,
      humanDecision: HUMAN_DECISION_SCHEMA,
      requestedChecks: EMPTY_CHECKS_SCHEMA,
    }),
  ],
});

export const VERIFICATION_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    type: { type: "string", enum: ["verification_completed"] },
    review_depth: {
      type: "string",
      enum: ["triage", "deep_review"],
    },
    summary: { type: "string" },
    assessment: VERIFICATION_ASSESSMENT_SCHEMA,
  },
  required: [
    "type",
    "review_depth",
    "summary",
    "assessment",
  ],
  additionalProperties: false,
});

export const SUPERVISION_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    type: { type: "string", enum: ["supervisor_decision_proposal"] },
    action_id: { type: "string" },
    projection_digest: { type: "string" },
    rationale: { type: "string" },
    expected_result: { type: "string" },
    evidence_reference_ids: {
      type: "array",
      items: { type: "string" },
      maxItems: 16,
    },
  },
  required: [
    "type",
    "action_id",
    "projection_digest",
    "rationale",
    "expected_result",
    "evidence_reference_ids",
  ],
  additionalProperties: false,
});

const BUNDLE_REVIEW_FINDING_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    finding_id: { type: "string" },
    severity: { type: "string", enum: ["blocking", "advisory"] },
    category: {
      type: "string",
      enum: [
        "confirmed_intent",
        "cross_repository",
        "correctness",
        "security",
        "data",
        "compatibility",
        "scope",
        "evidence",
      ],
    },
    message: { type: "string" },
    evidence_reference_ids: {
      type: "array",
      items: { type: "string" },
      maxItems: 16,
    },
    repository_ids: STRING_ARRAY_SCHEMA,
    work_unit_ids: STRING_ARRAY_SCHEMA,
  },
  required: [
    "finding_id",
    "severity",
    "category",
    "message",
    "evidence_reference_ids",
    "repository_ids",
    "work_unit_ids",
  ],
  additionalProperties: false,
});

export const BUNDLE_REVIEW_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    type: { type: "string", enum: ["bundle_review_completed"] },
    disposition: {
      type: "string",
      enum: ["pass", "feedback", "gate"],
    },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: BUNDLE_REVIEW_FINDING_SCHEMA,
      maxItems: 16,
    },
    human_decision: {
      anyOf: [HUMAN_DECISION_SCHEMA, { type: "null" }],
    },
  },
  required: [
    "type",
    "disposition",
    "summary",
    "findings",
    "human_decision",
  ],
  additionalProperties: false,
});

export function schemaForOperation(operation) {
  // 未知操作必须在调用 Provider 前失败，不能退回无结构文本。
  if (operation === "planning") return PLANNING_OUTCOME_SCHEMA;
  if (operation === "execution") {
    return EXECUTION_OUTCOME_SCHEMA;
  }
  if (operation === "verification") return VERIFICATION_OUTCOME_SCHEMA;
  if (operation === "supervision") return SUPERVISION_OUTCOME_SCHEMA;
  if (operation === "review") return BUNDLE_REVIEW_OUTCOME_SCHEMA;
  throw new Error(`Unsupported Runtime operation ${operation}`);
}

export function assertStructuredOutcome(operation, outcome) {
  // SDK 负责 JSON Schema；这里再验证判别字段与可空分支的一致性，防止无效联合进入控制内核。
  if (
    !outcome ||
    typeof outcome !== "object" ||
    Array.isArray(outcome) ||
    typeof outcome.type !== "string"
  ) {
    throw new Error("Structured Runtime outcome must be an object with a type");
  }
  if (operation === "planning" && outcome.type === "conversation_message") {
    if (
      !outcome.message ||
      typeof outcome.message.text !== "string" ||
      !("plan" in outcome.message) ||
      outcome.request !== null
    ) {
      throw new Error(
        "conversation_message requires one message and a null request",
      );
    }
    return outcome;
  }
  if (
    operation === "verification" &&
    outcome.type === "verification_completed" &&
    ["triage", "deep_review"].includes(outcome.review_depth) &&
    typeof outcome.summary === "string" &&
    validVerificationAssessment(outcome.assessment)
  ) {
    return {
      type: outcome.type,
      review_depth: outcome.review_depth,
      summary: outcome.summary,
      ...structuredClone(outcome.assessment),
    };
  }
  if (
    operation === "supervision" &&
    outcome.type === "supervisor_decision_proposal" &&
    typeof outcome.action_id === "string" &&
    typeof outcome.projection_digest === "string" &&
    typeof outcome.rationale === "string" &&
    typeof outcome.expected_result === "string" &&
    Array.isArray(outcome.evidence_reference_ids)
  ) {
    return outcome;
  }
  if (
    operation === "review" &&
    outcome.type === "bundle_review_completed" &&
    ["pass", "feedback", "gate"].includes(outcome.disposition) &&
    typeof outcome.summary === "string" &&
    Array.isArray(outcome.findings) &&
    (outcome.human_decision === null ||
      (outcome.human_decision &&
        typeof outcome.human_decision === "object" &&
        !Array.isArray(outcome.human_decision)))
  ) {
    return outcome;
  }
  if (
    operation === "planning" &&
    outcome.type === "repository_selection_change_request"
  ) {
    if (!outcome.request || outcome.message !== null) {
      throw new Error(
        "repository_selection_change_request requires request and a null message",
      );
    }
    return outcome;
  }
  if (
    operation === "execution" &&
    outcome.type === "implementation_completed" &&
    typeof outcome.summary === "string" &&
    Array.isArray(outcome.changed_paths) &&
    outcome.changed_paths.every((item) => typeof item === "string") &&
    outcome.blocker === null &&
    Array.isArray(outcome.revision_feedback_assessments)
  ) {
    return outcome;
  }
  if (
    operation === "execution" &&
    outcome.type === "implementation_blocked" &&
    typeof outcome.summary === "string" &&
    Array.isArray(outcome.changed_paths) &&
    outcome.changed_paths.every((item) => typeof item === "string") &&
    outcome.blocker &&
    typeof outcome.blocker === "object" &&
    !Array.isArray(outcome.blocker) &&
    typeof outcome.blocker.code === "string" &&
    typeof outcome.blocker.message === "string" &&
    Array.isArray(outcome.revision_feedback_assessments)
  ) {
    return outcome;
  }
  if (
    operation === "execution" &&
    outcome.type === "plan_invalidation_required" &&
    typeof outcome.summary === "string" &&
    Array.isArray(outcome.changed_paths) &&
    outcome.changed_paths.every((item) => typeof item === "string") &&
    outcome.blocker &&
    typeof outcome.blocker === "object" &&
    !Array.isArray(outcome.blocker) &&
    typeof outcome.blocker.code === "string" &&
    typeof outcome.blocker.message === "string" &&
    Array.isArray(outcome.revision_feedback_assessments)
  ) {
    return outcome;
  }
  throw new Error(
    `Structured Runtime outcome does not match operation ${operation}`,
  );
}

function validVerificationAssessment(assessment) {
  if (
    !assessment ||
    typeof assessment !== "object" ||
    Array.isArray(assessment) ||
    !Array.isArray(assessment.findings) ||
    !Array.isArray(assessment.notes) ||
    !Array.isArray(assessment.requested_checks)
  ) {
    return false;
  }
  const humanDecisionIsObject =
    assessment.human_decision !== null &&
    typeof assessment.human_decision === "object" &&
    !Array.isArray(assessment.human_decision);
  if (assessment.verdict === "pass") {
    return (
      assessment.findings.length === 0 &&
      assessment.notes.length === 0 &&
      assessment.human_decision === null
    );
  }
  if (assessment.verdict === "pass_with_notes") {
    return (
      assessment.findings.length === 0 &&
      assessment.notes.length > 0 &&
      assessment.human_decision === null
    );
  }
  if (assessment.verdict === "changes_required") {
    return (
      assessment.findings.length > 0 &&
      assessment.human_decision === null &&
      assessment.requested_checks.length === 0
    );
  }
  if (assessment.verdict === "human_decision_required") {
    return (
      assessment.findings.length === 0 &&
      humanDecisionIsObject &&
      assessment.requested_checks.length === 0
    );
  }
  return false;
}
