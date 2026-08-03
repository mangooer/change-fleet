import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../../domain/canonical-json.js";
import { ChangeFleetError, invariant } from "../../domain/errors.js";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file.js";
import { DirectoryLock } from "./directory-lock.js";

// v4 只增加 GitHub 绑定和有界交付请求；v3 私有快照可原地、可重入地迁移。
export const CONTROL_SCHEMA_VERSION = 4;
const PREVIOUS_CONTROL_SCHEMA_VERSION = 3;

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
      } else if (existing.schema_version === PREVIOUS_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(this.catalogPath, migrateCatalogV3(existing));
      } else {
        assertSchema(existing, "catalog");
      }
    } finally {
      await lock.release();
    }
    await this.migrateChangeSets();
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


  async migrateChangeSets() {
    const entries = await readdir(this.changeSetsRoot, {
      withFileTypes: true,
    });
    for (const entry of entries
      .filter((candidate) => candidate.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const lock = await this.acquireChangeSetLock(entry.name);
      try {
        const filePath = this.changeSetPath(entry.name);
        const existing = await readJsonFile(filePath, { allowMissing: true });
        if (!existing) continue;
        if (existing.schema_version === PREVIOUS_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(filePath, migrateChangeSetV3(existing));
        } else {
          assertSchema(existing, `ChangeSet ${entry.name}`);
        }
      } finally {
        await lock.release();
      }
    }
  }
}

function assertSchema(record, label) {
  invariant(
    record.schema_version === CONTROL_SCHEMA_VERSION,
    "UNSUPPORTED_SCHEMA_VERSION",
    `${label} schema version ${record.schema_version} is not supported`,
  );
}

function migrateCatalogV3(record) {
  const migrated = structuredClone(record);
  for (const project of Object.values(migrated.projects ?? {})) {
    for (const repository of project.repositories ?? []) {
      repository.delivery_binding_revisions ??= [];
      repository.current_delivery_binding_revision ??= null;
    }
  }
  migrated.schema_version = CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateChangeSetV3(record) {
  const migrated = structuredClone(record);
  migrated.delivery_requests ??= [];
  migrated.schema_version = CONTROL_SCHEMA_VERSION;
  return migrated;
}
