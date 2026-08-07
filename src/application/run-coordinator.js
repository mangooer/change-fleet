import { invokeRuntime } from "../adapters/runtime/runtime-port.js";
import { invariant } from "../domain/errors.js";
import { createRuntimeInvocationEvidence } from "../domain/runtime-evidence.js";

// RunCoordinator 统一一次 Provider 尝试的调用所有权和终态信封；业务 phase 仍由调用方裁决。
export class RunCoordinator {
  constructor({ appendEvent, runStore, evidenceStore, idFactory, now }) {
    invariant(
      typeof appendEvent === "function" &&
        runStore &&
        evidenceStore &&
        typeof idFactory === "function" &&
        typeof now === "function",
      "INVALID_RUN_COORDINATOR",
      "RunCoordinator requires Run persistence, evidence, identity, and time boundaries",
    );
    this.appendEvent = appendEvent;
    this.runStore = runStore;
    this.evidenceStore = evidenceStore;
    this.idFactory = idFactory;
    this.now = now;
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

  async recordRuntimeEvidence({
    runId,
    invocation,
    providerEvidence,
    terminal,
  }) {
    // 最终调用证据按内容寻址；Run 和聚合状态只保存引用。
    const run = await this.runStore.read(runId);
    const payload = createRuntimeInvocationEvidence({
      run,
      invocation,
      providerEvidence,
      terminal,
    });
    const reference = await this.evidenceStore.record({
      kind: "runtime_invocation",
      subject: {
        run_id: run.run_id,
        attempt: run.attempt,
        operation: run.operation,
        change_set_id: run.change_set_id,
        work_unit_id: run.work_unit_id,
      },
      payload,
      createdAt: terminal.completed_at,
    });
    await this.runStore.update(runId, (current) => {
      current.runtime_evidence = reference;
    });
    return reference;
  }

  async completeAttempt({
    runId,
    invocation,
    providerEvidence,
    eventPayload,
    runOutcome,
    completedAt = this.now(),
  }) {
    // 所有成功尝试按同一顺序冻结输出事件、调用证据和 Run 终态。
    await this.runStore.appendEvent(runId, {
      event_id: this.idFactory("event"),
      type: "runtime.outcome",
      at: completedAt,
      payload: eventPayload,
    });
    await this.recordRuntimeEvidence({
      runId,
      invocation,
      providerEvidence,
      terminal: {
        status: "completed",
        outcome_type: eventPayload.type,
        error_code: null,
        completed_at: completedAt,
      },
    });
    await this.runStore.update(runId, (run) => {
      run.status = "completed";
      run.completed_at = completedAt;
      run.outcome = structuredClone(runOutcome);
    });
    return completedAt;
  }

  async failAttempt({
    runId,
    invocation,
    providerEvidence,
    error,
    errorCode = error.code ?? "UNEXPECTED_ERROR",
    completedAt = this.now(),
  }) {
    const status = runTerminalStatusForError(error);
    await this.recordRuntimeEvidence({
      runId,
      invocation,
      providerEvidence,
      terminal: {
        status,
        outcome_type: "failed",
        error_code: errorCode,
        completed_at: completedAt,
      },
    });
    await this.failRun(runId, error, { completedAt });
    return { status, completed_at: completedAt };
  }

  async failRun(runId, error, { completedAt = this.now() } = {}) {
    const status = runTerminalStatusForError(error);
    await this.runStore.appendEvent(runId, {
      event_id: this.idFactory("event"),
      type: `run.${status}`,
      at: completedAt,
      payload: {
        code: error.code ?? "UNEXPECTED_ERROR",
        message: error.message,
        secondary_failures: structuredClone(error.secondary_failures ?? []),
      },
    });
    await this.runStore.update(runId, (run) => {
      run.status = status;
      run.completed_at = completedAt;
      run.outcome = {
        type: status,
        code: error.code ?? "UNEXPECTED_ERROR",
        secondary_failures: structuredClone(error.secondary_failures ?? []),
      };
    });
  }
}

export function runTerminalStatusForError(error) {
  if (error?.code === "RUNTIME_CANCELLED") return "cancelled";
  if (error?.code === "RUNTIME_INTERRUPTED") return "interrupted";
  return "failed";
}
