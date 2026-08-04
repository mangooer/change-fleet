import { invariant } from "./errors.js";
import { normalizeId } from "./model.js";

// Agent Profile 是可复现的非敏感配置；凭据和值得信任的宿主路径永远不进入该对象。
export function normalizeAgentProfile(input) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "INVALID_AGENT_PROFILE",
    "Agent Profile must be an object",
  );
  const provider = requireString("agent_profile.provider", input.provider);
  const runtime = requireString("agent_profile.runtime", input.runtime);
  invariant(
    Number.isSafeInteger(input.revision) && input.revision > 0,
    "INVALID_AGENT_PROFILE",
    "Agent Profile revision must be a positive integer",
  );
  invariant(
    ["operation_scoped", "host_user"].includes(input.permissions),
    "INVALID_AGENT_PROFILE",
    "Agent Profile permissions must be operation_scoped or host_user",
  );
  const expectedNetworkAccess = input.permissions === "host_user";
  invariant(
    input.network_access === expectedNetworkAccess,
    "UNSUPPORTED_AGENT_PROFILE",
    "Agent Profile network access must match its permission mode",
  );
  invariant(
    Array.isArray(input.skills) && input.skills.length === 0,
    "UNSUPPORTED_AGENT_PROFILE",
    "Runtime Skills are deferred and the first Agent Profile requires an empty skills list",
  );

  return {
    profile_id: normalizeId("agent_profile.profile_id", input.profile_id),
    revision: input.revision,
    provider,
    runtime,
    model: requireString("agent_profile.model", input.model),
    reasoning: requireString(
      "agent_profile.reasoning",
      input.reasoning,
    ),
    permissions: input.permissions,
    network_access: expectedNetworkAccess,
    skills: [],
    credential_profile_id: optionalId(
      "agent_profile.credential_profile_id",
      input.credential_profile_id,
    ),
  };
}

function requireString(label, value) {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    "INVALID_AGENT_PROFILE",
    `${label} must be a non-empty string`,
  );
  return value.trim();
}

function optionalId(label, value) {
  // 凭据配置只保存逻辑标识，不保存 API key、token 或认证文件路径。
  if (value === undefined || value === null) return null;
  return normalizeId(label, value);
}
