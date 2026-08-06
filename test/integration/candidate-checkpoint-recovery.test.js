import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { ChangeFleetError } from "../../src/domain/errors.js";
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
      coverage_rationale: "Checks the exact recovered Candidate",
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
    await writeLauncher(
      binRoot,
      commandName,
      "setTimeout(() => process.exit(0), 500);",
    );

    const result = await reopened.executeChangeSet({
      idempotency_key: "execute-resume",
      change_set_id: "change-1",
      validation_attempt_budgets: [
        {
          kind: "repository_validation",
          work_unit_id: "api-unit",
          command_id: "late-check",
          timeout_ms: 2_000,
        },
      ],
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
    const repositoryAttempts = recovered.validation_attempts.filter(
      (attempt) => attempt.kind === "repository_validation",
    );
    assert.deepEqual(repositoryAttempts.at(-1).requested_budget, {
      timeout_ms: 2_000,
    });
    assert.deepEqual(repositoryAttempts.at(-1).effective_budget, {
      timeout_ms: 2_000,
    });
    assert.equal(
      new Set(
        repositoryAttempts.map(
          (attempt) => attempt.check_identity.check_identity_hash,
        ),
      ).size,
      1,
    );
    assert.equal(recovered.current_plan_revision, 1);
    assert.equal(noRuntime.invocations.length, 0);
  });

  test("records a basic fast path without another Runtime invocation", async (t) => {
    const fixture = await createFixture(t, "basic-admission");
    fixture.plan.verification_expectation = {
      mode: "basic",
      rationale: "The fixture is an obvious bounded deterministic change.",
      escalation_triggers: ["scope_divergence"],
    };
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const service = await bootstrap(fixture, runtime);

    const result = await service.executeChangeSet({
      idempotency_key: "execute-basic",
      change_set_id: "change-1",
    });
    const state = await service.readChangeSet("change-1");

    assert.equal(result.bundle_revision, 1);
    assert.equal(state.verification_admissions.length, 1);
    assert.equal(state.verification_admissions[0].mode, "basic");
    assert.equal(
      runtime.invocations.filter((invocation) => invocation.operation === "execution")
        .length,
      1,
    );
  });

  test("persists a passing independent review before Candidate promotion", async (t) => {
    const fixture = await createFixture(t, "independent-admission");
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const service = await bootstrap(fixture, runtime);

    const result = await service.executeChangeSet({
      idempotency_key: "execute-independent",
      change_set_id: "change-1",
      verification_admission_mode: "independent_review",
    });
    const state = await service.readChangeSet("change-1");
    assert.equal(result.bundle_revision, 1);
    assert.equal(state.verification_admissions.length, 1);
    assert.equal(state.verification_admissions[0].mode, "independent_review");
    assert.equal(state.verification_reviews.length, 1);
    assert.equal(state.verification_reviews[0].verdict, "pass");
    assert.equal(state.work_units[0].state, "candidate_ready");
    assert.equal(state.candidates.length, 1);
    assert.equal(state.validation_attempts.length, 2);
    assert.equal(
      runtime.invocations.filter((invocation) => invocation.operation === "execution")
        .length,
      1,
    );
    assert.equal(
      runtime.invocations.filter(
        (invocation) => invocation.operation === "verification",
      ).length,
      1,
    );
  });

  test("executes every additional check requested by one deep-review Run", async (t) => {
    const fixture = await createFixture(t, "verification-check");
    const runtime = new ScriptedRuntime({
      plan: fixture.plan,
      verificationOutcome: {
        type: "verification_completed",
        review_depth: "deep_review",
        verdict: "pass_with_notes",
        summary: "A focused exact-subject check closes the compatibility boundary.",
        findings: [],
        notes: [
          { note_id: "host-note", message: "Another host remains unverified." },
        ],
        human_decision: null,
        requested_checks: [
          {
            command_id: "verification-feature-check",
            executable: process.execPath,
            argv: [
              "-e",
              "const fs=require('node:fs');if(!fs.readFileSync('feature.txt','utf8').includes('api'))process.exit(2)",
            ],
            coverage_rationale: "Checks the exact implemented feature from the review workspace",
            timeout_ms: 10_000,
          },
        ],
      },
    });
    const service = await bootstrap(fixture, runtime);

    await service.executeChangeSet({
      idempotency_key: "execute-with-review-check",
      change_set_id: "change-1",
      verification_admission_mode: "independent_review",
    });
    const state = await service.readChangeSet("change-1");
    const review = state.verification_reviews[0];
    const verificationRun = await service.runStore.read(review.run_id);

    assert.equal(review.review_depth, "deep_review");
    assert.equal(review.check_status, "passed");
    assert.equal(review.validation_attempt_ids.length, 1);
    assert.deepEqual(
      state.validation_attempts.map((attempt) => attempt.kind),
      ["repository_validation", "verification_check", "combined_validation"],
    );
    assert.equal(
      await stat(verificationRun.verification_workspace.workspace_path).catch(
        () => null,
      ),
      null,
    );
  });

  test("persists blocking findings without creating a Candidate", async (t) => {
    const fixture = await createFixture(t, "verification-blocking");
    const runtime = new ScriptedRuntime({
      plan: fixture.plan,
      verificationOutcome: {
        type: "verification_completed",
        review_depth: "deep_review",
        verdict: "changes_required",
        summary: "The implementation violates the confirmed output contract.",
        findings: [
          {
            finding_id: "correctness-1",
            category: "correctness",
            message: "The exact Candidate writes the wrong public value.",
            path: "feature.txt",
          },
        ],
        notes: [],
        human_decision: null,
        requested_checks: [],
      },
    });
    const service = await bootstrap(fixture, runtime);

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-blocking-review",
        change_set_id: "change-1",
        verification_admission_mode: "independent_review",
      }),
      { code: "VERIFICATION_CHANGES_REQUIRED" },
    );
    const state = await service.readChangeSet("change-1");
    assert.equal(state.verification_reviews[0].verdict, "changes_required");
    assert.equal(state.work_units[0].state, "verification_changes_required");
    assert.equal(state.candidates.length, 0);
  });

  test("fails closed when the read-only Runtime modifies its disposable workspace", async (t) => {
    const fixture = await createFixture(t, "verification-mutation");
    const runtime = new MutatingVerificationRuntime({ plan: fixture.plan });
    const service = await bootstrap(fixture, runtime);

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-mutating-review",
        change_set_id: "change-1",
        verification_admission_mode: "independent_review",
      }),
      { code: "VERIFICATION_WORKSPACE_MODIFIED" },
    );
    const state = await service.readChangeSet("change-1");
    assert.equal(state.work_units[0].state, "verification_failed");
    assert.equal(state.verification_reviews.length, 0);
    assert.equal(state.candidates.length, 0);
  });

  test("abandons an interrupted verification and reuses passed deterministic evidence", async (t) => {
    const fixture = await createFixture(t, "verification-restart");
    const interruptedRuntime = new InterruptingVerificationRuntime({
      plan: fixture.plan,
    });
    const service = await bootstrap(fixture, interruptedRuntime);
    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-interrupted-review",
        change_set_id: "change-1",
        verification_admission_mode: "independent_review",
      }),
      { code: "CONTROLLER_INTERRUPTED" },
    );

    const retryRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await open(fixture, retryRuntime);
    const result = await reopened.executeChangeSet({
      idempotency_key: "execute-restarted-review",
      change_set_id: "change-1",
    });
    const state = await reopened.readChangeSet("change-1");

    assert.equal(result.bundle_revision, 1);
    assert.equal(
      state.validation_attempts.filter(
        (attempt) => attempt.kind === "repository_validation",
      ).length,
      1,
    );
    assert.deepEqual(
      state.work_units[0].verification_run_references.map(
        (reference) => reference.status,
      ),
      ["abandoned", "completed"],
    );
    assert.equal(
      retryRuntime.invocations.filter(
        (invocation) => invocation.operation === "execution",
      ).length,
      0,
    );
  });

  test("requires an exact human gate for a private pre-checkpoint record", async (t) => {
    const fixture = await createFixture(t, "legacy");
    const commandName = `changefleet-legacy-check-${process.pid}`;
    fixture.plan.work_units[0].repository_check = {
      command_id: "legacy-check",
      executable: commandName,
      argv: [],
      coverage_rationale: "Checks the exact legacy Candidate",
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
  const planned = await service.planChangeSet({
    idempotency_key: "plan-1",
    change_set_id: "change-1",
  });
  await service.confirmPlanMessage({
    idempotency_key: "confirm-1",
    change_set_id: "change-1",
    message_id: planned.message.message_id,
    content_digest: planned.message.content_digest,
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

class MutatingVerificationRuntime extends ScriptedRuntime {
  async invoke(invocation) {
    if (invocation.operation === "verification") {
      await writeFile(
        path.join(invocation.workspace.workspace_path, "review-write.txt"),
        "not allowed\n",
      );
    }
    return super.invoke(invocation);
  }
}

class InterruptingVerificationRuntime extends ScriptedRuntime {
  constructor(options) {
    super(options);
    this.verificationInterrupted = false;
  }

  async invoke(invocation) {
    if (
      invocation.operation === "verification" &&
      !this.verificationInterrupted
    ) {
      this.verificationInterrupted = true;
      this.invocations.push(structuredClone(invocation));
      throw new ChangeFleetError(
        "CONTROLLER_INTERRUPTED",
        "Simulated controller loss during verification",
      );
    }
    return super.invoke(invocation);
  }
}
