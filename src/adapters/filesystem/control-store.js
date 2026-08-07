import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../../domain/canonical-json.js";
import { ChangeFleetError, invariant } from "../../domain/errors.js";
import {
  normalizeVerificationExpectation,
  normalizeVerificationPolicy,
} from "../../domain/verification.js";
import {
  assertChangeSetLifecycle,
  assertWorkUnitLifecycle,
} from "../../domain/lifecycle.js";
import {
  normalizePlanSupervision,
  normalizeSupervisionPolicy,
} from "../../domain/supervision.js";
import {
  normalizeBundleReviewPolicy,
  normalizePlanBundleReview,
} from "../../domain/bundle-review.js";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file.js";
import { DirectoryLock } from "./directory-lock.js";

// v12 固化 Bundle Review 准入；旧 Plan 一律迁移为 none，升级不能静默产生模型费用。
export const CONTROL_SCHEMA_VERSION = 12;
const PREVIOUS_CONTROL_SCHEMA_VERSION = 11;
const V10_CONTROL_SCHEMA_VERSION = 10;
const V9_CONTROL_SCHEMA_VERSION = 9;
const V8_CONTROL_SCHEMA_VERSION = 8;
const V7_CONTROL_SCHEMA_VERSION = 7;
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
        await writeJsonFileAtomic(this.catalogPath, migrateCatalogV11(existing));
      } else if (existing.schema_version === V10_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV11(migrateCatalogV10(existing)),
        );
      } else if (existing.schema_version === V9_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV11(migrateCatalogV10(migrateCatalogV9(existing))),
        );
      } else if (existing.schema_version === V8_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV11(
            migrateCatalogV10(migrateCatalogV9(migrateCatalogV8(existing))),
          ),
        );
      } else if (existing.schema_version === V7_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV11(
            migrateCatalogV10(
              migrateCatalogV9(migrateCatalogV8(migrateCatalogV7(existing))),
            ),
          ),
        );
      } else if (existing.schema_version === V6_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV11(
            migrateCatalogV10(
              migrateCatalogV9(
                migrateCatalogV8(migrateCatalogV7(migrateCatalogV6(existing))),
              ),
            ),
          ),
        );
      } else if (existing.schema_version === LEGACY_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV11(
            migrateCatalogV10(
              migrateCatalogV9(
                migrateCatalogV8(
                  migrateCatalogV7(migrateCatalogV6(migrateCatalogV5(existing))),
                ),
              ),
            ),
          ),
        );
      } else if (existing.schema_version === OLDEST_CONTROL_SCHEMA_VERSION) {
        await writeJsonFileAtomic(
          this.catalogPath,
          migrateCatalogV11(
            migrateCatalogV10(
              migrateCatalogV9(
                migrateCatalogV8(
                  migrateCatalogV7(
                    migrateCatalogV6(migrateCatalogV5(migrateCatalogV4(existing))),
                  ),
                ),
              ),
            ),
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
          await writeJsonFileAtomic(filePath, migrateChangeSetV11(existing));
        } else if (existing.schema_version === V10_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV11(migrateChangeSetV10(existing)),
          );
        } else if (existing.schema_version === V9_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV11(
              migrateChangeSetV10(migrateChangeSetV9(existing)),
            ),
          );
        } else if (existing.schema_version === V8_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV11(
              migrateChangeSetV10(
                migrateChangeSetV9(migrateChangeSetV8(existing)),
              ),
            ),
          );
        } else if (existing.schema_version === V7_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV11(
              migrateChangeSetV10(
                migrateChangeSetV9(
                  migrateChangeSetV8(migrateChangeSetV7(existing)),
                ),
              ),
            ),
          );
        } else if (existing.schema_version === V6_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV11(
              migrateChangeSetV10(
                migrateChangeSetV9(
                  migrateChangeSetV8(
                    migrateChangeSetV7(migrateChangeSetV6(existing)),
                  ),
                ),
              ),
            ),
          );
        } else if (existing.schema_version === LEGACY_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV11(
              migrateChangeSetV10(
                migrateChangeSetV9(
                  migrateChangeSetV8(
                    migrateChangeSetV7(
                      migrateChangeSetV6(migrateChangeSetV5(existing)),
                    ),
                  ),
                ),
              ),
            ),
          );
        } else if (existing.schema_version === OLDEST_CONTROL_SCHEMA_VERSION) {
          await writeJsonFileAtomic(
            filePath,
            migrateChangeSetV11(
              migrateChangeSetV10(
                migrateChangeSetV9(
                  migrateChangeSetV8(
                    migrateChangeSetV7(
                      migrateChangeSetV6(
                        migrateChangeSetV5(migrateChangeSetV4(existing)),
                      ),
                    ),
                  ),
                ),
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
  if (label.startsWith("ChangeSet ")) {
    assertChangeSetLifecycle(record);
    for (const workUnit of record.work_units ?? []) {
      assertWorkUnitLifecycle(workUnit);
    }
  }
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
  migrated.schema_version = V7_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateCatalogV7(record) {
  const migrated = structuredClone(record);
  migrated.schema_version = V8_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateCatalogV8(record) {
  const migrated = structuredClone(record);
  migrated.schema_version = V9_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateCatalogV9(record) {
  const migrated = structuredClone(record);
  migrated.schema_version = V10_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateCatalogV10(record) {
  const migrated = structuredClone(record);
  for (const project of Object.values(migrated.projects ?? {})) {
    project.supervision_policy = normalizeSupervisionPolicy(
      project.supervision_policy,
    );
  }
  migrated.schema_version = PREVIOUS_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateCatalogV11(record) {
  const migrated = structuredClone(record);
  for (const project of Object.values(migrated.projects ?? {})) {
    project.bundle_review_policy = normalizeBundleReviewPolicy(
      project.bundle_review_policy,
    );
  }
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
  migrated.schema_version = V7_CONTROL_SCHEMA_VERSION;
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
  migrated.schema_version = V8_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateChangeSetV8(record) {
  const migrated = structuredClone(record);
  for (const workUnit of migrated.work_units ?? []) {
    workUnit.correction_run_references ??= [];
    workUnit.correction_source_review_id ??= null;
  }
  for (const review of migrated.verification_reviews ?? []) {
    review.review_scope ??= "initial";
    review.source_review_id ??= null;
    review.correction_run_id ??= null;
  }
  migrated.schema_version = V9_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateChangeSetV9(record) {
  const migrated = structuredClone(record);
  const legacyState = migrated.state;
  migrated.migration_records ??= [];
  migrated.migration_records.push({
    migration_id: "control-schema-v9-to-v10",
    from_schema_version: 9,
    to_schema_version: 10,
    normalized_change_set_state: legacyState ?? null,
    normalized_work_unit_states: (migrated.work_units ?? []).map(
      (workUnit) => workUnit.state ?? null,
    ),
    normalized_legacy_operation_count:
      (migrated.run_references ?? []).filter(
        (reference) => reference.operation === "correction",
      ).length +
      (migrated.work_units ?? []).reduce(
        (count, workUnit) =>
          count + (workUnit.correction_run_references ?? []).length,
        0,
      ),
    source_digest: sha256(record),
  });
  migrated.phase = legacyChangeSetPhase(legacyState, migrated);
  migrated.terminal_outcome =
    legacyState === "done"
      ? "done"
      : legacyState === "abandoned"
        ? "abandoned"
        : null;
  delete migrated.state;
  migrated.feedback_records ??= [];
  if (migrated.current_revision_feedback) {
    const legacyFeedback = migrated.current_revision_feedback;
    const feedbackId = `feedback-${legacyFeedback.decision_id}`;
    migrated.feedback_records.push({
      feedback_id: feedbackId,
      source: "review",
      target: {
        change_set_id: migrated.change_set_id,
        plan_revision: legacyFeedback.applies_to_plan_revision ?? null,
        bundle_revision: legacyFeedback.bundle_revision ?? null,
        bundle_hash: legacyFeedback.bundle_hash ?? null,
      },
      content: {
        summary: legacyFeedback.summary,
        findings: structuredClone(legacyFeedback.findings ?? []),
      },
      created_at: legacyFeedback.decided_at ?? migrated.updated_at,
    });
    migrated.current_feedback_id = feedbackId;
  } else {
    migrated.current_feedback_id = null;
  }
  delete migrated.current_revision_feedback;
  migrated.gates ??= [];

  for (const reference of migrated.run_references ?? []) {
    if (reference.operation === "correction") {
      reference.operation = "execution";
      reference.trigger = "feedback";
      reference.legacy_operation = "correction";
    } else {
      reference.trigger ??= "initial";
    }
    if (reference.status === "abandoned") reference.status = "interrupted";
    if (reference.status === "blocked") reference.status = "failed";
  }

  for (const workUnit of migrated.work_units ?? []) {
    const legacyWorkUnitState = workUnit.state;
    workUnit.phase = legacyWorkUnitPhase(legacyWorkUnitState, workUnit);
    workUnit.disposition = legacyWorkUnitDisposition(legacyWorkUnitState);
    workUnit.pending_feedback_id = null;
    const references = new Map();
    for (const reference of workUnit.run_references ?? []) {
      references.set(reference.run_id, {
        ...reference,
        operation: "execution",
        trigger: "initial",
        status: legacyRunReferenceStatus(reference.status),
      });
    }
    for (const reference of workUnit.verification_run_references ?? []) {
      references.set(reference.run_id, {
        ...reference,
        operation: "verification",
        trigger: "initial",
        status: legacyRunReferenceStatus(reference.status),
      });
    }
    for (const reference of workUnit.correction_run_references ?? []) {
      references.set(reference.run_id, {
        ...reference,
        operation: "execution",
        trigger: "feedback",
        status: legacyRunReferenceStatus(reference.status),
        feedback_source_id: reference.source_review_id ?? null,
        legacy_operation: "correction",
      });
    }
    workUnit.run_references = [...references.values()];
    delete workUnit.state;
    delete workUnit.verification_run_references;
    delete workUnit.correction_run_references;
    delete workUnit.correction_source_review_id;
  }
  for (const review of migrated.verification_reviews ?? []) {
    if (review.review_scope === "focused") review.review_scope = "feedback";
    review.feedback_run_id = review.correction_run_id ?? null;
    delete review.correction_run_id;
  }
  migrated.schema_version = V10_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateChangeSetV10(record) {
  const migrated = structuredClone(record);
  const policy = normalizeSupervisionPolicy(migrated.supervision_policy);
  migrated.supervision_policy = policy;
  for (const plan of migrated.plans ?? []) {
    // 迁移输入故意覆盖 mode，确保任何历史 Plan 都不会静默获得自动运行权限。
    plan.supervision = normalizePlanSupervision(
      { ...(plan.supervision ?? {}), mode: "manual" },
      policy,
    );
  }
  migrated.supervision_control ??= {
    plan_revision: null,
    authorized_at: null,
    hold: null,
    last_stop_reason: null,
    updated_at: migrated.updated_at ?? null,
  };
  migrated.migration_records ??= [];
  migrated.migration_records.push({
    migration_id: "control-schema-v10-to-v11",
    from_schema_version: 10,
    to_schema_version: 11,
    existing_plan_mode: "manual",
    source_digest: sha256(record),
  });
  migrated.schema_version = PREVIOUS_CONTROL_SCHEMA_VERSION;
  return migrated;
}

function migrateChangeSetV11(record) {
  const migrated = structuredClone(record);
  const policy = normalizeBundleReviewPolicy(migrated.bundle_review_policy);
  migrated.bundle_review_policy = policy;
  for (const plan of migrated.plans ?? []) {
    // 迁移必须覆盖 mode；任何历史 Plan 都不能因升级静默启动独立 Review Runtime。
    plan.bundle_review = normalizePlanBundleReview(
      {
        mode: "none",
        agent_profile_id: null,
        agent_profile_revision: null,
        attempt_limit: Math.min(2, policy.max_attempts),
      },
      policy,
    );
  }
  migrated.bundle_review_assessments ??= [];
  migrated.current_bundle_review_assessment_id ??= null;
  migrated.bundle_review_last_error ??= null;
  migrated.migration_records ??= [];
  migrated.migration_records.push({
    migration_id: "control-schema-v11-to-v12",
    from_schema_version: 11,
    to_schema_version: 12,
    existing_plan_bundle_review_mode: "none",
    source_digest: sha256(record),
  });
  migrated.schema_version = CONTROL_SCHEMA_VERSION;
  return migrated;
}

function legacyChangeSetPhase(state, record) {
  if (["done", "abandoned"].includes(state)) return "terminal";
  if (["delivery_ready", "delivering"].includes(state)) return "delivery";
  if (state === "candidate_review") return "review";
  if (
    ["analyzing", "awaiting_plan_confirmation", "replanning"].includes(state)
  ) {
    return "planning";
  }
  if ((record.bundles ?? []).at(-1) && state !== "ready") return "review";
  return "working";
}

function legacyWorkUnitPhase(state, workUnit) {
  if (state === "candidate_ready" || workUnit.candidate) return "complete";
  if (
    [
      "validation_pending",
      "validation_failed",
      "verification_pending",
      "verifying",
      "verification_failed",
      "verification_human_decision_required",
      "verification_passed",
    ].includes(state)
  ) {
    return "verification";
  }
  return "execution";
}

function legacyWorkUnitDisposition(state) {
  return ["superseded", "retired_unconfirmed_legacy"].includes(state)
    ? "superseded"
    : "current";
}

function legacyRunReferenceStatus(status) {
  if (status === "abandoned") return "interrupted";
  if (status === "blocked") return "failed";
  return status;
}

function normalizeLegacyCheck(command, fallbackRationale) {
  if (!command || typeof command !== "object") return;
  command.coverage_rationale ??= fallbackRationale;
}
