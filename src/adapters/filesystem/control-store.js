import { mkdir } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../../domain/canonical-json.js";
import { ChangeFleetError, invariant } from "../../domain/errors.js";
import {
  assertChangeSetLifecycle,
  assertWorkUnitLifecycle,
} from "../../domain/lifecycle.js";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file.js";
import { DirectoryLock } from "./directory-lock.js";

// 当前私有存储只接受一个精确版本；未发布的旧格式不会在生产启动时被隐式改写。
export const CONTROL_SCHEMA_VERSION = 13;

export class ControlStore {
  constructor(controlRoot, { clock = () => new Date() } = {}) {
    this.controlRoot = path.resolve(controlRoot);
    this.clock = clock;
    this.catalogPath = path.join(this.controlRoot, "catalog.json");
    this.changeSetsRoot = path.join(this.controlRoot, "changesets");
    this.bundlesRoot = path.join(this.controlRoot, "bundles");
    this.locksRoot = path.join(this.controlRoot, "locks");
  }

  async initialize() {
    await Promise.all([
      mkdir(this.changeSetsRoot, { recursive: true }),
      mkdir(this.bundlesRoot, { recursive: true }),
      mkdir(this.locksRoot, { recursive: true }),
    ]);
    const lock = await this.acquireCatalogLock();
    try {
      const existing = await readJsonFile(this.catalogPath, {
        allowMissing: true,
      });
      if (!existing) {
        await writeJsonFileAtomic(this.catalogPath, {
          schema_version: CONTROL_SCHEMA_VERSION,
          projects: {},
          idempotency: {},
        });
      } else {
        assertSchema(existing, "catalog");
      }
    } finally {
      await lock.release();
    }
  }

  async readCatalog() {
    const catalog = await readJsonFile(this.catalogPath);
    assertSchema(catalog, "catalog");
    return catalog;
  }

  async transactCatalog(mutator) {
    // 目录锁串行化读改写；原子文件替换只保证单次写入完整，不能代替事务锁。
    const lock = await this.acquireCatalogLock();
    try {
      const catalog = await this.readCatalog();
      const result = await mutator(catalog);
      await writeJsonFileAtomic(this.catalogPath, catalog);
      return result;
    } finally {
      await lock.release();
    }
  }

  async createChangeSet(changeSet) {
    assertChangeSetLifecycle(changeSet);
    for (const workUnit of changeSet.work_units ?? []) {
      assertWorkUnitLifecycle(workUnit);
    }
    const changeSetId = changeSet.change_set_id;
    const lock = await this.acquireChangeSetLock(changeSetId);
    try {
      const filePath = this.changeSetPath(changeSetId);
      const existing = await readJsonFile(filePath, { allowMissing: true });
      invariant(
        !existing,
        "CHANGE_SET_ALREADY_EXISTS",
        `ChangeSet ${changeSetId} already exists`,
      );
      await writeJsonFileAtomic(filePath, changeSet);
    } finally {
      await lock.release();
    }
  }

  async readChangeSet(changeSetId) {
    const state = await readJsonFile(this.changeSetPath(changeSetId), {
      allowMissing: true,
    });
    if (!state) {
      throw new ChangeFleetError(
        "CHANGE_SET_NOT_FOUND",
        `ChangeSet ${changeSetId} does not exist`,
      );
    }
    assertSchema(state, `ChangeSet ${changeSetId}`);
    return state;
  }

  async transactChangeSet(changeSetId, mutator) {
    const lock = await this.acquireChangeSetLock(changeSetId);
    try {
      const state = await this.readChangeSet(changeSetId);
      const result = await mutator(state);
      assertChangeSetLifecycle(state);
      for (const workUnit of state.work_units ?? []) {
        assertWorkUnitLifecycle(workUnit);
      }
      await writeJsonFileAtomic(this.changeSetPath(changeSetId), state);
      return result;
    } finally {
      await lock.release();
    }
  }

  async writeBundle(bundle) {
    // Bundle 是人工审核主体，同 ID 出现不同内容必须报冲突而不能覆盖。
    const filePath = path.join(this.bundlesRoot, `${bundle.bundle_id}.json`);
    const existing = await readJsonFile(filePath, { allowMissing: true });
    if (existing) {
      invariant(
        existing.bundle_hash === bundle.bundle_hash,
        "IMMUTABLE_BUNDLE_CONFLICT",
        `Bundle ${bundle.bundle_id} already exists with different content`,
      );
      return;
    }
    await writeJsonFileAtomic(filePath, bundle);
  }

  async acquireSchedulerLock(ownerId) {
    return DirectoryLock.acquire(
      path.join(this.locksRoot, "portfolio-scheduler"),
      {
        ownerType: "portfolio_scheduler",
        ownerId,
        clock: this.clock,
      },
    );
  }

  async acquireDeliveryLock(repositoryId, targetRef, ownerId) {
    // 目标 ref 不进入文件名；稳定摘要既避免路径穿越，也让同一目标跨进程共享互斥锁。
    const destination = sha256({
      repository_id: repositoryId,
      target_ref: targetRef,
    });
    return DirectoryLock.acquire(
      path.join(this.locksRoot, "delivery", destination),
      {
        ownerType: "delivery_destination",
        ownerId,
        clock: this.clock,
      },
    );
  }

  changeSetPath(changeSetId) {
    return path.join(this.changeSetsRoot, changeSetId, "state.json");
  }

  acquireCatalogLock() {
    return DirectoryLock.acquire(path.join(this.locksRoot, "catalog"), {
      ownerType: "catalog",
      clock: this.clock,
    });
  }

  acquireChangeSetLock(changeSetId) {
    return DirectoryLock.acquire(
      path.join(this.locksRoot, "changesets", changeSetId),
      {
        ownerType: "change_set",
        ownerId: changeSetId,
        clock: this.clock,
      },
    );
  }
}

function assertSchema(record, label) {
  invariant(
    record.schema_version === CONTROL_SCHEMA_VERSION,
    "UNSUPPORTED_SCHEMA_VERSION",
    `${label} schema version ${record.schema_version} is not supported`,
  );
  if (label.startsWith("ChangeSet ")) {
    assertChangeSetRecord(record, label);
    assertChangeSetLifecycle(record);
    for (const workUnit of record.work_units) {
      assertWorkUnitLifecycle(workUnit);
    }
  }
}

const CHANGE_SET_ARRAY_FIELDS = Object.freeze([
  "repository_selection_change_requests",
  "plans",
  "planning_message_references",
  "work_units",
  "run_references",
  "candidate_checkpoints",
  "verification_admissions",
  "verification_reviews",
  "bundle_review_assessments",
  "validation_attempts",
  "candidates",
  "bundles",
  "delivery_requests",
  "decisions",
  "feedback_records",
  "gates",
  "blockers",
]);

function assertChangeSetRecord(record, label) {
  for (const field of CHANGE_SET_ARRAY_FIELDS) {
    invariant(
      Array.isArray(record[field]),
      "INVALID_CONTROL_RECORD",
      `${label} must contain the ${field} array`,
    );
  }
  invariant(
    record.task_workspace?.change_set_id === record.change_set_id &&
      typeof record.task_workspace.task_workspace_id === "string" &&
      Array.isArray(record.task_workspace.repositories) &&
      record.task_workspace.repositories.length > 0,
    "INVALID_CONTROL_RECORD",
    `${label} must contain one prepared TaskWorkspace`,
  );
}
