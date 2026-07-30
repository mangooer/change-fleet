// 此模块只翻译 ChangeFleet 自己定义的诊断；Git 和测试程序的原始输出必须保留为证据，不能擅自改写。
export const DEFAULT_LOCALE = "zh-CN";

const MESSAGES = {
  "zh-CN": {
    INVALID_ID: "标识符格式无效。",
    INVALID_PLAN: "变更计划无效。",
    INVALID_PROJECT_REPOSITORIES: "项目必须显式登记至少一个仓库。",
    SCOPE_EXPANSION_REQUIRED: "计划请求了尚未授权的仓库范围，需要人工确认。",
    INCOMPLETE_REPOSITORY_SCOPE: "计划必须至少包含一个仓库工作单元。",
    DUPLICATE_WORK_UNIT: "计划中存在重复的工作单元标识符。",
    DUPLICATE_REPOSITORY_WORK_UNIT: "同一仓库在一个计划中只能有一个工作单元。",
    MISSING_FROZEN_BASE: "仓库没有可执行的冻结基线版本。",
    WORK_UNIT_DEPENDENCY_CYCLE: "工作单元依赖关系存在循环。",
    UNKNOWN_WORK_UNIT_DEPENDENCY: "工作单元依赖了不存在的工作单元。",
    COMBINED_VALIDATION_FAILED: "候选集合的联合验证未通过。",
    INITIAL_CONTEXT_BUDGET_EXCEEDED: "初始上下文超过允许的 70% 预算。",
    PROJECT_NOT_FOUND: "未找到指定项目。",
    CHANGE_SET_NOT_FOUND: "未找到指定变更单。",
    PLAN_CONFIRMATION_REQUIRED: "计划尚未经过人工确认，不能执行。",
    STALE_PLAN_CONFIRMATION: "待确认的计划已不是当前版本。",
    STALE_BUNDLE_DECISION: "待审核的候选包已不是当前精确版本。",
    INVALID_CHANGE_SET_STATE: "当前变更单状态不允许此操作。",
    INCOMPLETE_CANDIDATE_SET: "候选结果尚未覆盖当前计划的全部工作单元。",
    MISSING_REQUIRED_EVIDENCE: "缺少生成候选包所需的不可变证据。",
    REPOSITORY_VALIDATION_FAILED: "仓库候选结果未通过验证。",
    COMMAND_SPAWN_FAILED: "无法启动验证命令。",
    IDEMPOTENCY_KEY_REUSED: "同一个幂等键不能用于不同输入。",
    LOCK_BUSY: "控制面当前被另一个执行者占用。",
    NOT_A_GIT_REPOSITORY: "指定路径不是 Git 仓库。",
    DIRTY_CANDIDATE_WORKSPACE: "候选工作区含有未提交修改。",
    CANDIDATE_HEAD_MISMATCH: "候选工作区的 Git 提交与记录不一致。",
  },
  en: {
    INVALID_ID: "Identifier format is invalid.",
    INVALID_PLAN: "Change plan is invalid.",
    INVALID_PROJECT_REPOSITORIES: "A Project must explicitly register at least one Repository.",
    SCOPE_EXPANSION_REQUIRED: "The plan requests Repository scope that is not authorized and needs human confirmation.",
    INCOMPLETE_REPOSITORY_SCOPE: "A plan must contain at least one Repository WorkUnit.",
    DUPLICATE_WORK_UNIT: "The plan contains a duplicate WorkUnit identifier.",
    DUPLICATE_REPOSITORY_WORK_UNIT: "A Repository can have only one WorkUnit in a plan.",
    MISSING_FROZEN_BASE: "The Repository has no frozen base suitable for execution.",
    WORK_UNIT_DEPENDENCY_CYCLE: "WorkUnit dependencies contain a cycle.",
    UNKNOWN_WORK_UNIT_DEPENDENCY: "A WorkUnit depends on an unknown WorkUnit.",
    COMBINED_VALIDATION_FAILED: "Combined validation did not pass for the exact Candidate set.",
    INITIAL_CONTEXT_BUDGET_EXCEEDED: "Initial context exceeds the 70 percent budget.",
    PROJECT_NOT_FOUND: "The requested Project was not found.",
    CHANGE_SET_NOT_FOUND: "The requested ChangeSet was not found.",
    PLAN_CONFIRMATION_REQUIRED: "The plan has not received human confirmation and cannot execute.",
    STALE_PLAN_CONFIRMATION: "The plan proposed for confirmation is no longer current.",
    STALE_BUNDLE_DECISION: "The Bundle proposed for review is no longer the exact current subject.",
    INVALID_CHANGE_SET_STATE: "The current ChangeSet state does not allow this operation.",
    INCOMPLETE_CANDIDATE_SET: "Candidate results do not cover every WorkUnit in the current plan.",
    MISSING_REQUIRED_EVIDENCE: "Required immutable evidence is missing for Bundle assembly.",
    REPOSITORY_VALIDATION_FAILED: "Repository Candidate validation failed.",
    COMMAND_SPAWN_FAILED: "The validation command could not be started.",
    IDEMPOTENCY_KEY_REUSED: "The same idempotency key cannot be used with different input.",
    LOCK_BUSY: "The control plane is currently owned by another executor.",
    NOT_A_GIT_REPOSITORY: "The specified path is not a Git repository.",
    DIRTY_CANDIDATE_WORKSPACE: "The Candidate workspace contains uncommitted changes.",
    CANDIDATE_HEAD_MISMATCH: "The Candidate workspace commit does not match the recorded Candidate.",
  },
};

export function normalizeLocale(locale = DEFAULT_LOCALE) {
  return MESSAGES[locale] ? locale : "en";
}

export function diagnosticMessage(code, { locale = DEFAULT_LOCALE, fallback } = {}) {
  // 翻译缺失时使用调用边界提供的原始说明，未知语言确定性回退到英文目录。
  const resolvedLocale = normalizeLocale(locale);
  return MESSAGES[resolvedLocale][code] ?? fallback ?? `ChangeFleet 错误：${code}`;
}

// 边缘界面应调用此函数切换展示语言，而不是匹配或重写稳定错误码。
export function presentDiagnostic(error, locale = DEFAULT_LOCALE) {
  return {
    code: error.code ?? "UNEXPECTED_ERROR",
    message: diagnosticMessage(error.code ?? "UNEXPECTED_ERROR", { locale, fallback: error.message }),
    details: error.details,
    locale: normalizeLocale(locale),
  };
}
