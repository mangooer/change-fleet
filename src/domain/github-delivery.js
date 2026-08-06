import { sha256, stableId } from "./canonical-json.js";
import { invariant } from "./errors.js";
import { normalizeId } from "./model.js";

const GITHUB_REPOSITORY_PATTERN =
  /^(?<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/(?<name>[A-Za-z0-9._-]{1,100})$/u;
const GIT_REMOTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u;
const DELIVERY_STATES = new Set([
  "pending",
  "publishing",
  "open",
  "merged",
  "closed_unmerged",
  "integration_stale",
  "candidate_diverged",
  "failed",
]);

// 交付领域只构造稳定身份和有界投影；Git、gh、时间及文件系统由外层适配器提供。
export function normalizeGithubDeliveryBindingRequest(input) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "INVALID_GITHUB_DELIVERY_BINDING",
    "GitHub delivery binding must be an object",
  );
  const match = String(input.github_repository ?? "").trim().match(
    GITHUB_REPOSITORY_PATTERN,
  );
  invariant(
    match?.groups,
    "INVALID_GITHUB_DELIVERY_BINDING",
    "GitHub repository must use owner/name syntax",
    { field: "github_repository" },
  );
  const pushRemote = String(input.push_remote ?? "").trim();
  invariant(
    GIT_REMOTE_PATTERN.test(pushRemote),
    "INVALID_GITHUB_DELIVERY_BINDING",
    "Git push remote name is invalid",
    { field: "push_remote" },
  );
  return {
    provider: "github",
    github_repository: `${match.groups.owner.toLowerCase()}/${match.groups.name.toLowerCase()}`,
    push_remote: pushRemote,
  };
}

export function createGithubDeliveryBinding({
  request,
  normalizedRemote,
  revision,
  actor,
  confirmedAt,
}) {
  const normalized = normalizeGithubDeliveryBindingRequest(request);
  invariant(
    Number.isSafeInteger(revision) && revision >= 1,
    "INVALID_GITHUB_DELIVERY_BINDING",
    "GitHub delivery binding revision is invalid",
  );
  normalizeId("actor", actor);
  invariant(
    normalizedRemote === normalized.github_repository,
    "GITHUB_REMOTE_IDENTITY_MISMATCH",
    "Git remote does not match the confirmed GitHub repository",
    {
      expected: normalized.github_repository,
      observed: normalizedRemote,
    },
  );
  return {
    revision,
    status: "current",
    ...normalized,
    normalized_remote: normalizedRemote,
    confirmed_by: actor,
    confirmed_at: confirmedAt,
  };
}

