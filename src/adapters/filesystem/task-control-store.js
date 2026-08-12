import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../../domain/canonical-json.js";
import { ChangeFleetError, invariant } from "../../domain/errors.js";
import { normalizeId } from "../../domain/model.js";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file.js";
import { DirectoryLock } from "./directory-lock.js";

const TASK_CONTROL_SCHEMA_VERSION = 1;
const MAX_TIMELINE_TEXT_BYTES = 8 * 1024;
const DEFAULT_TIMELINE_LIMIT = 100;
const MAX_TIMELINE_LIMIT = 200;

export const DEFAULT_TASK_AUTHORIZATION = Object.freeze({
  plan_activation: "automatic",
  human_review: "required",
  delivery_publish: "on_accept",
});

// TaskControlStore 只保存任务控制命令与安全展示事件，不复制 Run 日志、diff 或原始模型输出。
export class TaskControlStore {
  constructor(controlRoot, { clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.root = path.join(path.resolve(controlRoot), "task-control");
    this.locksRoot = path.join(path.resolve(controlRoot), "locks", "task-control");
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async initialize() {
    await Promise.all([
      mkdir(this.root, { recursive: true }),
      mkdir(this.locksRoot, { recursive: true }),
    ]);
  }

  async ensureTask(changeSetId, authorization = DEFAULT_TASK_AUTHORIZATION) {
    normalizeId("change_set_id", changeSetId);
    const normalizedAuthorization = normalizeAuthorization(authorization);
    const lock = await this.acquireLock(changeSetId);
    try {
      const existing = await this.readControl(changeSetId, { allowMissing: true });
      if (existing) {
        invariant(
          sha256(existing.authorization) === sha256(normalizedAuthorization),
          "TASK_AUTHORIZATION_CONFLICT",
          `Task ${changeSetId} already has different authorization`,
        );
        return structuredClone(existing);
      }
      const now = this.clock().toISOString();
      const control = {
        schema_version: TASK_CONTROL_SCHEMA_VERSION,
        change_set_id: changeSetId,
        authorization: normalizedAuthorization,
        hold: null,
        commands: [],
        created_at: now,
        updated_at: now,
      };
      await writeJsonFileAtomic(this.controlPath(changeSetId), control);
      return structuredClone(control);
    } finally {
      await lock.release();
    }
  }

  async readTask(changeSetId, { allowMissing = false } = {}) {
    normalizeId("change_set_id", changeSetId);
    const control = await this.readControl(changeSetId, { allowMissing });
    if (control === null) return null;
    return {
      ...structuredClone(control),
      timeline: await this.readTimeline(changeSetId),
    };
  }

  async enqueue({ changeSetId, idempotencyKey, kind, payload }) {
    normalizeId("change_set_id", changeSetId);
    normalizeId("idempotency_key", idempotencyKey);
    normalizeId("task_command_kind", kind);
    const fingerprint = sha256({ kind, payload });
    const lock = await this.acquireLock(changeSetId);
    try {
      const control = await this.readControl(changeSetId);
      const existing = control.commands.find(
        (command) => command.idempotency_key === idempotencyKey,
      );
      if (existing) {
        invariant(
          existing.fingerprint === fingerprint,
          "IDEMPOTENCY_KEY_REUSED",
          `Task command idempotency key ${idempotencyKey} was reused`,
        );
        return { command: structuredClone(existing), created: false };
      }
      const command = {
        command_id: this.idFactory(),
        idempotency_key: idempotencyKey,
        fingerprint,
        kind,
        payload: structuredClone(payload),
        status: "accepted",
        attempt: 0,
        accepted_at: this.clock().toISOString(),
      };
      control.commands.push(command);
      control.updated_at = command.accepted_at;
      await writeJsonFileAtomic(this.controlPath(changeSetId), control);
      return { command: structuredClone(command), created: true };
    } finally {
      await lock.release();
    }
  }

  async claimNext(changeSetId) {
    const lock = await this.acquireLock(changeSetId);
    try {
      const control = await this.readControl(changeSetId);
      const command = control.commands.find((candidate) => candidate.status === "accepted");
      if (!command) return null;
      command.status = "running";
      command.attempt += 1;
      command.started_at = this.clock().toISOString();
      delete command.completed_at;
      delete command.error;
      control.updated_at = command.started_at;
      await writeJsonFileAtomic(this.controlPath(changeSetId), control);
      return structuredClone(command);
    } finally {
      await lock.release();
    }
  }

  async enqueueCancellation({ changeSetId, idempotencyKey, payload }) {
    normalizeId("change_set_id", changeSetId);
    normalizeId("idempotency_key", idempotencyKey);
    const fingerprint = sha256({ kind: "cancel", payload });
    const lock = await this.acquireLock(changeSetId);
    try {
      const control = await this.readControl(changeSetId);
      const existing = control.commands.find(
        (command) => command.idempotency_key === idempotencyKey,
      );
      if (existing) {
        invariant(
          existing.fingerprint === fingerprint,
          "IDEMPOTENCY_KEY_REUSED",
          `Task command idempotency key ${idempotencyKey} was reused`,
        );
        return { command: structuredClone(existing), created: false };
      }
      const cancelledAt = this.clock().toISOString();
      for (const command of control.commands) {
        if (command.status !== "accepted") continue;
        command.status = "cancelled";
        command.completed_at = cancelledAt;
      }
      const command = {
        command_id: this.idFactory(),
        idempotency_key: idempotencyKey,
        fingerprint,
        kind: "cancel",
        payload: structuredClone(payload),
        status: "accepted",
        attempt: 0,
        accepted_at: cancelledAt,
      };
      control.commands.push(command);
      control.updated_at = cancelledAt;
      await writeJsonFileAtomic(this.controlPath(changeSetId), control);
      return { command: structuredClone(command), created: true };
    } finally {
      await lock.release();
    }
  }

  async setHold(changeSetId, hold) {
    const lock = await this.acquireLock(changeSetId);
    try {
      const control = await this.readControl(changeSetId);
      control.hold =
        hold === null
          ? null
          : {
              reason: hold.reason,
              actor: hold.actor,
              created_at: hold.created_at ?? this.clock().toISOString(),
            };
      control.updated_at = this.clock().toISOString();
      await writeJsonFileAtomic(this.controlPath(changeSetId), control);
      return structuredClone(control.hold);
    } finally {
      await lock.release();
    }
  }

  async settle(changeSetId, commandId, { status, result = null, error = null }) {
    invariant(
      ["completed", "failed", "cancelled"].includes(status),
      "INVALID_TASK_COMMAND_STATUS",
      `Task command cannot settle as ${String(status)}`,
    );
    const lock = await this.acquireLock(changeSetId);
    try {
      const control = await this.readControl(changeSetId);
      const command = control.commands.find((candidate) => candidate.command_id === commandId);
      invariant(command, "TASK_COMMAND_NOT_FOUND", `Task command ${commandId} does not exist`);
      invariant(
        command.status === "running",
        "TASK_COMMAND_STATE_MISMATCH",
        `Task command ${commandId} is not running`,
      );
      command.status = status;
      command.completed_at = this.clock().toISOString();
      if (result !== null) command.result = structuredClone(result);
      if (error !== null) command.error = structuredClone(error);
      control.updated_at = command.completed_at;
      await writeJsonFileAtomic(this.controlPath(changeSetId), control);
      return structuredClone(command);
    } finally {
      await lock.release();
    }
  }

  async recoverInterruptedCommands() {
    const changeSetIds = await this.listTaskIds();
    const recovered = [];
    for (const changeSetId of changeSetIds) {
      let workerLease;
      try {
        workerLease = await this.acquireWorkerLease(changeSetId);
      } catch (error) {
        if (error.code === "LOCK_BUSY") continue;
        throw error;
      }
      let lock;
      try {
        lock = await this.acquireLock(changeSetId);
        const control = await this.readControl(changeSetId);
        let changed = false;
        for (const command of control.commands) {
          if (command.status !== "running") continue;
          command.status = "accepted";
          command.recovered_at = this.clock().toISOString();
          delete command.started_at;
          changed = true;
          recovered.push({ change_set_id: changeSetId, command_id: command.command_id });
        }
        if (changed) {
          control.updated_at = this.clock().toISOString();
          await writeJsonFileAtomic(this.controlPath(changeSetId), control);
        }
      } finally {
        if (lock) await lock.release();
        await workerLease.release();
      }
    }
    return recovered;
  }

  async listPendingTaskIds() {
    const changeSetIds = await this.listTaskIds();
    const pending = [];
    for (const changeSetId of changeSetIds) {
      const control = await this.readControl(changeSetId);
      if (control.commands.some((command) => command.status === "accepted")) {
        pending.push(changeSetId);
      }
    }
    return pending;
  }

  async appendTimelineEvent(changeSetId, event) {
    normalizeId("change_set_id", changeSetId);
    const normalized = normalizeTimelineEvent(event, this.clock, this.idFactory);
    const lock = await this.acquireLock(changeSetId);
    try {
      await this.readControl(changeSetId);
      await appendFile(
        this.timelinePath(changeSetId),
        `${JSON.stringify(normalized)}\n`,
        "utf8",
      );
      return structuredClone(normalized);
    } finally {
      await lock.release();
    }
  }

  async readTimeline(changeSetId, { limit = DEFAULT_TIMELINE_LIMIT } = {}) {
    invariant(
      Number.isInteger(limit) && limit > 0 && limit <= MAX_TIMELINE_LIMIT,
      "INVALID_TASK_TIMELINE_LIMIT",
      `Timeline limit must be between 1 and ${MAX_TIMELINE_LIMIT}`,
    );
    let content;
    try {
      content = await readFile(this.timelinePath(changeSetId), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return content
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line));
  }

  async listTaskIds() {
    const entries = await readdir(this.root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  controlPath(changeSetId) {
    return path.join(this.root, changeSetId, "control.json");
  }

  timelinePath(changeSetId) {
    return path.join(this.root, changeSetId, "timeline.jsonl");
  }

  async readControl(changeSetId, { allowMissing = false } = {}) {
    let control = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      control = await readJsonFile(this.controlPath(changeSetId), { allowMissing: true });
      if (control !== null || allowMissing) break;
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
    }
    if (control === null) {
      if (allowMissing) return null;
      throw new ChangeFleetError(
        "TASK_CONTROL_NOT_FOUND",
        `Task control record ${changeSetId} does not exist`,
      );
    }
    assertTaskControl(control, changeSetId);
    return control;
  }

  async acquireLock(changeSetId) {
    // 同一任务的短 JSON 事务允许有界等待；worker 租约仍然 fail-fast，二者不能混为一类锁。
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await DirectoryLock.acquire(path.join(this.locksRoot, changeSetId), {
          ownerType: "task_control",
          ownerId: changeSetId,
          clock: this.clock,
        });
      } catch (error) {
        if (error.code !== "LOCK_BUSY" || attempt >= 40) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5 + attempt * 2));
      }
    }
  }

  acquireWorkerLease(changeSetId) {
    return DirectoryLock.acquire(
      path.join(this.locksRoot, "workers", changeSetId),
      {
        ownerType: "task_worker",
        ownerId: changeSetId,
        clock: this.clock,
      },
    );
  }
}

