import { sha256 } from "./canonical-json.js";
import { invariant } from "./errors.js";

const OBSERVATION_SCOPES = new Set([
  "request",
  "step",
  "model",
  "aggregate",
]);
const CONFIDENCE_LEVELS = new Set([
  "provider_reported",
  "estimated",
  "unknown",
]);
const COVERAGE_LEVELS = new Set([
  "complete",
  "partial",
  "aggregate_only",
  "unknown",
]);

// Runtime 证据只描述一次精确调用；跨 Run 汇总必须由查询层从不可变记录派生。
export function createRuntimeInvocationEvidence({
  run,
  invocation,
  providerEvidence,
  terminal,
}) {
  const evidence = providerEvidence ?? {};
  const startedAt = optionalTimestamp(evidence.started_at) ?? run.created_at;
  const completedAt =
    optionalTimestamp(evidence.completed_at) ?? terminal.completed_at;
  const durationMs =
    optionalNonNegativeInteger(evidence.duration_ms) ??
    Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
  const usageObservations = Array.isArray(evidence.usage_observations)
    ? evidence.usage_observations.map(normalizeUsageObservation)
    : [];

  return {
    schema_version: 1,
    invocation_id:
      optionalString(evidence.invocation_id) ??
      `${run.run_id}.attempt-${run.attempt}`,
    run_id: run.run_id,
    attempt: run.attempt,
    operation: run.operation,
    change_set_id: run.change_set_id,
    work_unit_id: run.work_unit_id,
    agent_profile: structuredClone(run.agent_profile),
    repository_harness_selection: structuredClone(
      run.repository_harness_selection ?? null,
    ),
    // Harness 可用性和 Provider 实际发现是两类证据；缺少原生事件时必须保留 unavailable。
    repository_harness_observation: structuredClone(
      run.repository_harness_observation ?? null,
    ),
    context_projection:
      run.context_projection_identity ??
      {
        schema_version: invocation.context_projection.schema_version,
        digest: sha256(invocation.context_projection),
      },
    provider: {
      name:
        optionalString(evidence.provider?.name) ?? run.agent_profile.provider,
      runtime:
        optionalString(evidence.provider?.runtime) ?? run.agent_profile.runtime,
      sdk_version: optionalString(evidence.provider?.sdk_version),
      cli_version: optionalString(evidence.provider?.cli_version),
      thread_id: optionalString(evidence.provider?.thread_id),
    },
    requested: {
      model: run.agent_profile.model,
      reasoning: run.agent_profile.reasoning,
      network_access: run.agent_profile.network_access,
      permissions: run.agent_profile.permissions,
    },
    observed: {
      effective_model: optionalString(evidence.observed?.effective_model),
    },
    timing: {
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
    },
    terminal: {
      status: normalizeTerminalStatus(terminal.status),
      outcome_type: optionalString(terminal.outcome_type),
      error_code: optionalString(terminal.error_code),
    },
    usage_observations: usageObservations,
    monetary_cost: null,
    raw_artifact_references: normalizeArtifactReferences(
      evidence.raw_artifact_references,
    ),
    evidence_classification:
      optionalString(evidence.evidence_classification) ?? "unavailable",
  };
}

export function createCodexAggregateUsageObservation(usage) {
  // reasoning_output_tokens 已包含在 output_tokens 中，不能再次累加到 total_tokens。
  if (!usage) return [];
  const normalized = {
    input_tokens: nonNegativeInteger(
      "usage.input_tokens",
      usage.input_tokens,
    ),
    cached_input_tokens: nonNegativeInteger(
      "usage.cached_input_tokens",
      usage.cached_input_tokens,
    ),
    cache_write_input_tokens: nonNegativeInteger(
      "usage.cache_write_input_tokens",
      usage.cache_write_input_tokens,
    ),
    output_tokens: nonNegativeInteger(
      "usage.output_tokens",
      usage.output_tokens,
    ),
    reasoning_output_tokens: nonNegativeInteger(
      "usage.reasoning_output_tokens",
      usage.reasoning_output_tokens,
    ),
  };
  return [
    {
      scope: "aggregate",
      confidence: "provider_reported",
      coverage: "aggregate_only",
      ...normalized,
      total_tokens: normalized.input_tokens + normalized.output_tokens,
      provider_cost: null,
    },
  ];
}

function normalizeUsageObservation(input) {
  invariant(
    input && typeof input === "object",
    "INVALID_RUNTIME_EVIDENCE",
    "Usage observation must be an object",
  );
  invariant(
    OBSERVATION_SCOPES.has(input.scope),
    "INVALID_RUNTIME_EVIDENCE",
    "Usage observation has an invalid scope",
  );
  invariant(
    CONFIDENCE_LEVELS.has(input.confidence),
    "INVALID_RUNTIME_EVIDENCE",
    "Usage observation has invalid confidence",
  );
  invariant(
    COVERAGE_LEVELS.has(input.coverage),
    "INVALID_RUNTIME_EVIDENCE",
    "Usage observation has invalid coverage",
  );
  return {
    scope: input.scope,
    confidence: input.confidence,
    coverage: input.coverage,
    input_tokens: nullableNonNegativeInteger(input.input_tokens),
    cached_input_tokens: nullableNonNegativeInteger(input.cached_input_tokens),
    cache_write_input_tokens: nullableNonNegativeInteger(
      input.cache_write_input_tokens,
    ),
    output_tokens: nullableNonNegativeInteger(input.output_tokens),
    reasoning_output_tokens: nullableNonNegativeInteger(
      input.reasoning_output_tokens,
    ),
    total_tokens: nullableNonNegativeInteger(input.total_tokens),
    provider_cost: null,
  };
}

function normalizeTerminalStatus(value) {
  invariant(
    ["completed", "failed", "cancelled", "abandoned"].includes(value),
    "INVALID_RUNTIME_EVIDENCE",
    "Runtime terminal status is invalid",
  );
  return value;
}

function normalizeArtifactReferences(value) {
  if (value === undefined || value === null) return [];
  invariant(
    Array.isArray(value) && value.every((item) => typeof item === "string"),
    "INVALID_RUNTIME_EVIDENCE",
    "Runtime artifact references must be strings",
  );
  return [...value];
}

function optionalTimestamp(value) {
  if (value === undefined || value === null) return null;
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)),
    "INVALID_RUNTIME_EVIDENCE",
    "Runtime evidence timestamp must be an ISO-compatible string",
  );
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null || value === "") return null;
  invariant(
    typeof value === "string",
    "INVALID_RUNTIME_EVIDENCE",
    "Runtime evidence string field is invalid",
  );
  return value;
}

function nonNegativeInteger(label, value) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    "INVALID_RUNTIME_EVIDENCE",
    `${label} must be a non-negative integer`,
  );
  return value;
}

function nullableNonNegativeInteger(value) {
  if (value === undefined || value === null) return null;
  return nonNegativeInteger("usage token field", value);
}

function optionalNonNegativeInteger(value) {
  if (value === undefined || value === null) return null;
  return nonNegativeInteger("runtime duration", value);
}