export function createDeliveryRequest({
  changeSetId,
  planRevision,
  bundle,
  candidate,
  binding,
  createdAt,
}) {
  normalizeId("change_set_id", changeSetId);
  normalizeId("repository_id", candidate.repository_id);
  assertCommit("candidate.base_sha", candidate.base_sha);
  assertCommit("candidate.candidate_sha", candidate.candidate_sha);
  invariant(
    bundle.candidates.some(
      (subject) =>
        subject.candidate_id === candidate.candidate_id &&
        subject.candidate_sha === candidate.candidate_sha,
    ),
    "DELIVERY_CANDIDATE_NOT_IN_BUNDLE",
    "Delivery Candidate is not part of the accepted Bundle",
  );
  const identity = {
    change_set_id: changeSetId,
    plan_revision: planRevision,
    bundle_id: bundle.bundle_id,
    bundle_revision: bundle.revision,
    bundle_hash: bundle.bundle_hash,
    repository_id: candidate.repository_id,
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.candidate_sha,
    candidate_base_sha: candidate.base_sha,
    target_ref: candidate.target_ref,
    binding_revision: binding.revision,
    provider: "github",
  };
  return {
    delivery_request_id: stableId("delivery", identity),
    ...identity,
    github_repository: binding.github_repository,
    push_remote: binding.push_remote,
    remote_branch: deliveryBranchName({
      changeSetId,
      repositoryId: candidate.repository_id,
      bundleRevision: bundle.revision,
      bundleHash: bundle.bundle_hash,
    }),
    target_sha_at_publication: null,
    pull_request: null,
    state: "pending",
    integration_evidence_state: "unknown",
    attempt_count: 0,
    latest_observation_reference: null,
    observation_count: 0,
    last_error: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export function deliveryBranchName({
  changeSetId,
  repositoryId,
  bundleRevision,
  bundleHash,
}) {
  normalizeId("change_set_id", changeSetId);
  normalizeId("repository_id", repositoryId);
  invariant(
    Number.isSafeInteger(bundleRevision) && bundleRevision >= 1,
    "INVALID_DELIVERY_REQUEST",
    "Bundle revision is invalid",
  );
  invariant(
    typeof bundleHash === "string" && /^[0-9a-f]{64}$/u.test(bundleHash),
    "INVALID_DELIVERY_REQUEST",
    "Bundle hash is invalid",
  );
  // 有界前缀保留可读性，摘要防止截断后的不同稳定 ID 发生分支碰撞。
  const changePart = boundedRefPart(changeSetId, 24);
  const repositoryPart = boundedRefPart(repositoryId, 24);
  const identityHash = sha256({
    change_set_id: changeSetId,
    repository_id: repositoryId,
    bundle_revision: bundleRevision,
    bundle_hash: bundleHash,
  }).slice(0, 12);
  return `changefleet/${changePart}/${repositoryPart}/b${bundleRevision}-${identityHash}`;
}

export function branchNameFromTargetRef(targetRef) {
  invariant(
    typeof targetRef === "string" && targetRef.startsWith("refs/heads/"),
    "INVALID_DELIVERY_TARGET_REF",
    "GitHub delivery target must be a branch ref",
    { target_ref: targetRef },
  );
  return targetRef.slice("refs/heads/".length);
}

export function normalizeGithubPullRequest(input) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "INVALID_GITHUB_PULL_REQUEST",
    "GitHub pull request response must be an object",
  );
  const number = input.number;
  invariant(
    Number.isSafeInteger(number) && number >= 1,
    "INVALID_GITHUB_PULL_REQUEST",
    "GitHub pull request number is invalid",
  );
  const state = normalizePullRequestState(input.state, input.merged_at);
  const headSha = String(input.head_sha ?? "").toLowerCase();
  const baseSha = String(input.base_sha ?? "").toLowerCase();
  assertCommit("pull_request.head_sha", headSha);
  assertCommit("pull_request.base_sha", baseSha);
  const mergeCommitSha = nullableCommit(input.merge_commit_sha);
  invariant(
    typeof input.url === "string" &&
      input.url.startsWith("https://github.com/") &&
      input.url.length <= 2_048,
    "INVALID_GITHUB_PULL_REQUEST",
    "GitHub pull request URL is invalid",
  );
  return {
    number,
    url: input.url,
    state,
    is_draft: input.is_draft === true,
    head_sha: headSha,
    base_sha: baseSha,
    merge_commit_sha: mergeCommitSha,
    merged_at: boundedNullableString(input.merged_at, 64),
    merged_by: boundedNullableString(input.merged_by, 128),
    merge_state_status: boundedNullableString(input.merge_state_status, 64),
    mergeable: boundedNullableString(input.mergeable, 64),
    review_decision: boundedNullableString(input.review_decision, 64),
    checks: normalizeCheckSummary(input.checks),
  };
}

export function assertDeliveryState(value) {
  invariant(
    DELIVERY_STATES.has(value),
    "INVALID_DELIVERY_STATE",
    `Unsupported delivery state ${String(value)}`,
  );
  return value;
}

