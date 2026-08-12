import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { runChangeFleetCommand } from "../../src/cli/changefleet-command.js";
import {
  createFixtureRoot,
  createGitRepository,
  writeCombinedCheckScript,
} from "../support/git-fixture.js";
import {
  createOneRepositoryPlan,
  ScriptedRuntime,
} from "../support/scripted-runtime.js";

test("unified CLI completes one current single-Repository lifecycle", async (t) => {
  const root = await createFixtureRoot(t, "changefleet-cli-acceptance-");
  const repository = await createGitRepository(root, "api");
  const configPath = path.join(root, "changefleet.json");
  await writeFile(configPath, JSON.stringify(cliConfig()), "utf8");
  const runtime = new ScriptedRuntime({
    plan: createOneRepositoryPlan(await writeCombinedCheckScript(root, 1)),
  });
  const dependencies = {
    runtimeFactory: () => runtime,
  };

  const registration = await invoke(
    ["project", "register"],
    configPath,
    root,
    "register",
    {
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
    },
    dependencies,
  );
  assert.equal(registration.project_id, "project");

  const creationRequest = {
    idempotency_key: "create-1",
    change_set_id: "change-1",
    project_id: "project",
    intent: { objective: "Complete one change through the unified CLI" },
  };
  const creation = await invoke(
    ["changeset", "create"],
    configPath,
    root,
    "create",
    creationRequest,
    dependencies,
  );
  assert.equal(creation.change_set_id, "change-1");
  assert.deepEqual(
    await invoke(
      ["changeset", "create"],
      configPath,
      root,
      "create-retry",
      creationRequest,
      dependencies,
    ),
    creation,
  );

  const planned = await invoke(
    ["changeset", "plan"],
    configPath,
    root,
    "plan",
    {
      idempotency_key: "plan-1",
      change_set_id: "change-1",
    },
    dependencies,
  );
  assert.equal(planned.status, "plan_ready");

  const confirmed = await invoke(
    ["changeset", "plan", "confirm"],
    configPath,
    root,
    "confirm",
    {
      idempotency_key: "confirm-1",
      change_set_id: "change-1",
      message_id: planned.message.message_id,
      content_digest: planned.message.content_digest,
    },
    dependencies,
  );
  assert.equal(confirmed.status, "confirmed");

  const execution = await invoke(
    ["changeset", "execute"],
    configPath,
    root,
    "execute",
    {
      idempotency_key: "execute-1",
      change_set_id: "change-1",
    },
    dependencies,
  );
  assert.equal(execution.bundle_revision, 1);

  const decision = await invoke(
    ["changeset", "bundle", "decide"],
    configPath,
    root,
    "decision",
    {
      idempotency_key: "decision-1",
      change_set_id: "change-1",
      bundle_revision: execution.bundle_revision,
      bundle_hash: execution.bundle_hash,
      decision: "accept",
    },
    dependencies,
  );
  assert.equal(decision.decision, "accept");

  const finalState = await invokeShow(
    "change-1",
    configPath,
    dependencies,
  );
  assert.equal(finalState.phase, "review");
  assert.equal(finalState.candidates.length, 1);
  assert.equal(finalState.decisions.at(-1).bundle_hash, execution.bundle_hash);
  assert.equal(runtime.invocations.length, 2);

  const closure = await invoke(
    ["changeset", "close"],
    configPath,
    root,
    "close",
    {
      idempotency_key: "close-1",
      change_set_id: "change-1",
      actor: "human",
      reason: {
        code: "no_longer_needed",
        summary: "Close the completed acceptance exercise before delivery",
      },
    },
    dependencies,
  );
  assert.equal(closure.status, "abandoned");
  const closedState = await invokeShow("change-1", configPath, dependencies);
  assert.equal(closedState.phase, "terminal");
  assert.equal(closedState.terminal_outcome, "abandoned");
  assert.equal(runtime.invocations.length, 2);
});

async function invoke(
  route,
  configPath,
  root,
  name,
  request,
  lifecycleDependencies,
) {
  const requestPath = path.join(root, `${name}.json`);
  await writeFile(requestPath, JSON.stringify(request), "utf8");
  return runSuccessfulCommand(
    [
      ...route,
      "--config",
      configPath,
      "--request",
      requestPath,
    ],
    lifecycleDependencies,
  );
}

function invokeShow(changeSetId, configPath, lifecycleDependencies) {
  return runSuccessfulCommand(
    ["changeset", "show", changeSetId, "--config", configPath],
    lifecycleDependencies,
  );
}

async function runSuccessfulCommand(arguments_, lifecycleDependencies) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runChangeFleetCommand(arguments_, {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
    lifecycleDependencies,
  });
  assert.equal(exitCode, 0, stderr);
  assert.equal(stderr, "");
  return JSON.parse(stdout);
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
      profile_id: "cli-acceptance-profile",
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
