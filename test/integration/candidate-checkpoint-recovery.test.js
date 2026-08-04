import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
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

describe("post-Provider Candidate finalization recovery", () => {
  test("persists spawn failure and resumes the exact checkpoint without Runtime", async (t) => {
    const fixture = await createFixture(t, "resume");
    const commandName = `changefleet-late-check-${process.pid}`;
    fixture.plan.work_units[0].repository_check = {
      command_id: "late-check",
      executable: commandName,
      argv: [],
      timeout_ms: 300,
    };
    const binRoot = path.join(fixture.root, "bin");
    await mkdir(binRoot);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binRoot}${path.delimiter}${previousPath}`;
    t.after(() => {
      process.env.PATH = previousPath;
    });
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const service = await bootstrap(fixture, runtime);

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-fails",
        change_set_id: "change-1",
      }),
      { code: "COMMAND_SPAWN_FAILED" },
    );
    const failed = await service.readChangeSet("change-1");
    const unit = failed.work_units[0];
    assert.equal(unit.state, "validation_failed");
    assert.equal(unit.run_references.at(-1).status, "completed");
    assert.equal(failed.run_references.at(-1).status, "completed");
    assert.equal(
      (await service.runStore.read(failed.candidate_checkpoints[0].source_run_id))
        .status,
      "completed",
    );
    assert.equal(failed.candidate_checkpoints.length, 1);
    assert.equal(failed.candidates.length, 0);
    assert.equal(
      runtime.invocations.filter((item) => item.operation === "execution").length,
      1,
    );
    const failedAttempt = failed.validation_attempts.find(
      (attempt) => attempt.kind === "repository_validation",
    );
    assert.equal(failedAttempt.status, "failed");
    assert.equal(failedAttempt.error_code, "COMMAND_SPAWN_FAILED");
    const failedEvidence = await service.evidenceStore.read(
      failedAttempt.evidence.evidence_id,
    );
    assert.equal(failedEvidence.payload.command.adapter, "direct");
    assert.equal(
      failedEvidence.payload.command.requested_executable,
      commandName,
    );

    const tamperPath = path.join(unit.workspace.workspace_path, "tampered.txt");
    await writeFile(tamperPath, "tampered\n");
    const noRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await open(fixture, noRuntime);
    await assert.rejects(
      reopened.executeChangeSet({
        idempotency_key: "execute-tampered",
        change_set_id: "change-1",
      }),
      { code: "DIRTY_CANDIDATE_WORKSPACE" },
    );
    assert.equal(noRuntime.invocations.length, 0);
    await rm(tamperPath);

    await writeLauncher(binRoot, commandName, "setInterval(() => {}, 1000);");
    await assert.rejects(
      reopened.executeChangeSet({
        idempotency_key: "execute-timeout",
        change_set_id: "change-1",
      }),
      { code: "REPOSITORY_VALIDATION_FAILED" },
    );
    await writeLauncher(
      binRoot,
      commandName,
      "process.stdout.write('x'.repeat(1024 * 1024 + 1));",
    );
    await assert.rejects(
      reopened.executeChangeSet({
        idempotency_key: "execute-overflow",
        change_set_id: "change-1",
      }),
      { code: "REPOSITORY_VALIDATION_FAILED" },
    );
    await writeLauncher(binRoot, commandName, "process.exit(7);");
    await assert.rejects(
      reopened.executeChangeSet({
        idempotency_key: "execute-nonzero",
        change_set_id: "change-1",
      }),
      { code: "REPOSITORY_VALIDATION_FAILED" },
    );
    await writePassingLauncher(binRoot, commandName);

    const result = await reopened.executeChangeSet({
      idempotency_key: "execute-resume",
      change_set_id: "change-1",
    });
    const recovered = await reopened.readChangeSet("change-1");
    assert.equal(result.bundle_revision, 1);
    assert.equal(recovered.state, "candidate_review");
    assert.equal(recovered.candidate_checkpoints.length, 1);
    assert.equal(recovered.candidates.length, 1);
    assert.deepEqual(
      recovered.validation_attempts.map((attempt) => attempt.status),
      ["failed", "failed", "failed", "failed", "failed", "passed", "passed"],
    );
    const repositoryEvidence = await Promise.all(
      recovered.validation_attempts
        .filter((attempt) => attempt.kind === "repository_validation")
        .map((attempt) => reopened.evidenceStore.read(attempt.evidence.evidence_id)),
    );
    assert.equal(repositoryEvidence[2].payload.command.timed_out, true);
    assert.equal(repositoryEvidence[3].payload.command.output_overflow, true);
    assert.equal(repositoryEvidence[4].payload.command.exit_code, 7);
    assert.equal(noRuntime.invocations.length, 0);
  });

  test("requires an exact human gate for a private pre-checkpoint record", async (t) => {
    const fixture = await createFixture(t, "legacy");
    const commandName = `changefleet-legacy-check-${process.pid}`;
    fixture.plan.work_units[0].repository_check = {
      command_id: "legacy-check",
      executable: commandName,
      argv: [],
      timeout_ms: 10_000,
    };
    const binRoot = path.join(fixture.root, "bin");
    await mkdir(binRoot);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binRoot}${path.delimiter}${previousPath}`;
    t.after(() => {
      process.env.PATH = previousPath;
    });
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const service = await bootstrap(fixture, runtime);
    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-fails",
        change_set_id: "change-1",
      }),
      { code: "COMMAND_SPAWN_FAILED" },
    );
    const checkpointState = await service.readChangeSet("change-1");
    const originalCheckpoint = checkpointState.candidate_checkpoints[0];
    await service.controlStore.transactChangeSet("change-1", (state) => {
      // 测试夹具退化成 WI-0009 的 v4 形状；生产代码不提供此类原始状态写入口。
      state.candidate_checkpoints = [];
      state.validation_attempts = [];
      const workUnit = state.work_units[0];
      workUnit.candidate_checkpoint_id = null;
      workUnit.validation_attempt_ids = [];
      workUnit.state = "failed";
    });

    const request = {
      idempotency_key: "legacy-recovery",
      change_set_id: "change-1",
      plan_revision: 1,
      work_unit_id: "api-unit",
      source_run_id: originalCheckpoint.source_run_id,
      base_sha: originalCheckpoint.base_sha,
      candidate_sha: originalCheckpoint.candidate_sha,
      actor: "operator",
    };
    await assert.rejects(
      service.recoverLegacyCandidate({
        ...request,
        idempotency_key: "legacy-wrong-sha",
        candidate_sha: originalCheckpoint.base_sha,
      }),
      { code: "CANDIDATE_HEAD_MISMATCH" },
    );
    const configPath = path.join(fixture.root, "changefleet.json");
    const requestPath = path.join(fixture.root, "legacy-recovery.json");
    await writeFile(configPath, JSON.stringify(cliConfig(fixture)));
    await writeFile(requestPath, JSON.stringify(request));
    const recoveryCommand = [
      "changeset",
      "candidate",
      "recover-legacy",
      "--config",
      configPath,
      "--request",
      requestPath,
    ];
    const recoveryResult = await runCli(recoveryCommand);
    assert.equal(recoveryResult.exitCode, 0);
    const recovery = JSON.parse(recoveryResult.stdout);
    assert.equal(recovery.status, "validation_pending");
    const repeatedRecovery = await runCli(recoveryCommand);
    assert.equal(repeatedRecovery.exitCode, 0);
    assert.deepEqual(JSON.parse(repeatedRecovery.stdout), recovery);
    const recoveredState = await service.readChangeSet("change-1");
    assert.equal(recoveredState.state, "ready");
    assert.equal(recoveredState.candidate_checkpoints.length, 1);
    assert.equal(
      recoveredState.candidate_checkpoints[0].provenance,
      "legacy_candidate_recovery",
    );
    assert.equal(
      recoveredState.decisions.at(-1).type,
      "legacy_candidate_recovery",
    );

    await writePassingLauncher(binRoot, commandName);
    const resumeRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await open(fixture, resumeRuntime);
    await reopened.executeChangeSet({
      idempotency_key: "execute-after-legacy-recovery",
      change_set_id: "change-1",
    });
    assert.equal(resumeRuntime.invocations.length, 0);
    assert.equal((await reopened.readChangeSet("change-1")).state, "candidate_review");
  });

  test("retries combined validation over unchanged Candidates without Runtime", async (t) => {
    const fixture = await createFixture(t, "combined");
    await writeFile(fixture.combinedScript, "process.exit(9);\n");
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const service = await bootstrap(fixture, runtime);
    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-combined-fails",
        change_set_id: "change-1",
      }),
      { code: "COMBINED_VALIDATION_FAILED" },
    );
    const failed = await service.readChangeSet("change-1");
    assert.equal(failed.candidates.length, 1);
    assert.equal(failed.validation_attempts.at(-1).kind, "combined_validation");
    assert.equal(failed.validation_attempts.at(-1).status, "failed");

    await writeCombinedCheckScript(fixture.root, 1);
    const resumeRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await open(fixture, resumeRuntime);
    const result = await reopened.executeChangeSet({
      idempotency_key: "execute-combined-resume",
      change_set_id: "change-1",
    });
    const recovered = await reopened.readChangeSet("change-1");
    assert.equal(result.bundle_revision, 1);
    assert.equal(recovered.candidate_checkpoints.length, 1);
    assert.equal(recovered.candidates.length, 1);
    assert.deepEqual(
      recovered.validation_attempts.map((attempt) => [
        attempt.kind,
        attempt.status,
      ]),
      [
        ["repository_validation", "passed"],
        ["combined_validation", "failed"],
        ["combined_validation", "passed"],
      ],
    );
    assert.equal(resumeRuntime.invocations.length, 0);
  });
});

