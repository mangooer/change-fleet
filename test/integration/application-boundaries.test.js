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
    assert.equal(state.phase, "working");
    assert.equal(state.candidates.length, 1);
    assert.equal(state.candidates[0].repository_id, "api");
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
    assert.equal(state.phase, "working");
    assert.equal(state.candidates.length, 2);
    assert.equal(state.bundles.length, 0);
    const attempt = state.validation_attempts.at(-1);
    assert.equal(attempt.kind, "combined_validation");
    assert.equal(attempt.status, "failed");
    const evidence = await service.evidenceStore.read(attempt.evidence.evidence_id);
    assert.equal(evidence.payload.postflight.status, "failed");
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
    const second = await service.executeChangeSet({
      idempotency_key: "execute-2",
      change_set_id: "change-1",
    });
    assert.equal(second.bundle_revision, 2);
    const correctedState = await service.readChangeSet("change-1");
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
    const feedbackExecution = runtime.invocations.filter(
      (invocation) =>
        invocation.operation === "execution" &&
        invocation.context_projection.feedback !== null,
    )[0];
    assert.equal(feedbackExecution.control_contract.plan_revision, 1);
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
