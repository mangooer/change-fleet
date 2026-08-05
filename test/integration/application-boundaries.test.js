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
    assert.equal(state.state, "failed");
    assert.equal(state.candidates.length, 1);
    assert.equal(state.candidates[0].repository_id, "api");
    assert.equal(state.bundles.length, 0);
    assert.equal(
      state.work_units.find((unit) => unit.repository_id === "web").state,
      "failed",
    );
  });

  test("fails combined validation when a Candidate workspace changes", async (t) => {
    const fixture = await createApplicationFixture(t, "mutating");
    const mutatingScript = path.join(fixture.root, "mutating-check.mjs");
    await writeFile(
      mutatingScript,
      [
        'import { readFile, writeFile } from "node:fs/promises";',
        "const manifest = JSON.parse(await readFile(process.env.CHANGEFLEET_VALIDATION_MANIFEST, 'utf8'));",
        "await writeFile(`${manifest.candidates[0].workspace_path}/tampered.txt`, 'changed\\n', 'utf8');",
        "",
      ].join("\n"),
      "utf8",
    );
    fixture.plan.combined_check.argv = [mutatingScript];
    const service = await openBootstrappedService(
      fixture,
      new ScriptedRuntime({ plan: fixture.plan }),
    );

    await assert.rejects(
      service.executeChangeSet({
        idempotency_key: "execute-1",
        change_set_id: "change-1",
      }),
      { code: "COMBINED_VALIDATION_FAILED" },
    );
    const state = await service.readChangeSet("change-1");
    assert.equal(state.state, "failed");
    assert.equal(state.candidates.length, 2);
    assert.equal(state.bundles.length, 0);
    const attempt = state.validation_attempts.at(-1);
    assert.equal(attempt.kind, "combined_validation");
    assert.equal(attempt.status, "failed");
    const evidence = await service.evidenceStore.read(attempt.evidence.evidence_id);
    assert.equal(evidence.payload.postflight.status, "failed");
  });

  test("replanning continues one ChangeSet and preserves superseded work", async (t) => {
    const fixture = await createApplicationFixture(t, "replan");
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const service = await ChangeFleetService.open({
      controlRoot: fixture.controlRoot,
      workspaceRoot: fixture.workspaceRoot,
      runtime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    await registerAndCreate(service, fixture);
    await service.planChangeSet({
      idempotency_key: "plan-1",
      change_set_id: "change-1",
    });
    await service.planChangeSet({
      idempotency_key: "plan-2",
      change_set_id: "change-1",
    });

    const state = await service.readChangeSet("change-1");
    assert.equal(state.change_set_id, "change-1");
    assert.equal(state.current_plan_revision, 2);
    assert.deepEqual(
      state.plans.map((plan) => plan.status),
      ["superseded", "proposed"],
    );
    assert.equal(state.work_units.length, 4);
    assert.deepEqual(
      state.work_units
        .filter((unit) => unit.plan_revision === 1)
        .map((unit) => unit.state),
      ["superseded", "superseded"],
    );
  });

  test("requires bounded request-revision feedback in only the current Runtime projection", async (t) => {
    const fixture = await createApplicationFixture(t, "revision-feedback");
    const runtime = new ScriptedRuntime({ plan: fixture.plan });
    const service = await openBootstrappedService(fixture, runtime);
    const first = await service.executeChangeSet({
      idempotency_key: "execute-1",
      change_set_id: "change-1",
    });
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
    const secondPlan = await service.planChangeSet({
      idempotency_key: "plan-2",
      change_set_id: "change-1",
    });
    const planningProjection = runtime.invocations
      .filter((invocation) => invocation.operation === "planning")
      .at(-1).context_projection;
    assert.deepEqual(planningProjection.revision_feedback, {
      bundle_revision: first.bundle_revision,
      bundle_hash: first.bundle_hash,
      ...feedback,
    });
    assert.equal(
      planningProjection.decisions.some(
        (decision) => decision.type === "bundle_review",
      ),
      false,
    );
    assert.deepEqual(secondPlan.plan.revision_feedback_assessments, [
      {
        finding_id: "finding-1",
        disposition: "adopt",
        rationale: "The deterministic fixture adopts the reviewed finding",
      },
    ]);

    const savedAssessments = secondPlan.plan.revision_feedback_assessments;
    await service.controlStore.transactChangeSet("change-1", (state) => {
      // 模拟升级前已经持久化、但没有新评估字段的待确认 Plan。
      delete state.plans.find(
        (plan) => plan.revision === secondPlan.plan_revision,
      ).revision_feedback_assessments;
    });
    await assert.rejects(
      service.confirmPlanRevision({
        idempotency_key: "confirm-legacy-plan-without-assessment",
        change_set_id: "change-1",
        plan_revision: secondPlan.plan_revision,
      }),
      { code: "INVALID_PLAN" },
    );
    await service.controlStore.transactChangeSet("change-1", (state) => {
      state.plans.find(
        (plan) => plan.revision === secondPlan.plan_revision,
      ).revision_feedback_assessments = savedAssessments;
    });

    await service.confirmPlanRevision({
      idempotency_key: "confirm-2",
      change_set_id: "change-1",
      plan_revision: secondPlan.plan_revision,
    });
    await service.executeChangeSet({
      idempotency_key: "execute-2",
      change_set_id: "change-1",
    });
    const executionProjection = runtime.invocations
      .filter(
        (invocation) =>
          invocation.operation === "execution" &&
          invocation.context_projection.current_plan.revision === 2,
      )[0].context_projection;
    assert.deepEqual(executionProjection.revision_feedback.findings, feedback.findings);
    assert.deepEqual(
      executionProjection.current_plan.revision_feedback_assessments,
      secondPlan.plan.revision_feedback_assessments,
    );
    assert.equal("candidate_checkpoint_id" in executionProjection.work_unit, false);
    assert.equal("workspace" in executionProjection.work_unit, false);
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
