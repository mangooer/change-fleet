import { randomUUID } from "node:crypto";

import { stableId } from "../domain/canonical-json.js";
import { DEFAULT_TASK_AUTHORIZATION } from "../adapters/filesystem/task-control-store.js";
import { invariant } from "../domain/errors.js";
import { createDeliveryProjection } from "../domain/github-delivery.js";
import { diagnosticMessage } from "../domain/diagnostics.js";

const TRANSIENT_DELIVERY_ERRORS = new Set([
  "GIT_REMOTE_READ_FAILED",
  "DELIVERY_GIT_PUSH_FAILED",
  "GITHUB_COMMAND_FAILED",
]);
const MAX_DELIVERY_ATTEMPTS = 3;

// 该控制器只选择 Core 已提供的确定性操作，不解释代码、不扩权，也不替 Agent 决定如何实现。
export class AutonomousTaskController {
  constructor({ service, taskControlStore, idFactory = randomUUID }) {
    invariant(service && typeof service === "object", "INVALID_TASK_CONTROLLER", "Task controller requires the lifecycle service");
    invariant(
      taskControlStore && typeof taskControlStore.enqueue === "function",
      "INVALID_TASK_CONTROLLER",
      "Task controller requires the durable task control store",
    );
    this.service = service;
    this.taskControlStore = taskControlStore;
    this.idFactory = idFactory;
    this.running = new Map();
    this.deliveryTimers = new Map();
    this.deliveryMonitors = new Set();
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.taskControlStore.recoverInterruptedCommands();
    for (const changeSetId of await this.taskControlStore.listPendingTaskIds()) {
      this.schedule(changeSetId);
    }
    for (const changeSetId of await this.taskControlStore.listTaskIds()) {
      const state = await this.service.readChangeSet(changeSetId);
      if (createDeliveryProjection(state).activity === "running") {
        this.scheduleDeliveryMonitor(changeSetId);
      }
    }
  }

  async stop() {
    this.started = false;
    for (const timer of this.deliveryTimers.values()) clearTimeout(timer);
    this.deliveryTimers.clear();
    await Promise.allSettled([
      ...this.running.values(),
      ...this.deliveryMonitors.values(),
    ]);
  }

  async createChangeSet(request) {
    const created = await this.service.createChangeSet(request);
    await this.taskControlStore.ensureTask(
      request.change_set_id,
      DEFAULT_TASK_AUTHORIZATION,
    );
    const queued = await this.taskControlStore.enqueue({
      changeSetId: request.change_set_id,
      idempotencyKey: `task-${request.idempotency_key}`,
      kind: "initial_plan",
      payload: {},
    });
    if (queued.created) {
      await this.taskControlStore.appendTimelineEvent(request.change_set_id, {
        command_id: queued.command.command_id,
        role: "human",
        stage: "intake",
        text: request.intent.objective,
      });
    }
    this.schedule(request.change_set_id);
    return acceptedResult(request.change_set_id, queued.command, created);
  }

  async sendTaskMessage(request) {
    await this.taskControlStore.ensureTask(
      request.change_set_id,
      DEFAULT_TASK_AUTHORIZATION,
    );
    const queued = await this.taskControlStore.enqueue({
      changeSetId: request.change_set_id,
      idempotencyKey: request.idempotency_key,
      kind: "message",
      payload: {
        idempotency_key: request.idempotency_key,
        change_set_id: request.change_set_id,
        message: request.message,
        actor: request.actor ?? "human",
      },
    });
    await this.taskControlStore.setHold(request.change_set_id, null);
    if (queued.created) {
      await this.taskControlStore.appendTimelineEvent(request.change_set_id, {
        command_id: queued.command.command_id,
        role: "human",
        stage: "task",
        text: request.message,
      });
    }
    this.schedule(request.change_set_id);
    return acceptedResult(request.change_set_id, queued.command);
  }

  async runTaskController(request) {
    await this.taskControlStore.setHold(request.change_set_id, null);
    return this.enqueueControlCommand(request, "resume", {
      idempotency_key: request.idempotency_key,
      change_set_id: request.change_set_id,
      actor: request.actor ?? "human",
    });
  }

  async interruptRun(request) {
    const result = await this.service.interruptRun(request);
    await this.taskControlStore.ensureTask(
      request.change_set_id,
      DEFAULT_TASK_AUTHORIZATION,
    );
    await this.taskControlStore.setHold(request.change_set_id, {
      reason: "operator_paused",
      actor: request.actor ?? "human",
    });
    return result;
  }

  async recordBundleDecision(request) {
    const decision = await this.service.recordBundleDecision(request);
    if (request.decision !== "accept") return decision;
    const queued = await this.enqueueControlCommand(
      {
        change_set_id: request.change_set_id,
        idempotency_key: `publish-${request.idempotency_key}`,
      },
      "publish",
      {
        idempotency_key: `delivery-${request.idempotency_key}`,
        change_set_id: request.change_set_id,
        actor: "task-controller",
        title: null,
        body: null,
      },
    );
    return { ...decision, delivery_command: queued.command };
  }

