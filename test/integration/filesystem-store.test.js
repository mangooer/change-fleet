import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { ControlStore } from "../../src/adapters/filesystem/control-store.js";
import { DirectoryLock } from "../../src/adapters/filesystem/directory-lock.js";
import { RunStore } from "../../src/adapters/filesystem/run-store.js";
import { createFixtureRoot } from "../support/git-fixture.js";

describe("filesystem control and evidence stores", () => {
  test("persists versioned snapshots and enforces lock ownership", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-store-");
    const store = new ControlStore(root);
    await store.initialize();
    await store.transactCatalog((catalog) => {
      catalog.projects.demo = {
        project_id: "demo",
        repositories: [],
      };
    });

    const reopened = new ControlStore(root);
    assert.equal((await reopened.readCatalog()).projects.demo.project_id, "demo");

    const lockPath = path.join(root, "locks", "manual");
    const first = await DirectoryLock.acquire(lockPath, {
      ownerType: "test",
    });
    await assert.rejects(
      DirectoryLock.acquire(lockPath, { ownerType: "contender" }),
      { code: "LOCK_BUSY" },
    );
    await first.release();
    const next = await DirectoryLock.acquire(lockPath, {
      ownerType: "next",
    });
    await next.release();
  });

  test("recovers a lock only when a local owner is proven dead", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-stale-lock-");
    const lockPath = path.join(root, "locks", "stale");
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({
        schema_version: 1,
        token: "stale-token",
        owner_type: "test",
        owner_id: null,
        hostname: os.hostname(),
        pid: 2_147_483_647,
        acquired_at: "2026-07-30T00:00:00.000Z",
      }),
      "utf8",
    );

    const recovered = await DirectoryLock.acquire(lockPath, {
      ownerType: "replacement",
    });
    assert.notEqual(recovered.owner.token, "stale-token");
    await recovered.release();
  });

  test("externalizes large Run output and keeps JSONL bounded", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-runs-");
    const store = new RunStore(root);
    await store.initialize();
    await store.create({
      schema_version: 1,
      run_id: "run-1",
      operation: "planning",
      trigger: "initial",
      attempt: 1,
      status: "running",
      created_at: "2026-07-30T00:00:00.000Z",
    });
    await store.appendEvent("run-1", {
      event_id: "event-large",
      type: "runtime.output",
      at: "2026-07-30T00:00:01.000Z",
      payload: { output: "x".repeat(128 * 1024) },
    });

    const lines = (
      await readFile(path.join(root, "runs", "run-1", "events.jsonl"), "utf8")
    )
      .trim()
      .split(/\r?\n/u);
    const event = JSON.parse(lines.at(-1));
    assert.equal(event.payload.output.bytes, 128 * 1024);
    assert.match(event.payload.output.artifact_ref, /^artifacts\//u);
    assert.ok(Buffer.byteLength(lines.at(-1)) < 64 * 1024);
  });

  test("normalizes legacy correction and abandoned Run identity once", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-legacy-run-");
    const runRoot = path.join(root, "runs", "run-legacy");
    await mkdir(runRoot, { recursive: true });
    await writeFile(
      path.join(runRoot, "run.json"),
      JSON.stringify({
        schema_version: 1,
        run_id: "run-legacy",
        operation: "correction",
        attempt: 1,
        status: "abandoned",
        created_at: "2026-08-06T00:00:00.000Z",
      }),
      "utf8",
    );

    const store = new RunStore(root);
    await store.initialize();
    await store.initialize();
    const run = await store.read("run-legacy");

    assert.equal(run.operation, "execution");
    assert.equal(run.trigger, "feedback");
    assert.equal(run.status, "interrupted");
    assert.equal(run.continuation_of_run_id, null);
    assert.equal(run.legacy_operation, "correction");
    assert.equal(run.legacy_status, "abandoned");
  });
});
