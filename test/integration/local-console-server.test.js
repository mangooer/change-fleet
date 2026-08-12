import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { ChangeFleetService } from "../../src/application/change-fleet-service.js";
import { ChangeSetViewService } from "../../src/application/changeset-view-service.js";
import { createOperatorApplication } from "../../src/application/operator-application.js";
import { RuntimeAuditQueryService } from "../../src/application/runtime-audit-query-service.js";
import { startLocalConsoleServer } from "../../src/cli/local-console-server.js";
import {
  FixtureBindingDeliveryGitAdapter,
  ScriptedGithubPullRequestAdapter,
} from "../support/scripted-github-delivery.js";
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

describe("local console server", () => {
  test("returns 202 for accepted background task commands and exposes delivery binding setup", async () => {
    const calls = [];
    const server = await startLocalConsoleServer({
      queryService: {
        readIntakeOptions: async () => ({ projects: [] }),
        listChangeSets: async () => ({ items: [] }),
        readChangeSetView: async () => ({}),
        readLiveTaskView: async () => ({}),
        readAuditView: async () => ({}),
      },
      operatorApplication: {
        execute: async (operation, request) => {
          calls.push({ operation, request });
          return operation === "changeset.controller.run"
            ? { accepted: true, command: { status: "accepted" } }
            : { status: "configured" };
        },
      },
    });
    try {
      const bootstrap = extractBootstrap(await fetchText(server, "/"));
      const headers = {
        "X-ChangeFleet-Session": bootstrap.session_nonce,
        "X-ChangeFleet-CSRF": bootstrap.csrf_nonce,
        Origin: `http://${server.host}:${server.port}`,
        "Content-Type": "application/json; charset=utf-8",
      };
      const accepted = await fetch(
        `http://${server.host}:${server.port}/api/local/v0/changesets/change/controller/run`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ idempotency_key: "resume-1", actor: "human" }),
        },
      );
      assert.equal(accepted.status, 202);
      assert.equal((await accepted.json()).accepted, true);

      const configured = await fetch(
        `http://${server.host}:${server.port}/api/local/v0/projects/project/repositories/api/github-delivery`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            idempotency_key: "binding-1",
            github_repository: "owner/repository",
            push_remote: "origin",
          }),
        },
      );
      assert.equal(configured.status, 200);
      assert.equal((await configured.json()).status, "configured");
      assert.deepEqual(
        calls.map((call) => call.operation),
        [
          "changeset.controller.run",
          "project.repository_delivery.github.configure",
        ],
      );
    } finally {
      await server.close();
    }
  });

  test("delegates supervision start, pause, and resume through the shared operation boundary", async () => {
    const calls = [];
    const server = await startLocalConsoleServer({
      queryService: {
        readIntakeOptions: async () => ({ projects: [] }),
        listChangeSets: async () => ({ items: [] }),
        readChangeSetView: async () => ({}),
        readLiveTaskView: async () => ({}),
        readAuditView: async () => ({}),
      },
      operatorApplication: {
        execute: async (operation, request) => {
          calls.push({ operation, request });
          return { status: operation.split(".").at(-1) };
        },
      },
    });
    try {
      const bootstrap = extractBootstrap(await fetchText(server, "/"));
      const headers = {
        "X-ChangeFleet-Session": bootstrap.session_nonce,
        "X-ChangeFleet-CSRF": bootstrap.csrf_nonce,
        Origin: `http://${server.host}:${server.port}`,
        "Content-Type": "application/json; charset=utf-8",
      };
      for (const operation of ["start", "pause", "resume"]) {
        const body = {
          idempotency_key: `${operation}-1`,
          actor: "human",
          ...(operation === "pause" ? { reason: "operator_hold" } : {}),
        };
        const response = await fetchJson(
          server,
          `/api/local/v0/changesets/change/supervision/${operation}`,
          { method: "POST", headers, body: JSON.stringify(body) },
        );
        assert.equal(response.status, operation);
      }
      assert.deepEqual(
        calls.map((call) => call.operation),
        [
          "changeset.supervision.start",
          "changeset.supervision.pause",
          "changeset.supervision.resume",
        ],
      );
      assert.equal(calls[1].request.change_set_id, "change");
      assert.equal(calls[1].request.reason, "operator_hold");
    } finally {
      await server.close();
    }
  });

  test("renders and confirms the current exact planning message through the shared operation", async (t) => {
    const fixture = await createReviewFixture(t);
    await fixture.service.createChangeSet({
      idempotency_key: "create-plan-only",
      change_set_id: "plan-only",
      project_id: "project",
      intent: { objective: "Approve one exact conversation plan" },
    });
    const planned = await fixture.service.planChangeSet({
      idempotency_key: "plan-only-message",
      change_set_id: "plan-only",
    });
    const server = await fixture.startServer();
    try {
      const bootstrap = extractBootstrap(await fetchText(server, "/"));
      const headers = {
        "X-ChangeFleet-Session": bootstrap.session_nonce,
        "X-ChangeFleet-CSRF": bootstrap.csrf_nonce,
        Origin: `http://${server.host}:${server.port}`,
        "Content-Type": "application/json; charset=utf-8",
      };
      const exact = await fetchJson(
        server,
        "/api/local/v0/changesets/plan-only",
        { headers },
      );
      assert.equal(exact.plan, null);
      assert.equal(
        exact.planning_message.message_id,
        planned.message.message_id,
      );
      const confirmation = await fetchJson(
        server,
        "/api/local/v0/changesets/plan-only/plan-confirmation",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            idempotency_key: "confirm-plan-only",
            message_id: exact.planning_message.message_id,
            content_digest: exact.planning_message.content_digest,
            actor: "human",
            run_after_confirmation: false,
          }),
        },
      );
      assert.equal(confirmation.plan_revision, 1);
      assert.equal(
        (await fixture.service.readChangeSet("plan-only")).phase,
        "running",
      );
      const supervision = await fetchJson(
        server,
        "/api/local/v0/changesets/plan-only/supervision",
        { headers },
      );
      assert.equal(supervision.progress.mode, "manual");
      assert.equal(supervision.offered_actions[0].type, "stop");
      const feedback = await fetchJson(
        server,
        "/api/local/v0/changesets/plan-only/feedback",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            idempotency_key: "feedback-plan-only",
            phase: "running",
            work_unit_id: "api-unit",
            run_id: null,
            feedback: {
              summary: "Keep the implementation narrowly scoped",
              findings: [
                { finding_id: "scope", text: "Change only the planned file" },
              ],
            },
            actor: "human",
          }),
        },
      );
      assert.equal(feedback.delivery, "recorded");
      const execution = await fetchJson(
        server,
        "/api/local/v0/changesets/plan-only/execute",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            idempotency_key: "execute-plan-only",
            verification_admission_mode: null,
            validation_attempt_budgets: [],
          }),
        },
      );
      assert.equal(execution.bundle_revision, 1);
      assert.equal(
        (await fixture.service.readChangeSet("plan-only")).phase,
        "review",
      );
    } finally {
      await server.close();
    }
  });

  test("creates one bounded existing-Project task and sends planning messages through explicit routes", async (t) => {
    const fixture = await createReviewFixture(t, {
      repositoryIds: ["api", "web"],
    });
    const server = await fixture.startServer();
    try {
      const bootstrap = extractBootstrap(await fetchText(server, "/"));
      const headers = {
        "X-ChangeFleet-Session": bootstrap.session_nonce,
        "X-ChangeFleet-CSRF": bootstrap.csrf_nonce,
        Origin: `http://${server.host}:${server.port}`,
        "Content-Type": "application/json; charset=utf-8",
      };
      const options = await fetchJson(server, "/api/local/v0/intake/options", {
        headers,
      });
      assert.deepEqual(
        options.projects[0].repositories.map((item) => item.repository_id),
        ["api", "web"],
      );
      assert.equal(JSON.stringify(options).includes(fixture.controlRoot), false);
      assert.equal(
        JSON.stringify(options).includes("credential_profile_id"),
        false,
      );

      const created = await fetchJson(server, "/api/local/v0/changesets", {
        method: "POST",
        headers,
        body: JSON.stringify({
          idempotency_key: "console-create",
          change_set_id: "console-created",
          project_id: "project",
          intent: {
            objective: "Create and plan from the local console",
            rationale: null,
            constraints: ["Keep the existing shared operations"],
            non_goals: [],
            acceptance_criteria: ["Prepare both RepositoryWorkspaces"],
            resolved_decisions: [],
            open_questions: [],
          },
          planning_repository_ids: ["api", "web"],
          repository_selections: [
            { repository_id: "api", branch_ref: null, target_ref: null },
            { repository_id: "web", branch_ref: null, target_ref: null },
          ],
        }),
      });
      assert.equal(created.change_set_id, "console-created");
      assert.equal(created.repositories.length, 2);

      const planned = await fetchJson(
        server,
        "/api/local/v0/changesets/console-created/planning-messages",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            idempotency_key: "console-plan",
            message: null,
          }),
        },
      );
      assert.equal(planned.status, "plan_ready");
      const exact = await fetchJson(
        server,
        "/api/local/v0/changesets/console-created",
        { headers },
      );
      assert.equal(exact.planning_conversation.total_turns, 1);
      assert.equal(
        exact.planning_conversation.turns[0].assistant_message.message_id,
        planned.message.message_id,
      );

      const rejected = await fetch(
        `http://${server.host}:${server.port}/api/local/v0/changesets`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            idempotency_key: "unsafe-create",
            change_set_id: "unsafe",
            project_id: "project",
            intent: {
              objective: "Unsafe",
              rationale: null,
              constraints: [],
              non_goals: [],
              acceptance_criteria: [],
              resolved_decisions: [],
              open_questions: [],
            },
            planning_repository_ids: ["api"],
            repository_selections: [
              { repository_id: "api", branch_ref: null, target_ref: null },
            ],
            agent_profile: TEST_AGENT_PROFILE,
          }),
        },
      );
      assert.equal(rejected.status, 400);
      await assert.rejects(
        fixture.service.readChangeSet("unsafe"),
        { code: "CHANGE_SET_NOT_FOUND" },
      );
    } finally {
      await server.close();
    }
  });

  test("serves bounded reads, rejects invalid session or origin, and keeps GET side-effect free", async (t) => {
    const fixture = await createReviewFixture(t);
    const before = await directoryDigest(fixture.controlRoot);
    const server = await fixture.startServer();
    try {
      const html = await fetchText(server, "/");
      const bootstrap = extractBootstrap(html);
      const sessionHeaders = {
        "X-ChangeFleet-Session": bootstrap.session_nonce,
        "X-ChangeFleet-CSRF": bootstrap.csrf_nonce,
      };

      const recent = await fetchJson(server, "/api/local/v0/changesets?limit=1", {
        headers: sessionHeaders,
      });
      assert.equal(recent.items.length, 1);
      assert.equal(recent.items[0].change_set_id, "change");

      const exact = await fetchJson(server, "/api/local/v0/changesets/change", {
        headers: sessionHeaders,
      });
      assert.equal(exact.bundle.revision, 1);

      const invalidSession = await fetch(
        `http://${server.host}:${server.port}/api/local/v0/changesets?limit=1`,
        { headers: { "X-ChangeFleet-Session": "wrong" } },
      );
      assert.equal(invalidSession.status, 400);

      const invalidOrigin = await fetch(
        `http://${server.host}:${server.port}/api/local/v0/changesets/change/bundle-decisions`,
        {
          method: "POST",
          headers: {
            ...sessionHeaders,
            Origin: "http://evil.example",
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            idempotency_key: "decision-1",
            bundle_revision: exact.bundle.revision,
            bundle_hash: exact.bundle.bundle_hash,
            decision: "reject",
            actor: "human",
          }),
        },
      );
      assert.equal(invalidOrigin.status, 400);
      assert.equal(await directoryDigest(fixture.controlRoot), before);
    } finally {
      await server.close();
    }
  });

  test("reuses explicit delivery routes while one refresh attempt stays ambiguous and then completes", async (t) => {
    const fixture = await createReviewFixture(t, {
      withDeliveryBinding: true,
      repositoryIds: ["api", "web"],
    });
    const server = await fixture.startServer();
    try {
      const bootstrap = extractBootstrap(await fetchText(server, "/"));
      const headers = {
        "X-ChangeFleet-Session": bootstrap.session_nonce,
        "X-ChangeFleet-CSRF": bootstrap.csrf_nonce,
        Origin: `http://${server.host}:${server.port}`,
        "Content-Type": "application/json; charset=utf-8",
      };
      const exact = await fetchJson(server, "/api/local/v0/changesets/change", {
        headers: {
          "X-ChangeFleet-Session": bootstrap.session_nonce,
          "X-ChangeFleet-CSRF": bootstrap.csrf_nonce,
        },
      });

      const decision = await fetchJson(
        server,
        "/api/local/v0/changesets/change/bundle-decisions",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            idempotency_key: "accept-attempt",
            bundle_revision: exact.bundle.revision,
            bundle_hash: exact.bundle.bundle_hash,
            decision: "accept",
            actor: "human",
          }),
        },
      );
      assert.equal(decision.decision, "accept");
      assert.equal(exact.bundle.candidates.length, 2);

      const publish = await fetchJson(
        server,
        "/api/local/v0/changesets/change/delivery/publish",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            idempotency_key: "publish-attempt",
            actor: "human",
            title: null,
            body: null,
          }),
        },
      );
      assert.equal(publish.delivery_count, 2);
      assert.deepEqual(publish.counts, { open: 2 });
      const apiRequest = publish.deliveries.find(
        (item) => item.repository_id === "api",
      );
      const webRequest = publish.deliveries.find(
        (item) => item.repository_id === "web",
      );

      fixture.github.merge({
        githubRepository: "fixture/api",
        headBranch: apiRequest.remote_branch,
        targetRef: apiRequest.target_ref,
        mergeCommitSha: await mergeCandidate(
          fixture.repositories.api,
          apiRequest.candidate_sha,
        ),
      });

      const partial = await fetchJson(
        server,
        "/api/local/v0/changesets/change/delivery/refresh",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ idempotency_key: "refresh-attempt" }),
        },
      );
      assert.equal(partial.phase, "review");
      assert.equal(partial.activity, "running");
      assert.deepEqual(partial.counts, { merged: 1, open: 1 });

      fixture.github.merge({
        githubRepository: "fixture/web",
        headBranch: webRequest.remote_branch,
        targetRef: webRequest.target_ref,
        mergeCommitSha: await mergeCandidate(
          fixture.repositories.web,
          webRequest.candidate_sha,
        ),
      });

      const refreshed = await fetchJson(
        server,
        "/api/local/v0/changesets/change/delivery/refresh",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ idempotency_key: "refresh-attempt" }),
        },
      );
      assert.equal(refreshed.phase, "terminal");
      assert.equal(refreshed.activity, "complete");
      assert.deepEqual(refreshed.counts, { merged: 2 });
    } finally {
      await server.close();
    }
  });
});

