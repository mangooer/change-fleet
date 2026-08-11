import { sha256, stableId } from "./canonical-json.js";
import { invariant } from "./errors.js";
import { normalizePlanBundleReview } from "./bundle-review.js";
import { normalizePlanSupervision } from "./supervision.js";
import { normalizeVerificationPolicy } from "./verification.js";

export function createTaskWorkspaceRecord({
  changeSetId,
  agentProfile,
  repositorySelection,
  repositoryHarnessSelection,
  repositoryWorkspaces,
  createdAt,
}) {
  // 一个 ChangeSet 只创建一个逻辑任务工作区；其中每个仓库仍保持独立 Git 身份。
  const taskWorkspaceId = stableId("task-workspace", {
    change_set_id: changeSetId,
  });
  const selectedById = new Map(
    repositorySelection.repositories.map((repository) => [
      repository.repository_id,
      repository,
    ]),
  );
  invariant(
    repositoryWorkspaces.length === selectedById.size,
    "TASK_WORKSPACE_REPOSITORY_MISMATCH",
    "TaskWorkspace requires one RepositoryWorkspace for every selected Repository",
  );
  const repositories = repositoryWorkspaces
    .map((workspace) => {
      const selected = selectedById.get(workspace.repository_id);
      invariant(
        selected &&
          workspace.base_sha === selected.resolved_base_sha &&
          workspace.target_ref === selected.target_ref,
        "TASK_WORKSPACE_REPOSITORY_MISMATCH",
        `RepositoryWorkspace ${workspace.repository_id} does not match frozen authority`,
      );
      return {
        repository_id: workspace.repository_id,
        base_sha: workspace.base_sha,
        target_ref: workspace.target_ref,
        branch_ref: workspace.branch_ref,
        workspace: structuredClone(workspace),
      };
    })
    .sort((left, right) =>
      left.repository_id.localeCompare(right.repository_id),
    );
  return {
    schema_version: 1,
    task_workspace_id: taskWorkspaceId,
    change_set_id: changeSetId,
    repository_selection_revision: repositorySelection.revision,
    repository_harness_selection_revision:
      repositoryHarnessSelection.revision,
    agent_profile: structuredClone(agentProfile),
    repositories,
    retired_repository_workspaces: [],
    resources_released_at: null,
    created_at: createdAt,
  };
}

export function advanceTaskWorkspaceGeneration({
  currentWorkspace,
  nextWorkspace,
  retiredAt,
}) {
  // 逻辑 TaskWorkspace 身份不变；旧物理 generation 留作终态统一回收和审计。
  invariant(
    currentWorkspace.task_workspace_id === nextWorkspace.task_workspace_id &&
      currentWorkspace.change_set_id === nextWorkspace.change_set_id,
    "TASK_WORKSPACE_IDENTITY_CHANGED",
    "A Repository or Harness revision cannot replace logical TaskWorkspace identity",
  );
  return {
    ...structuredClone(nextWorkspace),
    created_at: currentWorkspace.created_at,
    retired_repository_workspaces: [
      ...(currentWorkspace.retired_repository_workspaces ?? []).map((item) =>
        structuredClone(item),
      ),
      ...currentWorkspace.repositories.map((item) => ({
        ...structuredClone(item),
        retired_at: retiredAt,
      })),
    ],
  };
}

export function createTaskWorkspaceControlSummary(state) {
  // 摘要由 Core 生成并单独绑定，Planner 无需复述任何权限、预算或 Git 控制字段。
  const workspace = requireTaskWorkspace(state);
  const verificationPolicy = normalizeVerificationPolicy(
    state.verification_policy,
  );
  const summary = {
    schema_version: 1,
    task_workspace_id: workspace.task_workspace_id,
    repository_selection_revision:
      workspace.repository_selection_revision,
    repository_harness_selection_revision:
      workspace.repository_harness_selection_revision,
    repositories: workspace.repositories.map((repository) => ({
      repository_id: repository.repository_id,
      base_sha: repository.base_sha,
      target_ref: repository.target_ref,
      branch_ref: repository.branch_ref,
      repository_workspace_id: repository.workspace.workspace_id,
    })),
    agent_profile: {
      profile_id: workspace.agent_profile.profile_id,
      revision: workspace.agent_profile.revision,
      provider: workspace.agent_profile.provider,
      runtime: workspace.agent_profile.runtime,
      model: workspace.agent_profile.model,
      reasoning: workspace.agent_profile.reasoning,
      permissions: workspace.agent_profile.permissions,
    },
    verification_expectation: {
      mode: verificationPolicy.minimum_mode,
      rationale: "Uses the confirmed Project verification minimum and escalation policy.",
      escalation_triggers: [...verificationPolicy.escalation_triggers],
    },
    supervision: normalizePlanSupervision(null, state.supervision_policy),
    bundle_review: normalizePlanBundleReview(
      null,
      state.bundle_review_policy,
    ),
  };
  return {
    ...summary,
    control_digest: sha256(summary),
  };
}

export function compileConfirmedPlanContent({
  state,
  semanticPlan,
  planRevision,
}) {
  // 人类确认语义计划后，Core 才把既有任务配置编译为内部执行记录。
  const workspace = requireTaskWorkspace(state);
  const control = createTaskWorkspaceControlSummary(state);
  const task = [semanticPlan.summary, ...semanticPlan.steps]
    .filter(Boolean)
    .join("\n");
  return {
    intent_revision: state.current_intent_revision,
    repository_selection_revision:
      workspace.repository_selection_revision,
    repository_harness_selection_revision:
      workspace.repository_harness_selection_revision,
    semantic_plan: structuredClone(semanticPlan),
    workspace_control_digest: control.control_digest,
    rationale: semanticPlan.summary,
    revision_feedback_assessments: structuredClone(
      semanticPlan.revision_feedback_assessments,
    ),
    work_units: workspace.repositories.map((repository) => ({
      // Core 生成且在历史 revision 间唯一；首个 revision 保留简短可读身份便于本地审计。
      work_unit_id:
        planRevision === 1
          ? `${repository.repository_id}-unit`
          : `${repository.repository_id}-unit-r${planRevision}`,
      repository_id: repository.repository_id,
      task,
      target_ref: repository.target_ref,
      base_sha: repository.base_sha,
      repository_selection_revision:
        workspace.repository_selection_revision,
      repository_harness_selection_revision:
        workspace.repository_harness_selection_revision,
      repository_check: null,
      repository_check_rationale:
        "No task-configured semantic command; the Agent follows repository-native validation guidance.",
    })),
    combined_check: null,
    combined_check_rationale:
      "No task-configured Candidate-set semantic command; structural Bundle validation remains mandatory.",
    verification_expectation: structuredClone(
      control.verification_expectation,
    ),
    bundle_review: structuredClone(control.bundle_review),
    supervision: structuredClone(control.supervision),
    risks: [...semanticPlan.risks],
    unverified_boundaries: [],
  };
}

export function requireTaskWorkspace(state) {
  // 所有规划和执行入口统一验证一对一 TaskWorkspace 结构，避免回退到旧工作区路径。
  const workspace = state?.task_workspace;
  invariant(
    workspace?.change_set_id === state?.change_set_id &&
      typeof workspace.task_workspace_id === "string" &&
      Array.isArray(workspace.repositories) &&
      workspace.repositories.length > 0,
    "TASK_WORKSPACE_NOT_READY",
    "ChangeSet does not own one prepared TaskWorkspace",
  );
  return workspace;
}
