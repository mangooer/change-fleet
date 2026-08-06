import { canonicalStringify } from "./canonical-json.js";
import { invariant } from "./errors.js";

// Runtime 只接收当前操作所需投影；完整历史留在控制存储中按引用读取。
export const CONTROL_CONTRACT_VERSION = 4;
export const CONTEXT_PROJECTION_VERSION = 10;
const RUNTIME_EXCLUDED_DECISION_TYPES = new Set([
  "bundle_review",
  "legacy_candidate_recovery",
  "changeset_closure",
  "provider_retry",
]);

export function createControlContract({
  operation,
  changeSetId,
  planRevision,
  repositorySelectionRevision,
  repositoryHarnessSelectionRevision,
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
    repository_harness_selection_revision:
      repositoryHarnessSelectionRevision,
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
  repositoryHarnessSelection,
  workUnit = null,
  repositories,
  capability,
  requiredEvidence,
  historyReferences = [],
  planningConversation = null,
  verificationPolicy = null,
  verification = null,
  feedback = null,
}) {
  return {
    schema_version: CONTEXT_PROJECTION_VERSION,
    operation,
    change_set_id: changeSet.change_set_id,
    confirmed_intent: changeSet.intents.at(-1),
    current_plan: plan,
    verification_policy:
      verificationPolicy === null ? null : structuredClone(verificationPolicy),
    // 只投影当前选择，不把已废弃 revision 历史灌入 Agent 上下文。
    repository_selection: repositorySelection,
    repository_harness_selection: repositoryHarnessSelection,
    // 工作区 locator、Checkpoint、验证尝试和 Candidate 只属于控制与审计面。
    work_unit: projectWorkUnit(workUnit),
    repositories,
    capability,
    required_evidence: requiredEvidence,
    blockers: changeSet.blockers
      .filter((blocker) => blocker.resolved_at === undefined)
      .map(projectBlocker),
    decisions: changeSet.decisions
      .filter(
        // 审核、恢复和关闭细节只属于控制与审计面，不能反向扩大 Agent 上下文。
        (decision) => !RUNTIME_EXCLUDED_DECISION_TYPES.has(decision.type),
      )
      .slice(-16)
      .map((decision) => structuredClone(decision)),
    feedback: projectFeedback(feedback),
    // 只投影本轮输入和当前可批准消息；更早对话只能通过 Run 引用按需审计。
    planning_conversation: projectPlanningConversation(planningConversation),
    // Verification 只接收当前精确主体和有界证据摘要，不继承执行对话、成本或历史审计。
    verification:
      verification === null ? null : structuredClone(verification),
    history_references: historyReferences,
  };
}

function projectPlanningConversation(conversation) {
  if (!conversation) return null;
  return {
    user_message: conversation.user_message ?? null,
    current_approvable_message:
      conversation.current_approvable_message === null
        ? null
        : {
            message_id: conversation.current_approvable_message.message_id,
            content_digest:
              conversation.current_approvable_message.content_digest,
            text: conversation.current_approvable_message.text,
            plan_content:
              conversation.current_approvable_message.plan_content,
          },
  };
}

function projectBlocker(blocker) {
  return Object.fromEntries(
    ["code", "work_unit_id", "run_id", "request_id"]
      .filter((key) => blocker[key] !== undefined)
      .map((key) => [key, blocker[key]]),
  );
}

function projectWorkUnit(workUnit) {
  if (!workUnit) return null;
  return Object.fromEntries(
    [
      "work_unit_id",
      "repository_id",
      "task",
      "dependencies",
      "target_ref",
      "base_sha",
      "repository_selection_revision",
      "repository_harness_selection_revision",
      "repository_check",
      "plan_revision",
      "phase",
      "disposition",
      "last_error",
    ]
      .filter((key) => workUnit[key] !== undefined)
      .map((key) => [key, structuredClone(workUnit[key])]),
  );
}

function projectFeedback(feedback) {
  if (!feedback) return null;
  return {
    feedback_id: feedback.feedback_id,
    source: feedback.source,
    target: structuredClone(feedback.target),
    summary: feedback.content.summary,
    findings: feedback.content.findings.map((finding) => ({
      finding_id: finding.finding_id,
      text: finding.text,
    })),
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
