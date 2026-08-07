import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { RuntimeAuditQueryService } from "../../src/application/runtime-audit-query-service.js";
import { ChangeFleetError } from "../../src/domain/errors.js";
import {
  createFixtureRoot,
  createGitRepository,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createOneRepositoryPlan,
  createTwoRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("Plan-confirmed autonomous supervision", () => {
  test("advances a forced one-Repository route to Bundle review without a Supervisor Run", async (t) => {
    const fixture = await createAutonomousFixture(t, "changefleet-auto-forced-");
    const result = await confirmAutonomousPlan(fixture.service, fixture.changeSetId);

    assert.equal(
      result.supervision.status,
      "review_ready",
      JSON.stringify(result.supervision),
    );
    assert.equal(result.supervision.stop_reason, "bundle_review_ready");
    assert.equal(fixture.runtime.supervisionInvocationCount, 0);
    const state = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.equal(state.phase, "review");
    assert.equal(state.bundles.length, 1);
    assert.equal(
      state.run_references.some(
        (reference) => reference.operation === "supervision",
      ),
      false,
    );
  });

  test("dispatches one exact independent Bundle review without a Supervisor decision", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-bundle-review-pass-",
      {
        bundleReviewMode: "independent",
        bundleReviewOutcomes: [
          {
            type: "bundle_review_completed",
            disposition: "pass",
            summary: "The exact Bundle passes with one non-blocking observation.",
            findings: [
              {
                finding_id: "optional-cleanup",
                severity: "advisory",
                category: "scope",
                message: "An optional cleanup may be considered in a later ChangeSet.",
                evidence_reference_ids: [],
                repository_ids: ["api"],
                work_unit_ids: ["api-unit"],
              },
            ],
            human_decision: null,
          },
        ],
      },
    );

    const result = await confirmAutonomousPlan(
      fixture.service,
      fixture.changeSetId,
    );

    assert.equal(result.supervision.status, "review_ready");
    assert.equal(result.supervision.stop_reason, "bundle_review_recommended");
    assert.equal(fixture.runtime.reviewInvocationCount, 1);
    assert.equal(fixture.runtime.supervisionInvocationCount, 0);
    const invocation = fixture.runtime.invocations.find(
      (candidate) => candidate.operation === "review",
    );
    assert.equal(invocation.capabilities.mode, "read_only");
    assert.equal(invocation.context_projection.usage, undefined);
    assert.equal(invocation.context_projection.transcript, undefined);
    const state = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.equal(state.phase, "review");
    assert.equal(state.bundle_review_assessments.length, 1);
    assert.equal(state.bundle_review_assessments[0].disposition, "pass");
    assert.equal(
      state.bundle_review_assessments[0].findings[0].severity,
      "advisory",
    );
    const audit = await new RuntimeAuditQueryService({
      controlStore: fixture.service.controlStore,
      runStore: fixture.service.runStore,
      evidenceStore: fixture.service.evidenceStore,
    }).getChangeSetAudit(fixture.changeSetId);
    assert.equal(audit.payload.outcomes.bundle_review.pass, 1);
    assert.equal(audit.payload.bundle_reviews.rows[0].disposition, "pass");
    assert.equal(
      audit.payload.bundle_reviews.rows[0].findings[0].finding_id,
      "optional-cleanup",
    );
    assert.equal(
      audit.payload.runs.rows.some(
        (row) => row.identity.operation === "review",
      ),
      true,
    );
  });

  test("runs a Plan-required Bundle review from the manual execution command", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-manual-bundle-review-pass-",
      {
        supervisionMode: "manual",
        bundleReviewMode: "independent",
      },
    );
    await confirmAutonomousPlan(fixture.service, fixture.changeSetId);

    const result = await fixture.service.executeChangeSet({
      idempotency_key: "execute-manual-review",
      change_set_id: fixture.changeSetId,
    });

    assert.equal(result.status, "review_ready");
    assert.equal(fixture.runtime.reviewInvocationCount, 1);
    const state = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.equal(state.phase, "review");
    assert.equal(state.bundle_review_assessments.at(-1).disposition, "pass");
  });

  test("routes exact blocking Bundle findings through same-Plan targeted repair", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-bundle-review-feedback-",
      {
        bundleReviewMode: "independent",
        bundleReviewOutcomes: [
          {
            type: "bundle_review_completed",
            disposition: "feedback",
            summary: "The exact API behavior misses one confirmed requirement.",
            findings: [
              {
                finding_id: "api-contract",
                severity: "blocking",
                category: "confirmed_intent",
                message: "The API fixture must contain the reviewed marker.",
                evidence_reference_ids: [],
                repository_ids: ["api"],
                work_unit_ids: ["api-unit"],
              },
            ],
            human_decision: null,
          },
          {
            type: "bundle_review_completed",
            disposition: "pass",
            summary: "The repaired Bundle satisfies the confirmed intent.",
            findings: [],
            human_decision: null,
          },
        ],
        feedbackFileContent: "api reviewed\n",
      },
    );

    const result = await confirmAutonomousPlan(
      fixture.service,
      fixture.changeSetId,
    );

    assert.equal(result.supervision.status, "review_ready");
    const state = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.equal(state.bundles.length, 2);
    assert.deepEqual(
      state.bundle_review_assessments.map((assessment) => assessment.disposition),
      ["feedback", "pass"],
    );
    assert.notEqual(
      state.bundle_review_assessments[0].subject_digest,
      state.bundle_review_assessments[1].subject_digest,
    );
    assert.equal(
      state.current_bundle_review_assessment_id,
      state.bundle_review_assessments[1].assessment_id,
    );
    assert.equal(
      state.feedback_records.some((feedback) => feedback.source === "review"),
      true,
    );
    assert.equal(
      state.run_references.filter(
        (reference) =>
          reference.operation === "execution" && reference.trigger === "feedback",
      ).length,
      1,
    );
  });

  test("stops an ambiguous Bundle assessment at one exact human Gate", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-bundle-review-gate-",
      {
        bundleReviewMode: "independent",
        bundleReviewOutcomes: [
          {
            type: "bundle_review_completed",
            disposition: "gate",
            summary: "The compatibility choice needs product authority.",
            findings: [],
            human_decision: {
              question: "Which compatibility contract should this Bundle use?",
              options: ["preserve_legacy", "adopt_new_contract"],
            },
          },
        ],
      },
    );

    const result = await confirmAutonomousPlan(
      fixture.service,
      fixture.changeSetId,
    );

    assert.equal(result.supervision.status, "human_input_required");
    const state = await fixture.service.readChangeSet(fixture.changeSetId);
    const gate = state.gates.find((candidate) => candidate.status === "open");
    assert.equal(gate.kind, "bundle_review_decision");
    assert.equal(
      gate.bundle_review_assessment_id,
      state.current_bundle_review_assessment_id,
    );
    assert.equal(state.phase, "review");
  });

  test("reconciles an interrupted Bundle review before retrying the same exact Bundle", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-bundle-review-restart-",
      {
        bundleReviewMode: "independent",
        runtimeFactory: (plan) => new InterruptedBundleReviewRuntime({ plan }),
      },
    );

    await assert.rejects(
      confirmAutonomousPlan(fixture.service, fixture.changeSetId),
      { code: "CONTROLLER_INTERRUPTED" },
    );
    let state = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.equal(
      state.run_references.find((reference) => reference.operation === "review")
        .status,
      "running",
    );

    const resumedRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const resumedService = await ChangeFleetService.open({
      controlRoot: path.join(fixture.root, "control"),
      workspaceRoot: path.join(fixture.root, "workspaces"),
      runtime: resumedRuntime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    const resumed = await resumedService.resumeSupervision({
      idempotency_key: "resume-bundle-review",
      change_set_id: fixture.changeSetId,
    });

    assert.equal(resumed.status, "review_ready");
    state = await resumedService.readChangeSet(fixture.changeSetId);
    assert.deepEqual(
      state.run_references
        .filter((reference) => reference.operation === "review")
        .map((reference) => reference.status),
      ["interrupted", "completed"],
    );
    assert.equal(state.bundle_review_assessments.at(-1).disposition, "pass");
  });

  test("fails closed to an exact Gate after invalid Bundle review output exhausts attempts", async (t) => {
    const invalidOutcome = {
      type: "bundle_review_completed",
      disposition: "pass",
      summary: "This malformed passage still contains a blocker.",
      findings: [
        {
          finding_id: "contradictory-pass",
          severity: "blocking",
          category: "correctness",
          message: "A passage recommendation cannot retain this blocker.",
          evidence_reference_ids: [],
          repository_ids: ["api"],
          work_unit_ids: ["api-unit"],
        },
      ],
      human_decision: null,
    };
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-bundle-review-invalid-",
      {
        bundleReviewMode: "independent",
        bundleReviewOutcomes: [invalidOutcome, invalidOutcome],
      },
    );

    const result = await confirmAutonomousPlan(
      fixture.service,
      fixture.changeSetId,
    );

    assert.equal(result.supervision.status, "human_input_required");
    const state = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.deepEqual(
      state.run_references
        .filter((reference) => reference.operation === "review")
        .map((reference) => reference.status),
      ["failed", "failed"],
    );
    const gate = state.gates.find((candidate) => candidate.status === "open");
    assert.equal(gate.kind, "bundle_review_failure");
    assert.equal(gate.bundle_id, state.bundles.at(-1).bundle_id);
    const bundle = state.bundles.at(-1);
    await assert.rejects(
      fixture.service.recordBundleDecision({
        idempotency_key: "accept-failed-review",
        change_set_id: fixture.changeSetId,
        bundle_revision: bundle.revision,
        bundle_hash: bundle.bundle_hash,
        decision: "accept",
      }),
      { code: "BUNDLE_REVIEW_REQUIRED" },
    );
  });

  test("rejects and cleans a Review Runtime that writes its disposable Candidate workspace", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-bundle-review-write-",
      {
        bundleReviewMode: "independent",
        runtimeFactory: (plan) => new MutatingBundleReviewRuntime({ plan }),
      },
    );

    const result = await confirmAutonomousPlan(
      fixture.service,
      fixture.changeSetId,
    );

    assert.equal(result.supervision.status, "human_input_required");
    const state = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.equal(state.bundle_review_assessments.length, 0);
    assert.equal(
      state.bundle_review_last_error.code,
      "VERIFICATION_WORKSPACE_MODIFIED",
    );
    assert.deepEqual(
      state.run_references
        .filter((reference) => reference.operation === "review")
        .map((reference) => reference.status),
      ["failed", "failed"],
    );
  });

  test("routes an exact failed check through one read-only Supervisor decision and Feedback repair", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-feedback-",
      { requireFixedContent: true },
    );
    const result = await confirmAutonomousPlan(fixture.service, fixture.changeSetId);
    const failedState = await fixture.service.readChangeSet(fixture.changeSetId);

    assert.equal(
      result.supervision.status,
      "review_ready",
      JSON.stringify({
        supervision: result.supervision,
        feedback: failedState.feedback_records,
        work_units: failedState.work_units,
        blockers: failedState.blockers,
      }),
    );
    assert.equal(fixture.runtime.supervisionInvocationCount, 1);
    const supervisionInvocation = fixture.runtime.invocations.find(
      (invocation) => invocation.operation === "supervision",
    );
    assert.equal(supervisionInvocation.capabilities.mode, "read_only");
    assert.equal(
      supervisionInvocation.capabilities.typed_operations_only,
      true,
    );
    assert.equal(supervisionInvocation.context_projection.repositories, undefined);
    assert.equal(supervisionInvocation.context_projection.usage, undefined);
    assert.equal(supervisionInvocation.context_projection.transcript, undefined);
    assert.deepEqual(
      supervisionInvocation.context_projection.offered_actions.map(
        (action) => action.type,
      ),
      ["retry_validation", "submit_feedback", "open_gate"],
    );

    const state = failedState;
    assert.equal(state.phase, "review");
    assert.equal(
      state.feedback_records.some((feedback) => feedback.source === "validation"),
      true,
    );
    const supervisionReference = state.run_references.find(
      (reference) => reference.operation === "supervision",
    );
    const supervisionRun = await fixture.service.runStore.read(
      supervisionReference.run_id,
    );
    assert.equal(supervisionRun.outcome.disposition, "executed");
    assert.equal(
      supervisionRun.outcome.selected_action_id,
      supervisionInvocation.context_projection.offered_actions.find(
        (action) => action.type === "submit_feedback",
      ).action_id,
    );

    const audit = await new RuntimeAuditQueryService({
      controlStore: fixture.service.controlStore,
      runStore: fixture.service.runStore,
      evidenceStore: fixture.service.evidenceStore,
    }).getChangeSetAudit(fixture.changeSetId);
    assert.equal(
      audit.payload.runs.rows.some(
        (row) => row.identity.operation === "supervision",
      ),
      true,
    );
    await assert.rejects(
      stat(
        path.join(
          fixture.root,
          "workspaces",
          ".changefleet-supervision",
          fixture.changeSetId,
        ),
      ),
      { code: "ENOENT" },
    );
  });

  test("routes a failed verifier-requested check through bounded Feedback", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-verifier-check-feedback-",
      { requireVerifierCheckRepair: true },
    );

    const result = await confirmAutonomousPlan(
      fixture.service,
      fixture.changeSetId,
    );

    assert.equal(result.supervision.status, "review_ready");
    const state = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.deepEqual(
      state.run_references.map((reference) => reference.operation),
      [
        "planning",
        "execution",
        "verification",
        "supervision",
        "execution",
        "verification",
      ],
    );
    assert.equal(state.verification_reviews[0].check_status, "failed");
    assert.equal(state.verification_reviews[1].verdict, "pass");
    assert.equal(
      state.feedback_records.some(
        (feedback) => feedback.content.findings[0].text.startsWith(
          "VERIFICATION_CHECK_FAILED:",
        ),
      ),
      true,
    );
  });

  test("rejects and audits a Supervisor proposal that invents an action", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-invalid-supervisor-",
      {
        requireFixedContent: true,
        supervisionRuntime: new InvalidSupervisorRuntime(),
      },
    );

    await assert.rejects(
      confirmAutonomousPlan(fixture.service, fixture.changeSetId),
      { code: "SUPERVISOR_ACTION_NOT_OFFERED" },
    );
    const state = await fixture.service.readChangeSet(fixture.changeSetId);
    const reference = state.run_references.find(
      (candidate) => candidate.operation === "supervision",
    );
    assert.equal(reference.status, "failed");
    const run = await fixture.service.runStore.read(reference.run_id);
    assert.equal(run.status, "failed");
    assert.equal(run.outcome.code, "SUPERVISOR_ACTION_NOT_OFFERED");
    assert.equal(run.outcome.disposition, "rejected");
    assert.equal(
      run.outcome.disposition_error_code,
      "SUPERVISOR_ACTION_NOT_OFFERED",
    );
    assert.equal(
      (
        await fixture.service.runStore.readJsonArtifact(
          run.outcome.proposal_artifact,
        )
      ).action_id,
      "invented-action",
    );
    assert.equal(run.runtime_evidence.kind, "runtime_invocation");
  });

  test("preserves two-Repository dependencies and one exact combined Bundle", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-auto-two-repository-");
    const api = await createGitRepository(root, "api");
    const web = await createGitRepository(root, "web");
    const plan = createTwoRepositoryPlan(
      await writeCombinedCheckScript(root, 2),
    );
    plan.supervision.mode = "autonomous_until_review";
    plan.bundle_review = {
      mode: "independent",
      agent_profile_id: "scripted-test-profile-reviewer",
      agent_profile_revision: 1,
      attempt_limit: 2,
    };
    plan.supervision.elapsed_time_limit_ms = 120_000;
    const runtime = new ScriptedRuntime({ plan });
    const service = await ChangeFleetService.open({
      controlRoot: path.join(root, "control"),
      workspaceRoot: path.join(root, "workspaces"),
      runtime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    await service.registerProject({
      idempotency_key: "register",
      project: {
        project_id: "project",
        supervision_policy: {
          default_mode: "manual",
          max_execution_attempts_per_work_unit: 3,
          max_verification_attempts_per_work_unit: 3,
          max_feedback_cycles_per_work_unit: 2,
          max_elapsed_ms: 120_000,
        },
        bundle_review_policy: {
          default_mode: "independent",
          default_agent_profile_id: "scripted-test-profile-reviewer",
          default_agent_profile_revision: 1,
          max_attempts: 2,
        },
        repositories: [
          { repository_id: "api", locator: { path: api.path } },
          { repository_id: "web", locator: { path: web.path } },
        ],
      },
    });
    await service.createChangeSet({
      idempotency_key: "create",
      change_set_id: "two-repository-change",
      project_id: "project",
      intent: { objective: "Change API and web coherently" },
    });
    const result = await confirmAutonomousPlan(
      service,
      "two-repository-change",
    );

    assert.equal(result.supervision.status, "review_ready");
    const executionOrder = runtime.invocations
      .filter((invocation) => invocation.operation === "execution")
      .map(
        (invocation) => invocation.context_projection.work_unit.repository_id,
      );
    assert.deepEqual(executionOrder, ["api", "web"]);
    const state = await service.readChangeSet("two-repository-change");
    assert.equal(state.bundles.length, 1);
    assert.equal(state.bundles[0].candidates.length, 2);
    assert.equal(runtime.reviewInvocationCount, 1);
    assert.equal(
      runtime.invocations.find((invocation) => invocation.operation === "review")
        .context_projection.repositories.length,
      2,
    );
    assert.equal(state.phase, "review");
  });

  test("pauses at a bounded Gate and resumes the same authorized route without duplicate completed work", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-resume-",
    );
    fixture.runtime.failRepository = "api";
    fixture.runtime.failCode = "CODEX_PROVIDER_FAILED";
    fixture.runtime.supervisionActionType = "open_gate";
    const stopped = await confirmAutonomousPlan(
      fixture.service,
      fixture.changeSetId,
    );

    assert.equal(stopped.supervision.status, "stopped");
    let state = await fixture.service.readChangeSet(fixture.changeSetId);
    const gate = state.gates.find((candidate) => candidate.status === "open");
    assert.equal(gate.kind, "supervision_decision");
    assert.equal(state.supervision_control.hold !== null, true);
    await fixture.service.resolveGate({
      idempotency_key: "resolve-gate",
      change_set_id: fixture.changeSetId,
      gate_id: gate.gate_id,
      option: "resume",
    });
    await fixture.service.pauseSupervision({
      idempotency_key: "pause",
      change_set_id: fixture.changeSetId,
      reason: "operator_reviewed_failure",
    });
    const paused = await fixture.service.readSupervisionProgress({
      change_set_id: fixture.changeSetId,
    });
    assert.equal(paused.activity, "pause");

    fixture.runtime.failRepository = null;
    fixture.runtime.supervisionActionType = "retry_execution";
    const resumed = await fixture.service.resumeSupervision({
      idempotency_key: "resume",
      change_set_id: fixture.changeSetId,
    });
    assert.equal(resumed.status, "review_ready");
    state = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.equal(state.phase, "review");
    const unit = state.work_units.find(
      (candidate) => candidate.disposition === "current",
    );
    assert.equal(unit.run_references.length, 2);
    assert.deepEqual(
      unit.run_references.map((reference) => reference.status),
      ["failed", "completed"],
    );
  });

  test("stops after an explicit operator interruption instead of retrying it automatically", async (t) => {
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-interrupt-",
      {
        runtimeFactory: (plan) => new InterruptibleAutonomousRuntime({ plan }),
      },
    );
    const confirmation = confirmAutonomousPlan(
      fixture.service,
      fixture.changeSetId,
    );
    await fixture.runtime.started;
    const running = await fixture.service.readChangeSet(fixture.changeSetId);
    const run = running.run_references.find(
      (reference) =>
        reference.operation === "execution" && reference.status === "running",
    );
    await fixture.service.interruptRun({
      idempotency_key: "interrupt-autonomous-run",
      change_set_id: fixture.changeSetId,
      run_id: run.run_id,
    });

    const result = await confirmation;
    assert.equal(result.supervision.status, "stopped");
    assert.equal(result.supervision.stop_reason, "operator_interrupted");
    assert.equal(fixture.runtime.supervisionInvocationCount, 0);
    const stopped = await fixture.service.readChangeSet(fixture.changeSetId);
    assert.equal(
      stopped.run_references.find(
        (reference) => reference.run_id === run.run_id,
      ).status,
      "interrupted",
    );
  });

  test("reconciles an interrupted Supervisor Run before resuming the same Plan", async (t) => {
    const interruptedSupervisor = new InterruptedSupervisorRuntime();
    const fixture = await createAutonomousFixture(
      t,
      "changefleet-auto-supervisor-recovery-",
      {
        requireFixedContent: true,
        supervisionRuntime: interruptedSupervisor,
      },
    );

    await assert.rejects(
      confirmAutonomousPlan(fixture.service, fixture.changeSetId),
      { code: "CONTROLLER_INTERRUPTED" },
    );
    const interrupted = await fixture.service.readChangeSet(
      fixture.changeSetId,
    );
    const interruptedReference = interrupted.run_references.find(
      (reference) => reference.operation === "supervision",
    );
    assert.equal(interruptedReference.status, "running");
    assert.equal(
      fixture.runtime.invocations.filter(
        (invocation) => invocation.operation === "execution",
      ).length,
      1,
    );

    const resumedRuntime = new ScriptedRuntime({
      plan: fixture.plan,
      feedbackFileContent: "api fixed\n",
      feedbackExecutionOutcome: {
        type: "implementation_completed",
        summary: "Applied Feedback after recovering the Supervisor Run.",
        changed_paths: ["feature.txt"],
        blocker: null,
      },
    });
    const reopened = await ChangeFleetService.open({
      controlRoot: path.join(fixture.root, "control"),
      workspaceRoot: path.join(fixture.root, "workspaces"),
      runtime: resumedRuntime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    const result = await reopened.startSupervision({
      idempotency_key: "resume-after-controller-restart",
      change_set_id: fixture.changeSetId,
    });

    assert.equal(result.status, "review_ready");
    const recovered = await reopened.readChangeSet(fixture.changeSetId);
    assert.deepEqual(
      recovered.run_references
        .filter((reference) => reference.operation === "supervision")
        .map((reference) => reference.status),
      ["interrupted", "completed"],
    );
    assert.equal(
      resumedRuntime.invocations.filter(
        (invocation) => invocation.operation === "execution",
      ).length,
      1,
    );
  });
});

