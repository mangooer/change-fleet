import { canonicalize, sha256, stableId } from "./canonical-json.js";
import { invariant } from "./errors.js";

// 领域模块保持纯函数：只验证输入与构造稳定身份，不读取 Git、文件或当前时间。
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HUMAN_DECISIONS = new Set(["accept", "reject", "request_revision"]);

export function normalizeId(label, value) {
  invariant(
    typeof value === "string" && ID_PATTERN.test(value),
    "INVALID_ID",
    `${label} must match ${ID_PATTERN}`,
    { label, value },
  );
  return value;
}

export function normalizeIntent(input, { revision, confirmedAt }) {
  invariant(
    input && typeof input === "object",
    "INVALID_INTENT",
    "ChangeIntent must be an object",
  );
  invariant(
    typeof input.objective === "string" && input.objective.trim().length > 0,
    "INVALID_INTENT",
    "ChangeIntent objective is required",
  );
  return {
    revision,
    objective: input.objective.trim(),
    rationale: normalizeOptionalString(input.rationale),
    constraints: normalizeStringArray(input.constraints),
    non_goals: normalizeStringArray(input.non_goals),
    acceptance_criteria: normalizeStringArray(input.acceptance_criteria),
    resolved_decisions: normalizeStringArray(input.resolved_decisions),
    open_questions: normalizeStringArray(input.open_questions),
    source: normalizeOptionalString(input.source),
    confirmed_at: confirmedAt,
  };
}

export function normalizeRepositorySelectionRequest(
  project,
  { planningRepositoryIds, repositorySelections },
) {
  // 领域层只规范化调用者表达的授权；当前分支和提交解析必须留给 Git 边界。
  const registeredRepositoryIds = new Set(
    project.repositories.map((repository) => repository.repository_id),
  );
  const requestedRepositoryIds =
    planningRepositoryIds === undefined
      ? [...registeredRepositoryIds]
      : normalizeIdArray(
          "planning_repository_ids",
          planningRepositoryIds,
        );
  invariant(
    requestedRepositoryIds.length > 0,
    "INVALID_REPOSITORY_SELECTION",
    "Repository selection requires at least one planning-visible Repository",
  );
  invariant(
    new Set(requestedRepositoryIds).size === requestedRepositoryIds.length,
    "INVALID_REPOSITORY_SELECTION",
    "Planning-visible Repository ids must be unique",
  );
  for (const repositoryId of requestedRepositoryIds) {
    invariant(
      registeredRepositoryIds.has(repositoryId),
      "REPOSITORY_NOT_REGISTERED",
      `Repository ${repositoryId} is not registered in this Project`,
      { repository_id: repositoryId },
    );
  }

  const rawSelections = repositorySelections ?? [];
  invariant(
    Array.isArray(rawSelections),
    "INVALID_REPOSITORY_SELECTION",
    "repository_selections must be an array",
  );
  const selectionsByRepository = new Map();
  for (const rawSelection of rawSelections) {
    invariant(
      rawSelection && typeof rawSelection === "object",
      "INVALID_REPOSITORY_SELECTION",
      "Each Repository selection must be an object",
    );
    const repositoryId = normalizeId(
      "repository_selection.repository_id",
      rawSelection.repository_id,
    );
    invariant(
      requestedRepositoryIds.includes(repositoryId),
      "REPOSITORY_NOT_PLANNING_VISIBLE",
      `Repository ${repositoryId} is not in the planning-visible set`,
      { repository_id: repositoryId },
    );
    invariant(
      !selectionsByRepository.has(repositoryId),
      "INVALID_REPOSITORY_SELECTION",
      `Repository ${repositoryId} has more than one selection`,
      { repository_id: repositoryId },
    );
    selectionsByRepository.set(repositoryId, {
      repository_id: repositoryId,
      branch_ref: normalizeOptionalSelectionRef(
        "repository_selection.branch_ref",
        rawSelection.branch_ref,
      ),
      target_ref: normalizeOptionalSelectionRef(
        "repository_selection.target_ref",
        rawSelection.target_ref,
      ),
    });
  }

  const repositoryIds = [...requestedRepositoryIds].sort();
  return {
    repository_ids: repositoryIds,
    repositories: repositoryIds.map(
      (repositoryId) =>
        selectionsByRepository.get(repositoryId) ?? {
          repository_id: repositoryId,
          branch_ref: null,
          target_ref: null,
        },
    ),
  };
}

export function normalizeCommand(input, label = "command") {
  invariant(
    input && typeof input === "object",
    "INVALID_COMMAND",
    `${label} is required`,
  );
  return {
    command_id: normalizeId(`${label}.command_id`, input.command_id),
    executable: requireString(`${label}.executable`, input.executable),
    argv: normalizeStringArray(input.argv),
    timeout_ms: normalizePositiveInteger(
      `${label}.timeout_ms`,
      input.timeout_ms,
      120_000,
    ),
  };
}

