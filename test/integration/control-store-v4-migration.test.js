import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  CONTROL_SCHEMA_VERSION,
  ControlStore,
} from "../../src/adapters/filesystem/control-store.js";
import { createFixtureRoot } from "../support/git-fixture.js";

test("control store migrates private v3 catalog and ChangeSets to v4 idempotently", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-control-v4-");
  const changeSetRoot = path.join(root, "changesets", "change-1");
  await mkdir(changeSetRoot, { recursive: true });
  await writeFile(
    path.join(root, "catalog.json"),
    JSON.stringify({
      schema_version: 3,
      projects: {
        project: {
          project_id: "project",
          repositories: [{ repository_id: "api" }],
        },
      },
      idempotency: {},
    }),
  );
  await writeFile(
    path.join(changeSetRoot, "state.json"),
    JSON.stringify({
      schema_version: 3,
      change_set_id: "change-1",
    }),
  );
  const store = new ControlStore(root);
  await store.initialize();
  await store.initialize();
  const catalog = await store.readCatalog();
  const state = await store.readChangeSet("change-1");
  assert.equal(catalog.schema_version, CONTROL_SCHEMA_VERSION);
  assert.deepEqual(
    catalog.projects.project.repositories[0].delivery_binding_revisions,
    [],
  );
  assert.equal(
    catalog.projects.project.repositories[0]
      .current_delivery_binding_revision,
    null,
  );
  assert.equal(state.schema_version, CONTROL_SCHEMA_VERSION);
  assert.deepEqual(state.delivery_requests, []);
  const persistedCatalog = JSON.parse(
    await readFile(path.join(root, "catalog.json"), "utf8"),
  );
  assert.equal(persistedCatalog.schema_version, CONTROL_SCHEMA_VERSION);
});
