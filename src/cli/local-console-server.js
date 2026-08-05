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
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const GET_ROUTES = Object.freeze([
  /^\/$/u,
  /^\/app\.css$/u,
  /^\/app\.js$/u,
  /^\/api\/local\/v0\/changesets$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/audit$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/delivery$/u,
]);
const POST_ROUTES = Object.freeze([
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/bundle-decisions$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/delivery\/publish$/u,
  /^\/api\/local\/v0\/changesets\/[A-Za-z0-9._-]+\/delivery\/refresh$/u,
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
      typeof queryService.listChangeSets === "function" &&
      typeof queryService.readChangeSetView === "function" &&
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

      validateSession(request, sessionNonce);
      if (request.method === "GET") {
        await handleGetApi({
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
  response,
  url,
  queryService,
  operatorApplication,
}) {
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
    /^\/api\/local\/v0\/changesets\/(?<changeSetId>[A-Za-z0-9._-]+)(?:\/(?<tail>audit|delivery))?$/u,
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
  sendJson(
    response,
    200,
    await operatorApplication.execute("changeset.delivery.read", {
      change_set_id: changeSetId,
    }),
  );
}

async function handlePostApi({
  request,
  response,
  url,
  operatorApplication,
}) {
  const match = url.pathname.match(
    /^\/api\/local\/v0\/changesets\/(?<changeSetId>[A-Za-z0-9._-]+)\/(?<tail>bundle-decisions|delivery\/publish|delivery\/refresh)$/u,
  );
  invariant(match?.groups, "CHANGE_SET_NOT_FOUND", "Route not found");
  const changeSetId = match.groups.changeSetId;
  normalizeId("change_set_id", changeSetId);
  if (match.groups.tail === "bundle-decisions") {
    const body = normalizeBundleDecisionBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.bundle.decide", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  if (match.groups.tail === "delivery/publish") {
    const body = normalizePublishBody(await readJsonBody(request));
    sendJson(
      response,
      200,
      await operatorApplication.execute("changeset.delivery.publish", {
        ...body,
        change_set_id: changeSetId,
      }),
    );
    return;
  }
  const body = normalizeRefreshBody(await readJsonBody(request));
  sendJson(
    response,
    200,
    await operatorApplication.execute("changeset.delivery.refresh", {
      ...body,
      change_set_id: changeSetId,
    }),
  );
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
