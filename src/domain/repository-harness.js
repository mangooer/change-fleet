import { sha256 } from "./canonical-json.js";
import { invariant } from "./errors.js";
import { normalizeId } from "./model.js";

export const REPOSITORY_HARNESS_PURPOSE = "repository_harness";
export const HARNESS_PROVIDER_FAMILY = "codex";
export const HARNESS_SELECTION_MODES = Object.freeze({
  EXACT_BASE_ONLY: "exact_base_only",
  EXACT_BASE_PLUS_OVERLAY: "exact_base_plus_overlay",
});
export const HARNESS_POLICY_SELECTORS = Object.freeze({
  EXPLICIT_PATTERNS: "explicit_patterns",
  EXACT_BASE_WORKTREEINCLUDE: "exact_base_worktreeinclude",
});

export function normalizeRepositoryWorkspacePolicy(
  input,
  { revision, confirmedAt, actor },
) {
  // Repository 策略只表达可复用授权，不包含某次 ChangeSet 实际读取到的路径和字节。
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "INVALID_REPOSITORY_HARNESS_POLICY",
    "Repository Harness policy must be an object",
  );
  invariant(
    Number.isSafeInteger(revision) && revision > 0,
    "INVALID_REPOSITORY_HARNESS_POLICY_REVISION",
    "Repository Harness policy revision must be positive",
  );
  invariant(
    input.purpose === undefined ||
      input.purpose === REPOSITORY_HARNESS_PURPOSE,
    "UNSUPPORTED_WORKSPACE_POLICY_PURPOSE",
    "Only repository_harness workspace policies are supported",
  );
  const selector = input.selector;
  invariant(
    Object.values(HARNESS_POLICY_SELECTORS).includes(selector),
    "INVALID_REPOSITORY_HARNESS_POLICY",
    "Repository Harness policy selector is unsupported",
    { selector },
  );

  let patterns = [];
  let manifestPath = null;
  if (selector === HARNESS_POLICY_SELECTORS.EXPLICIT_PATTERNS) {
    invariant(
      Array.isArray(input.patterns) && input.patterns.length > 0,
      "INVALID_REPOSITORY_HARNESS_POLICY",
      "Explicit Repository Harness policy requires patterns",
    );
    patterns = normalizePatterns(input.patterns);
  } else {
    manifestPath = input.manifest_path ?? ".worktreeinclude";
    invariant(
      manifestPath === ".worktreeinclude",
      "INVALID_WORKTREEINCLUDE_PATH",
      "The first Harness manifest must be the tracked root .worktreeinclude",
      { manifest_path: manifestPath },
    );
  }

  return {
    revision,
    status: "current",
    purpose: REPOSITORY_HARNESS_PURPOSE,
    selector,
    patterns,
    manifest_path: manifestPath,
    confirmed_by: normalizeActor(actor),
    confirmed_at: confirmedAt,
  };
}

export function normalizeRepositoryHarnessSelectionRequest(
  project,
  { repositoryIds, repositoryHarnessSelections },
) {
  // 每个规划可见 Repository 都得到一个显式选择，省略项只继承已确认的当前策略。
  const visibleRepositoryIds = [...repositoryIds].sort();
  const visible = new Set(visibleRepositoryIds);
  const repositories = new Map(
    project.repositories.map((repository) => [
      repository.repository_id,
      repository,
    ]),
  );
  const requested = repositoryHarnessSelections ?? [];
  invariant(
    Array.isArray(requested),
    "INVALID_REPOSITORY_HARNESS_SELECTION",
    "repository_harness_selections must be an array",
  );
  const byRepository = new Map();
  for (const item of requested) {
    invariant(
      item && typeof item === "object" && !Array.isArray(item),
      "INVALID_REPOSITORY_HARNESS_SELECTION",
      "Each Repository Harness selection must be an object",
    );
    const repositoryId = normalizeId(
      "repository_harness_selection.repository_id",
      item.repository_id,
    );
    invariant(
      visible.has(repositoryId),
      "REPOSITORY_NOT_PLANNING_VISIBLE",
      `Repository ${repositoryId} is not planning-visible`,
      { repository_id: repositoryId },
    );
    invariant(
      !byRepository.has(repositoryId),
      "INVALID_REPOSITORY_HARNESS_SELECTION",
      `Repository ${repositoryId} has more than one Harness selection`,
      { repository_id: repositoryId },
    );
    byRepository.set(
      repositoryId,
      normalizeRequestedSelection(repositories.get(repositoryId), item),
    );
  }

  return {
    repositories: visibleRepositoryIds.map((repositoryId) => {
      const repository = repositories.get(repositoryId);
      invariant(
        repository,
        "REPOSITORY_NOT_REGISTERED",
        `Repository ${repositoryId} is not registered`,
      );
      return (
        byRepository.get(repositoryId) ??
        defaultSelectionForRepository(repository)
      );
    }),
  };
}

export function createExactBaseHarnessSelection({
  repositoryId,
  baseSha,
  providerFamily = HARNESS_PROVIDER_FAMILY,
}) {
  // 无策略时仍建立显式选择记录，使规划、重试和审计不依赖“字段缺失”的隐含语义。
  return {
    repository_id: repositoryId,
    resolved_base_sha: baseSha,
    mode: HARNESS_SELECTION_MODES.EXACT_BASE_ONLY,
    provider_family: providerFamily,
    workspace_policy_revision: null,
    selector_digest: null,
    resolved_relative_paths: [],
    skipped_resources: [],
    content_digest: null,
    artifact_reference: null,
  };
}

