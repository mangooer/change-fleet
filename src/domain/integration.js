import { sha256, stableId } from "./canonical-json.js";
import { invariant } from "./errors.js";
import { normalizeId } from "./model.js";

export const INTEGRATION_ACTION_KINDS = Object.freeze([
  "publish_exact_candidate",
  "fast_forward_target",
]);

const ACTION_KIND_SET = new Set(INTEGRATION_ACTION_KINDS);
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u;
const REMOTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BRANCH_REF_PATTERN =
  /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,239}$/u;

export function createIntegrationActionOffer({
  changeSet,
  bundle,
  candidate,
  agentSession,
  actionKind,
  pushRemote,
  destinationRef,
  observedDestinationSha,
  offeredAt,
  expiresAt,
  idFactory,
}) {
  const normalizedKind = normalizeIntegrationActionKind(actionKind);
  const normalizedRemote = normalizePushRemote(pushRemote);
  const normalizedRef = normalizeBranchRef(destinationRef);
  const observedSha = normalizeOptionalCommit(observedDestinationSha);
  invariant(
    candidate.repository_id === agentSession.repository_id ||
      agentSession.repository_id === undefined,
    "INTEGRATION_SUBJECT_MISMATCH",
    "AgentSession Repository scope does not match the Candidate",
  );
  if (normalizedKind === "publish_exact_candidate") {
    invariant(
      normalizedRef !== candidate.target_ref &&
        normalizedRef.startsWith("refs/heads/changefleet/"),
      "INVALID_INTEGRATION_DESTINATION",
      "Exact publication requires a non-target changefleet branch",
    );
    invariant(
      observedSha === null || observedSha === candidate.candidate_sha,
      "INTEGRATION_DESTINATION_DIVERGED",
      "Publication destination already points at another commit",
    );
  } else {
    invariant(
      normalizedRef === candidate.target_ref,
      "INVALID_INTEGRATION_DESTINATION",
      "Fast-forward integration must target the Candidate target ref",
    );
    invariant(
      observedSha === candidate.base_sha ||
        observedSha === candidate.candidate_sha,
      "INTEGRATION_TARGET_MOVED",
      "Fast-forward target no longer matches the exact base or Candidate",
    );
  }
  const subject = {
    change_set_id: changeSet.change_set_id,
    task_workspace_id: changeSet.task_workspace.task_workspace_id,
    bundle_id: bundle.bundle_id,
    bundle_revision: bundle.revision,
    bundle_hash: bundle.bundle_hash,
    repository_id: candidate.repository_id,
    candidate_id: candidate.candidate_id,
    candidate_base_sha: candidate.base_sha,
    candidate_sha: candidate.candidate_sha,
    target_ref: candidate.target_ref,
    action_kind: normalizedKind,
    push_remote: normalizedRemote,
    destination_ref: normalizedRef,
    observed_destination_sha: observedSha,
    agent_session_id: agentSession.agent_session_id,
    agent_profile_id: agentSession.agent_profile.profile_id,
    agent_profile_revision: agentSession.agent_profile.revision,
    permission_mode: agentSession.agent_profile.permissions,
    action_contract: {
      mutation_scope: "one_exact_remote_branch_ref",
      force_allowed: false,
      refspec: `${candidate.candidate_sha}:${normalizedRef}`,
    },
    preflight_contract: {
      kind: "exact_local_commits_and_remote_ref_v1",
      expected_destination_sha: observedSha,
    },
    result_observer: {
      kind: "independent_git_ls_remote_v1",
      accepted_destination_sha: candidate.candidate_sha,
    },
    accepted_result_schema: "exact_remote_ref_equals_candidate_v1",
    recovery_boundary: {
      mode: "observe_then_retry_same_grant",
      partial_success_is_durable_fact: true,
    },
  };
  return {
    schema_version: 1,
    action_offer_id: idFactory("integration-offer"),
    input_digest: sha256(subject),
    ...subject,
    status: "offered",
    maximum_attempts: 2,
    offered_at: offeredAt,
    expires_at: expiresAt,
  };
}

