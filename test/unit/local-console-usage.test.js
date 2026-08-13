import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  agentTokenLabel,
  compactMetrics,
  compactUsageLabel,
  formatMetricValue,
} from "../../src/ui/local-console/usage-presentation.js";

describe("Local console usage presentation", () => {
  test("separates observed traffic, cached input, non-cached input, and output", () => {
    // cached_input_tokens 是 input_tokens 子集，不能再次加入总流量或当成金额折扣。
    const metrics = compactMetrics(
      auditWithUsage({
        observedTotal: 130,
        input: tokenField(100, 2),
        cached: tokenField(60, 2),
        output: tokenField(30, 2),
      }),
    );

    assert.equal(metrics.token_traffic, 130);
    assert.equal(metrics.cached_input_tokens, 60);
    assert.equal(metrics.non_cached_input_tokens, 40);
    assert.equal(metrics.output_tokens, 30);
    assert.equal(compactUsageLabel(metrics), "40 非缓存输入 · 30 输出");
    assert.equal(
      agentTokenLabel(
        {
          input_tokens: 100,
          cached_input_tokens: 60,
          output_tokens: 30,
          total_tokens: 130,
        },
        false,
      ),
      "130 token 流量 · 40 非缓存输入 · 30 输出",
    );
  });

  test("preserves unknown semantics and rejects mismatched aggregate coverage", () => {
    // 不同字段没有覆盖同一批 Run 时，非缓存输入无法可靠相减。
    const metrics = compactMetrics(
      auditWithUsage({
        observedTotal: 130,
        input: tokenField(100, 2),
        cached: tokenField(60, 1),
        output: null,
      }),
    );

    assert.equal(metrics.non_cached_input_tokens, null);
    assert.equal(metrics.output_tokens, null);
    assert.equal(compactUsageLabel(metrics), "130 token 流量");
    assert.equal(formatMetricValue(null), "未观测");
    assert.equal(agentTokenLabel(null, false), "Token 用量未观测");
    assert.equal(agentTokenLabel(null, true), "无 Agent Token");
  });
});

function auditWithUsage({ observedTotal, input, cached, output }) {
  // 夹具只构造 UI 消费的只读投影，不伪造 Provider 证据或持久状态。
  return {
    payload: {
      usage: {
        observed_total_tokens: observedTotal,
        token_fields: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
        },
      },
      outcomes: {},
      runs: { referenced_count: 2 },
      timing: {},
    },
  };
}

function tokenField(observedSum, knownCount) {
  // 字段形状与 RuntimeAuditQueryService 的稳定聚合结果一致。
  return { observed_sum: observedSum, known_count: knownCount };
}
