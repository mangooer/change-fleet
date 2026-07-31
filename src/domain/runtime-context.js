import { canonicalStringify } from "./canonical-json.js";
import { invariant } from "./errors.js";

// Runtime 只接收当前操作所需投影；完整历史留在控制存储中按引用读取。
export const CONTROL_CONTRACT_VERSION = 2;
export const CONTEXT_PROJECTION_VERSION = 2;

export function createControlContract({
  operation,
  changeSetId,
  planRevision,
  repositorySelectionRevision,
  workUnitId = null,
  authorizedRepositories,
  allowedOutcomes,
  humanGates,
}) {
  return {
    schema_version: CONTROL_CONTRACT_VERSION,
    operation,
    change_set_id: changeSetId,
    plan_revision: planRevision,
    repository_selection_revision: repositorySelectionRevision,
    work_unit_id: workUnitId,
    authorized_repositories: authorizedRepositories,
    allowed_outcomes: allowedOutcomes,
    human_gates: humanGates,
    runtime_kit: {
      enabled: false,
      skills: [],
    },
  };
}

export function createContextProjection({
  operation,
  changeSet,
  plan = null,
  repositorySelection,
  workUnit = null,
  repositories,
  capability,
  requiredEvidence,
  historyReferences = [],
}) {
  return {
    schema_version: CONTEXT_PROJECTION_VERSION,
    operation,
    change_set_id: changeSet.change_set_id,
    confirmed_intent: changeSet.intents.at(-1),
    current_plan: plan,
    // 只投影当前选择，不把已废弃 revision 历史灌入 Agent 上下文。
    repository_selection: repositorySelection,
    work_unit: workUnit,
    repositories,
    capability,
    required_evidence: requiredEvidence,
    blockers: [...changeSet.blockers],
    decisions: [...changeSet.decisions],
    history_references: historyReferences,
  };
}

export function assessInitialContext({
  controlContract,
  contextProjection,
  agentProfile,
  runtimeMeasurement,
}) {
  const changeFleetBytes = Buffer.byteLength(
    canonicalStringify({
      control_contract: controlContract,
      context_projection: contextProjection,
      agent_profile: agentProfile,
    }),
  );

  // Provider 无法报告容量时如实记为 unknown，不能把字节估算冒充 token 保证。
  if (!runtimeMeasurement) {
    return {
      classification: "unknown",
      changefleet_bytes: changeFleetBytes,
      used_tokens: null,
      capacity_tokens: null,
      usage_ratio: null,
      headroom_ratio: null,
      target_ratio: 0.7,
    };
  }

  const { classification, used_tokens: usedTokens, capacity_tokens: capacity } =
    runtimeMeasurement;
  invariant(
    classification === "enforced" || classification === "estimated",
    "INVALID_CONTEXT_EVIDENCE",
    "Runtime context evidence must be enforced, estimated, or absent",
  );
  invariant(
    Number.isSafeInteger(usedTokens) &&
      usedTokens >= 0 &&
      Number.isSafeInteger(capacity) &&
      capacity > 0,
    "INVALID_CONTEXT_EVIDENCE",
    "Runtime context evidence requires non-negative usage and positive capacity",
  );
  const usageRatio = usedTokens / capacity;
  invariant(
    usageRatio <= 0.7,
    "INITIAL_CONTEXT_BUDGET_EXCEEDED",
    `Initial context ratio ${usageRatio.toFixed(4)} exceeds 0.70`,
    { used_tokens: usedTokens, capacity_tokens: capacity },
  );
  return {
    classification,
    changefleet_bytes: changeFleetBytes,
    used_tokens: usedTokens,
    capacity_tokens: capacity,
    usage_ratio: usageRatio,
    headroom_ratio: 1 - usageRatio,
    target_ratio: 0.7,
  };
}
