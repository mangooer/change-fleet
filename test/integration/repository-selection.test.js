import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
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
  createOneRepositoryPlan,
  createTwoRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("ChangeSet Repository selection", () => {
  test("freezes an explicit branch at creation and replays without resolving a moved branch", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-selection-explicit-");
    const api = await createGitRepository(root, "api", { harness: true });
    await git(api.path, ["checkout", "-b", "feature"]);
    await writeFile(path.join(api.path, "feature-base.txt"), "first\n", "utf8");
    await git(api.path, ["add", "feature-base.txt"]);
    await git(api.path, ["commit", "-m", "feature base"]);
    const selectedSha = (await git(api.path, ["rev-parse", "HEAD"])).trim();
    await git(api.path, ["checkout", "main"]);

    const runtime = new ScriptedRuntime({
      plan: createOneRepositoryPlan(
        await writeCombinedCheckScript(root, 1),
      ),
    });
    runtime.plan.work_units[0].branch_ref = "refs/heads/runtime-choice";
    runtime.plan.work_units[0].target_ref = "refs/heads/runtime-choice";
    runtime.plan.work_units[0].base_sha = "f".repeat(40);
    const service = await openService(root, runtime);
    await registerProject(service, [
      { repository_id: "api", locator: { path: api.path } },
    ]);
    const creation = await service.createChangeSet({
      idempotency_key: "create",
      change_set_id: "change",
      project_id: "project",
      intent: { objective: "Use the selected feature branch" },
      repository_selections: [
        {
          repository_id: "api",
          branch_ref: "feature",
          target_ref: "main",
        },
      ],
    });
    assert.equal(creation.repository_selection_revision, 1);
    assert.deepEqual(creation.repositories[0], {
      repository_id: "api",
      branch_ref: "refs/heads/feature",
      resolved_base_sha: selectedSha,
      target_ref: "refs/heads/main",
      selection_source: "caller",
      resolved_at: creation.repositories[0].resolved_at,
    });

    await git(api.path, ["checkout", "feature"]);
    await writeFile(path.join(api.path, "feature-base.txt"), "second\n", "utf8");
    await git(api.path, ["add", "feature-base.txt"]);
    await git(api.path, ["commit", "-m", "move feature"]);
    assert.notEqual(
      (await git(api.path, ["rev-parse", "HEAD"])).trim(),
      selectedSha,
    );
    await git(api.path, ["checkout", "main"]);

    assert.deepEqual(
      await service.createChangeSet({
        idempotency_key: "create",
        change_set_id: "change",
        project_id: "project",
        intent: { objective: "Use the selected feature branch" },
        repository_selections: [
          {
            repository_id: "api",
            branch_ref: "feature",
            target_ref: "main",
          },
        ],
      }),
      creation,
    );
    const planned = await service.planChangeSet({
      idempotency_key: "plan",
      change_set_id: "change",
    });
    assert.equal(planned.message.plan_content.work_units[0].base_sha, selectedSha);
    assert.equal(
      planned.message.plan_content.work_units[0].target_ref,
      "refs/heads/main",
    );
    assert.equal(planned.message.plan_content.repository_selection_revision, 1);
    const invocation = runtime.invocations[0];
    assert.equal(
      invocation.control_contract.repository_selection_revision,
      1,
    );
    assert.deepEqual(invocation.control_contract.allowed_outcomes, [
      "conversation_message",
      "repository_selection_change_request",
    ]);
    assert.equal(
      invocation.context_projection.repositories[0].base_sha,
      selectedSha,
    );
  });

  test("uses the creation-time symbolic branch and rejects omitted selection at detached HEAD", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-selection-current-");
    const api = await createGitRepository(root, "api");
    const runtime = new ScriptedRuntime({
      plan: createOneRepositoryPlan(
        await writeCombinedCheckScript(root, 1),
      ),
    });
    const service = await openService(root, runtime);
    await registerProject(service, [
      { repository_id: "api", locator: { path: api.path } },
    ]);

    await git(api.path, ["checkout", "-b", "task-branch"]);
    const currentSha = (await git(api.path, ["rev-parse", "HEAD"])).trim();
    const currentCreation = await service.createChangeSet({
      idempotency_key: "create-current",
      change_set_id: "current",
      project_id: "project",
      intent: { objective: "Use the current task branch" },
    });
    assert.equal(
      currentCreation.repositories[0].branch_ref,
      "refs/heads/task-branch",
    );
    assert.equal(
      currentCreation.repositories[0].resolved_base_sha,
      currentSha,
    );
    assert.equal(
      currentCreation.repositories[0].selection_source,
      "current_checkout",
    );

    await git(api.path, ["checkout", "--detach", api.base_sha]);
    await assert.rejects(
      service.createChangeSet({
        idempotency_key: "create-detached",
        change_set_id: "detached",
        project_id: "project",
        intent: { objective: "Require an explicit branch" },
      }),
      { code: "REPOSITORY_BRANCH_SELECTION_REQUIRED" },
    );
    assert.equal(runtime.invocations.length, 0);
  });

  test("limits planning visibility and revises authority in the same ChangeSet", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-selection-revision-");
    const api = await createGitRepository(root, "api");
    const web = await createGitRepository(root, "web");
    const combinedCheck = await writeCombinedCheckScript(root, 1);
    const runtime = new ScriptedRuntime({
      plan: oneRepositoryPlan("api", combinedCheck),
    });
    const service = await openService(root, runtime);
    await registerProject(service, [
      { repository_id: "api", locator: { path: api.path } },
      { repository_id: "web", locator: { path: web.path } },
    ]);
    await service.createChangeSet({
      idempotency_key: "create",
      change_set_id: "change",
      project_id: "project",
      intent: { objective: "Change whichever Repository is selected" },
      planning_repository_ids: ["api"],
    });
    runtime.plan = createTwoRepositoryPlan(combinedCheck);
    await assert.rejects(
      service.planChangeSet({
        idempotency_key: "scope-denied",
        change_set_id: "change",
      }),
      { code: "SCOPE_EXPANSION_REQUIRED" },
    );
    runtime.plan = oneRepositoryPlan("api", combinedCheck);
    await service.planChangeSet({
      idempotency_key: "plan-1",
      change_set_id: "change",
    });
    assert.deepEqual(
      runtime.invocations[0].control_contract.authorized_repositories,
      ["api"],
    );

    const revision = await service.reviseRepositorySelection({
      idempotency_key: "revise",
      change_set_id: "change",
      current_repository_selection_revision: 1,
      planning_repository_ids: ["web"],
      repository_selections: [
        { repository_id: "web", branch_ref: "main" },
      ],
    });
    assert.equal(revision.repository_selection_revision, 2);
    assert.equal(revision.repository_harness_selection_revision, 2);
    const revisedState = await service.readChangeSet("change");
    assert.equal(revisedState.phase, "planning");
    assert.equal(revisedState.current_plan_revision, null);
    assert.equal(
      revisedState.current_repository_harness_selection_revision,
      2,
    );
    assert.deepEqual(
      revisedState.repository_selection_revisions.map(
        (selection) => selection.status,
      ),
      ["superseded", "current"],
    );
    assert.deepEqual(revisedState.plans, []);
    assert.deepEqual(revisedState.work_units, []);
    assert.equal(revisedState.current_approvable_plan_message_id, null);

    runtime.plan = oneRepositoryPlan("web", combinedCheck);
    const replanned = await service.planChangeSet({
      idempotency_key: "plan-2",
      change_set_id: "change",
    });
    assert.equal(replanned.message.plan_content.work_units[0].repository_id, "web");
    assert.equal(
      replanned.message.plan_content.work_units[0].repository_selection_revision,
      2,
    );
    assert.equal(
      replanned.message.plan_content.work_units[0]
        .repository_harness_selection_revision,
      2,
    );
    await assert.rejects(
      service.reviseRepositorySelection({
        idempotency_key: "stale-revise",
        change_set_id: "change",
        current_repository_selection_revision: 1,
        planning_repository_ids: ["api"],
      }),
      { code: "STALE_REPOSITORY_SELECTION_REVISION" },
    );
    const confirmed = await service.confirmPlanMessage({
      idempotency_key: "confirm-plan-2",
      change_set_id: "change",
      message_id: replanned.message.message_id,
      content_digest: replanned.message.content_digest,
    });
    assert.equal(confirmed.plan_revision, 1);
  });

  test("persists an Agent selection request without granting it authority", async (t) => {
    const root = await createFixtureRoot(t, "changefleet-selection-request-");
    const api = await createGitRepository(root, "api");
    const runtime = {
      invocations: [],
      async invoke(invocation) {
        this.invocations.push(structuredClone(invocation));
        return {
          outcome: {
            type: "repository_selection_change_request",
            message: null,
            request: {
              planning_repository_ids: ["api"],
              repository_selections: [
                { repository_id: "api", branch_ref: "main" },
              ],
              rationale: "The requested work belongs on main",
            },
          },
          provider_evidence: {
            evidence_classification: "test_fixture",
            usage_observations: [],
          },
        };
      },
    };
    const service = await openService(root, runtime);
    await registerProject(service, [
      { repository_id: "api", locator: { path: api.path } },
    ]);
    await service.createChangeSet({
      idempotency_key: "create",
      change_set_id: "change",
      project_id: "project",
      intent: { objective: "Ask before changing Repository authority" },
    });

    const result = await service.planChangeSet({
      idempotency_key: "plan-request",
      change_set_id: "change",
    });
    assert.equal(result.status, "repository_selection_change_requested");
    const requestedState = await service.readChangeSet("change");
    assert.equal(requestedState.current_repository_selection_revision, 1);
    assert.equal(requestedState.plans.length, 0);
    assert.equal(
      requestedState.repository_selection_change_requests[0].status,
      "pending",
    );

    await service.reviseRepositorySelection({
      idempotency_key: "confirm-request",
      change_set_id: "change",
      current_repository_selection_revision: 1,
      planning_repository_ids: ["api"],
      repository_selections: [
        { repository_id: "api", branch_ref: "main" },
      ],
    });
    const confirmedState = await service.readChangeSet("change");
    assert.equal(
      confirmedState.repository_selection_change_requests[0].status,
      "resolved_by_revision",
    );
    assert.equal(confirmedState.current_repository_selection_revision, 2);
  });
});

function openService(root, runtime) {
  return ChangeFleetService.open({
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
  });
}

function registerProject(service, repositories) {
  return service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      repositories,
    },
  });
}

function oneRepositoryPlan(repositoryId, combinedCheckScript) {
  return {
    rationale: `Only ${repositoryId} changes`,
    work_units: [
      {
        work_unit_id: `${repositoryId}-unit`,
        repository_id: repositoryId,
        task: `Change ${repositoryId}`,
        dependencies: [],
        repository_check: {
          command_id: `${repositoryId}-check`,
          executable: process.execPath,
          argv: ["-e", "process.exit(0)"],
          coverage_rationale: `Checks the ${repositoryId} change`,
          timeout_ms: 10_000,
        },
      },
    ],
    combined_check: {
      command_id: "combined-check",
      executable: process.execPath,
      argv: [combinedCheckScript],
      coverage_rationale: "Checks the combined contract",
      timeout_ms: 10_000,
    },
    risks: [],
    unverified_boundaries: [],
    verification_expectation: {
      mode: "deterministic",
      rationale: "The selected behavioral checks cover the change.",
      escalation_triggers: ["scope_divergence"],
    },
  };
}