export function normalizePlan(
  input,
  {
    project,
    bases,
    intentRevision,
    repositorySelectionRevision,
    revision,
    createdAt,
  },
) {
  invariant(
    input && typeof input === "object",
    "INVALID_PLAN",
    "Runtime planning outcome must contain a plan object",
  );
  invariant(
    // 项目目录是授权上限，不是每次变更都必须覆盖的执行清单。
    Array.isArray(input.work_units) && input.work_units.length >= 1,
    "INVALID_PLAN",
    "A ChangePlan requires at least one WorkUnit",
  );
  invariant(
    Number.isSafeInteger(repositorySelectionRevision) &&
      repositorySelectionRevision > 0,
    "INVALID_REPOSITORY_SELECTION_REVISION",
    "A ChangePlan requires one positive Repository selection revision",
  );

  const authorizedRepositories = new Set(
    project.repositories.map((repository) => repository.repository_id),
  );
  const seenUnits = new Set();
  const seenRepositories = new Set();
  const workUnits = input.work_units.map((workUnit) => {
    const workUnitId = normalizeId("work_unit_id", workUnit.work_unit_id);
    const repositoryId = normalizeId(
      "repository_id",
      workUnit.repository_id,
    );
    invariant(
      !seenUnits.has(workUnitId),
      "DUPLICATE_WORK_UNIT",
      `Duplicate WorkUnit id ${workUnitId}`,
    );
    invariant(
      authorizedRepositories.has(repositoryId),
      "SCOPE_EXPANSION_REQUIRED",
      `Repository ${repositoryId} is not authorized for this Project`,
      { requested_repository_id: repositoryId },
    );
    invariant(
      !seenRepositories.has(repositoryId),
      "DUPLICATE_REPOSITORY_WORK_UNIT",
      `The first slice allows one WorkUnit per Repository: ${repositoryId}`,
    );
    invariant(
      bases[repositoryId],
      "MISSING_FROZEN_BASE",
      `No frozen base exists for Repository ${repositoryId}`,
    );
    seenUnits.add(workUnitId);
    seenRepositories.add(repositoryId);
    return {
      work_unit_id: workUnitId,
      repository_id: repositoryId,
      task: requireString("work_unit.task", workUnit.task),
      dependencies: normalizeIdArray(
        "work_unit.dependencies",
        workUnit.dependencies,
      ),
      target_ref: bases[repositoryId].target_ref,
      base_sha: bases[repositoryId].base_sha,
      repository_selection_revision: repositorySelectionRevision,
      repository_check: normalizeCommand(
        workUnit.repository_check,
        `${workUnitId}.repository_check`,
      ),
    };
  });

  validateDependencyGraph(workUnits);

  const plannedRepositories = [...seenRepositories].sort();
  invariant(
    plannedRepositories.length > 0,
    "INCOMPLETE_REPOSITORY_SCOPE",
    "A ChangePlan must cover at least one explicitly authorized Repository",
    { plannedRepositories },
  );

  return {
    revision,
    intent_revision: intentRevision,
    repository_selection_revision: repositorySelectionRevision,
    created_at: createdAt,
    status: "proposed",
    rationale: normalizeOptionalString(input.rationale),
    work_units: workUnits,
    combined_check: normalizeCommand(input.combined_check, "combined_check"),
    risks: normalizeStringArray(input.risks),
    unverified_boundaries: normalizeStringArray(input.unverified_boundaries),
  };
}

export function createValidationSubject(changeSet, plan, candidates) {
  const exactCandidates = candidates
    .map(candidateIdentity)
    .sort(compareByRepositoryId);
  const subject = {
    schema_version: 1,
    change_set_id: changeSet.change_set_id,
    plan_revision: plan.revision,
    candidates: exactCandidates,
    required_check: plan.combined_check,
  };
  return {
    ...subject,
    validation_subject_hash: sha256(subject),
  };
}

export function createCandidate({
  repositoryId,
  targetRef,
  baseSha,
  candidateSha,
  workspaceId,
  workspacePath,
  changedPaths,
  repositoryEvidence,
}) {
  const identity = {
    repository_id: repositoryId,
    target_ref: targetRef,
    base_sha: baseSha,
    candidate_sha: candidateSha,
  };
  return {
    candidate_id: stableId("candidate", identity),
    ...identity,
    workspace_id: workspaceId,
    workspace_path: workspacePath,
    changed_paths: [...changedPaths].sort(),
    repository_evidence: repositoryEvidence,
  };
}

