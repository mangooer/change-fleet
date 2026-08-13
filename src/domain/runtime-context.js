import { canonicalStringify } from "./canonical-json.js";
import { invariant } from "./errors.js";

// Runtime 只接收当前操作所需投影；完整历史留在控制存储中按引用读取。
export const CONTROL_CONTRACT_VERSION = 6;
export const CONTEXT_PROJECTION_VERSION = 15;
const RUNTIME_EXCLUDED_DECISION_TYPES = new Set([
  "bundle_review",
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
  writableRepositories = [],
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
    // 可读仓库与可写仓库分开冻结；Runtime 权限宽于声明时仍由执行前后 Git 身份比对兜底。
    writable_repositories: writableRepositories,
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
  supervisionPolicy = null,
  bundleReviewPolicy = null,
  workspaceControl = null,
  verification = null,
  feedback = null,
}) {
  return {
    schema_version: CONTEXT_PROJECTION_VERSION,
    operation,
    change_set_id: changeSet.change_set_id,
    confirmed_intent: changeSet.intents.at(-1),
    // Agent 只消费已确认的语义计划；Core 编译出的 WorkUnit、预算和审核配置不回灌上下文。
    current_plan: projectSemanticPlan(plan),
    verification_policy:
      verificationPolicy === null ? null : structuredClone(verificationPolicy),
    supervision_policy:
      supervisionPolicy === null ? null : structuredClone(supervisionPolicy),
    bundle_review_policy:
      bundleReviewPolicy === null
        ? null
        : structuredClone(bundleReviewPolicy),
    workspace_control:
      workspaceControl === null ? null : structuredClone(workspaceControl),
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
    // 只投影本轮输入和紧邻的上一条 Agent 回复；更早对话只能通过 Run 引用按需审计。
    planning_conversation: projectPlanningConversation(planningConversation),
    // Verification 只接收当前精确主体和有界证据摘要，不继承执行对话、成本或历史审计。
    verification:
      verification === null ? null : structuredClone(verification),
    history_references: historyReferences,
  };
}

function projectSemanticPlan(plan) {
  if (!plan?.semantic_plan) return null;
  return {
    revision: plan.revision,
    ...structuredClone(plan.semantic_plan),
  };
}

function projectPlanningConversation(conversation) {
  if (!conversation) return null;
  return {
    user_message: conversation.user_message ?? null,
    previous_assistant_message:
      conversation.previous_assistant_message === null
        ? null
        : {
            message_id: conversation.previous_assistant_message.message_id,
            content_digest:
              conversation.previous_assistant_message.content_digest,
            text: conversation.previous_assistant_message.text,
            plan_content:
              conversation.previous_assistant_message.plan_content,
            ...(conversation.previous_assistant_message.intent_draft ===
            undefined
              ? {}
              : {
                  intent_draft: structuredClone(
                    conversation.previous_assistant_message.intent_draft,
                  ),
                }),
          },
    ...(conversation.intent_draft === undefined
      ? {}
      : { intent_draft: structuredClone(conversation.intent_draft) }),
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
  // 语义执行内容只保留在 current_plan；WorkUnit 投影仅携带仓库级控制身份，避免每轮重复同一 Plan 文本。
  return Object.fromEntries(
    [
      "work_unit_id",
      "repository_id",
      "target_ref",
      "base_sha",
      "repository_selection_revision",
      "repository_harness_selection_revision",
      "repository_check",
      "repository_check_rationale",
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