function normalizeAuthorization(value) {
  invariant(value && typeof value === "object", "INVALID_TASK_AUTHORIZATION", "Task authorization is required");
  const normalized = {
    plan_activation: value.plan_activation,
    human_review: value.human_review,
    delivery_publish: value.delivery_publish,
  };
  invariant(
    normalized.plan_activation === "automatic" &&
      normalized.human_review === "required" &&
      normalized.delivery_publish === "on_accept",
    "INVALID_TASK_AUTHORIZATION",
    "The local autonomous slice requires automatic planning, human review, and publish on acceptance",
  );
  return normalized;
}

function assertTaskControl(control, changeSetId) {
  invariant(
    control.schema_version === TASK_CONTROL_SCHEMA_VERSION &&
      control.change_set_id === changeSetId &&
      Array.isArray(control.commands),
    "INVALID_TASK_CONTROL_RECORD",
    `Task control record ${changeSetId} is invalid`,
  );
  normalizeAuthorization(control.authorization);
}

function normalizeTimelineEvent(event, clock, idFactory) {
  invariant(event && typeof event === "object", "INVALID_TASK_TIMELINE_EVENT", "Timeline event is required");
  invariant(
    ["human", "agent", "system"].includes(event.role),
    "INVALID_TASK_TIMELINE_EVENT",
    "Timeline event role is invalid",
  );
  const text = String(event.text ?? "").trim();
  invariant(text.length > 0, "INVALID_TASK_TIMELINE_EVENT", "Timeline event text is required");
  invariant(
    Buffer.byteLength(text, "utf8") <= MAX_TIMELINE_TEXT_BYTES,
    "INVALID_TASK_TIMELINE_EVENT",
    "Timeline event text is too large",
  );
  return {
    event_id: event.event_id ?? idFactory(),
    command_id: event.command_id ?? null,
    role: event.role,
    stage: event.stage ?? "task",
    kind: event.kind ?? "message",
    text,
    created_at: event.created_at ?? clock().toISOString(),
  };
}
