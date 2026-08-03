import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createAuditProjection,
  deriveCanonicalUsage,
} from "../../src/domain/runtime-audit.js";

function observation(overrides = {}) {
  return {
    scope: "aggregate",
    confidence: "provider_reported",
    coverage: "aggregate_only",
    input_tokens: 100,
    cached_input_tokens: 40,
    cache_write_input_tokens: 0,
    output_tokens: 30,
    reasoning_output_tokens: 10,
    total_tokens: 130,
    provider_cost: null,
    ...overrides,
  };
}

describe("Runtime audit derivation", () => {
  test("selects one Provider aggregate without adding cached or reasoning subsets", () => {
    const usage = deriveCanonicalUsage({
      runId: "run-1",
      usageObservations: [
        observation({ scope: "request", total_tokens: 20 }),
        observation(),
      ],
    });

    assert.equal(usage.canonical.selection, "selected");
    assert.equal(usage.canonical.reason, "single_provider_aggregate");
    assert.equal(usage.canonical.input_tokens, 100);
    assert.equal(usage.canonical.cached_input_tokens, 40);
    assert.equal(usage.canonical.output_tokens, 30);
    assert.equal(usage.canonical.reasoning_output_tokens, 10);
    assert.equal(usage.canonical.total_tokens, 130);
    assert.deepEqual(usage.diagnostics, []);
  });

  test("keeps missing usage unknown and refuses overlapping observations", () => {
    const missing = deriveCanonicalUsage({
      runId: "run-empty",
      usageObservations: [],
    });
    assert.equal(missing.canonical.selection, "unknown");
    assert.equal(missing.canonical.reason, "no_usage_observation");
    assert.equal(missing.canonical.total_tokens, null);

    const ambiguous = deriveCanonicalUsage({
      runId: "run-overlap",
      usageObservations: [
        observation({ scope: "request" }),
        observation({ scope: "step" }),
      ],
    });
    assert.equal(ambiguous.canonical.selection, "unknown");
    assert.equal(
      ambiguous.canonical.reason,
      "ambiguous_observation_overlap",
    );
    assert.equal(ambiguous.canonical.total_tokens, null);
    assert.equal(
      ambiguous.diagnostics[0].code,
      "AMBIGUOUS_OBSERVATION_OVERLAP",
    );
  });

  test("excludes generated_at from the deterministic payload digest", () => {
    const input = {
      sourceIdentity: { kind: "run", run_id: "run-1" },
      queryParameters: { run_id: "run-1" },
      payload: { observed_total_tokens: 130 },
    };
    const first = createAuditProjection({
      ...input,
      generatedAt: "2026-08-03T00:00:00.000Z",
    });
    const second = createAuditProjection({
      ...input,
      generatedAt: "2026-08-03T01:00:00.000Z",
    });
    assert.notEqual(first.generated_at, second.generated_at);
    assert.equal(first.payload_digest, second.payload_digest);
  });

  test("rejects malformed token evidence rather than treating it as zero", () => {
    assert.throws(
      () =>
        deriveCanonicalUsage({
          runId: "run-invalid",
          usageObservations: [observation({ total_tokens: -1 })],
        }),
      { code: "AUDIT_REQUIRED_REFERENCE_INVALID" },
    );
  });

  test("bounds raw observation rows while evaluating the complete set", () => {
    const usage = deriveCanonicalUsage({
      runId: "run-many",
      usageObservations: Array.from({ length: 101 }, (_, index) =>
        observation({ scope: "step", total_tokens: index }),
      ),
    });
    assert.equal(usage.observation_count, 101);
    assert.equal(usage.shown_observations.length, 100);
    assert.equal(usage.omitted_observation_count, 1);
    assert.equal(usage.canonical.reason, "ambiguous_observation_overlap");
  });
});