async function createAutonomousFixture(
  t,
  prefix,
  {
    requireFixedContent = false,
    requireVerifierCheckRepair = false,
    runtimeFactory = null,
    supervisionRuntime = null,
    bundleReviewMode = "none",
    bundleReviewOutcomes = null,
    feedbackFileContent = null,
    supervisionMode = "autonomous_until_review",
  } = {},
) {
  const root = await createFixtureRoot(t, prefix);
  const repository = await createGitRepository(root, "api");
  const combinedScript = await writeCombinedCheckScript(root, 1);
  const plan = createOneRepositoryPlan(combinedScript);
  plan.supervision.mode = supervisionMode;
  plan.supervision.verification_attempt_limit_per_work_unit = 6;
  plan.supervision.elapsed_time_limit_ms = 120_000;
  if (bundleReviewMode === "independent") {
    plan.bundle_review = {
      mode: "independent",
      agent_profile_id: "scripted-test-profile-reviewer",
      agent_profile_revision: 1,
      attempt_limit: 2,
    };
  }
  if (requireFixedContent) {
    plan.work_units[0].repository_check.argv = [
      "-e",
      "const fs=require('node:fs');if(!fs.readFileSync('feature.txt','utf8').includes('fixed'))process.exit(2)",
    ];
  }
  if (requireVerifierCheckRepair) {
    plan.verification_expectation.mode = "independent_review";
  }
  const passingVerification = {
    type: "verification_completed",
    review_depth: "triage",
    verdict: "pass",
    summary: "The repaired exact Candidate satisfies the confirmed Plan.",
    findings: [],
    notes: [],
    human_decision: null,
    requested_checks: [],
  };
  const runtime = runtimeFactory?.(plan) ?? new ScriptedRuntime({
    plan,
    verificationOutcomes: requireVerifierCheckRepair
      ? [
          {
            ...passingVerification,
            summary: "The verdict is conditional on one exact requested check.",
            requested_checks: [
              {
                command_id: "require-fixed-content",
                executable: process.execPath,
                argv: [
                  "-e",
                  "const fs=require('node:fs');if(!fs.readFileSync('feature.txt','utf8').includes('fixed'))process.exit(2)",
                ],
                coverage_rationale: "Requires repaired behavior on the exact Candidate",
                timeout_ms: 10_000,
              },
            ],
          },
          passingVerification,
        ]
      : null,
    feedbackFileContent:
      feedbackFileContent ??
      (requireFixedContent || requireVerifierCheckRepair ? "api fixed\n" : null),
    reviewOutcomes: bundleReviewOutcomes,
    feedbackExecutionOutcome:
      requireFixedContent || requireVerifierCheckRepair || feedbackFileContent
      ? {
          type: "implementation_completed",
          summary: "Applied the exact validation Feedback.",
          changed_paths: ["feature.txt"],
          blocker: null,
        }
      : null,
  });
  const service = await ChangeFleetService.open({
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
    runtime,
    supervisionRuntime: supervisionRuntime ?? runtime,
    agentProfile: TEST_AGENT_PROFILE,
  });
  await service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      supervision_policy: {
        default_mode: "manual",
          max_execution_attempts_per_work_unit: 3,
          max_verification_attempts_per_work_unit: 6,
        max_feedback_cycles_per_work_unit: 2,
        max_elapsed_ms: 120_000,
      },
      bundle_review_policy:
        bundleReviewMode === "independent"
          ? {
              default_mode: "independent",
              default_agent_profile_id: "scripted-test-profile-reviewer",
              default_agent_profile_revision: 1,
              max_attempts: 2,
            }
          : undefined,
      repositories: [
        { repository_id: "api", locator: { path: repository.path } },
      ],
    },
  });
  const changeSetId = "autonomous-change";
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: changeSetId,
    project_id: "project",
    intent: { objective: "Implement the exact autonomous fixture" },
  });
  return { root, repository, plan, runtime, service, changeSetId };
}