export function createOverlayHarnessSelection({
  repositoryId,
  baseSha,
  policy,
  snapshotReference,
  selectorDigest,
  files,
  skippedResources = [],
}) {
  // 聚合只保存规范化路径、摘要和 artifact 引用，绝不内嵌私有文件正文。
  return {
    repository_id: repositoryId,
    resolved_base_sha: baseSha,
    mode: HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY,
    provider_family: HARNESS_PROVIDER_FAMILY,
    workspace_policy_revision: policy.revision,
    selector_digest: selectorDigest,
    resolved_relative_paths: files
      .map((file) => file.relative_path)
      .sort(),
    skipped_resources: structuredClone(skippedResources),
    content_digest: snapshotReference.content_digest,
    artifact_reference: snapshotReference,
  };
}

export function harnessSelectorDigest(policy, patterns) {
  // selector 摘要同时绑定策略版本和实际采用的 manifest 模式，避免 live manifest 漂移。
  return sha256({
    purpose: policy.purpose,
    selector: policy.selector,
    policy_revision: policy.revision,
    manifest_path: policy.manifest_path,
    patterns,
  });
}

function normalizeRequestedSelection(repository, input) {
  const mode = input.mode;
  invariant(
    Object.values(HARNESS_SELECTION_MODES).includes(mode),
    "INVALID_REPOSITORY_HARNESS_SELECTION",
    "Repository Harness selection mode is unsupported",
    { mode },
  );
  invariant(
    input.provider_family === undefined ||
      input.provider_family === HARNESS_PROVIDER_FAMILY,
    "UNSUPPORTED_HARNESS_PROVIDER",
    "The first Repository Harness overlay supports only Codex",
    { provider_family: input.provider_family },
  );
  if (mode === HARNESS_SELECTION_MODES.EXACT_BASE_ONLY) {
    invariant(
      input.workspace_policy_revision === undefined ||
        input.workspace_policy_revision === null,
      "INVALID_REPOSITORY_HARNESS_SELECTION",
      "exact_base_only cannot reference a workspace policy",
    );
    return {
      repository_id: repository.repository_id,
      mode,
      provider_family: HARNESS_PROVIDER_FAMILY,
      workspace_policy_revision: null,
    };
  }

  const revision =
    input.workspace_policy_revision ??
    repository.current_workspace_policy_revision;
  invariant(
    Number.isSafeInteger(revision) && revision > 0,
    "REPOSITORY_HARNESS_POLICY_REQUIRED",
    `Repository ${repository.repository_id} has no confirmed Harness policy`,
    { repository_id: repository.repository_id },
  );
  requirePolicyRevision(repository, revision);
  return {
    repository_id: repository.repository_id,
    mode,
    provider_family: HARNESS_PROVIDER_FAMILY,
    workspace_policy_revision: revision,
  };
}

function defaultSelectionForRepository(repository) {
  if (repository.current_workspace_policy_revision === null) {
    return {
      repository_id: repository.repository_id,
      mode: HARNESS_SELECTION_MODES.EXACT_BASE_ONLY,
      provider_family: HARNESS_PROVIDER_FAMILY,
      workspace_policy_revision: null,
    };
  }
  requirePolicyRevision(
    repository,
    repository.current_workspace_policy_revision,
  );
  return {
    repository_id: repository.repository_id,
    mode: HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY,
    provider_family: HARNESS_PROVIDER_FAMILY,
    workspace_policy_revision:
      repository.current_workspace_policy_revision,
  };
}

function requirePolicyRevision(repository, revision) {
  const policy = repository.workspace_policy_revisions.find(
    (candidate) => candidate.revision === revision,
  );
  invariant(
    policy?.purpose === REPOSITORY_HARNESS_PURPOSE,
    "REPOSITORY_HARNESS_POLICY_NOT_FOUND",
    `Repository ${repository.repository_id} has no Harness policy revision ${revision}`,
    {
      repository_id: repository.repository_id,
      workspace_policy_revision: revision,
    },
  );
  return policy;
}

function normalizePatterns(patterns) {
  const normalized = patterns.map((pattern) => {
    invariant(
      typeof pattern === "string" && pattern.trim().length > 0,
      "INVALID_REPOSITORY_HARNESS_PATTERN",
      "Repository Harness patterns must be non-empty strings",
    );
    const value = pattern.trim().replaceAll("\\", "/");
    invariant(
      !value.includes("\0") &&
        !value.startsWith("../") &&
        value !== ".." &&
        !value.match(/^[A-Za-z]:\//u),
      "UNSAFE_REPOSITORY_HARNESS_PATTERN",
      `Unsafe Repository Harness pattern: ${value}`,
      { pattern: value },
    );
    return value;
  });
  invariant(
    new Set(normalized).size === normalized.length,
    "DUPLICATE_REPOSITORY_HARNESS_PATTERN",
    "Repository Harness patterns cannot contain duplicates",
  );
  return normalized;
}

function normalizeActor(actor) {
  invariant(
    typeof actor === "string" && actor.trim().length > 0,
    "INVALID_ACTOR",
    "Policy confirmation actor is required",
  );
  return actor.trim();
}
