import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ChangeFleetService } from "../src/application/change-fleet-service.js";
import { AutonomousTaskController } from "../src/application/autonomous-task-controller.js";
import { ChangeSetViewService } from "../src/application/changeset-view-service.js";
import { createOperatorApplication } from "../src/application/operator-application.js";
import { RuntimeAuditQueryService } from "../src/application/runtime-audit-query-service.js";
import { startLocalConsoleServer } from "../src/cli/local-console-server.js";
import { TaskControlStore } from "../src/adapters/filesystem/task-control-store.js";
import {
  FixtureBindingDeliveryGitAdapter,
  ScriptedGithubPullRequestAdapter,
} from "../test/support/scripted-github-delivery.js";
import {
  createTwoRepositoryPlan,
  ScriptedRuntime,
  TEST_AGENT_PROFILE,
} from "../test/support/scripted-runtime.js";

const execFileAsync = promisify(execFile);

const root = await mkdtemp(path.join(os.tmpdir(), "changefleet-ui-"));
let server = null;
let browser = null;
try {
  const playwright = await loadPlaywright();
  const fixture = await createFixture(root);
  server = await fixture.startServer();
  browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  const reconnectScenario = await prepareLiveReconnect(page);
  const refreshAttempts = [];
  const taskMessages = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/delivery/refresh")
    ) {
      const payload = request.postDataJSON();
      refreshAttempts.push(payload.idempotency_key);
    }
    if (request.method() === "POST" && request.url().endsWith("/messages")) {
      taskMessages.push(request.postDataJSON());
    }
  });
  await page.goto(`http://${server.host}:${server.port}/`, {
    // 页面持有一个 SSE 长连接，因此不能以 networkidle 作为就绪条件。
    waitUntil: "domcontentloaded",
  });
  await reconnectScenario.verify();
  await page.getByRole("button", { name: "新建" }).click();
  await page
    .getByLabel("你希望 Agent 完成什么？")
    .fill("Create and plan one exact task from the browser");
  await page
    .getByRole("button", { name: "创建并开始规划" })
    .click();
  await page
    .getByRole("button", { name: "重试规划", exact: true })
    .waitFor();
  const createdChangeSetId = new URL(page.url()).searchParams.get(
    "change_set_id",
  );
  if (!createdChangeSetId?.startsWith("change-")) {
    throw new Error("Browser creation did not select the new ChangeSet.");
  }
  const afterPlanningFailure = await fixture.service.readChangeSet(
    createdChangeSetId,
  );
  if (
    afterPlanningFailure.phase !== "planning" ||
    afterPlanningFailure.planning_message_references.length !== 0
  ) {
    throw new Error("Failed initial planning did not preserve one retryable ChangeSet.");
  }
  await page
    .getByRole("button", { name: "重试规划", exact: true })
    .click();
  await page.waitForSelector("text=The deterministic fixture produced an approvable plan.");
  await assertRunningTimeRefresh(page);
  await page.waitForSelector("text=待审查", { timeout: 90_000 });
  if (await page.getByRole("button", { name: "确认计划并自动运行" }).count()) {
    throw new Error("Ordinary task flow still exposed a manual Plan confirmation action.");
  }
  // 当前进度必须是主视图，语义 Plan 只作为不随执行状态伪造变化的参考。
  await page.waitForSelector(".progress-surface");
  if ((await page.locator(".plan-reference").count()) !== 1) {
    throw new Error("The immutable Plan reference was not retained as a secondary panel.");
  }
  await page.waitForFunction(
    () =>
      document.querySelector(".conversation")?.textContent?.includes("implemented api") &&
      document.querySelector(".conversation")?.textContent?.includes("implemented web"),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForSelector(".review-surface", { timeout: 90_000 });
  await page.locator("#open-audit").click();
  await page.waitForSelector(".audit-step");
  const auditText = await page.locator("#audit-content").innerText();
  for (const expected of [
    "任务链路",
    "implemented api",
    "项目检查",
    "无 Agent Token",
    "Token 用量未观测",
    "已观测 Token 流量（非金额）",
    "Provider 金额未观测",
  ]) {
    if (!auditText.includes(expected)) {
      throw new Error(`Audit workflow ledger did not display ${expected}.`);
    }
  }
  if (auditText.includes("Token 总计")) {
    throw new Error("Audit still presented aggregate token traffic as an unqualified total.");
  }
  await page.locator("#close-audit").click();
  if (taskMessages.length !== 1) {
    throw new Error("Planning recovery was not routed through the single task conversation.");
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=待审查", { timeout: 90_000 });
  await page.locator('[data-change-set-id="change"]').click();
  await page.waitForSelector("text=候选变更");
  await page.waitForSelector("text=api");
  await page.waitForSelector("text=web");
  await page.getByRole("button", { name: "接受候选" }).click();
  await page.waitForSelector('a[href^="https://github.com/fixture/api/pull/"]');
  await page.waitForSelector('a[href^="https://github.com/fixture/web/pull/"]');

  await page.waitForSelector(".integration-surface");
  const expectedPublicationRef =
    "refs/heads/changefleet/integration/change/api";
  if (
    (await page.locator("#integration-destination-ref").inputValue()) !==
    expectedPublicationRef
  ) {
    throw new Error("Integration form did not project the bounded publication ref.");
  }
  await page
    .getByRole("button", { name: "生成精确授权请求" })
    .click();
  await page
    .getByRole("button", { name: "授权并执行此精确动作" })
    .click();
  try {
    await page.waitForFunction(
      () =>
        document.querySelector(".integration-surface .delivery-row")?.textContent?.includes("api"),
      undefined,
      { timeout: 60_000 },
    );
  } catch (error) {
    const integration = await fixture.service.readIntegration({
      change_set_id: "change",
    });
    const task = await fixture.queryService.readLiveTaskView("change");
    const taskControl = await fixture.taskControlStore.readTask("change");
    const changeSet = await fixture.service.readChangeSet("change");
    const integrationRunId = changeSet.run_references.find(
      (reference) => reference.operation === "integration",
    )?.run_id;
    const integrationRun = integrationRunId
      ? await fixture.service.runStore.read(integrationRunId)
      : null;
    throw new Error(
      `Browser integration result was not projected: ${JSON.stringify({ integration, task, task_control: taskControl, integration_run: integrationRun, integration_execution: fixture.integrationExecution })}`,
      { cause: error },
    );
  }
  const integrationState = await fixture.service.readIntegration({
    change_set_id: "change",
  });
  if (
    integrationState.results.length !== 1 ||
    integrationState.results[0].action_kind !== "publish_exact_candidate"
  ) {
    throw new Error("Browser integration grant did not produce one exact observed result.");
  }

  const publishView = await fixture.service.readDelivery({
    change_set_id: "change",
  });
  const exactView = await fixture.service.readChangeSet("change");
  const currentBundleId = exactView.bundles.at(-1).bundle_id;
  const apiRequest = publishView.deliveries.find(
    (item) => item.repository_id === "api",
  );
  const webRequest = publishView.deliveries.find(
    (item) => item.repository_id === "web",
  );
  fixture.github.merge({
    githubRepository: "fixture/api",
    headBranch: apiRequest.remote_branch,
    targetRef: apiRequest.target_ref,
    mergeCommitSha: await mergeCandidate(
      fixture.repositories.api.path,
      apiRequest.candidate_sha,
    ),
  });

  await page.getByRole("button", { name: "刷新合并状态" }).click();
  await page.waitForSelector("text=merged");
  await page.waitForSelector("text=open");

  const refreshAttemptKey = await page.evaluate(
    (bundleId) =>
      globalThis.localStorage.getItem(
        `changefleet:refresh:change:${bundleId}`,
      ),
    currentBundleId,
  );
  if (!refreshAttemptKey) {
    throw new Error("Expected a retained refresh attempt identity after partial delivery.");
  }

  fixture.github.merge({
    githubRepository: "fixture/web",
    headBranch: webRequest.remote_branch,
    targetRef: webRequest.target_ref,
    mergeCommitSha: await mergeCandidate(
      fixture.repositories.web.path,
      webRequest.candidate_sha,
    ),
  });

  await page.getByRole("button", { name: "刷新合并状态" }).click();
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".changeset-card p")).some(
        (element) => element.textContent?.trim() === "已完成",
      ),
    // Playwright 的第二个参数是传给页面函数的值，超时选项必须放在第三个参数。
    undefined,
    { timeout: 60_000 },
  );

  if (refreshAttempts.length !== 2) {
    throw new Error(`Expected two refresh requests, observed ${refreshAttempts.length}.`);
  }
  if (refreshAttempts[0] !== refreshAttempts[1]) {
    throw new Error("Refresh requests did not preserve the same attempt identity.");
  }
  if (refreshAttempts[0] !== refreshAttemptKey) {
    throw new Error("The retained browser attempt identity did not match the refresh request.");
  }
  const clearedRefreshAttempt = await page.evaluate(
    (bundleId) =>
      globalThis.localStorage.getItem(
        `changefleet:refresh:change:${bundleId}`,
      ),
    currentBundleId,
  );
  if (clearedRefreshAttempt !== null) {
    throw new Error("Expected the refresh attempt identity to clear after merged delivery.");
  }
  process.stdout.write("[test:ui] Chromium console path passed.\n");
} catch (error) {
  if (isMissingPlaywright(error)) {
    process.stderr.write(
      "[test:ui] Missing @playwright/test; install dependencies before validation.\n",
    );
    process.exitCode = 1;
  } else if (isMissingChromium(error)) {
    process.stderr.write(
      "[test:ui] Missing the pinned Chromium binary; run `npx playwright install chromium` before validation.\n",
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
  // Windows 可能在浏览器或 Git 刚关闭句柄时短暂返回 EBUSY；只对测试临时根做有界重试。
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

async function createFixture(root) {
  const integrationExecution = [];
  const repositories = {
    api: await createRepository(root, "api"),
    web: await createRepository(root, "web"),
  };
  for (const repository of Object.values(repositories)) {
    const remotePath = path.join(root, `${path.basename(repository.path)}-remote.git`);
    await git(root, ["init", "--bare", remotePath]);
    await git(repository.path, ["remote", "add", "origin", remotePath]);
    await git(repository.path, ["push", "-u", "origin", "main"]);
  }
  const runtime = new ScriptedRuntime({
    plan: createTwoRepositoryPlan(await writeCombinedCheckScript(root, 2)),
    executionDelayMs: 7_000,
    planningFailures: [
      null,
      {
        code: "SCRIPTED_PLANNING_FAILURE",
        message: "The first browser planning attempt failed",
      },
      null,
    ],
    integrationExecutor: async (invocation) => {
      const action = invocation.context_projection.integration;
      integrationExecution.push({ stage: "started", action: structuredClone(action) });
      try {
        await git(invocation.workspace.workspace_path, [
          "push",
          action.push_remote,
          `${action.candidate_sha}:${action.destination_ref}`,
        ]);
        integrationExecution.push({ stage: "pushed" });
      } catch (error) {
        integrationExecution.push({ stage: "failed", message: String(error?.message ?? error) });
        throw error;
      }
    },
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
  const service = await ChangeFleetService.open({
    controlRoot: path.join(root, "control"),
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
      repositories: Object.entries(repositories).map(([repositoryId, repository]) => ({
        repository_id: repositoryId,
        locator: { path: repository.path },
      })),
    },
  });
  for (const repositoryId of Object.keys(repositories).sort()) {
    await service.configureGithubDelivery({
      idempotency_key: `binding-${repositoryId}`,
      project_id: "project",
      repository_id: repositoryId,
      github_repository: `fixture/${repositoryId}`,
      push_remote: "origin",
    });
  }
  await service.createChangeSet({
    idempotency_key: "create",
    change_set_id: "change",
    project_id: "project",
    intent: { objective: "Exercise the local browser console" },
  });
  const plan = await service.planChangeSet({
    idempotency_key: "plan",
    change_set_id: "change",
  });
  await service.confirmPlanMessage({
    idempotency_key: "confirm",
    change_set_id: "change",
    message_id: plan.message.message_id,
    content_digest: plan.message.content_digest,
  });
  await service.executeChangeSet({
    idempotency_key: "execute",
    change_set_id: "change",
  });
  const taskControlStore = new TaskControlStore(path.join(root, "control"));
  await taskControlStore.initialize();
  const taskController = new AutonomousTaskController({
    service,
    taskControlStore,
  });
  await taskController.start();
  const queryService = new ChangeSetViewService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    auditQueryService: new RuntimeAuditQueryService({
      controlStore: service.controlStore,
      runStore: service.runStore,
      evidenceStore: service.evidenceStore,
    }),
    agentProfile: TEST_AGENT_PROFILE,
    taskControlStore,
  });
  const operatorApplication = createOperatorApplication(service, {
    operationHandlers: {
      "changeset.create": (request) => taskController.createChangeSet(request),
      "changeset.message": (request) => taskController.sendTaskMessage(request),
      "changeset.run.interrupt": (request) => taskController.interruptRun(request),
      "changeset.controller.run": (request) =>
        taskController.runTaskController(request),
      "changeset.close": (request) => taskController.cancelChangeSet(request),
      "changeset.bundle.decide": (request) =>
        taskController.recordBundleDecision(request),
      "changeset.delivery.publish": (request) =>
        taskController.publishDelivery(request),
      "changeset.delivery.refresh": (request) =>
        taskController.refreshDelivery(request),
      "changeset.integration.grant": (request) =>
        taskController.grantIntegrationAction(request),
      "changeset.integration.execute": (request) =>
        taskController.executeIntegrationAction(request),
      "changeset.integration.complete_without_managed": (request) =>
        taskController.completeWithoutManagedIntegration(request),
    },
  });
  return {
    repositories,
    github,
    service,
    queryService,
    taskControlStore,
    integrationExecution,
    async startServer() {
      const localServer = await startLocalConsoleServer({
        queryService,
        operatorApplication,
      });
      return {
        ...localServer,
        async close() {
          await taskController.stop();
          await localServer.close();
        },
      };
    },
  };
}

async function prepareLiveReconnect(page) {
  let requestCount = 0;
  let allowReconnect;
  const reconnectBarrier = new Promise((resolve) => {
    allowReconnect = resolve;
  });
  await page.route("**/api/local/v0/changesets/*/events", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      // 显式制造一次初始连接失败；有限 SSE 响应的自然关闭时机在不同 Node/Chromium
      // 调度下并不稳定，不能作为重连测试的隐含时钟。
      await route.abort("connectionfailed");
      return;
    }
    // 第二次请求停在网络边界，确保页面有确定的“正在自动重连”可观察窗口。
    if (requestCount === 2) await reconnectBarrier;
    await route.continue();
  });
  return {
    async verify() {
      try {
        await page.waitForSelector("text=正在自动重连", { timeout: 15_000 });
      } catch (error) {
        const statusText = await page.locator("#status").innerText().catch(() => "unavailable");
        throw new Error(
          `Automatic reconnect was not visible; requests=${requestCount}; status=${statusText}`,
          { cause: error },
        );
      }
      allowReconnect();
      await page.waitForSelector("text=实时连接正常", { timeout: 15_000 });
      await page.unroute("**/api/local/v0/changesets/*/events");
    },
  };
}

