import { invariant } from "../../domain/errors.js";

// 端口只约束结构化调用与结果；Provider SDK、模型和子 Agent 策略留在适配器内部。
export async function invokeRuntime(runtime, invocation) {
  invariant(
    runtime && typeof runtime.invoke === "function",
    "INVALID_RUNTIME_ADAPTER",
    "Runtime adapter must implement invoke(invocation)",
  );
  const outcome = await runtime.invoke(invocation);
  invariant(
    outcome && typeof outcome === "object" && typeof outcome.type === "string",
    "INVALID_RUNTIME_OUTCOME",
    "Runtime outcome must be a typed object",
  );
  return outcome;
}

export async function measureInitialContext(runtime, invocation) {
  // 测量能力可选；缺失时上层记录 unknown，而不是伪造或拒绝所有 Runtime。
  if (!runtime || typeof runtime.measureInitialContext !== "function") {
    return null;
  }
  return runtime.measureInitialContext(invocation);
}
