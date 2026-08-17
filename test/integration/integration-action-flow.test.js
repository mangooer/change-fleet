import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { ChangeFleetError } from "../../src/domain/errors.js";
import {
  createFixtureRoot,
  createGitRepository,
  git,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createOneRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../support/scripted-runtime.js";

describe("exact integration action flow", () => {
  test("requires a human grant, executes one non-force fast-forward, and completes only after observation", async (t) => {
    const fixture = await createAcceptedFixture(t, "managed");
    const candidate = fixture.state.candidates[0];
    const bundle = fixture.state.bundles.at(-1);
    const offer = await fixture.service.offerIntegrationAction({
      idempotency_key: "offer-fast-forward",
      change_set_id: "change",
      bundle_revision: bundle.revision,
      bundle_hash: bundle.bundle_hash,
      repository_id: "api",
      action_kind: "fast_forward_target",
      push_remote: "origin",
      destination_ref: candidate.target_ref,
    });

    await assert.rejects(
      fixture.service.executeIntegrationAction({
        idempotency_key: "execute-without-grant",
        change_set_id: "change",
        action_grant_id: "missing-grant",
      }),
      { code: "ACTION_GRANT_NOT_FOUND" },
    );
    const grant = await fixture.service.grantIntegrationAction({
      idempotency_key: "grant-fast-forward",
      change_set_id: "change",
      action_offer_id: offer.action_offer_id,
      input_digest: offer.input_digest,
      actor: "operator-1",
    });
    const result = await fixture.service.executeIntegrationAction({
      idempotency_key: "execute-fast-forward",
      change_set_id: "change",
      action_grant_id: grant.action_grant_id,
    });

    assert.equal(result.observed_destination_sha, candidate.candidate_sha);
    assert.equal(
      await readRemoteRef(fixture.repository.path, "refs/heads/main"),
      candidate.candidate_sha,
    );
    const terminal = await fixture.service.readChangeSet("change");
    assert.equal(terminal.phase, "terminal");
    assert.equal(terminal.terminal_outcome, "done");
    assert.equal(terminal.integration_results.length, 1);
    assert.equal(
      terminal.integration_dispositions.at(-1).reason,
      "managed_integration_completed",
    );
    assert.notEqual(terminal.task_workspace.resources_released_at, null);
    assert.equal(
      terminal.task_workspace.agent_sessions.every(
        (session) =>
          session.status === "closed" && session.closed_at !== null,
      ),
      true,
    );
    const reference = terminal.run_references.find(
      (item) => item.operation === "integration",
    );
    assert.equal(reference.status, "completed");
    assert.equal(reference.agent_session_id, grant.agent_session_id);
  });

  test("publishes an exact Candidate without moving the target and can finish without a delivery claim", async (t) => {
    const fixture = await createAcceptedFixture(t, "publication");
    const candidate = fixture.state.candidates[0];
    const bundle = fixture.state.bundles.at(-1);
    const destinationRef = "refs/heads/changefleet/change/api";
    const offer = await fixture.service.offerIntegrationAction({
      idempotency_key: "offer-publication",
      change_set_id: "change",
      bundle_revision: bundle.revision,
      bundle_hash: bundle.bundle_hash,
      repository_id: "api",
      action_kind: "publish_exact_candidate",
      push_remote: "origin",
      destination_ref: destinationRef,
    });
    const grant = await fixture.service.grantIntegrationAction({
      idempotency_key: "grant-publication",
      change_set_id: "change",
      action_offer_id: offer.action_offer_id,
      input_digest: offer.input_digest,
      actor: "operator-1",
    });
    await fixture.service.executeIntegrationAction({
      idempotency_key: "execute-publication",
      change_set_id: "change",
      action_grant_id: grant.action_grant_id,
    });

    let state = await fixture.service.readChangeSet("change");
    assert.equal(state.phase, "review");
    assert.equal(
      await readRemoteRef(fixture.repository.path, destinationRef),
      candidate.candidate_sha,
    );
    assert.equal(
      await readRemoteRef(fixture.repository.path, "refs/heads/main"),
      candidate.base_sha,
    );
    const disposition = await fixture.service.completeWithoutManagedIntegration({
      idempotency_key: "complete-without-managed",
      change_set_id: "change",
      bundle_revision: bundle.revision,
      bundle_hash: bundle.bundle_hash,
      actor: "operator-1",
    });
    assert.equal(disposition.reason, "accepted_without_managed_integration");
    state = await fixture.service.readChangeSet("change");
    assert.equal(state.phase, "terminal");
    assert.equal(state.terminal_outcome, "done");
    assert.equal(
      state.integration_dispositions.at(-1).reason,
      "accepted_without_managed_integration",
    );
    assert.equal(
      state.delivery_requests.some((request) => request.state === "merged"),
      false,
    );
  });

  test("recovers an exact action observed after controller loss without rewriting the interrupted Run", async (t) => {
    const fixture = await createAcceptedFixture(t, "recovery", {
      interruptIntegrationAfterPush: true,
    });
    const candidate = fixture.state.candidates[0];
    const bundle = fixture.state.bundles.at(-1);
    const offer = await fixture.service.offerIntegrationAction({
      idempotency_key: "offer-recovery",
      change_set_id: "change",
      bundle_revision: bundle.revision,
      bundle_hash: bundle.bundle_hash,
      repository_id: "api",
      action_kind: "fast_forward_target",
      push_remote: "origin",
      destination_ref: candidate.target_ref,
    });
    const grant = await fixture.service.grantIntegrationAction({
      idempotency_key: "grant-recovery",
      change_set_id: "change",
      action_offer_id: offer.action_offer_id,
      input_digest: offer.input_digest,
      actor: "operator-1",
    });
    await assert.rejects(
      fixture.service.executeIntegrationAction({
        idempotency_key: "execute-recovery",
        change_set_id: "change",
        action_grant_id: grant.action_grant_id,
      }),
      { code: "CONTROLLER_INTERRUPTED" },
    );
    const lost = await fixture.service.readChangeSet("change");
    assert.equal(lost.run_references.at(-1).status, "running");
    assert.equal(lost.action_grants[0].status, "running");

    const reopenedRuntime = new ScriptedRuntime({ plan: fixture.plan });
    const reopened = await ChangeFleetService.open({
      controlRoot: fixture.controlRoot,
      workspaceRoot: fixture.workspaceRoot,
      runtime: reopenedRuntime,
      agentProfile: TEST_AGENT_PROFILE,
    });
    const result = await reopened.executeIntegrationAction({
      idempotency_key: "execute-recovery",
      change_set_id: "change",
      action_grant_id: grant.action_grant_id,
    });
    assert.equal(result.observed_destination_sha, candidate.candidate_sha);
    assert.equal(result.run_id, null);
    assert.equal(reopenedRuntime.integrationInvocationCount, 0);
    const recovered = await reopened.readChangeSet("change");
    assert.equal(recovered.run_references.at(-1).status, "interrupted");
    assert.equal(recovered.action_grants[0].status, "completed");
    assert.equal(recovered.phase, "terminal");
  });

  test("fails closed when the integration Runtime mutates its task workspace", async (t) => {
    const fixture = await createAcceptedFixture(t, "workspace-boundary", {
      mutateIntegrationWorkspace: true,
    });
    const candidate = fixture.state.candidates[0];
    const bundle = fixture.state.bundles.at(-1);
    const offer = await fixture.service.offerIntegrationAction({
      idempotency_key: "offer-workspace-boundary",
      change_set_id: "change",
      bundle_revision: bundle.revision,
      bundle_hash: bundle.bundle_hash,
      repository_id: "api",
      action_kind: "publish_exact_candidate",
      push_remote: "origin",
      destination_ref: "refs/heads/changefleet/change/api",
    });
    const grant = await fixture.service.grantIntegrationAction({
      idempotency_key: "grant-workspace-boundary",
      change_set_id: "change",
      action_offer_id: offer.action_offer_id,
      input_digest: offer.input_digest,
      actor: "operator-1",
    });
    await assert.rejects(
      fixture.service.executeIntegrationAction({
        idempotency_key: "execute-workspace-boundary",
        change_set_id: "change",
        action_grant_id: grant.action_grant_id,
      }),
      { code: "INTEGRATION_WORKSPACE_MODIFIED" },
    );
    const state = await fixture.service.readChangeSet("change");
    assert.equal(state.phase, "review");
    assert.equal(state.action_grants[0].status, "failed");
    assert.equal(state.integration_results.length, 0);
    assert.equal(state.run_references.at(-1).status, "failed");
  });
});

async function createAcceptedFixture(
  t,
  name,
  {
    interruptIntegrationAfterPush = false,
    mutateIntegrationWorkspace = false,
  } = {},
) {
  const root = await createFixtureRoot(t, `changefleet-integration-${name}-`);
  const repository = await createGitRepository(root, "api");
  const remotePath = path.join(root, "api.git");
  await mkdir(remotePath, { recursive: true });
  await git(remotePath, ["init", "--bare", "--initial-branch=main"]);
  await git(repository.path, ["remote", "add", "origin", remotePath]);
  await git(repository.path, ["push", "origin", "main"]);
  const plan = createOneRepositoryPlan(await writeCombinedCheckScript(root, 1));
  const runtime = new ScriptedRuntime({
    plan,
    integrationExecutor: async (invocation) => {
      const action = invocation.context_projection.integration;
      await git(invocation.workspace.workspace_path, [
        "push",
        action.push_remote,
        `${action.candidate_sha}:${action.destination_ref}`,
      ]);
      if (mutateIntegrationWorkspace) {
        await writeFile(
          path.join(invocation.workspace.workspace_path, "integration-side-effect.txt"),
          "not authorized\n",
        );
      }
      if (interruptIntegrationAfterPush) {
        throw new ChangeFleetError(
          "CONTROLLER_INTERRUPTED",
          "Simulated controller loss after the exact Git action",
        );
      }
    },
  });
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
      repositories: [
        { repository_id: "api", locator: { path: repository.path } },
      ],
    },
  });
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: "change",
    project_id: "project",
    intent: { objective: "Create and integrate one exact Candidate" },
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
  const executed = await service.executeChangeSet({
    idempotency_key: "execute",
    change_set_id: "change",
  });
  await service.recordBundleDecision({
    idempotency_key: "accept",
    change_set_id: "change",
    bundle_revision: executed.bundle_revision,
    bundle_hash: executed.bundle_hash,
    decision: "accept",
  });
  return {
    controlRoot: path.join(root, "control"),
    workspaceRoot: path.join(root, "workspaces"),
    plan,
    repository,
    service,
    state: await service.readChangeSet("change"),
  };
}

async function readRemoteRef(repositoryPath, ref) {
  const output = await git(repositoryPath, ["ls-remote", "--refs", "origin", ref]);
  return output.trim().split(/\s+/u)[0];
}
