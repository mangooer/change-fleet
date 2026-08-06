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
          repository_check: COMMAND_SCHEMA,
        },
        required: [
          "work_unit_id",
          "repository_id",
          "task",
          "dependencies",
          "repository_check",
        ],
        additionalProperties: false,
      },
    },
    combined_check: COMMAND_SCHEMA,
    verification_expectation: VERIFICATION_EXPECTATION_SCHEMA,
    risks: STRING_ARRAY_SCHEMA,
    unverified_boundaries: STRING_ARRAY_SCHEMA,
  },
  required: [
    "rationale",
    "revision_feedback_assessments",
    "work_units",
    "combined_check",
    "verification_expectation",
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
    options: { type: "array", items: { type: "string" }, minItems: 2 },
  },
  required: ["question", "options"],
  additionalProperties: false,
});

export const VERIFICATION_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    type: { type: "string", enum: ["verification_completed"] },
    review_depth: {
      type: "string",
      enum: ["triage", "deep_review"],
    },
    verdict: {
      type: "string",
      enum: [
        "pass",
        "pass_with_notes",
        "changes_required",
        "human_decision_required",
      ],
    },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: VERIFICATION_FINDING_SCHEMA,
      maxItems: 16,
    },
    notes: {
      type: "array",
      items: VERIFICATION_NOTE_SCHEMA,
      maxItems: 16,
    },
    human_decision: {
      anyOf: [HUMAN_DECISION_SCHEMA, { type: "null" }],
    },
    requested_checks: {
      type: "array",
      items: COMMAND_SCHEMA,
      maxItems: 8,
    },
  },
  required: [
    "type",
    "review_depth",
    "verdict",
    "summary",
    "findings",
    "notes",
    "human_decision",
    "requested_checks",
  ],
  additionalProperties: false,
});

export function schemaForOperation(operation) {
  // 未知操作必须在调用 Provider 前失败，不能退回无结构文本。
  if (operation === "planning") return PLANNING_OUTCOME_SCHEMA;
  // 修正与执行共享终态结构，但仍以独立 operation 记录权限、成本和生命周期。
  if (operation === "execution" || operation === "correction") {
    return EXECUTION_OUTCOME_SCHEMA;
  }
  if (operation === "verification") return VERIFICATION_OUTCOME_SCHEMA;
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
    [
      "pass",
      "pass_with_notes",
      "changes_required",
      "human_decision_required",
    ].includes(outcome.verdict) &&
    typeof outcome.summary === "string" &&
    Array.isArray(outcome.findings) &&
    Array.isArray(outcome.notes) &&
    (outcome.human_decision === null ||
      (outcome.human_decision &&
        typeof outcome.human_decision === "object" &&
        !Array.isArray(outcome.human_decision))) &&
    Array.isArray(outcome.requested_checks)
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
    ["execution", "correction"].includes(operation) &&
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
    ["execution", "correction"].includes(operation) &&
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
    ["execution", "correction"].includes(operation) &&
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