async function confirmAutonomousPlan(service, changeSetId) {
  const planned = await service.planChangeSet({
    idempotency_key: "plan",
    change_set_id: changeSetId,
  });
  return service.confirmPlanMessage({
    idempotency_key: "confirm",
    change_set_id: changeSetId,
    message_id: planned.message.message_id,
    content_digest: planned.message.content_digest,
  });
}

class InterruptedSupervisorRuntime extends ScriptedRuntime {
  constructor() {
    super({ plan: null });
  }

  async invoke(invocation) {
    this.invocations.push(structuredClone(invocation));
    throw new ChangeFleetError(
      "CONTROLLER_INTERRUPTED",
      "Simulated controller loss during semantic supervision",
    );
  }
}

class InterruptedBundleReviewRuntime extends ScriptedRuntime {
  async invoke(invocation) {
    if (invocation.operation !== "review" || this.interrupted) {
      return super.invoke(invocation);
    }
    this.invocations.push(structuredClone(invocation));
    this.interrupted = true;
    throw new ChangeFleetError(
      "CONTROLLER_INTERRUPTED",
      "Simulated controller loss during exact Bundle review",
    );
  }
}

class MutatingBundleReviewRuntime extends ScriptedRuntime {
  async invoke(invocation) {
    if (invocation.operation === "review") {
      await writeFile(
        path.join(
          invocation.context_projection.repositories[0].root_path,
          "feature.txt",
        ),
        "reviewer mutation\n",
        "utf8",
      );
    }
    return super.invoke(invocation);
  }
}