  async publishDelivery(request) {
    return this.enqueueControlCommand(request, "publish", request);
  }

  async refreshDelivery(request) {
    return this.enqueueControlCommand(request, "refresh_delivery", request);
  }

  async cancelChangeSet(request) {
    await this.taskControlStore.ensureTask(
      request.change_set_id,
      DEFAULT_TASK_AUTHORIZATION,
    );
    const queued = await this.taskControlStore.enqueueCancellation({
      changeSetId: request.change_set_id,
      idempotencyKey: request.idempotency_key,
      payload: {
        idempotency_key: `close-${request.idempotency_key}`,
        change_set_id: request.change_set_id,
        actor: request.actor ?? "human",
        reason: {
          code: "no_longer_needed",
          summary: request.summary ?? "Operator cancelled the task",
        },
      },
    });
    const state = await this.service.readChangeSet(request.change_set_id);
    for (const reference of state.run_references.filter(
      (candidate) => candidate.status === "running",
    )) {
      await this.service.interruptRun({
        idempotency_key: `cancel-${reference.run_id}`,
        change_set_id: request.change_set_id,
        run_id: reference.run_id,
        actor: request.actor ?? "human",
      });
    }
    this.schedule(request.change_set_id);
    return acceptedResult(request.change_set_id, queued.command);
  }

  async enqueueControlCommand(request, kind, payload) {
    await this.taskControlStore.ensureTask(
      request.change_set_id,
      DEFAULT_TASK_AUTHORIZATION,
    );
    const queued = await this.taskControlStore.enqueue({
      changeSetId: request.change_set_id,
      idempotencyKey: request.idempotency_key,
      kind,
      payload,
    });
    this.schedule(request.change_set_id);
    return acceptedResult(request.change_set_id, queued.command);
  }

  schedule(changeSetId) {
    if (!this.started || this.running.has(changeSetId)) return;
    const promise = this.drain(changeSetId).catch(async (error) => {
      if (!this.started) return;
      try {
        await this.taskControlStore.appendTimelineEvent(changeSetId, {
          role: "system",
          stage: "task",
          kind: "error",
          text: `后台控制器暂停：${safeErrorMessage(error)}`,
        });
      } catch {
        // 展示事件写入失败不能制造第二个未处理异常；精确命令状态仍留在 TaskControlStore。
      }
    }).finally(() => {
      this.running.delete(changeSetId);
      if (this.started) {
        void this.taskControlStore.readTask(changeSetId).then((task) => {
          if (task.commands.some((command) => command.status === "accepted")) {
            const retry = setTimeout(() => this.schedule(changeSetId), 250);
            retry.unref?.();
          }
        });
      }
    });
    this.running.set(changeSetId, promise);
  }

  async drain(changeSetId) {
    let workerLease;
    try {
      workerLease = await this.taskControlStore.acquireWorkerLease(changeSetId);
    } catch (error) {
      if (error.code === "LOCK_BUSY") return;
      throw error;
    }
    try {
      while (this.started) {
        const command = await this.taskControlStore.claimNext(changeSetId);
        if (!command) return;
        try {
          const result = await this.executeCommand(changeSetId, command);
          await this.taskControlStore.settle(changeSetId, command.command_id, {
            status: "completed",
            result: summarizeResult(result),
          });
        } catch (error) {
          await this.taskControlStore.settle(changeSetId, command.command_id, {
            status: "failed",
            error: safeCommandError(error),
          });
          await this.taskControlStore.appendTimelineEvent(changeSetId, {
            command_id: command.command_id,
            role: "system",
            stage: stageForCommand(command.kind),
            kind: "error",
            text: `任务暂停：${safeErrorMessage(error)}`,
          });
        }
      }
    } finally {
      await workerLease.release();
    }
  }

  async executeCommand(changeSetId, command) {
    switch (command.kind) {
      case "initial_plan":
        return this.planAndAdvance(changeSetId, command, null);
      case "message": {
        const result = await this.service.sendTaskMessage(command.payload);
        await this.appendAgentResult(changeSetId, command, result);
        if (result.status === "plan_ready") {
          return this.confirmAndAdvance(changeSetId, command, result.message);
        }
        return result;
      }
      case "resume":
        return this.service.runTaskController(command.payload);
      case "publish":
        return this.deliveryOperation(
          changeSetId,
          (attempt) =>
            this.service.publishDelivery({
              ...command.payload,
              idempotency_key: `${command.payload.idempotency_key}-a${attempt}`,
            }),
        );
      case "refresh_delivery":
        return this.deliveryOperation(
          changeSetId,
          (attempt) =>
            this.service.refreshDelivery({
              ...command.payload,
              idempotency_key: `${command.payload.idempotency_key}-a${attempt}`,
            }),
        );
      case "cancel":
        return this.closeWhenQuiescent(command.payload);
      default:
        throw new Error(`Unsupported task command ${command.kind}`);
    }
  }