async function createRepository(parent, name) {
  const repositoryPath = path.join(parent, name);
  await mkdir(repositoryPath, { recursive: true });
  await git(repositoryPath, ["init", "-b", "main"]);
  await git(repositoryPath, ["config", "user.name", "Fixture"]);
  await git(repositoryPath, ["config", "user.email", "fixture@example.test"]);
  await writeFile(path.join(repositoryPath, "baseline.txt"), `${name} baseline\n`, "utf8");
  await git(repositoryPath, ["add", "-A"]);
  await git(repositoryPath, ["commit", "-m", "baseline"]);
  return { path: repositoryPath };
}

async function assertRunningTimeRefresh(page) {
  const elapsed = page.locator('[data-testid="run-elapsed"]').first();
  const lastActivity = page.locator('[data-testid="run-last-activity"]').first();
  await elapsed.waitFor({ timeout: 15_000 });
  await lastActivity.waitFor({ timeout: 15_000 });
  const initialElapsed = await elapsed.innerText();
  const initialLastActivity = await lastActivity.innerText();
  await page.waitForTimeout(3_100);
  const nextElapsed = await elapsed.innerText();
  const nextLastActivity = await lastActivity.innerText();
  if (initialElapsed === nextElapsed) {
    throw new Error(
      `Run elapsed time did not advance without new SSE activity: ${initialElapsed} -> ${nextElapsed}.`,
    );
  }
  if (initialLastActivity === nextLastActivity) {
    throw new Error(
      `Last-activity time did not advance without new SSE activity: ${initialLastActivity} -> ${nextLastActivity}.`,
    );
  }
}