export function createCandidateBundle({
  changeSet,
  plan,
  candidates,
  combinedEvidence,
  createdAt,
}) {
  invariant(
    candidates.length === plan.work_units.length,
    "INCOMPLETE_CANDIDATE_SET",
    "CandidateBundle requires one Candidate for every current WorkUnit",
  );
  const expectedRepositories = plan.work_units
    .map((workUnit) => workUnit.repository_id)
    .sort();
  const candidateRepositories = candidates
    .map((candidate) => candidate.repository_id)
    .sort();
  invariant(
    JSON.stringify(expectedRepositories) ===
      JSON.stringify(candidateRepositories),
    "INCOMPLETE_CANDIDATE_SET",
    "CandidateBundle Candidate repositories do not match the current plan",
  );
  for (const candidate of candidates) {
    validateEvidenceReference(
      candidate.repository_evidence,
      `${candidate.repository_id} repository evidence`,
    );
  }
  validateEvidenceReference(combinedEvidence, "combined validation evidence");
  const sortedCandidates = [...candidates].sort(compareByRepositoryId);
  const revision = changeSet.bundles.length + 1;
  const identity = {
    schema_version: 1,
    change_set_id: changeSet.change_set_id,
    intent_revision: plan.intent_revision,
    plan_revision: plan.revision,
    revision,
    candidates: sortedCandidates.map((candidate) => ({
      ...candidateIdentity(candidate),
      candidate_id: candidate.candidate_id,
      repository_evidence: candidate.repository_evidence,
    })),
    combined_validation_evidence: combinedEvidence,
    missing_work_units: [],
    blocked_work_units: [],
    superseded_work_units: [],
    excluded_work_units: [],
    unverified_risks: [...plan.unverified_boundaries],
  };
  // 创建时间不属于审核主体，重算同一精确内容时 Bundle hash 必须保持不变。
  const bundleHash = sha256(identity);
  return {
    ...identity,
    bundle_id: stableId("bundle", { revision, bundleHash }),
    bundle_hash: bundleHash,
    created_at: createdAt,
  };
}

export function normalizeHumanDecision(value) {
  invariant(
    HUMAN_DECISIONS.has(value),
    "INVALID_HUMAN_DECISION",
    `Decision must be one of ${[...HUMAN_DECISIONS].join(", ")}`,
  );
  return value;
}

export function commandFingerprint(command, input) {
  return sha256({ command, input: canonicalize(input) });
}

export function candidateIdentity(candidate) {
  return {
    repository_id: candidate.repository_id,
    target_ref: candidate.target_ref,
    base_sha: candidate.base_sha,
    candidate_sha: candidate.candidate_sha,
  };
}

function validateDependencyGraph(workUnits) {
  const units = new Map(
    workUnits.map((workUnit) => [workUnit.work_unit_id, workUnit]),
  );
  for (const workUnit of workUnits) {
    for (const dependency of workUnit.dependencies) {
      invariant(
        units.has(dependency),
        "UNKNOWN_WORK_UNIT_DEPENDENCY",
        `${workUnit.work_unit_id} depends on unknown WorkUnit ${dependency}`,
      );
      invariant(
        dependency !== workUnit.work_unit_id,
        "WORK_UNIT_DEPENDENCY_CYCLE",
        `${workUnit.work_unit_id} cannot depend on itself`,
      );
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(workUnitId) {
    if (visited.has(workUnitId)) return;
    invariant(
      !visiting.has(workUnitId),
      "WORK_UNIT_DEPENDENCY_CYCLE",
      `WorkUnit dependency cycle includes ${workUnitId}`,
    );
    visiting.add(workUnitId);
    for (const dependency of units.get(workUnitId).dependencies) {
      visit(dependency);
    }
    visiting.delete(workUnitId);
    visited.add(workUnitId);
  }
  for (const workUnitId of units.keys()) visit(workUnitId);
}

function normalizeStringArray(value) {
  if (value === undefined) return [];
  invariant(Array.isArray(value), "INVALID_STRING_ARRAY", "Expected an array");
  return value.map((item) => requireString("array item", item));
}

function normalizeIdArray(label, value) {
  if (value === undefined) return [];
  invariant(Array.isArray(value), "INVALID_ID_ARRAY", `${label} must be an array`);
  const normalized = value.map((item) => normalizeId(label, item));
  invariant(
    new Set(normalized).size === normalized.length,
    "DUPLICATE_ID",
    `${label} cannot contain duplicates`,
  );
  return normalized;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null || value === "") return null;
  return requireString("value", value);
}

function normalizeOptionalSelectionRef(label, value) {
  // 显式给出的空 ref 是无效输入；只有真正省略时才允许应用层读取当前分支或默认目标。
  if (value === undefined || value === null) return null;
  invariant(
    typeof value === "string" && value.trim().length > 0,
    "INVALID_REPOSITORY_SELECTION",
    `${label} must be a non-empty string when provided`,
  );
  return value.trim();
}

function requireString(label, value) {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    "INVALID_STRING",
    `${label} must be a non-empty string`,
  );
  return value.trim();
}

function normalizePositiveInteger(label, value, defaultValue) {
  if (value === undefined) return defaultValue;
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "INVALID_POSITIVE_INTEGER",
    `${label} must be a positive integer`,
  );
  return value;
}

function compareByRepositoryId(left, right) {
  return left.repository_id.localeCompare(right.repository_id);
}

function validateEvidenceReference(reference, label) {
  invariant(
    reference &&
      typeof reference.evidence_id === "string" &&
      /^[0-9a-f]{64}$/u.test(reference.evidence_hash),
    "MISSING_REQUIRED_EVIDENCE",
    `${label} must contain an immutable evidence id and SHA-256 hash`,
  );
}
