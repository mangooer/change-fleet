import { mkdir } from "node:fs/promises";
import path from "node:path";

import { ChangeFleetError, invariant } from "../../domain/errors.js";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file.js";
import { DirectoryLock } from "./directory-lock.js";

// 当前快照在此管理；长输出和不可变证据由专门 Store 保存，避免聚合状态无限增长。
export const CONTROL_SCHEMA_VERSION = 1;

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
}
