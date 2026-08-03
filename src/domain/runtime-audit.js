import { canonicalize, sha256, stableId } from "./canonical-json.js";
import { invariant } from "./errors.js";

export const AUDIT_PROJECTION_SCHEMA_VERSION = 1;
export const MAX_AUDIT_RUN_ROWS = 100;
export const MAX_AUDIT_USAGE_ROWS = 100;

export const USAGE_TOKEN_FIELDS = Object.freeze([
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
]);

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

// 审计层只选择 Provider 已记录的一条观察，不根据相似字段猜测请求树或重复累加子集。
export function deriveCanonicalUsage({ runId, usageObservations }) {
  invariant(
    Array.isArray(usageObservations),
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "Runtime usage observations must be an array",
    { run_id: runId },
  );
  const observations = usageObservations.map((input, index) => {
    const observation = normalizeObservation(input, { runId, index });
    return {
      observation_id: stableId("usage", {
        run_id: runId,
        index,
        observation,
      }),
      index,
      ...observation,
    };
  });
  const aggregate = observations.filter(
    (observation) => observation.scope === "aggregate",
  );
  let selected = null;
  let reason;
  let diagnostics = [];

  if (aggregate.length === 1) {
    [selected] = aggregate;
    reason = "single_provider_aggregate";
  } else if (aggregate.length === 0 && observations.length === 1) {
    [selected] = observations;
    reason = "single_unambiguous_observation";
  } else if (observations.length === 0) {
    reason = "no_usage_observation";
  } else {
    reason = "ambiguous_observation_overlap";
    diagnostics = [
      {
        code: "AMBIGUOUS_OBSERVATION_OVERLAP",
        details: {
          run_id: runId,
          observation_count: observations.length,
          aggregate_count: aggregate.length,
        },
      },
    ];
  }

  return {
    observation_count: observations.length,
    shown_observations: observations.slice(0, MAX_AUDIT_USAGE_ROWS),
    omitted_observation_count: Math.max(
      0,
      observations.length - MAX_AUDIT_USAGE_ROWS,
    ),
    canonical: selected
      ? {
          selection: "selected",
          reason,
          observation_id: selected.observation_id,
          scope: selected.scope,
          confidence: selected.confidence,
          coverage: selected.coverage,
          input_tokens: selected.input_tokens,
          cached_input_tokens: selected.cached_input_tokens,
          cache_write_input_tokens: selected.cache_write_input_tokens,
          output_tokens: selected.output_tokens,
          reasoning_output_tokens: selected.reasoning_output_tokens,
          total_tokens: selected.total_tokens,
        }
      : {
          selection: "unknown",
          reason,
          observation_id: null,
          scope: null,
          confidence: "unknown",
          coverage: "unknown",
          input_tokens: null,
          cached_input_tokens: null,
          cache_write_input_tokens: null,
          output_tokens: null,
          reasoning_output_tokens: null,
          total_tokens: null,
        },
    diagnostics,
  };
}

// generated_at 只描述查询发生时间，不参与事实载荷摘要，保证重启后可复算同一报告。
export function createAuditProjection({
  sourceIdentity,
  queryParameters,
  payload,
  generatedAt,
}) {
  invariant(
    typeof generatedAt === "string" && Number.isFinite(Date.parse(generatedAt)),
    "INVALID_AUDIT_QUERY",
    "Audit generated_at must be an ISO-compatible timestamp",
  );
  const deterministic = canonicalize({
    audit_projection_schema_version: AUDIT_PROJECTION_SCHEMA_VERSION,
    source_identity: sourceIdentity,
    query_parameters: queryParameters,
    payload,
  });
  return {
    ...deterministic,
    generated_at: generatedAt,
    payload_digest: sha256(deterministic),
  };
}

export function elapsedMilliseconds(start, finish) {
  if (start === null || start === undefined || finish === null || finish === undefined) {
    return null;
  }
  const startMs = Date.parse(start);
  const finishMs = Date.parse(finish);
  if (!Number.isFinite(startMs) || !Number.isFinite(finishMs) || finishMs < startMs) {
    return null;
  }
  return finishMs - startMs;
}

function normalizeObservation(input, { runId, index }) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "Usage observation must be an object",
    { run_id: runId, observation_index: index },
  );
  invariant(
    OBSERVATION_SCOPES.has(input.scope) &&
      CONFIDENCE_LEVELS.has(input.confidence) &&
      COVERAGE_LEVELS.has(input.coverage),
    "AUDIT_REQUIRED_REFERENCE_INVALID",
    "Usage observation classification is invalid",
    { run_id: runId, observation_index: index },
  );
  const normalized = {
    scope: input.scope,
    confidence: input.confidence,
    coverage: input.coverage,
  };
  for (const field of USAGE_TOKEN_FIELDS) {
    const value = input[field] ?? null;
    invariant(
      value === null || (Number.isSafeInteger(value) && value >= 0),
      "AUDIT_REQUIRED_REFERENCE_INVALID",
      `Usage field ${field} must be null or a non-negative integer`,
      { run_id: runId, observation_index: index, field },
    );
    normalized[field] = value;
  }
  return normalized;
}
