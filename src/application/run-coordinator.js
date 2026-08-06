import { invokeRuntime } from "../adapters/runtime/runtime-port.js";
import { invariant } from "../domain/errors.js";

// RunCoordinator 只管理一次本机 Provider 调用的所有权；持久化与业务 phase 由调用方显式完成。
export class RunCoordinator {
  constructor({ appendEvent }) {
    invariant(
      typeof appendEvent === "function",
      "INVALID_RUN_COORDINATOR",
      "RunCoordinator requires one event sink",
    );
    this.appendEvent = appendEvent;
    this.active = new Map();
  }

  isLocallyActive(runId) {
    const controller = this.active.get(runId);
    return Boolean(controller && !controller.signal.aborted);
  }

  async invoke(runtime, runId, invocation) {
    const controller = new AbortController();
    invariant(
      !this.active.has(runId),
      "DUPLICATE_DISPATCH",
      `Run ${runId} already has one local Provider invocation`,
    );
    this.active.set(runId, controller);
    try {
      return await invokeRuntime(
        runtime,
        { ...invocation, signal: controller.signal },
        { onEvent: (event) => this.appendEvent(runId, event) },
      );
    } finally {
      this.active.delete(runId);
    }
  }

  requestInterrupt(runId, reason) {
    const controller = this.active.get(runId);
    invariant(
      controller && !controller.signal.aborted,
      "RUN_NOT_LOCALLY_ACTIVE",
      `Run ${runId} has no active invocation owned by this controller`,
    );
    controller.abort(reason);
  }
}
