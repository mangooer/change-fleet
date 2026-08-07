import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  CONTROL_SCHEMA_VERSION,
  ControlStore,
} from "../../src/adapters/filesystem/control-store.js";
import { RunStore } from "../../src/adapters/filesystem/run-store.js";
import { createFixtureRoot } from "../support/git-fixture.js";

test("control store creates only the current private schema", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-current-schema-");
  const store = new ControlStore(root);

  await store.initialize();

  const catalog = await store.readCatalog();
  assert.equal(catalog.schema_version, CONTROL_SCHEMA_VERSION);
  assert.deepEqual(catalog.projects, {});
});

test("control store rejects an obsolete catalog without rewriting it", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-obsolete-catalog-");
  const catalogPath = path.join(root, "catalog.json");
  const obsoleteCatalog = {
    schema_version: CONTROL_SCHEMA_VERSION - 1,
    projects: {},
    idempotency: {},
  };
  await writeFile(catalogPath, JSON.stringify(obsoleteCatalog));

  await assert.rejects(new ControlStore(root).initialize(), {
    code: "UNSUPPORTED_SCHEMA_VERSION",
  });

  assert.deepEqual(
    JSON.parse(await readFile(catalogPath, "utf8")),
    obsoleteCatalog,
  );
});

test("control store rejects an obsolete ChangeSet on read", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-obsolete-changeset-");
  const store = new ControlStore(root);
  await store.initialize();
  const changeSetRoot = path.join(root, "changesets", "change-old");
  await mkdir(changeSetRoot, { recursive: true });
  await writeFile(
    path.join(changeSetRoot, "state.json"),
    JSON.stringify({
      schema_version: CONTROL_SCHEMA_VERSION - 1,
      change_set_id: "change-old",
    }),
  );

  await assert.rejects(store.readChangeSet("change-old"), {
    code: "UNSUPPORTED_SCHEMA_VERSION",
  });
});

test("run store initialization never mutates an obsolete private Run", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-obsolete-run-");
  const runRoot = path.join(root, "runs", "run-old");
  const runPath = path.join(runRoot, "run.json");
  const obsoleteRun = {
    schema_version: 1,
    run_id: "run-old",
    operation: "correction",
    status: "abandoned",
  };
  await mkdir(runRoot, { recursive: true });
  await writeFile(runPath, JSON.stringify(obsoleteRun));

  await new RunStore(root).initialize();

  assert.deepEqual(JSON.parse(await readFile(runPath, "utf8")), obsoleteRun);
});
