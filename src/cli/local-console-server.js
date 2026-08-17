import http from "node:http";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_LOCALE,
  diagnosticMessage,
  normalizeLocale,
} from "../domain/diagnostics.js";
import { ChangeFleetError, invariant, wrapError } from "../domain/errors.js";
import { normalizeId } from "../domain/model.js";
import { readConsoleAsset, renderIndexHtml } from "../ui/local-console/index.js";

const MAX_JSON_BODY_BYTES = 16 * 1024;
const MAX_INTENT_ITEMS = 20;
const MAX_INTENT_TEXT_BYTES = 2 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const GET_ROUTES = Object.freeze([
  /^\/$/u,
  /^\/app\.css$/u,
  /^\/app\.js$/u,
  /^\/live-connection\.js$/u,
  /^\/usage-presentation\.js$/u,
  /^\/api\/local\/v0\/intake\/options$/u,
  /^\/api\/local\/v0\/changesets$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/events$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/audit$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/delivery$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/supervision$/u,
]);
const POST_ROUTES = Object.freeze([
  /^\/api\/local\/v0\/changesets$/u,
  /^\/api\/local\/v0\/projects\/[A-Za-z0-9._-]+\/repositories\/[A-Za-z0-9._-]+\/github-delivery$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/messages$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/planning-messages$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/plan-confirmation$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/controller\/run$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/cancel$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/bundle-decisions$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/feedback$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/execute$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/runs\/[A-Za-z0-9._-]+\/interrupt$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/gates\/[A-Za-z0-9._-]+\/resolve$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/delivery\/publish$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/delivery\/refresh$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/integration\/offers$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/integration\/grants$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/integration\/complete-without-managed$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/supervision\/(?:start|pause|resume)$/u,
]);

