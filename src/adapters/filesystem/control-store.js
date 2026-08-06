import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../../domain/canonical-json.js";
import { ChangeFleetError, invariant } from "../../domain/errors.js";
import {
  normalizeVerificationExpectation,
  normalizeVerificationPolicy,
} from "../../domain/verification.js";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file.js";
import { DirectoryLock } from "./directory-lock.js";

// v8 增加独立验证引用；每一代迁移只补缺省字段，不反向授予 Candidate 权限。
export const CONTROL_SCHEMA_VERSION = 8;
const PREVIOUS_CONTROL_SCHEMA_VERSION = 7;
const V6_CONTROL_SCHEMA_VERSION = 6;
const LEGACY_CONTROL_SCHEMA_VERSION = 5;
const OLDEST_CONTROL_SCHEMA_VERSION = 4;

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
        await writeJsonFileAtomic(this.catalogPath, migrateCatalogV7(existing));
      } else if (existing.schema_version === V6_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV7(migrateCatalogV6(existing)),
        );
      } else if (existing.schema_version === LEGACY_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV7(migrateCatalogV6(migrateCatalogV5(existing))),
        );
      } else if (existing.schema_version === OLDEST_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV7(
            migrateCatalogV6(migrateCatalogV5(migrateCatalogV4(existing))),
          ),
        );
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
          await writeJsonFileAtomic(filePath, migrateChangeSetV7(existing));
        } else if (existing.schema_version === V6_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV7(migrateChangeSetV6(existing)),
          );
        } else if (existing.schema_version === LEGACY_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV7(
              migrateChangeSetV6(migrateChangeSetV5(existing)),
            ),
          );
        } else if (existing.schema_version === OLDEST_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV7(
              migrateChangeSetV6(
                migrateChangeSetV5(migrateChangeSetV4(existing)),
              ),
            ),
          );
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

function migrateCatalogV4(record) {
  const migrated = structuredClone(record);
  migrated.schema_version = LEGACY_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateCatalogV5(record) {
  const migrated = structuredClone(record);
  migrated.schema_version = V6_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateCatalogV6(record) {
  const migrated = structuredClone(record);
  for (const project of Object.values(migrated.projects ?? {})) {
    project.verification_policy = normalizeVerificationPolicy(
      project.verification_policy,
    );
  }
  migrated.schema_version = PREVIOUS_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateCatalogV7(record) {
  const migrated = structuredClone(record);
  migrated.schema_version = CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateChangeSetV4(record) {
  const migrated = structuredClone(record);
  migrated.candidate_checkpoints ??= [];
  migrated.validation_attempts ??= [];
  migrated.current_revision_feedback ??= null;
  for (const workUnit of migrated.work_units ?? []) {
    workUnit.candidate_checkpoint_id ??= null;
    workUnit.validation_attempt_ids ??= [];
  }
  migrated.schema_version = LEGACY_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateChangeSetV5(record) {
  const migrated = structuredClone(record);
  migrated.planning_message_references ??= [];
  migrated.current_approvable_plan_message_id ??= null;
  migrated.legacy_unconfirmed_plans ??= [];

  const confirmedPlans = [];
  const retiredRevisions = new Set();
  for (const plan of migrated.plans ?? []) {
    if (typeof plan.confirmed_at === "string") {
      confirmedPlans.push(plan);
      continue;
    }
    retiredRevisions.add(plan.revision);
    migrated.legacy_unconfirmed_plans.push({
      ...plan,
      legacy_disposition: "retired_unconfirmed_v5",
      legacy_content_digest: sha256(plan),
    });
  }
  confirmedPlans.sort((left, right) => left.revision - right.revision);
  const latestConfirmed = confirmedPlans.at(-1) ?? null;
  if (latestConfirmed) latestConfirmed.status = "confirmed";
  migrated.plans = confirmedPlans;
  migrated.current_plan_revision = latestConfirmed?.revision ?? null;
  for (const workUnit of migrated.work_units ?? []) {
    if (retiredRevisions.has(workUnit.plan_revision)) {
      workUnit.state = "retired_unconfirmed_legacy";
    }
  }
  if (
    ["awaiting_plan_confirmation", "replanning"].includes(migrated.state)
  ) {
    migrated.state = latestConfirmed ? "replanning" : "analyzing";
  }
  migrated.schema_version = V6_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateChangeSetV6(record) {
  const migrated = structuredClone(record);
  migrated.verification_policy = normalizeVerificationPolicy(
    migrated.verification_policy,
  );
  migrated.verification_admissions ??= [];
  for (const plan of migrated.plans ?? []) {
    plan.verification_expectation = normalizeVerificationExpectation(
      plan.verification_expectation,
    );
    normalizeLegacyCheck(plan.combined_check, "combined validation");
    for (const workUnit of plan.work_units ?? []) {
      normalizeLegacyCheck(
        workUnit.repository_check,
        `Repository ${workUnit.repository_id} validation`,
      );
    }
  }
  for (const workUnit of migrated.work_units ?? []) {
    workUnit.verification_admission_id ??= null;
    normalizeLegacyCheck(
      workUnit.repository_check,
      `Repository ${workUnit.repository_id} validation`,
    );
  }
  for (const candidate of migrated.candidates ?? []) {
    candidate.verification_admission_id ??= null;
  }
  migrated.schema_version = PREVIOUS_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateChangeSetV7(record) {
  const migrated = structuredClone(record);
  migrated.verification_reviews ??= [];
  for (const workUnit of migrated.work_units ?? []) {
    workUnit.verification_run_references ??= [];
    workUnit.verification_review_id ??= null;
  }
  for (const candidate of migrated.candidates ?? []) {
    candidate.verification_review_id ??= null;
  }
  migrated.schema_version = CONTROL_SCHEMA_VERSION;
  return migrated;
}

function normalizeLegacyCheck(command, fallbackRationale) {
  if (!command || typeof command !== "object") return;
  command.coverage_rationale ??= fallbackRationale;
}