class InvalidSupervisorRuntime extends ScriptedRuntime {
  constructor() {
    super({ plan: null });
  }

  async invoke(invocation) {
    this.invocations.push(structuredClone(invocation));
    return {
      outcome: {
        type: "supervisor_decision_proposal",
        action_id: "invented-action",
        projection_digest: invocation.context_projection.projection_digest,
        rationale: "This deliberately malformed fixture invents authority.",
        expected_result: "The kernel rejects the proposal.",
        evidence_reference_ids: [],
      },
      provider_evidence: {
        provider: "test",
        runtime: "scripted",
        model: "fixture",
        usage: {
          input_tokens: 5,
          cached_input_tokens: 0,
          output_tokens: 3,
          reasoning_tokens: 0,
          total_tokens: 8,
          coverage: "complete",
        },
      },
    };
  }
}

class InterruptibleAutonomousRuntime extends ScriptedRuntime {
  constructor(options) {
    super(options);
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  async invoke(invocation) {
    if (invocation.operation !== "execution") {
      return super.invoke(invocation);
    }
    this.invocations.push(structuredClone(invocation));
    this.resolveStarted();
    return new Promise((resolve, reject) => {
      invocation.signal.addEventListener(
        "abort",
        () => reject(invocation.signal.reason),
        { once: true },
      );
    });
  }
}