async function createReviewFixture(
  testContext,
  { withDeliveryBinding = false, repositoryIds = ["api"] } = {},
) {
  const root = await createFixtureRoot(testContext, "changefleet-console-");
  const repositories = {};
  for (const repositoryId of repositoryIds) {
    const repository = await createGitRepository(root, repositoryId);
    const remotePath = path.join(root, `${repositoryId}-remote.git`);
    await git(root, ["init", "--bare", remotePath]);
    await git(repository.path, ["remote", "add", "origin", remotePath]);
    await git(repository.path, ["push", "-u", "origin", "main"]);
    repositories[repositoryId] = repository;
  }
  const runtime = new ScriptedRuntime({
    plan:
      repositoryIds.length === 1
        ? createOneRepositoryPlan(await writeCombinedCheckScript(root, 1))
        : createTwoRepositoryPlan(await writeCombinedCheckScript(root, repositoryIds.length)),
  });
  const github = new ScriptedGithubPullRequestAdapter({
    resolveRefs: async ({ githubRepository, headBranch, targetRef }) => {
      const repository = repositories[githubRepository.split("/")[1]];
      return {
        head_sha: await remoteSha(repository.path, `refs/heads/${headBranch}`),
        base_sha: await remoteSha(repository.path, targetRef),
      };
    },
  });
  const controlRoot = path.join(root, "control");
  const service = await ChangeFleetService.open({
    controlRoot,
    workspaceRoot: path.join(root, "workspaces"),
    runtime,
    agentProfile: TEST_AGENT_PROFILE,
    deliveryGitAdapter: new FixtureBindingDeliveryGitAdapter(),
    githubPullRequestAdapter: github,
  });
  await service.registerProject({
    idempotency_key: "register",
    project: {
      project_id: "project",
      repositories: repositoryIds.map((repositoryId) => ({
        repository_id: repositoryId,
        locator: { path: repositories[repositoryId].path },
      })),
    },
  });
  if (withDeliveryBinding) {
    for (const repositoryId of repositoryIds) {
      await service.configureGithubDelivery({
        idempotency_key: `binding-${repositoryId}`,
        project_id: "project",
        repository_id: repositoryId,
        github_repository: `fixture/${repositoryId}`,
        push_remote: "origin",
      });
    }
  }
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: "change",
    project_id: "project",
    intent: { objective: "Review one exact bundle" },
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
  await service.executeChangeSet({
    idempotency_key: "execute",
    change_set_id: "change",
  });
  const queryService = new ChangeSetViewService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    auditQueryService: new RuntimeAuditQueryService({
      controlStore: service.controlStore,
      runStore: service.runStore,
      evidenceStore: service.evidenceStore,
    }),
    agentProfile: TEST_AGENT_PROFILE,
  });
  const operatorApplication = createOperatorApplication(service);
  return {
    controlRoot,
    repositories,
    github,
    service,
    async startServer() {
      return startLocalConsoleServer({
        queryService,
        operatorApplication,
      });
    },
  };
}

