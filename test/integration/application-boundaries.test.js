import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import {
  createFixtureRoot,
  createGitRepository,
  git,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createTwoRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("application failure and revision boundaries", () => {
  test("preserves partial failure and cannot assemble a complete Bundle", async (t) => {
    const fixture = await createApplicationFixture(t, "partial");
    const runtime = new ScriptedRuntime({
      plan: fixture.plan,
      failRepository: "web",
    });
    const service = await openBootstrappedService(fixture, runtime);

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-1",
        change_set_id: "change-1",
      }),
      { code: "SCRIPTED_EXECUTION_FAILURE" },
    );
    const state = await service.readChangeSet("change-1");
    assert.equal(state.phase, "working");
    assert.equal(state.candidates.length, 0);
    assert.equal(state.candidate_checkpoints.length, 1);
    assert.equal(state.candidate_checkpoints[0].repository_id, "api");
    assert.equal(state.bundles.length, 0);
    assert.equal(
      state.work_units.find((unit) => unit.repository_id === "web").phase,
      "execution",
    );
    assert.equal(
      state.blockers.some((blocker) => blocker.work_unit_id === "web-unit"),
      true,
    );
  });

  test("planning conversation replaces the approval subject without allocating Plan revisions", async (t) => {
    const fixture = await createApplicationFixture(t, "replan");
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const service = await ChangeFleetService.open({
      controlRoot: fixture.controlRoot,
      workspaceRoot: fixture.workspaceRoot,
      runtime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    await registerAndCreate(service, fixture);
    const first = await service.planChangeSet({
      idempotency_key: "plan-1",
      change_set_id: "change-1",
    });
    const second = await service.planChangeSet({
      idempotency_key: "plan-2",
      change_set_id: "change-1",
      message: "Keep the same scope but explain the checks more clearly.",
    });

    const state = await service.readChangeSet("change-1");
    assert.equal(state.change_set_id, "change-1");
    assert.equal(state.current_plan_revision, null);
    assert.deepEqual(state.plans, []);
    assert.deepEqual(state.work_units, []);
    assert.equal(state.planning_message_references.length, 2);
    assert.equal(
      state.current_approvable_plan_message_id,
      second.message.message_id,
    );
    await assert.rejects(
      service.confirmPlanMessage({
        idempotency_key: "confirm-stale-message",
        change_set_id: "change-1",
        message_id: first.message.message_id,
        content_digest: first.message.content_digest,
      }),
      { code: "STALE_PLAN_MESSAGE_CONFIRMATION" },
    );
    const confirmed = await service.confirmPlanMessage({
      idempotency_key: "confirm-current-message",
      change_set_id: "change-1",
      message_id: second.message.message_id,
      content_digest: second.message.content_digest,
    });
    assert.equal(confirmed.plan_revision, 1);
    assert.equal(confirmed.plan.summary, second.message.plan_content.summary);
    assert.equal("work_units" in confirmed.plan, false);
    assert.equal("supervision" in confirmed.plan, false);
    assert.equal(
      confirmed.workspace_control_summary.task_workspace_id,
      state.task_workspace.task_workspace_id,
    );
  });

  test("carries an assistant question into the next planning turn without replaying older history", async (t) => {
    const fixture = await createApplicationFixture(t, "planning-question");
    const runtime = new ScriptedRuntime({
      plan: fixture.plan,
      planningOutcomes: [
        {
          type: "conversation_message",
          message: {
            text: "Should the implementation preserve the current public route?",
            plan: null,
          },
          request: null,
        },
        {
          type: "conversation_message",
          message: {
            text: "The clarified answer is now reflected in the Plan.",
            plan: fixture.plan,
          },
          request: null,
        },
      ],
    });
    const service = await ChangeFleetService.open({
      controlRoot: fixture.controlRoot,
      workspaceRoot: fixture.workspaceRoot,
      runtime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    await registerAndCreate(service, fixture);

    const question = await service.planChangeSet({
      idempotency_key: "question",
      change_set_id: "change-1",
    });
    assert.equal(question.status, "planning");
    assert.equal(
      (await service.readChangeSet("change-1"))
        .current_approvable_plan_message_id,
      null,
    );

    const answer = await service.planChangeSet({
      idempotency_key: "answer",
      change_set_id: "change-1",
      message: "Yes. Preserve that public route.",
    });
    assert.equal(answer.status, "plan_ready");
    const secondProjection = runtime.invocations[1].context_projection;
    assert.deepEqual(secondProjection.planning_conversation, {
      user_message: "Yes. Preserve that public route.",
      previous_assistant_message: {
        message_id: question.message.message_id,
        content_digest: question.message.content_digest,
        text: question.message.text,
        plan_content: null,
      },
    });
    assert.equal(
      JSON.stringify(secondProjection).includes(
        "The clarified answer is now reflected in the Plan.",
      ),
      false,
    );
  });

  test("requires bounded request-revision feedback in only the current Runtime projection", async (t) => {
    const fixture = await createApplicationFixture(t, "revision-feedback");
    const runtime = new ScriptedRuntime({
      plan: fixture.plan,
      feedbackExecutionOutcome: {
        type: "implementation_completed",
        summary: "Assessed the bounded feedback without changing the Candidate.",
        changed_paths: [],
        blocker: null,
      },
    });
    const service = await openBootstrappedService(fixture, runtime);
    const first = await service.executeChangeSet({
      idempotency_key: "execute-1",
      change_set_id: "change-1",
    });
    const initialState = await service.readChangeSet("change-1");
    const initialSubjects = new Map(
      initialState.work_units.map((unit) => [
        unit.work_unit_id,
        {
          checkpoint_id: unit.candidate_checkpoint_id,
          candidate_sha: unit.candidate.candidate_sha,
          workspace_id: unit.workspace.workspace_id,
          validation_attempt_ids: [...unit.validation_attempt_ids],
        },
      ]),
    );
    await assert.rejects(
      service.recordBundleDecision({
        idempotency_key: "revision-without-feedback",
        change_set_id: "change-1",
        bundle_revision: first.bundle_revision,
        bundle_hash: first.bundle_hash,
        decision: "request_revision",
      }),
      { code: "INVALID_REVISION_FEEDBACK" },
    );
    const feedback = {
      summary: "Fix only the current reviewed blockers",
      findings: [
        { finding_id: "finding-1", text: "Harden exact bootstrap encoding" },
      ],
    };
    await service.recordBundleDecision({
      idempotency_key: "revision-with-feedback",
      change_set_id: "change-1",
      bundle_revision: first.bundle_revision,
      bundle_hash: first.bundle_hash,
      decision: "request_revision",
      feedback,
    });
    const feedbackState = await service.readChangeSet("change-1");
    for (const unit of feedbackState.work_units) {
      const initial = initialSubjects.get(unit.work_unit_id);
      assert.equal(unit.phase, "execution");
      assert.equal(unit.candidate, null);
      assert.equal(unit.candidate_checkpoint_id, initial.checkpoint_id);
      assert.equal(unit.workspace.workspace_id, initial.workspace_id);
      assert.deepEqual(
        unit.validation_attempt_ids,
        initial.validation_attempt_ids,
      );
    }
    const resumedService = await ChangeFleetService.open({
      controlRoot: fixture.controlRoot,
      workspaceRoot: fixture.workspaceRoot,
      runtime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    const second = await resumedService.executeChangeSet({
      idempotency_key: "execute-2",
      change_set_id: "change-1",
    });
    assert.equal(second.bundle_revision, 2);
    const correctedState = await resumedService.readChangeSet("change-1");
    assert.equal(correctedState.current_plan_revision, 1);
    assert.equal(correctedState.plans.length, 1);
    assert.equal(correctedState.current_feedback_id, null);
    assert.equal(correctedState.feedback_records.length, 1);
    const executionProjection = runtime.invocations
      .filter(
        (invocation) =>
          invocation.operation === "execution" &&
          invocation.context_projection.feedback !== null,
      )[0].context_projection;
    assert.deepEqual(executionProjection.feedback.findings, feedback.findings);
    assert.equal("candidate_checkpoint_id" in executionProjection.work_unit, false);
    assert.equal("workspace" in executionProjection.work_unit, false);
    const feedbackExecutions = runtime.invocations.filter(
      (invocation) =>
        invocation.operation === "execution" &&
        invocation.context_projection.feedback !== null,
    );
    assert.equal(feedbackExecutions.length, 2);
    for (const invocation of feedbackExecutions) {
      const initial = initialSubjects.get(
        invocation.context_projection.work_unit.work_unit_id,
      );
      assert.equal(invocation.control_contract.plan_revision, 1);
      assert.equal(
        invocation.context_projection.repositories[0].candidate_sha,
        initial.candidate_sha,
      );
    }
    assert.equal(
      correctedState.candidate_checkpoints.length,
      initialState.candidate_checkpoints.length,
    );
    for (const unit of correctedState.work_units) {
      const initial = initialSubjects.get(unit.work_unit_id);
      assert.equal(unit.candidate_checkpoint_id, initial.checkpoint_id);
      assert.equal(unit.candidate.candidate_sha, initial.candidate_sha);
      const feedbackReference = unit.run_references.find(
        (reference) =>
          reference.operation === "execution" &&
          reference.trigger === "feedback",
      );
      const feedbackRun = await resumedService.runStore.read(
        feedbackReference.run_id,
      );
      assert.equal(feedbackRun.outcome.no_change, true);
      assert.deepEqual(feedbackRun.outcome.actual_changed_paths, []);
    }
  });

  test("publishes changed Bundle feedback as descendants of current checkpoints", async (t) => {
    const fixture = await createApplicationFixture(t, "revision-feedback-descendant");
    const runtime = new ScriptedRuntime({
      plan: fixture.plan,
      feedbackFileContent: "api web corrected after Bundle review\n",
      feedbackExecutionOutcome: {
        type: "implementation_completed",
        summary: "Applied the bounded Bundle feedback.",
        changed_paths: ["feature.txt"],
        blocker: null,
      },
    });
    const service = await openBootstrappedService(fixture, runtime);
    const first = await service.executeChangeSet({
      idempotency_key: "execute-descendant-1",
      change_set_id: "change-1",
    });
    const initialState = await service.readChangeSet("change-1");
    const initialCandidates = new Map(
      initialState.work_units.map((unit) => [
        unit.work_unit_id,
        unit.candidate.candidate_sha,
      ]),
    );

    await service.recordBundleDecision({
      idempotency_key: "revision-with-descendant-change",
      change_set_id: "change-1",
      bundle_revision: first.bundle_revision,
      bundle_hash: first.bundle_hash,
      decision: "request_revision",
      feedback: {
        summary: "Apply the exact reviewed correction",
        findings: [
          { finding_id: "finding-descendant", text: "Correct feature.txt" },
        ],
      },
    });
    const second = await service.executeChangeSet({
      idempotency_key: "execute-descendant-2",
      change_set_id: "change-1",
    });
    const correctedState = await service.readChangeSet("change-1");

    assert.equal(second.bundle_revision, 2);
    assert.equal(correctedState.candidate_checkpoints.length, 4);
    for (const unit of correctedState.work_units) {
      const sourceSha = initialCandidates.get(unit.work_unit_id);
      assert.notEqual(unit.candidate.candidate_sha, sourceSha);
      assert.equal(
        (await git(unit.workspace.workspace_path, ["rev-parse", "HEAD^"])).trim(),
        sourceSha,
      );
      const feedbackReference = unit.run_references.find(
        (reference) =>
          reference.operation === "execution" &&
          reference.trigger === "feedback",
      );
      const feedbackRun = await service.runStore.read(feedbackReference.run_id);
      assert.equal(feedbackRun.outcome.no_change, false);
      assert.deepEqual(feedbackRun.outcome.actual_changed_paths, ["feature.txt"]);
    }
  });

  test("allocates a later Plan revision only after typed execution invalidation and exact approval", async (t) => {
    const fixture = await createApplicationFixture(t, "typed-plan-invalidation");
    const runtime = new ScriptedRuntime({
      plan: fixture.plan,
      executionOutcome: {
        type: "plan_invalidation_required",
        summary: "The confirmed design cannot satisfy the exact repository contract",
        changed_paths: [],
        blocker: {
          code: "design_assumption_invalid",
          message: "The exact base exposes a mutually exclusive contract",
        },
      },
    });
    const service = await openBootstrappedService(fixture, runtime);
    const invalidated = await service.executeChangeSet({
      idempotency_key: "execute-invalidated",
      change_set_id: "change-1",
    });
    assert.equal(invalidated.status, "replanning");
    const invalidatedState = await service.readChangeSet("change-1");
    assert.equal(invalidatedState.current_plan_revision, 1);
    assert.equal(invalidatedState.plans[0].status, "invalidated");
    assert.equal(invalidatedState.bundles.length, 0);

    runtime.executionOutcome = null;
    const replacement = await service.planChangeSet({
      idempotency_key: "replacement-plan-message",
      change_set_id: "change-1",
      message: "Replace the invalidated execution contract.",
    });
    assert.equal((await service.readChangeSet("change-1")).plans.length, 1);
    const confirmed = await service.confirmPlanMessage({
      idempotency_key: "confirm-replacement",
      change_set_id: "change-1",
      message_id: replacement.message.message_id,
      content_digest: replacement.message.content_digest,
    });
    assert.equal(confirmed.plan_revision, 2);
  });
});

async function createApplicationFixture(t, name) {
  const root = await createFixtureRoot(t, `changefleet-${name}-`);
  const api = await createGitRepository(root, "api");
  const web = await createGitRepository(root, "web");
  const combinedScript = await writeCombinedCheckScript(root);
  return {
    root,
    api,
    web,
    plan: createTwoRepositoryPlan(combinedScript),
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
  };
}

async function openBootstrappedService(fixture, runtime) {
  const service = await ChangeFleetService.open({
    controlRoot: fixture.controlRoot,
    workspaceRoot: fixture.workspaceRoot,
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  });
  await registerAndCreate(service, fixture);
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

async function registerAndCreate(service, fixture) {
  await service.registerProject({
    idempotency_key: "register-1",
    project: {
      project_id: "project-1",
      repositories: [
        { repository_id: "api", locator: { path: fixture.api.path } },
        { repository_id: "web", locator: { path: fixture.web.path } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create-1",
    change_set_id: "change-1",
    project_id: "project-1",
    intent: {
      objective: "Change both repositories",
      acceptance_criteria: ["Produce one exact Bundle"],
    },
  });
}
