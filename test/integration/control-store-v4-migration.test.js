import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  CONTROL_SCHEMA_VERSION,
  ControlStore,
} from "../../src/adapters/filesystem/control-store.js";
import { createFixtureRoot } from "../support/git-fixture.js";

test("control store migrates private v4 catalog and ChangeSets to v5 idempotently", async (t) => {
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
  assert.equal(state.current_revision_feedback, null);
  assert.equal(state.work_units[0].candidate_checkpoint_id, null);
  assert.deepEqual(state.work_units[0].validation_attempt_ids, []);
  const persistedCatalog = JSON.parse(
    await readFile(path.join(root, "catalog.json"), "utf8"),
  );
  assert.equal(persistedCatalog.schema_version, CONTROL_SCHEMA_VERSION);
});
