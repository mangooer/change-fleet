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
    timeout_ms: { type: "integer", minimum: 1 },
  },
  required: ["command_id", "executable", "argv", "timeout_ms"],
  additionalProperties: false,
});

const PLAN_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    rationale: { anyOf: [{ type: "string" }, { type: "null" }] },
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
    risks: STRING_ARRAY_SCHEMA,
    unverified_boundaries: STRING_ARRAY_SCHEMA,
  },
  required: [
    "rationale",
    "work_units",
    "combined_check",
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
      enum: ["plan_proposed", "repository_selection_change_request"],
    },
    plan: { anyOf: [PLAN_SCHEMA, { type: "null" }] },
    request: {
      anyOf: [REPOSITORY_SELECTION_REQUEST_SCHEMA, { type: "null" }],
    },
  },
  required: ["type", "plan", "request"],
  additionalProperties: false,
});

export const EXECUTION_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    type: { type: "string", enum: ["implementation_completed"] },
    summary: { type: "string" },
    changed_paths: STRING_ARRAY_SCHEMA,
  },
  required: ["type", "summary", "changed_paths"],
  additionalProperties: false,
});

export function schemaForOperation(operation) {
  // 未知操作必须在调用 Provider 前失败，不能退回无结构文本。
  if (operation === "planning") return PLANNING_OUTCOME_SCHEMA;
  if (operation === "execution") return EXECUTION_OUTCOME_SCHEMA;
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
  if (operation === "planning" && outcome.type === "plan_proposed") {
    if (!outcome.plan || outcome.request !== null) {
      throw new Error("plan_proposed requires plan and a null request");
    }
    return outcome;
  }
  if (
    operation === "planning" &&
    outcome.type === "repository_selection_change_request"
  ) {
    if (!outcome.request || outcome.plan !== null) {
      throw new Error(
        "repository_selection_change_request requires request and a null plan",
      );
    }
    return outcome;
  }
  if (
    operation === "execution" &&
    outcome.type === "implementation_completed" &&
    typeof outcome.summary === "string" &&
    Array.isArray(outcome.changed_paths) &&
    outcome.changed_paths.every((item) => typeof item === "string")
  ) {
    return outcome;
  }
  throw new Error(
    `Structured Runtime outcome does not match operation ${operation}`,
  );
}
