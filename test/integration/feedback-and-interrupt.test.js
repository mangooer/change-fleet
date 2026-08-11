import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
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

describe("stage-neutral feedback and interruption", () => {
  test("queues feedback during execution and handles it in another execution Run", async (t) => {
    const fixture = await createFixture(t, "feedback");
    const runtime = new PausingExecutionRuntime({ plan: fixture.plan });
    const service = await bootstrap(fixture, runtime);
    const executionPromise = service.executeChangeSet({
      idempotency_key: "execute-initial",
      change_set_id: "change",
    });
    await runtime.started;
    const active = await service.readChangeSet("change");
    const activeRun = active.run_references.find(
      (reference) =>
        reference.operation === "execution" && reference.status === "running",
    );

    const submitted = await service.submitFeedback({
      idempotency_key: "feedback-active",
      change_set_id: "change",
      phase: "working",
      work_unit_id: "api-unit",
      run_id: activeRun.run_id,
      feedback: {
        summary: "Use the final public value before verification.",
        findings: [
          {
            finding_id: "final-value",
            text: "Replace the draft with the final API implementation.",
          },
        ],
      },
      actor: "human",
    });
    assert.equal(submitted.delivery, "next_run");
    runtime.release();
    const result = await executionPromise;
    const state = await service.readChangeSet("change");

    assert.equal(result.bundle_revision, 1);
    assert.deepEqual(
      state.work_units[0].run_references
        .filter((reference) => reference.operation === "execution")
        .map((reference) => reference.trigger),
      ["initial", "feedback"],
    );
    assert.equal(state.feedback_records.length, 1);
    assert.equal(
      runtime.invocations.find(
        (invocation) =>
          invocation.operation === "execution" &&
          invocation.context_projection.feedback !== null,
      ).context_projection.feedback.feedback_id,
      submitted.feedback_id,
    );
  });

  test("interrupts one locally owned Run without changing its WorkUnit phase", async (t) => {
    const fixture = await createFixture(t, "interrupt");
    const runtime = new InterruptibleExecutionRuntime({ plan: fixture.plan });
    const service = await bootstrap(fixture, runtime);
    const executionPromise = service.executeChangeSet({
      idempotency_key: "execute-interruptible",
      change_set_id: "change",
    });
    await runtime.started;
    const active = await service.readChangeSet("change");
    const activeRun = active.run_references.find(
      (reference) =>
        reference.operation === "execution" && reference.status === "running",
    );
    const request = {
      idempotency_key: "interrupt-active",
      change_set_id: "change",
      run_id: activeRun.run_id,
      actor: "human",
    };
    const interrupted = await service.interruptRun(request);
    assert.equal(interrupted.status, "interrupt_requested");
    await assert.rejects(executionPromise, { code: "RUNTIME_INTERRUPTED" });
    assert.deepEqual(await service.interruptRun(request), interrupted);

    const stopped = await service.readChangeSet("change");
    assert.equal(stopped.phase, "working");
    assert.equal(stopped.work_units[0].phase, "execution");
    assert.equal(stopped.work_units[0].run_references[0].status, "interrupted");
    assert.equal(
      stopped.blockers.some(
        (blocker) => blocker.run_id === activeRun.run_id,
      ),
      false,
    );

    const reopened = await ChangeFleetService.open({
      ...fixture.options,
      runtime: new ScriptedRuntime({ plan: fixture.plan }),
    });
    const result = await reopened.executeChangeSet({
      idempotency_key: "execute-after-interrupt",
      change_set_id: "change",
    });
    assert.equal(result.bundle_revision, 1);
  });

  test("queues feedback during verification and re-verifies the same exact Candidate", async (t) => {
    const fixture = await createFixture(t, "verification-feedback");
    fixture.verificationMode = "independent_review";
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const verificationRuntime = new PausingVerificationRuntime({
      plan: fixture.plan,
    });
    const service = await bootstrap(
      fixture,
      runtime,
      verificationRuntime,
    );
    const executionPromise = service.executeChangeSet({
      idempotency_key: "execute-verification-initial",
      change_set_id: "change",
    });
    await verificationRuntime.started;
    const active = await service.readChangeSet("change");
    const activeRun = active.run_references.find(
      (reference) =>
        reference.operation === "verification" &&
        reference.status === "running",
    );
    const submitted = await service.submitFeedback({
      idempotency_key: "feedback-verification-active",
      change_set_id: "change",
      phase: "working",
      work_unit_id: "api-unit",
      run_id: activeRun.run_id,
      feedback: {
        summary: "Check the compatibility edge explicitly.",
        findings: [
          {
            finding_id: "compatibility-edge",
            text: "Reassess the exact diff against the compatibility edge.",
          },
        ],
      },
      actor: "human",
    });
    verificationRuntime.release();
    const waiting = await executionPromise;
    assert.equal(waiting.status, "feedback_required");

    const result = await service.executeChangeSet({
      idempotency_key: "execute-verification-feedback",
      change_set_id: "change",
    });
    const state = await service.readChangeSet("change");
    assert.equal(result.bundle_revision, 1);
    assert.equal(state.candidate_checkpoints.length, 1);
    assert.deepEqual(
      state.work_units[0].run_references
        .filter((reference) => reference.operation === "verification")
        .map((reference) => reference.trigger),
      ["initial", "feedback"],
    );
    assert.equal(state.verification_reviews[1].feedback_id, submitted.feedback_id);
    assert.equal(state.verification_reviews[1].source_review_id, null);
    assert.equal(
      verificationRuntime.invocations[1].context_projection.feedback.feedback_id,
      submitted.feedback_id,
    );
  });

  test("resolves a human Gate into feedback and continues verification", async (t) => {
    const fixture = await createFixture(t, "gate");
    fixture.verificationMode = "independent_review";
    const runtime = new ScriptedRuntime({
      plan: fixture.plan,
      verificationOutcomes: [
        {
          type: "verification_completed",
          review_depth: "triage",
          verdict: "human_decision_required",
          summary: "One compatibility choice remains.",
          findings: [],
          notes: [],
          human_decision: {
            question: "Which behavior is authoritative?",
            options: ["Preserve legacy", "Adopt new behavior"],
          },
          requested_checks: [],
        },
        passingVerificationOutcome(),
      ],
    });
    const service = await bootstrap(fixture, runtime);
    const waiting = await service.executeChangeSet({
      idempotency_key: "execute-gate",
      change_set_id: "change",
    });
    assert.equal(waiting.status, "human_input_required");
    await assert.rejects(
      service.resolveGate({
        idempotency_key: "resolve-invalid",
        change_set_id: "change",
        gate_id: waiting.gate_id,
        option: "Unlisted choice",
        actor: "human",
      }),
      { code: "INVALID_GATE_DECISION" },
    );
    const resolved = await service.resolveGate({
      idempotency_key: "resolve-gate",
      change_set_id: "change",
      gate_id: waiting.gate_id,
      option: "Preserve legacy",
      actor: "human",
    });
    assert.equal(resolved.status, "resolved");
    const result = await service.executeChangeSet({
      idempotency_key: "execute-after-gate",
      change_set_id: "change",
    });
    const state = await service.readChangeSet("change");
    assert.equal(result.bundle_revision, 1);
    assert.equal(state.gates[0].status, "resolved");
    assert.equal(state.work_units[0].phase, "complete");
    assert.equal(state.verification_reviews[1].feedback_id, resolved.feedback_id);
  });
});

