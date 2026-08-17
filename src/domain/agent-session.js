import { sha256, stableId } from "./canonical-json.js";
import { normalizeAgentProfile } from "./agent-profile.js";
import { invariant } from "./errors.js";

const ALLOWED_PURPOSES = new Set([
  "planning",
  "execution",
  "verification",
  "supervision",
  "review",
  "integration",
]);

export function createAgentSessionRecords({
  taskWorkspaceId,
  assignments,
  createdAt,
}) {
  invariant(
    Array.isArray(assignments) && assignments.length > 0,
    "INVALID_AGENT_SESSION",
    "TaskWorkspace requires at least one AgentSession assignment",
  );
  const grouped = new Map();
  for (const assignment of assignments) {
    const profile = normalizeAgentProfile(assignment.agentProfile);
    const purposes = normalizePurposes(assignment.allowedRunPurposes);
    const profileDigest = sha256(profile);
    const existing = grouped.get(profileDigest);
    if (existing) {
      existing.purposes = [...new Set([...existing.purposes, ...purposes])].sort();
    } else {
      grouped.set(profileDigest, { profile, purposes });
    }
  }
  return [...grouped.values()]
    .map(({ profile, purposes }) => {
      const identity = {
        task_workspace_id: taskWorkspaceId,
        agent_profile_id: profile.profile_id,
        agent_profile_revision: profile.revision,
        allowed_run_purposes: purposes,
      };
      return {
        schema_version: 1,
        agent_session_id: stableId("agent-session", identity),
        ...identity,
        agent_profile: structuredClone(profile),
        status: "active",
        provider_session_locators: [],
        run_references: [],
        created_at: createdAt,
        closed_at: null,
      };
    })
    .sort((left, right) =>
      left.agent_session_id.localeCompare(right.agent_session_id),
    );
}

export function requireAgentSession(taskWorkspace, agentProfile, operation) {
  const normalizedProfile = normalizeAgentProfile(agentProfile);
  invariant(
    ALLOWED_PURPOSES.has(operation),
    "INVALID_AGENT_SESSION_PURPOSE",
    `AgentSession Run purpose is invalid: ${String(operation)}`,
  );
  const digest = sha256(normalizedProfile);
  const session = (taskWorkspace?.agent_sessions ?? []).find(
    (candidate) =>
      candidate.status === "active" &&
      candidate.allowed_run_purposes.includes(operation) &&
      sha256(candidate.agent_profile) === digest,
  );
  invariant(
    session,
    "AGENT_SESSION_NOT_AUTHORIZED",
    `No active AgentSession authorizes ${operation} for the selected AgentProfile`,
  );
  return session;
}

export function appendAgentSessionRun(taskWorkspace, agentSessionId, reference) {
  const session = (taskWorkspace?.agent_sessions ?? []).find(
    (candidate) => candidate.agent_session_id === agentSessionId,
  );
  invariant(
    session?.status === "active",
    "AGENT_SESSION_NOT_AUTHORIZED",
    "Run cannot be attached to an inactive or missing AgentSession",
  );
  invariant(
    session.allowed_run_purposes.includes(reference.operation),
    "AGENT_SESSION_NOT_AUTHORIZED",
    "AgentSession does not authorize the Run purpose",
  );
  invariant(
    !session.run_references.some(
      (candidate) => candidate.run_id === reference.run_id,
    ),
    "DUPLICATE_AGENT_SESSION_RUN",
    "AgentSession already contains the Run reference",
  );
  session.run_references.push(structuredClone(reference));
}

export function assertAgentSessions(taskWorkspace) {
  invariant(
    Array.isArray(taskWorkspace?.agent_sessions) &&
      taskWorkspace.agent_sessions.length > 0,
    "INVALID_AGENT_SESSION",
    "TaskWorkspace must contain AgentSessions",
  );
  const ids = new Set();
  for (const session of taskWorkspace.agent_sessions) {
    invariant(
      session?.schema_version === 1 &&
        typeof session.agent_session_id === "string" &&
        session.agent_session_id.length > 0 &&
        session.task_workspace_id === taskWorkspace.task_workspace_id &&
        ["active", "closed"].includes(session.status) &&
        (session.status === "active"
          ? session.closed_at === null
          : typeof session.closed_at === "string") &&
        Array.isArray(session.provider_session_locators) &&
        Array.isArray(session.run_references),
      "INVALID_AGENT_SESSION",
      "TaskWorkspace contains an invalid AgentSession",
    );
    normalizeAgentProfile(session.agent_profile);
    normalizePurposes(session.allowed_run_purposes);
    invariant(
      !ids.has(session.agent_session_id),
      "INVALID_AGENT_SESSION",
      "TaskWorkspace contains duplicate AgentSession ids",
    );
    ids.add(session.agent_session_id);
  }
}

function normalizePurposes(value) {
  invariant(
    Array.isArray(value) && value.length > 0,
    "INVALID_AGENT_SESSION_PURPOSE",
    "AgentSession requires at least one Run purpose",
  );
  const normalized = [...new Set(value)];
  invariant(
    normalized.length === value.length &&
      normalized.every((purpose) => ALLOWED_PURPOSES.has(purpose)),
    "INVALID_AGENT_SESSION_PURPOSE",
    "AgentSession Run purposes must be unique supported values",
  );
  return normalized.sort();
}