  async planAndAdvance(changeSetId, command, message) {
    const result = await this.service.planChangeSet({
      idempotency_key: `plan-${command.command_id}`,
      change_set_id: changeSetId,
      message,
    });
    await this.appendAgentResult(changeSetId, command, result);
    if (result.status !== "plan_ready") return result;
    return this.confirmAndAdvance(changeSetId, command, result.message);
  }

  async confirmAndAdvance(changeSetId, command, message) {
    const confirmation = await this.service.confirmPlanMessage({
      idempotency_key: `confirm-${command.command_id}`,
      change_set_id: changeSetId,
      message_id: message.message_id,
      content_digest: message.content_digest,
      actor: "task-controller",
      run_after_confirmation: false,
    });
    await this.taskControlStore.appendTimelineEvent(changeSetId, {
      command_id: command.command_id,
      role: "system",
      stage: "planning",
      kind: "plan_activated",
      text: "计划已按任务授权自动确定，开始执行。",
    });
    const controller = await this.service.runTaskController({
      idempotency_key: `run-${command.command_id}`,
      change_set_id: changeSetId,
      actor: "task-controller",
    });
    await this.taskControlStore.appendTimelineEvent(changeSetId, {
      command_id: command.command_id,
      role: "system",
      stage: "review",
      kind: "stage_completed",
      text: "自动执行已推进到当前稳定检查点。",
    });
    return { confirmation, controller };
  }

  async appendAgentResult(changeSetId, command, result) {
    const text = result?.message?.text;
    if (typeof text !== "string" || text.trim().length === 0) return;
    await this.taskControlStore.appendTimelineEvent(changeSetId, {
      command_id: command.command_id,
      role: "agent",
      stage: "planning",
      text,
    });
  }

  async retryDelivery(operation) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        if (!TRANSIENT_DELIVERY_ERRORS.has(error?.code) || attempt >= MAX_DELIVERY_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  async deliveryOperation(changeSetId, operation) {
    const result = await this.retryDelivery(operation);
    if (result?.activity === "running") this.scheduleDeliveryMonitor(changeSetId);
    return result;
  }

  async closeWhenQuiescent(payload) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        return await this.service.closeChangeSet(payload);
      } catch (error) {
        if (error?.code !== "CHANGE_SET_NOT_QUIESCENT") throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return this.service.closeChangeSet(payload);
  }

  scheduleDeliveryMonitor(changeSetId) {
    if (!this.started || this.deliveryTimers.has(changeSetId)) return;
    const timer = setTimeout(() => {
      this.deliveryTimers.delete(changeSetId);
      const monitor = this.monitorDelivery(changeSetId).finally(() =>
        this.deliveryMonitors.delete(monitor),
      );
      this.deliveryMonitors.add(monitor);
    }, 10_000);
    timer.unref?.();
    this.deliveryTimers.set(changeSetId, timer);
  }

  async monitorDelivery(changeSetId) {
    if (!this.started) return;
    try {
      const state = await this.service.readChangeSet(changeSetId);
      const monitorId = stableId("delivery-monitor", {
        change_set_id: changeSetId,
        bundle_hash: state.bundles.at(-1)?.bundle_hash ?? null,
        observations: (state.delivery_requests ?? []).map((request) => ({
          delivery_request_id: request.delivery_request_id,
          observation_count: request.observation_count ?? 0,
          state: request.state,
        })),
      });
      const result = await this.retryDelivery((attempt) =>
        this.service.refreshDelivery({
          idempotency_key: `${monitorId}-a${attempt}`,
          change_set_id: changeSetId,
        }),
      );
      if (result?.activity === "running") this.scheduleDeliveryMonitor(changeSetId);
    } catch (error) {
      if (!this.started) return;
      await this.taskControlStore.appendTimelineEvent(changeSetId, {
        role: "system",
        stage: "delivery",
        kind: "error",
        text: `交付状态监控暂停：${safeErrorMessage(error)}`,
      });
    }
  }
}

function acceptedResult(changeSetId, command, result = null) {
  return {
    change_set_id: changeSetId,
    accepted: true,
    command: {
      command_id: command.command_id,
      kind: command.kind,
      status: command.status,
      accepted_at: command.accepted_at,
    },
    result,
  };
}

function summarizeResult(result) {
  return {
    status: result?.status ?? result?.controller?.status ?? "completed",
    phase: result?.phase ?? result?.controller?.phase ?? null,
    plan_revision: result?.plan_revision ?? result?.confirmation?.plan_revision ?? null,
  };
}

function safeCommandError(error) {
  const code = typeof error?.code === "string" ? error.code : "TASK_COMMAND_FAILED";
  return {
    code,
    message: safeErrorMessage({ code }),
  };
}

function safeErrorMessage(error) {
  const code = typeof error?.code === "string" ? error.code : "TASK_COMMAND_FAILED";
  return diagnosticMessage(code, "zh-CN");
}

function stageForCommand(kind) {
  if (kind === "initial_plan") return "planning";
  if (kind === "publish" || kind === "refresh_delivery") return "delivery";
  if (kind === "cancel") return "task";
  return "task";
}