export function createDeliveryProjection(state) {
  const currentBundleId = state.bundles?.at(-1)?.bundle_id ?? null;
  const allRequests = state.delivery_requests ?? [];
  const requests = allRequests
    .filter((request) => request.bundle_id === currentBundleId)
    .sort((left, right) =>
      left.repository_id.localeCompare(right.repository_id),
    )
    .map((request) => ({
      delivery_request_id: request.delivery_request_id,
      repository_id: request.repository_id,
      bundle_revision: request.bundle_revision,
      candidate_sha: request.candidate_sha,
      target_ref: request.target_ref,
      state: assertDeliveryState(request.state),
      integration_evidence_state: request.integration_evidence_state,
      remote_branch: request.remote_branch,
      github_repository: request.github_repository,
      pull_request:
        request.pull_request === null
          ? null
          : {
              number: request.pull_request.number,
              url: request.pull_request.url,
              is_draft: request.pull_request.is_draft,
              head_sha: request.pull_request.head_sha,
              base_sha: request.pull_request.base_sha,
              state: request.pull_request.state,
              merge_commit_sha: request.pull_request.merge_commit_sha,
              merged_at: request.pull_request.merged_at,
              merged_by: request.pull_request.merged_by,
              merge_state_status:
                request.pull_request.merge_state_status,
              mergeable: request.pull_request.mergeable,
              review_decision: request.pull_request.review_decision,
              checks: structuredClone(request.pull_request.checks),
            },
      last_error:
        request.last_error === null
          ? null
          : {
              code: request.last_error.code,
              at: request.last_error.at,
            },
      updated_at: request.updated_at,
    }));
  return {
    change_set_id: state.change_set_id,
    phase: state.phase,
    activity: deliveryActivity(state, requests),
    delivery_count: requests.length,
    historical_delivery_count: allRequests.length - requests.length,
    counts: countStates(requests),
    deliveries: requests,
  };
}

function deliveryActivity(changeSet, requests) {
  if (changeSet.phase === "terminal") return "complete";
  if (requests.length === 0) return "ready";
  if (
    requests.some((request) =>
      ["candidate_diverged", "closed_unmerged", "integration_stale", "failed"].includes(
        request.state,
      ),
    )
  ) {
    return "blocked";
  }
  return requests.every((request) => request.state === "merged")
    ? "complete"
    : "running";
}

function normalizePullRequestState(value, mergedAt) {
  if (mergedAt !== null && mergedAt !== undefined) return "merged";
  const normalized = String(value ?? "").toLowerCase();
  invariant(
    new Set(["open", "closed", "merged"]).has(normalized),
    "INVALID_GITHUB_PULL_REQUEST",
    "GitHub pull request state is invalid",
  );
  return normalized;
}

function normalizeCheckSummary(value) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "INVALID_GITHUB_PULL_REQUEST",
    "GitHub check summary is invalid",
  );
  const result = {};
  for (const key of ["total", "successful", "failed", "pending", "neutral"]) {
    invariant(
      Number.isSafeInteger(value[key]) && value[key] >= 0,
      "INVALID_GITHUB_PULL_REQUEST",
      `GitHub check summary ${key} is invalid`,
    );
    result[key] = value[key];
  }
  invariant(
    result.successful + result.failed + result.pending + result.neutral ===
      result.total,
    "INVALID_GITHUB_PULL_REQUEST",
    "GitHub check summary counts do not add up",
  );
  return result;
}

function countStates(requests) {
  const result = {};
  for (const request of requests) {
    result[request.state] = (result[request.state] ?? 0) + 1;
  }
  return result;
}

function nullableCommit(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).toLowerCase();
  assertCommit("merge_commit_sha", normalized);
  return normalized;
}

function assertCommit(label, value) {
  invariant(
    typeof value === "string" && COMMIT_PATTERN.test(value),
    "INVALID_COMMIT_SHA",
    `${label} is not a commit SHA`,
  );
}

function boundedNullableString(value, maximum) {
  if (value === null || value === undefined || value === "") return null;
  invariant(
    typeof value === "string" && value.length <= maximum,
    "INVALID_GITHUB_PULL_REQUEST",
    "GitHub pull request field exceeds its bound",
  );
  return value;
}

function boundedRefPart(value, maximum) {
  return value.toLowerCase().slice(0, maximum);
}