class PausingExecutionRuntime extends ScriptedRuntime {
  constructor(options) {
    super(options);
    this.executionCount = 0;
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.released = new Promise((resolve) => {
      this.resolveRelease = resolve;
    });
  }

  release() {
    this.resolveRelease();
  }

  async invoke(invocation) {
    if (invocation.operation !== "execution") {
      return super.invoke(invocation);
    }
    this.executionCount += 1;
    if (this.executionCount === 1) {
      this.invocations.push(structuredClone(invocation));
      await writeFile(
        path.join(invocation.workspace.workspace_path, "feature.txt"),
        "api draft\n",
        "utf8",
      );
      this.resolveStarted();
      await this.released;
      return implementationOutcome("Initial draft", []);
    }
    return super.invoke(invocation);
  }
}

class InterruptibleExecutionRuntime extends ScriptedRuntime {
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

class PausingVerificationRuntime extends ScriptedRuntime {
  constructor(options) {
    super(options);
    this.verificationCount = 0;
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.released = new Promise((resolve) => {
      this.resolveRelease = resolve;
    });
  }

  release() {
    this.resolveRelease();
  }

  async invoke(invocation) {
    if (invocation.operation !== "verification") {
      return super.invoke(invocation);
    }
    this.verificationCount += 1;
    if (this.verificationCount === 1) {
      this.invocations.push(structuredClone(invocation));
      this.resolveStarted();
      await this.released;
      return {
        outcome: passingVerificationOutcome(),
        provider_evidence: implementationOutcome("unused", []).provider_evidence,
      };
    }
    return super.invoke(invocation);
  }
}

function implementationOutcome(summary, assessments) {
  return {
    outcome: {
      type: "implementation_completed",
      summary,
      changed_paths: ["feature.txt"],
      blocker: null,
      revision_feedback_assessments: assessments,
    },
    provider_evidence: {
      evidence_classification: "test_fixture",
      provider: {
        name: "test",
        runtime: "scripted",
        sdk_version: null,
        cli_version: null,
        thread_id: null,
      },
      observed: { effective_model: null },
      usage_observations: [],
      raw_artifact_references: [],
    },
  };
}

function passingVerificationOutcome() {
  return {
    type: "verification_completed",
    review_depth: "triage",
    verdict: "pass",
    summary: "The exact Candidate satisfies the confirmed contract.",
    findings: [],
    notes: [],
    human_decision: null,
    requested_checks: [],
  };
}

async function createFixture(t, name) {
  const root = await createFixtureRoot(t, `changefleet-control-${name}-`);
  const repository = await createGitRepository(root, "api");
  const combined = await writeCombinedCheckScript(root, 1);
  return {
    repository,
    plan: createOneRepositoryPlan(combined),
    options: {
      controlRoot: path.join(root, "control"),
      workspaceRoot: path.join(root, "workspaces"),
      agentProfile: TEST_AGENT_PROFILE,
    },
  };
}

async function bootstrap(fixture, runtime, verificationRuntime = runtime) {
  const service = await ChangeFleetService.open({
    ...fixture.options,
    runtime,
    verificationRuntime,
    verificationAgentProfile: TEST_AGENT_PROFILE,
  });
  await service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      verification_policy:
        fixture.verificationMode === "independent_review"
          ? { minimum_mode: "independent_review" }
          : undefined,
      repositories: [
        {
          repository_id: "api",
          locator: { path: fixture.repository.path },
        },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: "change",
    project_id: "project",
    intent: { objective: "Exercise feedback and interruption" },
  });
  const planned = await service.planChangeSet({
    idempotency_key: "plan",
    change_set_id: "change",
  });
  await service.confirmPlanMessage({
    idempotency_key: "confirm",
    change_set_id: "change",
    message_id: planned.message.message_id,
    content_digest: planned.message.content_digest,
  });
  return service;
}