// 本地 HTTP 适配层只公开精确白名单路由，并集中处理 loopback、Host/Origin/session/CSRF、大小限制、安全头与优雅关闭。
export async function startLocalConsoleServer({
  host = "127.0.0.1",
  port = 0,
  locale = DEFAULT_LOCALE,
  queryService,
  operatorApplication,
}) {
  invariant(
    LOOPBACK_HOSTS.has(host),
    "INVALID_CLI_INVOCATION",
    "The local console must bind one loopback address",
  );
  invariant(
    queryService &&
      typeof queryService.readIntakeOptions === "function" &&
      typeof queryService.listChangeSets === "function" &&
      typeof queryService.readChangeSetView === "function" &&
      typeof queryService.readLiveTaskView === "function" &&
      typeof queryService.readAuditView === "function",
    "INVALID_OPERATOR_APPLICATION",
    "The local console requires one bounded query service",
  );
  invariant(
    operatorApplication &&
      typeof operatorApplication.execute === "function",
    "INVALID_OPERATOR_APPLICATION",
    "The local console requires one operator application",
  );

  const sessionNonce = randomUUID();
  const csrfNonce = randomUUID();
  const localeCode = normalizeLocale(locale);
  const sockets = new Set();
  let shuttingDown = false;

  const server = http.createServer(async (request, response) => {
    applySecurityHeaders(response);
    try {
      const localPort = server.address()?.port ?? port;
      const requestUrl = new URL(
        request.url ?? "/",
        originFor(host, localPort),
      );
      validateHost(request, host, localPort);
      validateAllowedMethodAndPath(request.method, requestUrl.pathname);
      if (request.method === "GET" && requestUrl.pathname === "/") {
        sendText(
          response,
          200,
          renderIndexHtml({
            sessionNonce,
            csrfNonce,
            selectedChangeSetId: requestUrl.searchParams.get("change_set_id"),
          }),
          "text/html; charset=utf-8",
        );
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/app.css") {
        const asset = await readConsoleAsset("app.css");
        invariant(asset !== null, "CHANGE_SET_NOT_FOUND", "Console CSS is missing");
        sendText(response, 200, asset, "text/css; charset=utf-8");
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/app.js") {
        const asset = await readConsoleAsset("app.js");
        invariant(asset !== null, "CHANGE_SET_NOT_FOUND", "Console script is missing");
        sendText(response, 200, asset, "text/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/live-connection.js") {
        const asset = await readConsoleAsset("live-connection.js");
        invariant(asset !== null, "CHANGE_SET_NOT_FOUND", "Console script is missing");
        sendText(response, 200, asset, "text/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/usage-presentation.js") {
        // 浏览器原生 ESM 的每个依赖都必须经过同一静态白名单，不能退化为任意文件读取。
        const asset = await readConsoleAsset("usage-presentation.js");
        invariant(asset !== null, "CHANGE_SET_NOT_FOUND", "Console script is missing");
        sendText(response, 200, asset, "text/javascript; charset=utf-8");
        return;
      }

      validateSession(request, sessionNonce);
      if (request.method === "GET") {
        await handleGetApi({
          request,
          response,
          url: requestUrl,
          queryService,
          operatorApplication,
        });
        return;
      }

      validateOrigin(request, host, localPort);
      validateCsrf(request, csrfNonce);
      await handlePostApi({
        request,
        response,
        url: requestUrl,
        operatorApplication,
      });
    } catch (error) {
      const safe = wrapError(
        error,
        "CLI_COMMAND_FAILED",
        "The local console request could not be completed",
      );
      sendJson(response, statusForError(safe.code), {
        error: presentSafeConsoleError(safe, localeCode),
      });
    }
  });
  server.keepAliveTimeout = 1_000;
  server.requestTimeout = 15_000;
  server.headersTimeout = 20_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    host,
    port: server.address().port,
    async close() {
      if (shuttingDown) return;
      shuttingDown = true;
      for (const socket of sockets) socket.end();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      for (const socket of sockets) {
        if (!socket.destroyed) socket.destroy();
      }
    },
  };
}

async function handleGetApi({
  request,
  response,
  url,
  queryService,
  operatorApplication,
}) {
  if (url.pathname === "/api/local/v0/intake/options") {
    sendJson(response, 200, await queryService.readIntakeOptions());
    return;
  }
  if (url.pathname === "/api/local/v0/changesets") {
    sendJson(
      response,
      200,
      await queryService.listChangeSets({
        limit: parseOptionalInteger(url.searchParams.get("limit")),
        cursor: url.searchParams.get("cursor") ?? undefined,
      }),
    );
    return;
  }
  const match = url.pathname.match(
    /^\/api\/local\/v0\/changesets\/(?<changeSetId>[A-Za-z0-9._-]+)(?:\/(?<tail>audit|delivery|events|supervision))?$/u,
  );
  invariant(match?.groups, "CHANGE_SET_NOT_FOUND", "Route not found");
  const changeSetId = match.groups.changeSetId;
  normalizeId("change_set_id", changeSetId);
  if (match.groups.tail === undefined) {
    sendJson(response, 200, await queryService.readChangeSetView(changeSetId));
    return;
  }
  if (match.groups.tail === "audit") {
    sendJson(response, 200, await queryService.readAuditView(changeSetId));
    return;
  }
  if (match.groups.tail === "events") {
    await streamTaskEvents({ request, response, queryService, changeSetId });
    return;
  }
  if (match.groups.tail === "supervision") {
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.supervision.progress", {
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  sendJson(
    response,
    200,
    await operatorApplication.execute("changeset.delivery.read", {
      change_set_id: changeSetId,
    }),
  );
}

async function streamTaskEvents({
  request,
  response,
  queryService,
  changeSetId,
}) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders?.();
  await new Promise((resolve) => {
    let lastCursor = null;
    let reading = false;
    let heartbeat = 0;
    let timer = null;
    const close = () => {
      if (timer !== null) clearInterval(timer);
      resolve();
    };
    request.once("close", close);
    response.once("close", close);
    const emit = async () => {
      if (reading || response.destroyed) return;
      reading = true;
      try {
        const projection = await queryService.readLiveTaskView(changeSetId);
        heartbeat += 1;
        if (projection.cursor !== lastCursor || heartbeat >= 20) {
          response.write(`event: task\ndata: ${JSON.stringify(projection)}\n\n`);
          lastCursor = projection.cursor;
          heartbeat = 0;
        }
      } catch (error) {
        response.write(
          `event: error\ndata: ${JSON.stringify({ code: error?.code ?? "LIVE_TASK_READ_FAILED" })}\n\n`,
        );
      } finally {
        reading = false;
      }
    };
    timer = setInterval(() => void emit(), 750);
    void emit();
  });
}

async function handlePostApi({
  request,
  response,
  url,
  operatorApplication,
}) {
  if (url.pathname === "/api/local/v0/changesets") {
    const body = normalizeCreateChangeSetBody(await readJsonBody(request));
    sendMutationResult(
      response,
      await operatorApplication.execute("changeset.create", {
        ...body,
        actor: "human",
      }),
    );
    return;
  }
  const bindingMatch = url.pathname.match(
    /^\/api\/local\/v0\/projects\/(?<projectId>[A-Za-z0-9._-]+)\/repositories\/(?<repositoryId>[A-Za-z0-9._-]+)\/github-delivery$/u,
  );
  if (bindingMatch?.groups) {
    const body = normalizeGithubDeliveryBindingBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute(
        "project.repository_delivery.github.configure",
        {
          ...body,
          project_id: bindingMatch.groups.projectId,
          repository_id: bindingMatch.groups.repositoryId,
          actor: "human",
        },
      ),
    );
    return;
  }
  const interruptMatch = url.pathname.match(
    /^\/api\/local\/v0\/changesets\/(?<changeSetId>[A-Za-z0-9._-]+)\/runs\/(?<runId>[A-Za-z0-9._-]+)\/interrupt$/u,
  );
  if (interruptMatch?.groups) {
    const body = normalizeInterruptBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.run.interrupt", {
        ...body,
        change_set_id: interruptMatch.groups.changeSetId,
        run_id: interruptMatch.groups.runId,
      }),
    );
    return;
  }
  const gateMatch = url.pathname.match(
    /^\/api\/local\/v0\/changesets\/(?<changeSetId>[A-Za-z0-9._-]+)\/gates\/(?<gateId>[A-Za-z0-9._-]+)\/resolve$/u,
  );
  if (gateMatch?.groups) {
    const body = normalizeGateResolutionBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.gate.resolve", {
        ...body,
        change_set_id: gateMatch.groups.changeSetId,
        gate_id: gateMatch.groups.gateId,
      }),
    );
    return;
  }
  const match = url.pathname.match(
    /^\/api\/local\/v0\/changesets\/(?<changeSetId>[A-Za-z0-9._-]+)\/(?<tail>messages|planning-messages|plan-confirmation|controller\/run|cancel|bundle-decisions|feedback|execute|delivery\/publish|delivery\/refresh|integration\/(?:offers|grants|complete-without-managed)|supervision\/(?:start|pause|resume))$/u,
  );
  invariant(match?.groups, "CHANGE_SET_NOT_FOUND", "Route not found");
  const changeSetId = match.groups.changeSetId;
  normalizeId("change_set_id", changeSetId);
  if (match.groups.tail === "messages") {
    const body = normalizeTaskMessageBody(await readJsonBody(request));
    sendMutationResult(
      response,
      await operatorApplication.execute("changeset.message", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "planning-messages") {
    const body = normalizePlanningMessageBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.plan", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "plan-confirmation") {
    const body = normalizePlanConfirmationBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.plan.confirm", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "controller/run") {
    const body = normalizeControllerBody(await readJsonBody(request));
    sendMutationResult(
      response,
      await operatorApplication.execute("changeset.controller.run", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "cancel") {
    const body = normalizeControllerBody(await readJsonBody(request));
    sendMutationResult(
      response,
      await operatorApplication.execute("changeset.close", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "bundle-decisions") {
    const body = normalizeBundleDecisionBody(await readJsonBody(request));
    sendMutationResult(
      response,
      await operatorApplication.execute("changeset.bundle.decide", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "feedback") {
    const body = normalizeFeedbackBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.feedback.submit", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "execute") {
    const body = normalizeExecuteBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.execute", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail.startsWith("supervision/")) {
    const operation = match.groups.tail.slice("supervision/".length);
    const body = normalizeSupervisionBody(
      await readJsonBody(request),
      operation,
    );
    sendJson(
      response,
      200,
      await operatorApplication.execute(
        `changeset.supervision.${operation}`,
        { ...body, change_set_id: changeSetId },
      ),
    );
    return;
  }
  if (match.groups.tail === "integration/offers") {
    const body = normalizeIntegrationOfferBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.integration.offer", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "integration/grants") {
    const body = normalizeIntegrationGrantBody(await readJsonBody(request));
    sendMutationResult(
      response,
      await operatorApplication.execute("changeset.integration.grant", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "integration/complete-without-managed") {
    const body = normalizeCompleteWithoutIntegrationBody(
      await readJsonBody(request),
    );
    sendMutationResult(
      response,
      await operatorApplication.execute(
        "changeset.integration.complete_without_managed",
        {
          ...body,
          change_set_id: changeSetId,
        },
      ),
    );
    return;
  }
  if (match.groups.tail === "delivery/publish") {
    const body = normalizePublishBody(await readJsonBody(request));
    sendMutationResult(
      response,
      await operatorApplication.execute("changeset.delivery.publish", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  const body = normalizeRefreshBody(await readJsonBody(request));
  sendMutationResult(
    response,
    await operatorApplication.execute("changeset.delivery.refresh", {
      ...body,
      change_set_id: changeSetId,
    }),
  );
}

function sendMutationResult(response, result) {
  // 后台命令只返回“已接受”，不能把尚未发生的 Agent 结果伪装成同步成功。
  sendJson(
    response,
    result?.accepted === true ||
      result?.delivery_command ||
      result?.integration_command
      ? 202
      : 200,
    result,
  );
}

function normalizeCreateChangeSetBody(body) {
  // 浏览器只能表达任务意图和已注册仓库选择；Runtime、路径与 Harness 选择不能穿过该边界。
  requireExactFields(body, [
    "idempotency_key",
    "change_set_id",
    "project_id",
    "intent",
    "planning_repository_ids",
    "repository_selections",
  ]);
  const planningRepositoryIds = normalizeBoundedStringArray(
    body.planning_repository_ids,
    "planning_repository_ids",
    { minimum: 1, maximum: 32 },
  );
  invariant(
    new Set(planningRepositoryIds).size === planningRepositoryIds.length,
    "INVALID_OPERATOR_REQUEST",
    "planning_repository_ids must be unique",
  );
  invariant(
    Array.isArray(body.repository_selections) &&
      body.repository_selections.length === planningRepositoryIds.length,
    "INVALID_OPERATOR_REQUEST",
    "repository_selections must match the selected Repositories",
  );
  const repositorySelections = body.repository_selections.map((selection) => {
    requireExactFields(selection, [
      "repository_id",
      "branch_ref",
      "target_ref",
    ]);
    const repositoryId = requireNonEmptyString(
      selection.repository_id,
      "repository_id",
    );
    invariant(
      planningRepositoryIds.includes(repositoryId),
      "INVALID_OPERATOR_REQUEST",
      "repository_selections contains an unselected Repository",
    );
    return {
      repository_id: repositoryId,
      branch_ref: optionalNullableString(selection.branch_ref, "branch_ref"),
      target_ref: optionalNullableString(selection.target_ref, "target_ref"),
    };
  });
  invariant(
    new Set(repositorySelections.map((item) => item.repository_id)).size ===
      repositorySelections.length,
    "INVALID_OPERATOR_REQUEST",
    "repository_selections must be unique",
  );
  return {
    idempotency_key: requireNonEmptyString(
      body.idempotency_key,
      "idempotency_key",
    ),
    change_set_id: requireNonEmptyString(body.change_set_id, "change_set_id"),
    project_id: requireNonEmptyString(body.project_id, "project_id"),
    intent: normalizeConsoleIntent(body.intent),
    planning_repository_ids: planningRepositoryIds,
    repository_selections: repositorySelections,
  };
}

function normalizeGithubDeliveryBindingBody(body) {
  requireExactFields(body, [
    "idempotency_key",
    "github_repository",
    "push_remote",
  ]);
  return {
    idempotency_key: requireNonEmptyString(
      body.idempotency_key,
      "idempotency_key",
    ),
    github_repository: requireNonEmptyString(
      body.github_repository,
      "github_repository",
    ),
    push_remote: requireNonEmptyString(body.push_remote, "push_remote"),
  };
}

function normalizeConsoleIntent(intent) {
  requireExactFields(intent, [
    "objective",
    "rationale",
    "constraints",
    "non_goals",
    "acceptance_criteria",
    "resolved_decisions",
    "open_questions",
  ]);
  return {
    objective: requireBoundedText(intent.objective, "intent.objective"),
    rationale: optionalBoundedText(intent.rationale, "intent.rationale"),
    constraints: normalizeBoundedStringArray(
      intent.constraints,
      "intent.constraints",
    ),
    non_goals: normalizeBoundedStringArray(
      intent.non_goals,
      "intent.non_goals",
    ),
    acceptance_criteria: normalizeBoundedStringArray(
      intent.acceptance_criteria,
      "intent.acceptance_criteria",
    ),
    resolved_decisions: normalizeBoundedStringArray(
      intent.resolved_decisions,
      "intent.resolved_decisions",
    ),
    open_questions: normalizeBoundedStringArray(
      intent.open_questions,
      "intent.open_questions",
    ),
    source: "local_console",
  };
}

function normalizePlanningMessageBody(body) {
  // null 表示首次规划；后续轮次必须携带一条有界、非空的人类消息。
  requireExactFields(body, ["idempotency_key", "message"]);
  invariant(
    body.message === null ||
      (typeof body.message === "string" && body.message.trim().length > 0),
    "INVALID_OPERATOR_REQUEST",
    "Planning message must be a non-empty string or null",
  );
  return {
    idempotency_key: requireNonEmptyString(
      body.idempotency_key,
      "idempotency_key",
    ),
    message: body.message === null ? null : body.message.trim(),
  };
}

function normalizeTaskMessageBody(body) {
  requireExactFields(body, ["idempotency_key", "message", "actor"]);
  return {
    idempotency_key: requireNonEmptyString(
      body.idempotency_key,
      "idempotency_key",
    ),
    message: requireNonEmptyString(body.message, "message"),
    actor: requireNonEmptyString(body.actor, "actor"),
  };
}

function normalizePlanConfirmationBody(body) {
  requireExactFields(body, [
    "idempotency_key",
    "message_id",
    "content_digest",
    "actor",
    "run_after_confirmation",
  ]);
  invariant(
    typeof body.run_after_confirmation === "boolean",
    "INVALID_OPERATOR_REQUEST",
    "run_after_confirmation must be boolean",
  );
  return {
    idempotency_key: requireNonEmptyString(body.idempotency_key, "idempotency_key"),
    message_id: requireNonEmptyString(body.message_id, "message_id"),
    content_digest: requireNonEmptyString(body.content_digest, "content_digest"),
    actor: requireNonEmptyString(body.actor, "actor"),
    run_after_confirmation: body.run_after_confirmation,
  };
}

function normalizeControllerBody(body) {
  requireExactFields(body, ["idempotency_key", "actor"]);
  return {
    idempotency_key: requireNonEmptyString(
      body.idempotency_key,
      "idempotency_key",
    ),
    actor: requireNonEmptyString(body.actor, "actor"),
  };
}

function normalizeBundleDecisionBody(body) {
  requireExactFields(body, [
    "idempotency_key",
    "bundle_revision",
    "bundle_hash",
    "decision",
    "actor",
  ]);
  invariant(
    body.decision === "accept" || body.decision === "reject",
    "INVALID_OPERATOR_REQUEST",
    "Bundle decision must be accept or reject",
  );
  return {
    idempotency_key: requireNonEmptyString(body.idempotency_key, "idempotency_key"),
    bundle_revision: requirePositiveInteger(body.bundle_revision, "bundle_revision"),
    bundle_hash: requireNonEmptyString(body.bundle_hash, "bundle_hash"),
    decision: body.decision,
    actor: requireNonEmptyString(body.actor, "actor"),
  };
}

function normalizePublishBody(body) {
  requireExactFields(body, ["idempotency_key", "actor", "title", "body"]);
  return {
    idempotency_key: requireNonEmptyString(body.idempotency_key, "idempotency_key"),
    actor: requireNonEmptyString(body.actor, "actor"),
    title: optionalNullableString(body.title, "title"),
    body: optionalNullableString(body.body, "body"),
  };
}

function normalizeIntegrationOfferBody(body) {
  requireExactFields(body, [
    "idempotency_key",
    "bundle_revision",
    "bundle_hash",
    "repository_id",
    "action_kind",
    "push_remote",
    "destination_ref",
  ]);
  invariant(
    ["publish_exact_candidate", "fast_forward_target"].includes(
      body.action_kind,
    ),
    "INVALID_OPERATOR_REQUEST",
    "Integration action kind is invalid",
  );
  return {
    idempotency_key: requireNonEmptyString(
      body.idempotency_key,
      "idempotency_key",
    ),
    bundle_revision: requirePositiveInteger(
      body.bundle_revision,
      "bundle_revision",
    ),
    bundle_hash: requireNonEmptyString(body.bundle_hash, "bundle_hash"),
    repository_id: requireNonEmptyString(
      body.repository_id,
      "repository_id",
    ),
    action_kind: body.action_kind,
    push_remote: requireNonEmptyString(body.push_remote, "push_remote"),
    destination_ref: requireNonEmptyString(
      body.destination_ref,
      "destination_ref",
    ),
  };
}

function normalizeIntegrationGrantBody(body) {
  requireExactFields(body, [
    "idempotency_key",
    "action_offer_id",
    "input_digest",
    "actor",
  ]);
  return {
    idempotency_key: requireNonEmptyString(
      body.idempotency_key,
      "idempotency_key",
    ),
    action_offer_id: requireNonEmptyString(
      body.action_offer_id,
      "action_offer_id",
    ),
    input_digest: requireNonEmptyString(body.input_digest, "input_digest"),
    actor: requireNonEmptyString(body.actor, "actor"),
  };
}

function normalizeCompleteWithoutIntegrationBody(body) {
  requireExactFields(body, [
    "idempotency_key",
    "bundle_revision",
    "bundle_hash",
    "actor",
  ]);
  return {
    idempotency_key: requireNonEmptyString(
      body.idempotency_key,
      "idempotency_key",
    ),
    bundle_revision: requirePositiveInteger(
      body.bundle_revision,
      "bundle_revision",
    ),
    bundle_hash: requireNonEmptyString(body.bundle_hash, "bundle_hash"),
    actor: requireNonEmptyString(body.actor, "actor"),
  };
}

function normalizeFeedbackBody(body) {
  requireExactFields(body, [
    "idempotency_key",
    "phase",
    "work_unit_id",
    "run_id",
    "feedback",
    "actor",
  ]);
  invariant(
    body.work_unit_id === null || typeof body.work_unit_id === "string",
    "INVALID_OPERATOR_REQUEST",
    "work_unit_id must be a string or null",
  );
  invariant(
    body.run_id === null || typeof body.run_id === "string",
    "INVALID_OPERATOR_REQUEST",
    "run_id must be a string or null",
  );
  return {
    idempotency_key: requireNonEmptyString(body.idempotency_key, "idempotency_key"),
    phase: requireNonEmptyString(body.phase, "phase"),
    work_unit_id: body.work_unit_id,
    run_id: body.run_id,
    feedback: body.feedback,
    actor: requireNonEmptyString(body.actor, "actor"),
  };
}

function normalizeExecuteBody(body) {
  requireExactFields(body, [
    "idempotency_key",
    "verification_admission_mode",
    "validation_attempt_budgets",
  ]);
  invariant(
    body.verification_admission_mode === null ||
      ["basic", "deterministic", "independent_review"].includes(
        body.verification_admission_mode,
      ),
    "INVALID_OPERATOR_REQUEST",
    "verification_admission_mode is invalid",
  );
  invariant(
    Array.isArray(body.validation_attempt_budgets),
    "INVALID_OPERATOR_REQUEST",
    "validation_attempt_budgets must be an array",
  );
  return {
    idempotency_key: requireNonEmptyString(body.idempotency_key, "idempotency_key"),
    verification_admission_mode: body.verification_admission_mode,
    validation_attempt_budgets: body.validation_attempt_budgets,
  };
}

function normalizeInterruptBody(body) {
  requireExactFields(body, ["idempotency_key", "actor"]);
  return {
    idempotency_key: requireNonEmptyString(body.idempotency_key, "idempotency_key"),
    actor: requireNonEmptyString(body.actor, "actor"),
  };
}

function normalizeSupervisionBody(body, operation) {
  const fields = operation === "pause"
    ? ["idempotency_key", "actor", "reason"]
    : ["idempotency_key", "actor"];
  requireExactFields(body, fields);
  const normalized = {
    idempotency_key: requireNonEmptyString(body.idempotency_key, "idempotency_key"),
    actor: requireNonEmptyString(body.actor, "actor"),
  };
  if (operation === "pause") {
    normalized.reason = requireNonEmptyString(body.reason, "reason");
  }
  return normalized;
}

function normalizeGateResolutionBody(body) {
  requireExactFields(body, ["idempotency_key", "option", "actor"]);
  return {
    idempotency_key: requireNonEmptyString(body.idempotency_key, "idempotency_key"),
    option: requireNonEmptyString(body.option, "option"),
    actor: requireNonEmptyString(body.actor, "actor"),
  };
}

function normalizeRefreshBody(body) {
  requireExactFields(body, ["idempotency_key"]);
  return {
    idempotency_key: requireNonEmptyString(body.idempotency_key, "idempotency_key"),
  };
}

function requireExactFields(value, allowed) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "INVALID_OPERATOR_REQUEST",
    "Mutation request body must be one JSON object",
  );
  const allowedSet = new Set(allowed);
  const keys = Object.keys(value);
  invariant(
    keys.every((key) => allowedSet.has(key)),
    "INVALID_OPERATOR_REQUEST",
    "Mutation request body contains an unsupported field",
  );
  for (const key of allowed) {
    invariant(
      Object.hasOwn(value, key),
      "INVALID_OPERATOR_REQUEST",
      `Mutation request body is missing ${key}`,
    );
  }
}

function normalizeBoundedStringArray(
  value,
  field,
  { minimum = 0, maximum = MAX_INTENT_ITEMS } = {},
) {
  invariant(
    Array.isArray(value) &&
      value.length >= minimum &&
      value.length <= maximum,
    "INVALID_OPERATOR_REQUEST",
    `${field} must contain between ${minimum} and ${maximum} items`,
  );
  return value.map((item, index) =>
    requireBoundedText(item, `${field}[${index}]`),
  );
}

function requireBoundedText(value, field) {
  const normalized = requireNonEmptyString(value, field).trim();
  invariant(
    Buffer.byteLength(normalized, "utf8") <= MAX_INTENT_TEXT_BYTES,
    "INVALID_OPERATOR_REQUEST",
    `${field} is too large`,
  );
  return normalized;
}

function optionalBoundedText(value, field) {
  if (value === null || value === undefined) return null;
  return requireBoundedText(value, field);
}

function requireNonEmptyString(value, field) {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    "INVALID_OPERATOR_REQUEST",
    `${field} must be one non-empty string`,
  );
  return value;
}

function requirePositiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 1,
    "INVALID_OPERATOR_REQUEST",
    `${field} must be one positive integer`,
  );
  return value;
}

function optionalNullableString(value, field) {
  invariant(
    value === null || value === undefined || typeof value === "string",
    "INVALID_OPERATOR_REQUEST",
    `${field} must be a string or null`,
  );
  return value ?? null;
}

function validateAllowedMethodAndPath(method, pathname) {
  if (method === "GET" && GET_ROUTES.some((route) => route.test(pathname))) {
    return;
  }
  if (method === "POST" && POST_ROUTES.some((route) => route.test(pathname))) {
    return;
  }
  if (GET_ROUTES.concat(POST_ROUTES).some((route) => route.test(pathname))) {
    throw new ChangeFleetError(
      "UNSUPPORTED_OPERATOR_OPERATION",
      "The local console method is not allowed",
    );
  }
  throw new ChangeFleetError(
    "CHANGE_SET_NOT_FOUND",
    "The local console route was not found",
  );
}

function validateSession(request, expected) {
  invariant(
    request.headers["x-changefleet-session"] === expected,
    "INVALID_OPERATOR_REQUEST",
    "The local console session is invalid",
  );
}

function validateCsrf(request, expected) {
  invariant(
    request.headers["x-changefleet-csrf"] === expected,
    "INVALID_OPERATOR_REQUEST",
    "The local console CSRF nonce is invalid",
  );
}

function validateHost(request, host, port) {
  const expected = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
  invariant(
    request.headers.host === expected,
    "INVALID_OPERATOR_REQUEST",
    "The local console Host header is invalid",
  );
}

function validateOrigin(request, host, port) {
  invariant(
    request.headers.origin === originFor(host, port),
    "INVALID_OPERATOR_REQUEST",
    "The local console Origin header is invalid",
  );
}

async function readJsonBody(request) {
  const contentType = String(request.headers["content-type"] ?? "");
  invariant(
    /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType),
    "INVALID_OPERATOR_REQUEST",
    "Mutation requests must use application/json",
  );
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    invariant(
      total <= MAX_JSON_BODY_BYTES,
      "INVALID_OPERATOR_REQUEST",
      "Mutation request body is too large",
      { maximum_bytes: MAX_JSON_BODY_BYTES },
    );
    chunks.push(buffer);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ChangeFleetError(
      "INVALID_OPERATOR_REQUEST",
      "Mutation request body is not valid JSON",
    );
  }
  invariant(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "INVALID_OPERATOR_REQUEST",
    "Mutation request body must be one JSON object",
  );
  return parsed;
}

function parseOptionalInteger(value) {
  if (value === null) return undefined;
  if (!/^[1-9][0-9]*$/u.test(value)) return value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

function applySecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; "),
  );
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload, contentType) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.end(payload);
}

function statusForError(code) {
  if (code === "CHANGE_SET_NOT_FOUND") {
    return 404;
  }
  if (code === "UNSUPPORTED_OPERATOR_OPERATION") return 405;
  if (
    new Set([
      "STALE_BUNDLE_DECISION",
      "INVALID_CHANGE_SET_STATE",
      "PLAN_CONFIRMATION_REQUIRED",
      "COMMAND_PREVIOUSLY_FAILED",
      "IDEMPOTENCY_KEY_REUSED",
      "DELIVERY_NOT_PUBLISHED",
      "BUNDLE_ACCEPTANCE_REQUIRED",
    ]).has(code)
  ) {
    return 409;
  }
  if (code.startsWith("INVALID_")) return 400;
  return 422;
}

function presentSafeConsoleError(error, locale) {
  const resolvedLocale = normalizeLocale(locale);
  return {
    code: error.code ?? "CLI_COMMAND_FAILED",
    message: diagnosticMessage(error.code ?? "CLI_COMMAND_FAILED", {
      locale: resolvedLocale,
      fallback: error.message,
    }),
    locale: resolvedLocale,
    details: null,
  };
}

function originFor(host, port) {
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}
