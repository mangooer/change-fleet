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
  assert.deepEqual(state.work_units[0].run_references, []);
  assert.equal(state.work_units[0].verification_review_id, null);
  assert.equal(state.work_units[0].phase, "execution");
  assert.equal(state.work_units[0].disposition, "current");
  assert.equal(catalog.projects.project.verification_policy.minimum_mode, "basic");
  assert.equal(catalog.projects.project.supervision_policy.default_mode, "manual");
  assert.equal(catalog.projects.project.bundle_review_policy.default_mode, "none");
  assert.equal(state.verification_policy.max_attempt_timeout_ms, 600_000);
  assert.equal(state.supervision_policy.default_mode, "manual");
  assert.equal(state.supervision_control.plan_revision, null);
  assert.equal(state.bundle_review_policy.default_mode, "none");
  assert.deepEqual(state.bundle_review_assessments, []);
  assert.equal(state.current_bundle_review_assessment_id, null);
  assert.deepEqual(state.feedback_records, []);
  assert.equal(state.current_feedback_id, null);
  assert.deepEqual(state.gates, []);
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

test("control store migrates legacy Plans without silent supervision or Bundle review authority", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-control-v10-supervision-");
  const changeSetRoot = path.join(root, "changesets", "change-1");
  await mkdir(changeSetRoot, { recursive: true });
  await writeFile(
    path.join(root, "catalog.json"),
    JSON.stringify({
      schema_version: 10,
      projects: {
        project: { project_id: "project", repositories: [] },
      },
      idempotency: {},
    }),
  );
  await writeFile(
    path.join(changeSetRoot, "state.json"),
    JSON.stringify({
      schema_version: 10,
      change_set_id: "change-1",
      phase: "working",
      terminal_outcome: null,
      current_plan_revision: 1,
      plans: [
        {
          revision: 1,
          status: "confirmed",
          confirmed_at: "2026-08-06T00:00:00.000Z",
        },
      ],
      work_units: [
        {
          work_unit_id: "unit-1",
          plan_revision: 1,
          phase: "execution",
          disposition: "current",
        },
      ],
      migration_records: [],
      updated_at: "2026-08-06T00:00:00.000Z",
    }),
  );

  const store = new ControlStore(root);
  await store.initialize();
  const state = await store.readChangeSet("change-1");
  assert.equal(state.plans[0].supervision.mode, "manual");
  assert.equal(state.plans[0].bundle_review.mode, "none");
  assert.equal(state.plans[0].bundle_review.agent_profile_id, null);
  assert.equal(state.plans[0].bundle_review.agent_profile_revision, null);
  assert.equal(state.supervision_control.plan_revision, null);
  assert.deepEqual(
    state.migration_records.slice(-2).map((record) => record.migration_id),
    ["control-schema-v10-to-v11", "control-schema-v11-to-v12"],
  );
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
  assert.equal(state.phase, "planning");
  assert.equal(state.current_plan_revision, null);
  assert.deepEqual(state.plans, []);
  assert.equal(state.legacy_unconfirmed_plans.length, 1);
  assert.equal(
    state.legacy_unconfirmed_plans[0].legacy_disposition,
    "retired_unconfirmed_v5",
  );
  assert.equal(state.work_units[0].phase, "execution");
  assert.equal(state.work_units[0].disposition, "superseded");
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
  assert.deepEqual(state.work_units[0].run_references, []);
  assert.equal(state.work_units[0].verification_review_id, null);
  assert.equal(state.work_units[0].phase, "execution");
  assert.equal(state.work_units[0].disposition, "current");
  assert.equal(state.candidates[0].verification_review_id, null);
});

test("control store normalizes legacy feedback-execution lineage from v8 records", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-control-v8-feedback-");
  const changeSetRoot = path.join(root, "changesets", "change-1");
  await mkdir(changeSetRoot, { recursive: true });
  await writeFile(
    path.join(root, "catalog.json"),
    JSON.stringify({ schema_version: 8, projects: {}, idempotency: {} }),
  );
  await writeFile(
    path.join(changeSetRoot, "state.json"),
    JSON.stringify({
      schema_version: 8,
      change_set_id: "change-1",
      work_units: [{ work_unit_id: "api-unit" }],
      verification_reviews: [{ review_id: "review-1", verdict: "pass" }],
    }),
  );

  const store = new ControlStore(root);
  await store.initialize();
  const state = await store.readChangeSet("change-1");

  assert.equal(state.schema_version, CONTROL_SCHEMA_VERSION);
  assert.deepEqual(state.work_units[0].run_references, []);
  assert.equal(state.verification_reviews[0].review_scope, "initial");
  assert.equal(state.verification_reviews[0].source_review_id, null);
  assert.equal(state.verification_reviews[0].feedback_run_id, null);
});

