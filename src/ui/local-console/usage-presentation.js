// 本模块只把只读审计事实转换成显示值；不会写控制状态，也不会进入 Agent 上下文。
export function compactMetrics(audit) {
  const outcomes = audit?.payload?.outcomes ?? {};
  const attempts = outcomes.runtime_attempts ?? {};
  const feedback = outcomes.feedback_execution ?? {};
  const usage = audit?.payload?.usage ?? {};
  return {
    token_traffic: usage.observed_total_tokens ?? null,
    non_cached_input_tokens: deriveAggregateNonCachedInputTokens(
      usage.token_fields,
    ),
    cached_input_tokens: observedTokenField(
      usage.token_fields,
      "cached_input_tokens",
    ),
    output_tokens: observedTokenField(usage.token_fields, "output_tokens"),
    runs: audit?.payload?.runs?.referenced_count ?? 0,
    failures:
      (attempts.failed ?? 0) +
      (attempts.interrupted ?? 0) +
      (attempts.cancelled ?? 0),
    rework: Object.values(feedback).reduce((sum, value) => sum + value, 0),
    duration_ms:
      audit?.payload?.timing?.provider_duration_sum?.observed_sum ?? 0,
  };
}

// 普通详情只展示便于快速比较的用量信号，累计流量和字段覆盖留在审计弹窗。
export function compactUsageLabel(metrics) {
  if (
    metrics.non_cached_input_tokens !== null &&
    metrics.output_tokens !== null
  ) {
    return `${formatNumber(metrics.non_cached_input_tokens)} 非缓存输入 · ${formatNumber(metrics.output_tokens)} 输出`;
  }
  if (metrics.token_traffic !== null) {
    return `${formatNumber(metrics.token_traffic)} token 流量`;
  }
  return "Provider 用量未观测";
}

export function agentTokenLabel(usage, isValidation) {
  // 单步审计同时显示总流量和可比较的非缓存输入/输出，不把任一项冒充金额成本。
  if (isValidation) return "无 Agent Token";
  if (usage?.total_tokens === null || usage?.total_tokens === undefined) {
    return "Token 用量未观测";
  }
  const parts = [`${formatNumber(usage.total_tokens)} token 流量`];
  const nonCachedInputTokens = deriveNonCachedInputTokens(
    usage.input_tokens,
    usage.cached_input_tokens,
  );
  if (nonCachedInputTokens !== null) {
    parts.push(`${formatNumber(nonCachedInputTokens)} 非缓存输入`);
  }
  if (Number.isSafeInteger(usage.output_tokens)) {
    parts.push(`${formatNumber(usage.output_tokens)} 输出`);
  }
  return parts.join(" · ");
}

export function metricLabel(value) {
  // “已观测”避免部分覆盖时把求和结果误解为完整 Provider 账单。
  return (
    {
      token_traffic: "已观测 Token 流量（非金额）",
      non_cached_input_tokens: "已观测非缓存输入",
      cached_input_tokens: "已观测缓存输入",
      output_tokens: "已观测输出",
      runs: "运行次数",
      failures: "失败/中断",
      rework: "返工次数",
      duration_ms: "Provider 时长 (ms)",
    }[value] ?? value
  );
}

export function formatMetricValue(value) {
  // 精确审计保留 unknown 语义，不能使用通用数字格式把 null 变成 0。
  return value === null || value === undefined ? "未观测" : formatNumber(value);
}

// 聚合查询会明确记录字段覆盖率；没有任何已知 Run 时必须显示“未观测”，不能伪装成 0。
function observedTokenField(tokenFields, field) {
  const summary = tokenFields?.[field];
  return Number.isSafeInteger(summary?.known_count) && summary.known_count > 0
    ? summary.observed_sum
    : null;
}

// 聚合推导要求输入与缓存字段覆盖同一批 Run；覆盖数不一致时宁可显示未知。
function deriveAggregateNonCachedInputTokens(tokenFields) {
  const input = tokenFields?.input_tokens;
  const cached = tokenFields?.cached_input_tokens;
  if (
    !Number.isSafeInteger(input?.known_count) ||
    input.known_count === 0 ||
    input.known_count !== cached?.known_count
  ) {
    return null;
  }
  return deriveNonCachedInputTokens(input.observed_sum, cached.observed_sum);
}

// cached_input_tokens 是 input_tokens 的子集，只在两者均已观测且关系有效时推导。
function deriveNonCachedInputTokens(inputTokens, cachedInputTokens) {
  if (
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(cachedInputTokens) ||
    cachedInputTokens > inputTokens
  ) {
    return null;
  }
  return inputTokens - cachedInputTokens;
}

// 固定中文数字格式，使普通详情、步骤审计和汇总指标保持同一表达。
function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("zh-CN");
}