async function createFixture(t, name) {
  const root = await createFixtureRoot(t, `changefleet-checkpoint-${name}-`);
  const api = await createGitRepository(root, "api");
  const combinedScript = await writeCombinedCheckScript(root, 1);
  return {
    root,
    api,
    combinedScript,
    plan: createOneRepositoryPlan(combinedScript),
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
  };
}

async function bootstrap(fixture, runtime) {
  const service = await open(fixture, runtime);
  await service.registerProject({
    idempotency_key: "register-1",
    project: {
      project_id: "project-1",
      repositories: [
        { repository_id: "api", locator: { path: fixture.api.path } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create-1",
    change_set_id: "change-1",
    project_id: "project-1",
    intent: { objective: "Prove exact post-Provider recovery" },
  });
  await service.planChangeSet({
    idempotency_key: "plan-1",
    change_set_id: "change-1",
  });
  await service.confirmPlanRevision({
    idempotency_key: "confirm-1",
    change_set_id: "change-1",
    plan_revision: 1,
  });
  return service;
}

function open(fixture, runtime) {
  return ChangeFleetService.open({
    controlRoot: fixture.controlRoot,
    workspaceRoot: fixture.workspaceRoot,
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  });
}

async function writePassingLauncher(binRoot, commandName) {
  return writeLauncher(binRoot, commandName, "process.exit(0);");
}

async function writeLauncher(binRoot, commandName, source) {
  if (process.platform === "win32") {
    const scriptPath = path.join(binRoot, `${commandName}.mjs`);
    await writeFile(scriptPath, `${source}\n`);
    await writeFile(
      path.join(binRoot, `${commandName}.cmd`),
      `@ECHO OFF\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
    );
    return;
  }
  const launcher = path.join(binRoot, commandName);
  await writeFile(launcher, `#!/usr/bin/env node\n${source}\n`);
  await chmod(launcher, 0o755);
}

function cliConfig(fixture) {
  return {
    schema_version: 1,
    control_root: fixture.controlRoot,
    workspace_root: fixture.workspaceRoot,
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

function runCli(arguments_) {
  return new Promise((resolve, reject) => {
    const commandPath = path.join(process.cwd(), "bin", "changefleet.js");
    const child = spawn(process.execPath, [commandPath, ...arguments_], {
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
      if (signal) reject(new Error(`CLI terminated by ${signal}`));
      else resolve({ exitCode, stdout, stderr });
    });
  });
}
