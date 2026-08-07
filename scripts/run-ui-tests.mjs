import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ChangeFleetService } from "../src/application/change-fleet-service.js";
import { ChangeSetViewService } from "../src/application/changeset-view-service.js";
import { createOperatorApplication } from "../src/application/operator-application.js";
import { RuntimeAuditQueryService } from "../src/application/runtime-audit-query-service.js";
import { startLocalConsoleServer } from "../src/cli/local-console-server.js";
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
  const refreshAttempts = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/delivery/refresh")
    ) {
      const payload = request.postDataJSON();
      refreshAttempts.push(payload.idempotency_key);
    }
  });
  await page.goto(`http://${server.host}:${server.port}/`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("text=Bundle Subject");
  await page.waitForSelector("text=Work Units");
  await page.waitForSelector("text=api");
  await page.waitForSelector("text=web");
  await page.getByRole("button", { name: "Accept Bundle" }).click();
  await page.getByRole("button", { name: "Publish Delivery" }).click();
  await page.waitForSelector('a[href^="https://github.com/fixture/api/pull/"]');
  await page.waitForSelector('a[href^="https://github.com/fixture/web/pull/"]');

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

  await page.getByRole("button", { name: "Refresh Delivery" }).click();
  await page.waitForSelector("text=Current state");
  await page.waitForSelector("text=Per-repository requests 2");
  await page.waitForSelector("text=Reusing refresh attempt");
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

  await page.getByRole("button", { name: "Refresh Delivery" }).click();
  await page.waitForSelector("text=Current state");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".pill")).some(
        (element) => element.textContent?.trim() === "terminal / complete",
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
  await rm(root, { recursive: true, force: true });
}

async function createFixture(root) {
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
  const queryService = new ChangeSetViewService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    auditQueryService: new RuntimeAuditQueryService({
      controlStore: service.controlStore,
      runStore: service.runStore,
      evidenceStore: service.evidenceStore,
    }),
  });
  return {
    repositories,
    github,
    service,
    startServer() {
      return startLocalConsoleServer({
        queryService,
        operatorApplication: createOperatorApplication(service),
      });
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