async function fetchJson(server, route, options = {}) {
  const response = await fetch(`http://${server.host}:${server.port}${route}`, options);
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload;
}

async function fetchText(server, route, options = {}) {
  const response = await fetch(`http://${server.host}:${server.port}${route}`, options);
  assert.equal(response.ok, true);
  return response.text();
}

function extractBootstrap(html) {
  const match = html.match(
    /<script id="changefleet-bootstrap" type="application\/json">([^<]+)<\/script>/u,
  );
  assert.ok(match);
  return JSON.parse(match[1]);
}

async function remoteSha(repositoryPath, ref) {
  const output = await git(repositoryPath, ["ls-remote", "origin", ref]);
  return output.split(/\s+/u)[0];
}

async function mergeCandidate(repository, candidateSha) {
  await git(repository.path, ["checkout", "main"]);
  await git(repository.path, [
    "merge",
    "--no-ff",
    candidateSha,
    "-m",
    `merge ${candidateSha.slice(0, 12)}`,
  ]);
  await git(repository.path, ["push", "origin", "main"]);
  return (await git(repository.path, ["rev-parse", "HEAD"])).trim();
}

async function directoryDigest(root) {
  const hash = createHash("sha256");
  await appendDirectory(hash, root, root);
  return hash.digest("hex");
}

async function appendDirectory(hash, root, current) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    hash.update(path.relative(root, absolute).replaceAll("\\", "/"));
    if (entry.isDirectory()) await appendDirectory(hash, root, absolute);
    else hash.update(await readFile(absolute));
  }
}
