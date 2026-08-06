import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  CONTROL_SCHEMA_VERSION,
  ControlStore,
} from "../../src/adapters/filesystem/control-store.js";
import { createFixtureRoot } from "../support/git-fixture.js";

test("control store migrates private v4 catalog and ChangeSets to the current schema idempotently", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-control-v5-");
  const changeSetRoot = path.join(root, "changesets", "change-1");
  await mkdir(changeSetRoot, { recursive: true });
  await writeFile(
    path.join(root, "catalog.json"),
    JSON.stringify({
      schema_version: 4,
      projects: {
        project: {
          project_id: "project",
          repositories: [
            {
              repository_id: "api",
              delivery_binding_revisions: [],
              current_delivery_binding_revision: null,
            },
          ],
        },
      },
      idempotency: {},
    }),
  );
  await writeFile(
    path.join(changeSetRoot, "state.json"),
    JSON.stringify({
      schema_version: 4,
      change_set_id: "change-1",
      work_units: [{ work_unit_id: "api", state: "failed" }],
      delivery_requests: [],
    }),
  );
  const store = new ControlStore(root);
  await store.initialize();
  await store.initialize();
  const catalog = await store.readCatalog();
  const state = await store.readChangeSet("change-1");
  assert.equal(catalog.schema_version, CONTROL_SCHEMA_VERSION);
  assert.equal(state.schema_version, CONTROL_SCHEMA_VERSION);
  assert.deepEqual(state.candidate_checkpoints, []);
  assert.deepEqual(state.validation_attempts, []);
  assert.deepEqual(state.verification_admissions, []);
  assert.deepEqual(state.verification_reviews, []);
  assert.equal(state.work_units[0].verification_admission_id, null);
  assert.deepEqual(state.work_units[0].verification_run_references, []);
  assert.equal(state.work_units[0].verification_review_id, null);
  assert.equal(catalog.projects.project.verification_policy.minimum_mode, "basic");
  assert.equal(state.verification_policy.max_attempt_timeout_ms, 600_000);
  assert.equal(state.current_revision_feedback, null);
  assert.deepEqual(state.planning_message_references, []);
  assert.equal(state.current_approvable_plan_message_id, null);
  assert.deepEqual(state.legacy_unconfirmed_plans, []);
  assert.equal(state.work_units[0].candidate_checkpoint_id, null);
  assert.deepEqual(state.work_units[0].validation_attempt_ids, []);
  const persistedCatalog = JSON.parse(
    await readFile(path.join(root, "catalog.json"), "utf8"),
  );
  assert.equal(persistedCatalog.schema_version, CONTROL_SCHEMA_VERSION);
});

test("control store retires unconfirmed v5 Plan records without allocating new authority", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-control-v5-retirement-");
  const changeSetRoot = path.join(root, "changesets", "change-1");
  await mkdir(changeSetRoot, { recursive: true });
  await writeFile(
    path.join(root, "catalog.json"),
    JSON.stringify({ schema_version: 5, projects: {}, idempotency: {} }),
  );
  await writeFile(
    path.join(changeSetRoot, "state.json"),
    JSON.stringify({
      schema_version: 5,
      change_set_id: "change-1",
      state: "awaiting_plan_confirmation",
      plans: [{ revision: 1, status: "proposed", planning_run_id: "run-1" }],
      current_plan_revision: 1,
      work_units: [{ work_unit_id: "unit-1", plan_revision: 1, state: "pending" }],
    }),
  );
  const store = new ControlStore(root);
  await store.initialize();
  const state = await store.readChangeSet("change-1");
  assert.equal(state.schema_version, CONTROL_SCHEMA_VERSION);
  assert.equal(state.state, "analyzing");
  assert.equal(state.current_plan_revision, null);
  assert.deepEqual(state.plans, []);
  assert.equal(state.legacy_unconfirmed_plans.length, 1);
  assert.equal(
    state.legacy_unconfirmed_plans[0].legacy_disposition,
    "retired_unconfirmed_v5",
  );
  assert.equal(state.work_units[0].state, "retired_unconfirmed_legacy");
});

test("control store adds deterministic verification authority to v6 records", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-control-v6-verification-");
  const changeSetRoot = path.join(root, "changesets", "change-1");
  await mkdir(changeSetRoot, { recursive: true });
  const legacyCheck = {
    command_id: "check",
    executable: "node",
    argv: ["check.mjs"],
    timeout_ms: 1_000,
  };
  await writeFile(
    path.join(root, "catalog.json"),
    JSON.stringify({
      schema_version: 6,
      projects: { project: { project_id: "project", repositories: [] } },
      idempotency: {},
    }),
  );
  await writeFile(
    path.join(changeSetRoot, "state.json"),
    JSON.stringify({
      schema_version: 6,
      change_set_id: "change-1",
      plans: [
        {
          revision: 1,
          status: "confirmed",
          work_units: [
            {
              work_unit_id: "api-unit",
              repository_id: "api",
              repository_check: legacyCheck,
            },
          ],
          combined_check: legacyCheck,
        },
      ],
      work_units: [
        {
          work_unit_id: "api-unit",
          repository_id: "api",
          repository_check: legacyCheck,
        },
      ],
      candidates: [{ candidate_id: "candidate-1" }],
    }),
  );

  const store = new ControlStore(root);
  await store.initialize();
  const catalog = await store.readCatalog();
  const state = await store.readChangeSet("change-1");

  assert.equal(catalog.projects.project.verification_policy.minimum_mode, "basic");
  assert.equal(state.verification_policy.minimum_mode, "basic");
  assert.deepEqual(state.verification_admissions, []);
  assert.equal(state.plans[0].verification_expectation.mode, "deterministic");
  assert.equal(
    state.plans[0].combined_check.coverage_rationale,
    "combined validation",
  );
  assert.equal(state.work_units[0].verification_admission_id, null);
  assert.equal(state.candidates[0].verification_admission_id, null);
  assert.equal(state.candidates[0].verification_review_id, null);
  assert.deepEqual(state.verification_reviews, []);
});

test("control store adds read-only verification references to v7 records", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-control-v7-verification-");
  const changeSetRoot = path.join(root, "changesets", "change-1");
  await mkdir(changeSetRoot, { recursive: true });
  await writeFile(
    path.join(root, "catalog.json"),
    JSON.stringify({ schema_version: 7, projects: {}, idempotency: {} }),
  );
  await writeFile(
    path.join(changeSetRoot, "state.json"),
    JSON.stringify({
      schema_version: 7,
      change_set_id: "change-1",
      work_units: [{ work_unit_id: "api-unit" }],
      candidates: [{ candidate_id: "candidate-1" }],
    }),
  );

  const store = new ControlStore(root);
  await store.initialize();
  const state = await store.readChangeSet("change-1");

  assert.equal(state.schema_version, CONTROL_SCHEMA_VERSION);
  assert.deepEqual(state.verification_reviews, []);
  assert.deepEqual(state.work_units[0].verification_run_references, []);
  assert.equal(state.work_units[0].verification_review_id, null);
  assert.equal(state.candidates[0].verification_review_id, null);
});