test("control store exhaustively maps every legacy ChangeSet and WorkUnit state", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-control-v9-lifecycle-");
  const legacyChangeSetStates = [
    "analyzing",
    "awaiting_plan_confirmation",
    "replanning",
    "ready",
    "executing",
    "validating",
    "failed",
    "blocked",
    "decision_required",
    "candidate_review",
    "delivery_ready",
    "delivering",
    "done",
    "abandoned",
  ];
  const legacyWorkUnitStates = [
    "pending",
    "running",
    "failed",
    "blocked",
    "validation_pending",
    "validation_failed",
    "verification_pending",
    "verifying",
    "verification_failed",
    "verification_changes_required",
    "verification_human_decision_required",
    "verification_passed",
    "correction_pending",
    "correcting",
    "correction_failed",
    "candidate_ready",
    "superseded",
    "retired_unconfirmed_legacy",
  ];
  await writeFile(
    path.join(root, "catalog.json"),
    JSON.stringify({ schema_version: 9, projects: {}, idempotency: {} }),
  );
  for (const [index, legacyState] of legacyChangeSetStates.entries()) {
    const changeSetId = `change-${index}`;
    const changeSetRoot = path.join(root, "changesets", changeSetId);
    await mkdir(changeSetRoot, { recursive: true });
    await writeFile(
      path.join(changeSetRoot, "state.json"),
      JSON.stringify({
        schema_version: 9,
        change_set_id: changeSetId,
        state: legacyState,
        updated_at: "2026-08-06T00:00:00.000Z",
        bundles: legacyState === "candidate_review" ? [{ bundle_id: "bundle-1" }] : [],
        work_units:
          index === 0
            ? legacyWorkUnitStates.map((state, unitIndex) => ({
                work_unit_id: `unit-${unitIndex}`,
                state,
                candidate:
                  state === "candidate_ready" ? { candidate_id: "candidate-1" } : null,
                run_references:
                  unitIndex === 0
                    ? [{ run_id: "execution-1", status: "running" }]
                    : [],
                verification_run_references:
                  unitIndex === 0
                    ? [{ run_id: "verification-1", status: "abandoned" }]
                    : [],
                correction_run_references:
                  unitIndex === 0
                    ? [{
                        run_id: "feedback-1",
                        status: "completed",
                        source_review_id: "review-1",
                      }]
                    : [],
              }))
            : [],
        verification_reviews:
          index === 0
            ? [{
                review_id: "review-1",
                review_scope: "focused",
                correction_run_id: "feedback-1",
              }]
            : [],
        current_revision_feedback:
          index === 0
            ? {
                decision_id: "decision-1",
                summary: "Legacy review feedback",
                findings: [],
                decided_at: "2026-08-06T00:00:00.000Z",
              }
            : null,
        gates:
          index === 0
            ? [{ gate_id: "gate-1", status: "open" }]
            : [],
      }),
    );
  }

  const store = new ControlStore(root);
  await store.initialize();

  for (const [index, legacyState] of legacyChangeSetStates.entries()) {
    const state = await store.readChangeSet(`change-${index}`);
    const expectedPhase =
      ["done", "abandoned"].includes(legacyState)
        ? "terminal"
        : ["delivery_ready", "delivering"].includes(legacyState)
          ? "delivery"
          : legacyState === "candidate_review"
            ? "review"
            : ["analyzing", "awaiting_plan_confirmation", "replanning"].includes(legacyState)
              ? "planning"
              : "working";
    assert.equal(state.phase, expectedPhase, legacyState);
    assert.equal(
      state.terminal_outcome,
      legacyState === "done"
        ? "done"
        : legacyState === "abandoned"
          ? "abandoned"
          : null,
      legacyState,
    );
  }

  const migrated = await store.readChangeSet("change-0");
  assert.deepEqual(
    migrated.work_units.map((unit) => unit.phase),
    legacyWorkUnitStates.map((state) =>
      state === "candidate_ready"
        ? "complete"
        : [
              "validation_pending",
              "validation_failed",
              "verification_pending",
              "verifying",
              "verification_failed",
              "verification_human_decision_required",
              "verification_passed",
            ].includes(state)
          ? "verification"
          : "execution",
    ),
  );
  assert.equal(migrated.work_units.at(-1).disposition, "superseded");
  assert.equal(migrated.work_units.at(-2).disposition, "superseded");
  assert.deepEqual(
    migrated.work_units[0].run_references.map((reference) => [
      reference.operation,
      reference.trigger,
      reference.status,
    ]),
    [
      ["execution", "initial", "running"],
      ["verification", "initial", "interrupted"],
      ["execution", "feedback", "completed"],
    ],
  );
  assert.equal(migrated.verification_reviews[0].review_scope, "feedback");
  assert.equal(migrated.verification_reviews[0].feedback_run_id, "feedback-1");
  assert.equal(migrated.feedback_records.length, 1);
  assert.equal(migrated.gates[0].status, "open");
  assert.deepEqual(
    migrated.migration_records[0].normalized_work_unit_states,
    legacyWorkUnitStates,
  );
  assert.equal(
    migrated.migration_records[0].normalized_legacy_operation_count,
    1,
  );
});
