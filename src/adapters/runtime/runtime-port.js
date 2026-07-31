import { invariant } from "../../domain/errors.js";

// 端口同时返回业务结果和上下文外 Provider 证据，但不向领域层泄漏 SDK 事件类型。
export async function invokeRuntime(runtime, invocation, { onEvent } = {}) {
  invariant(
    runtime && typeof runtime.invoke === "function",
    "INVALID_RUNTIME_ADAPTER",
    "Runtime adapter must implement invoke(invocation)",
  );
  const result = await runtime.invoke(invocation, { onEvent });
  invariant(
    result &&
      typeof result === "object" &&
      result.outcome &&
      typeof result.outcome === "object" &&
      typeof result.outcome.type === "string",
    "INVALID_RUNTIME_OUTCOME",
    "Runtime result must contain a typed outcome",
  );
  invariant(
    result.provider_evidence &&
      typeof result.provider_evidence === "object" &&
      !Array.isArray(result.provider_evidence),
    "INVALID_RUNTIME_EVIDENCE",
    "Runtime result must contain Provider evidence",
  );
  return result;
}

export async function measureInitialContext(runtime, invocation) {
  // 测量能力可选；缺失时上层记录 unknown，而不是伪造或拒绝所有 Runtime。
  if (!runtime || typeof runtime.measureInitialContext !== "function") {
    return null;
  }
  return runtime.measureInitialContext(invocation);
}
