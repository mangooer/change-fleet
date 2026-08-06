import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
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

const COMMAND_PATH = path.join(process.cwd(), "bin", "changefleet.js");

describe("unified local CLI process", () => {
  test("runs non-Provider lifecycle commands through the installed executable", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-cli-process-");
    const repository = await createGitRepository(root, "api");
    const configPath = path.join(root, "changefleet.json");
    const registerPath = path.join(root, "register.json");
    await writeFile(configPath, JSON.stringify(cliConfig()), "utf8");
    await writeFile(
      registerPath,
      JSON.stringify({
        idempotency_key: "register-1",
        project: {
          project_id: "project",
          repositories: [
            {
              repository_id: "api",
              locator: { path: repository.path },
            },
          ],
        },
      }),
      "utf8",
    );

    const registered = await runCommand([
      "project",
      "register",
      "--config",
      configPath,
      "--request",
      registerPath,
    ]);
    assert.equal(registered.exitCode, 0);
    assert.equal(registered.stderr, "");
    assert.equal(JSON.parse(registered.stdout).project_id, "project");

    const created = await runCommand(
      [
        "changeset",
        "create",
        "--config",
        configPath,
        "--request",
        "-",
      ],
      {
        input: JSON.stringify({
          idempotency_key: "create-1",
          change_set_id: "change-1",
          project_id: "project",
          intent: { objective: "Exercise the installed local CLI" },
        }),
      },
    );
    assert.equal(created.exitCode, 0);
    assert.equal(created.stderr, "");
    assert.equal(JSON.parse(created.stdout).change_set_id, "change-1");

    const shown = await runCommand([
      "changeset",
      "show",
      "change-1",
      "--config",
      configPath,
    ]);
    assert.equal(shown.exitCode, 0);
    assert.equal(shown.stderr, "");
    const state = JSON.parse(shown.stdout);
    assert.equal(state.phase, "planning");
    assert.equal(state.repository_selection_revisions.length, 1);
  });

  test("rejects fake configuration and unsupported commands before creating control state", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-cli-invalid-");
    const config = cliConfig();
    config.control_root = "./must-stay-absent";
    config.runtime.adapter = "scripted";
    config.agent_profile.provider = "test";
    config.agent_profile.runtime = "scripted";
    const configPath = path.join(root, "invalid.json");
    const requestPath = path.join(root, "request.json");
    await writeFile(configPath, JSON.stringify(config), "utf8");
    await writeFile(requestPath, "{}", "utf8");

    const result = await runCommand([
      "project",
      "register",
      "--config",
      configPath,
      "--request",
      requestPath,
    ]);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).error.code, "INVALID_CLI_CONFIG");
    await assert.rejects(access(path.join(root, "must-stay-absent")), {
      code: "ENOENT",
    });

    const unsupported = await runCommand([
      "changeset",
      "repository-selection",
      "resolve",
    ]);
    assert.equal(unsupported.exitCode, 2);
    assert.equal(unsupported.stdout, "");
    assert.equal(
      JSON.parse(unsupported.stderr).error.code,
      "INVALID_CLI_INVOCATION",
    );
  });

  test("returns exact audit projections without changing the control root", async (t) => {
    const fixture = await createAuditFixture(t);
    const directQuery = new RuntimeAuditQueryService({
      controlStore: fixture.service.controlStore,
      runStore: fixture.service.runStore,
      evidenceStore: fixture.service.evidenceStore,
    });
    const before = await directoryDigest(fixture.controlRoot);

    const runResult = await runCommand([
      "debug",
      "audit",
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
      "debug",
      "audit",
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

  test("keeps invalid, missing, and malformed audit roots unchanged", async (t) => {
    const fixture = await createAuditFixture(t);
    const missingRoot = path.join(fixture.root, "missing-control");

    const invalid = await runCommand([
      "debug",
      "audit",
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
    assert.equal(
      JSON.parse(invalid.stderr).error.code,
      "INVALID_AUDIT_INVOCATION",
    );
    await assert.rejects(access(missingRoot), { code: "ENOENT" });

    const missing = await runCommand([
      "debug",
      "audit",
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
      "debug",
      "audit",
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
      "debug",
      "audit",
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

  test("keeps audit composition free of lifecycle, Runtime, Git, and workspace capabilities", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src", "cli", "read-only-audit.js"),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /\.initialize\(|ChangeFleetService|RepositoryWorker|WorkUnitScheduler|CodexSdkRuntime|codex-sdk-runtime|repository-worker|workspace/,
    );
  });

  test("removes obsolete standalone audit entry points", async () => {
    await assert.rejects(
      access(path.join(process.cwd(), "bin", "changefleet-audit.js")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      access(
        path.join(process.cwd(), "src", "cli", "local-audit-command.js"),
      ),
      { code: "ENOENT" },
    );
    const packageManifest = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    );
    assert.deepEqual(packageManifest.bin, {
      changefleet: "bin/changefleet.js",
    });
    assert.equal(Object.hasOwn(packageManifest.scripts, "audit"), false);
  });
});

async function createAuditFixture(testContext) {
  const root = await createFixtureRoot(testContext, "changefleet-unified-audit-");
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

function runCommand(arguments_, { input = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [COMMAND_PATH, ...arguments_], {
      cwd: process.cwd(),
      windowsHide: true,
      shell: false,
      stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
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
        reject(new Error(`ChangeFleet command terminated by ${signal}`));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
    if (input !== null) child.stdin.end(input);
  });
}

function cliConfig() {
  return {
    schema_version: 1,
    control_root: "./control",
    workspace_root: "./workspaces",
    locale: "en",
    runtime: {
      adapter: "codex-sdk",
      credential_source: "local_codex_home",
      codex_home: "./provider-home",
    },
    agent_profile: {
      profile_id: "local-codex-profile",
      revision: 1,
      provider: "openai",
      runtime: "codex-sdk",
      model: "gpt-5.4",
      reasoning: "medium",
      permissions: "operation_scoped",
      network_access: false,
      skills: [],
      credential_profile_id: "local-codex-credentials",
    },
  };
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