export function createActionGrant({ offer, actor, grantedAt, idFactory }) {
  normalizeId("integration_action_offer_id", offer.action_offer_id);
  invariant(
    offer.status === "offered",
    "INTEGRATION_OFFER_NOT_CURRENT",
    "Integration action offer is not available for a grant",
  );
  const normalizedActor = normalizeId("actor", actor);
  return {
    schema_version: 1,
    action_grant_id: idFactory("action-grant"),
    action_offer_id: offer.action_offer_id,
    input_digest: offer.input_digest,
    change_set_id: offer.change_set_id,
    task_workspace_id: offer.task_workspace_id,
    bundle_id: offer.bundle_id,
    bundle_revision: offer.bundle_revision,
    bundle_hash: offer.bundle_hash,
    repository_id: offer.repository_id,
    candidate_id: offer.candidate_id,
    candidate_base_sha: offer.candidate_base_sha,
    candidate_sha: offer.candidate_sha,
    target_ref: offer.target_ref,
    action_kind: offer.action_kind,
    push_remote: offer.push_remote,
    destination_ref: offer.destination_ref,
    observed_destination_sha: offer.observed_destination_sha,
    agent_session_id: offer.agent_session_id,
    agent_profile_id: offer.agent_profile_id,
    agent_profile_revision: offer.agent_profile_revision,
    permission_mode: offer.permission_mode,
    action_contract: structuredClone(offer.action_contract),
    preflight_contract: structuredClone(offer.preflight_contract),
    result_observer: structuredClone(offer.result_observer),
    accepted_result_schema: offer.accepted_result_schema,
    recovery_boundary: structuredClone(offer.recovery_boundary),
    maximum_attempts: offer.maximum_attempts,
    attempt_count: 0,
    status: "granted",
    granted_by: normalizedActor,
    granted_at: grantedAt,
    expires_at: offer.expires_at,
    current_run_id: null,
    result_id: null,
  };
}

export function assertCurrentActionGrant({
  state,
  grant,
  now,
  allowRunning = false,
}) {
  invariant(
    grant?.schema_version === 1 &&
      (grant.status === "granted" ||
        (allowRunning && grant.status === "running")) &&
      Date.parse(grant.expires_at) > Date.parse(now),
    "ACTION_GRANT_NOT_CURRENT",
    "ActionGrant is missing, expired, or no longer executable",
  );
  const bundle = state.bundles.at(-1);
  const candidate = state.candidates.find(
    (item) => item.candidate_id === grant.candidate_id,
  );
  const accepted = state.decisions.some(
    (decision) =>
      decision.type === "bundle_review" &&
      decision.decision === "accept" &&
      decision.bundle_revision === grant.bundle_revision &&
      decision.bundle_hash === grant.bundle_hash,
  );
  invariant(
    state.phase === "review" &&
      accepted &&
      bundle?.bundle_id === grant.bundle_id &&
      bundle.revision === grant.bundle_revision &&
      bundle.bundle_hash === grant.bundle_hash &&
      candidate?.candidate_sha === grant.candidate_sha &&
      candidate.base_sha === grant.candidate_base_sha &&
      state.task_workspace.task_workspace_id === grant.task_workspace_id &&
      grant.attempt_count < grant.maximum_attempts,
    "ACTION_GRANT_SUBJECT_CHANGED",
    "ActionGrant no longer binds the current accepted integration subject",
  );
  return { bundle, candidate };
}

export function createIntegrationResult({
  grant,
  runId,
  evidence,
  observedDestinationSha,
  completedAt,
  idFactory,
}) {
  invariant(
    observedDestinationSha === grant.candidate_sha,
    "INTEGRATION_RESULT_DIVERGED",
    "Observed integration result does not equal the exact Candidate",
  );
  return {
    schema_version: 1,
    integration_result_id: idFactory("integration-result"),
    action_grant_id: grant.action_grant_id,
    action_kind: grant.action_kind,
    change_set_id: grant.change_set_id,
    bundle_id: grant.bundle_id,
    bundle_revision: grant.bundle_revision,
    bundle_hash: grant.bundle_hash,
    repository_id: grant.repository_id,
    candidate_id: grant.candidate_id,
    candidate_sha: grant.candidate_sha,
    destination_ref: grant.destination_ref,
    observed_destination_sha: observedDestinationSha,
    run_id: runId,
    evidence: structuredClone(evidence),
    status: "succeeded",
    completed_at: completedAt,
  };
}

export function normalizeIntegrationActionKind(value) {
  invariant(
    ACTION_KIND_SET.has(value),
    "INVALID_INTEGRATION_ACTION",
    `Unsupported integration action ${String(value)}`,
  );
  return value;
}

export function normalizePushRemote(value) {
  const normalized = String(value ?? "").trim();
  invariant(
    REMOTE_PATTERN.test(normalized),
    "INVALID_INTEGRATION_REMOTE",
    "Integration push remote name is invalid",
  );
  return normalized;
}

export function normalizeBranchRef(value) {
  const normalized = String(value ?? "").trim();
  invariant(
    BRANCH_REF_PATTERN.test(normalized) && !normalized.includes(".."),
    "INVALID_INTEGRATION_DESTINATION",
    "Integration destination must be one exact branch ref",
  );
  return normalized;
}

function normalizeOptionalCommit(value) {
  if (value === null || value === undefined) return null;
  invariant(
    typeof value === "string" && COMMIT_PATTERN.test(value),
    "INVALID_COMMIT_SHA",
    "Observed integration destination SHA is invalid",
  );
  return value;
}