async function writeCombinedCheckScript(parent, candidateCount) {
  const scriptPath = path.join(parent, "combined-check.mjs");
  await writeFile(
    scriptPath,
    [
      'import { readFile } from "node:fs/promises";',
      "const manifest = JSON.parse(await readFile(process.env.CHANGEFLEET_VALIDATION_MANIFEST, 'utf8'));",
      `if (manifest.candidates.length !== ${candidateCount}) process.exit(2);`,
      "for (const candidate of manifest.candidates) {",
      "  const feature = await readFile(`${candidate.workspace_path}/feature.txt`, 'utf8');",
      "  if (!feature.includes(candidate.repository_id)) process.exit(3);",
      "}",
    ].join("\n"),
    "utf8",
  );
  return scriptPath;
}

async function git(cwd, arguments_) {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout.trim();
}

async function mergeCandidate(repositoryPath, candidateSha) {
  await git(repositoryPath, ["checkout", "main"]);
  await git(repositoryPath, [
    "merge",
    "--no-ff",
    candidateSha,
    "-m",
    `merge ${candidateSha.slice(0, 12)}`,
  ]);
  await git(repositoryPath, ["push", "origin", "main"]);
  return git(repositoryPath, ["rev-parse", "HEAD"]);
}

async function remoteSha(repositoryPath, ref) {
  const output = await git(repositoryPath, ["ls-remote", "origin", ref]);
  return output.split(/\s+/u)[0];
}

async function loadPlaywright() {
  return import("@playwright/test");
}

function isMissingPlaywright(error) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "ERR_MODULE_NOT_FOUND" ||
    /Cannot find package '@playwright\/test'/u.test(message)
  );
}

function isMissingChromium(error) {
  return /Executable doesn't exist|browserType\.launch/u.test(
    String(error?.message ?? ""),
  );
}
