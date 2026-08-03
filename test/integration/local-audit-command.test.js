import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { RuntimeAuditQueryService } from "../../src/application/runtime-audit-query-service.js";
import {
  createFixtureRoot,
  createGitRepository,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createOneRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

const COMMAND_PATH = path.join(
  process.cwd(),
  "bin",
  "changefleet-audit.js",
);

describe("package-private local audit command", () => {
  test("returns exact Run and ChangeSet projections without changing the control root", async (t) => {
    const fixture = await createAuditFixture(t);
    const directQuery = new RuntimeAuditQueryService({
      controlStore: fixture.service.controlStore,
      runStore: fixture.service.runStore,
      evidenceStore: fixture.service.evidenceStore,
    });
    const before = await directoryDigest(fixture.controlRoot);

    const runResult = await runCommand([
      "run",
      fixture.runId,
      "--control-root",
      fixture.controlRoot,
    ]);
    assert.equal(runResult.exitCode, 0);
    assert.equal(runResult.stderr, "");
    assert.equal(countNewlines(runResult.stdout), 1);
    const runProjection = JSON.parse(runResult.stdout);
    const directRun = await directQuery.getRunAudit(fixture.runId);
    assert.equal(runProjection.payload_digest, directRun.payload_digest);
    assert.deepEqual(runProjection.payload, directRun.payload);

    const changeResult = await runCommand([
      "changeset",
      "change",
      "--control-root",
      fixture.controlRoot,
      "--detail-page",
      "1",
      "--page-size",
      "1",
    ]);
    assert.equal(changeResult.exitCode, 0);
    assert.equal(changeResult.stderr, "");
    assert.equal(countNewlines(changeResult.stdout), 1);
    const changeProjection = JSON.parse(changeResult.stdout);
    const directChange = await directQuery.getChangeSetAudit("change", {
      detail_page: 1,
      page_size: 1,
    });
    assert.equal(changeProjection.payload_digest, directChange.payload_digest);
    assert.deepEqual(changeProjection.payload, directChange.payload);
    assert.equal(changeProjection.payload.runs.shown_count, 1);

    assert.equal(await directoryDigest(fixture.controlRoot), before);
  });

  test("keeps invalid, missing, and malformed roots unchanged", async (t) => {
    const fixture = await createAuditFixture(t);
    const missingRoot = path.join(fixture.root, "missing-control");

    const invalid = await runCommand([
      "changeset",
      "change",
      "--control-root",
      missingRoot,
      "--page-size",
      "101",
      "--locale",
      "en",
    ]);
    assert.equal(invalid.exitCode, 2);
    assert.equal(invalid.stdout, "");
    assert.equal(JSON.parse(invalid.stderr).error.code, "INVALID_AUDIT_INVOCATION");
    await assert.rejects(access(missingRoot), { code: "ENOENT" });

    const missing = await runCommand([
      "run",
      "missing-run",
      "--control-root",
      missingRoot,
    ]);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stdout, "");
    assert.equal(JSON.parse(missing.stderr).error.code, "AUDIT_SOURCE_NOT_FOUND");
    await assert.rejects(access(missingRoot), { code: "ENOENT" });

    const validBefore = await directoryDigest(fixture.controlRoot);
    const absentRun = await runCommand([
      "run",
      "absent-run",
      "--control-root",
      fixture.controlRoot,
    ]);
    assert.equal(absentRun.exitCode, 1);
    assert.equal(JSON.parse(absentRun.stderr).error.code, "AUDIT_SOURCE_NOT_FOUND");
    assert.equal(await directoryDigest(fixture.controlRoot), validBefore);

    const malformedRoot = path.join(fixture.root, "malformed-control");
    const malformedStateRoot = path.join(
      malformedRoot,
      "changesets",
      "change",
    );
    await mkdir(malformedStateRoot, { recursive: true });
    await writeFile(path.join(malformedStateRoot, "state.json"), "{broken\n", "utf8");
    const malformedBefore = await directoryDigest(malformedRoot);
    const malformed = await runCommand([
      "changeset",
      "change",
      "--control-root",
      malformedRoot,
      "--locale",
      "en",
    ]);
    assert.equal(malformed.exitCode, 1);
    assert.equal(malformed.stdout, "");
    assert.deepEqual(JSON.parse(malformed.stderr), {
      error: {
        code: "AUDIT_COMMAND_FAILED",
        message: "The local audit query could not be completed.",
        locale: "en",
        details: null,
      },
    });
    assert.equal(await directoryDigest(malformedRoot), malformedBefore);
  });

  test("does not compose initialization, lifecycle, Runtime, Git, or workspace capabilities", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "cli", "local-audit-command.js"),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /\.initialize\(|ChangeFleetService|RepositoryWorker|WorkUnitScheduler|codex-sdk-runtime|repository-worker|workspace/,
    );
  });
});

async function createAuditFixture(testContext) {
  const root = await createFixtureRoot(testContext, "changefleet-local-audit-");
  const repository = await createGitRepository(root, "api");
  const runtime = new ScriptedRuntime({
    plan: createOneRepositoryPlan(await writeCombinedCheckScript(root, 1)),
  });
  const controlRoot = path.join(root, "control");
  const service = await ChangeFleetService.open({
    controlRoot,
    workspaceRoot: path.join(root, "workspaces"),
    agentProfile: TEST_AGENT_PROFILE,
    runtime,
  });
  await service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      repositories: [
        { repository_id: "api", locator: { path: repository.path } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: "change",
    project_id: "project",
    intent: { objective: "Inspect one local audit projection" },
  });
  await service.planChangeSet({
    idempotency_key: "plan",
    change_set_id: "change",
  });
  const state = await service.readChangeSet("change");
  return {
    root,
    controlRoot,
    service,
    runId: state.run_references[0].run_id,
  };
}

function runCommand(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [COMMAND_PATH, ...arguments_], {
      cwd: process.cwd(),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal !== null) {
        reject(new Error(`Audit command terminated by ${signal}`));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function directoryDigest(root) {
  const hash = createHash("sha256");
  await appendDirectory(hash, root, root);
  return hash.digest("hex");
}

async function appendDirectory(hash, root, current) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    hash.update(path.relative(root, absolute).replaceAll("\\", "/"));
    if (entry.isDirectory()) await appendDirectory(hash, root, absolute);
    else hash.update(await readFile(absolute));
  }
}

function countNewlines(value) {
  return value.split("\n").length - 1;
}
