import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { normalizeAgentProfile } from "../domain/agent-profile.js";
import { ChangeFleetError } from "../domain/errors.js";
import { DEFAULT_LOCALE } from "../domain/diagnostics.js";

const CONFIG_MAX_BYTES = 64 * 1024;
const REQUEST_MAX_BYTES = 1024 * 1024;
const SUPPORTED_LOCALES = new Set(["zh-CN", "en"]);
const CREDENTIAL_SOURCES = new Set([
  "local_codex_home",
  "openai_api_key",
]);

// 本地配置只描述可复现且非敏感的装配选择；未知字段一律拒绝，避免悄悄接受凭据或宿主路径。
export async function loadLocalCliConfig(
  configPath,
  { readFileImpl = readFile } = {},
) {
  if (typeof configPath !== "string" || configPath.trim().length === 0) {
    throw invalidConfig("missing_config_path");
  }
  const absolutePath = path.resolve(configPath);
  const input = await readJsonFile(absolutePath, {
    maximumBytes: CONFIG_MAX_BYTES,
    code: "INVALID_CLI_CONFIG",
    reasonPrefix: "config",
    readFileImpl,
  });

  let locale = DEFAULT_LOCALE;
  try {
    requirePlainObject(input, "config_not_object", invalidConfig);
    requireExactKeys(
      input,
      [
        "schema_version",
        "control_root",
        "workspace_root",
        "locale",
        "runtime",
        "agent_profile",
      ],
      invalidConfig,
    );
    if (input.locale !== undefined) {
      if (!SUPPORTED_LOCALES.has(input.locale)) {
        throw invalidConfig("unsupported_locale", { field: "locale" });
      }
      locale = input.locale;
    }
    if (input.schema_version !== 1) {
      throw invalidConfig("unsupported_schema_version", {
        field: "schema_version",
      });
    }
    const controlRoot = requirePath(
      input.control_root,
      "control_root",
      absolutePath,
    );
    const workspaceRoot = requirePath(
      input.workspace_root,
      "workspace_root",
      absolutePath,
    );

    requirePlainObject(input.runtime, "runtime_not_object", invalidConfig);
    requireExactKeys(
      input.runtime,
      ["adapter", "credential_source"],
      invalidConfig,
      "runtime",
    );
    if (input.runtime.adapter !== "codex-sdk") {
      throw invalidConfig("unsupported_runtime_adapter", {
        field: "runtime.adapter",
      });
    }
    if (!CREDENTIAL_SOURCES.has(input.runtime.credential_source)) {
      throw invalidConfig("unsupported_credential_source", {
        field: "runtime.credential_source",
      });
    }

    requirePlainObject(
      input.agent_profile,
      "agent_profile_not_object",
      invalidConfig,
    );
    requireExactKeys(
      input.agent_profile,
      [
        "profile_id",
        "revision",
        "provider",
        "runtime",
        "model",
        "reasoning",
        "permissions",
        "network_access",
        "skills",
        "credential_profile_id",
      ],
      invalidConfig,
      "agent_profile",
    );
    let agentProfile;
    try {
      agentProfile = normalizeAgentProfile(input.agent_profile);
    } catch (error) {
      throw invalidConfig("invalid_agent_profile", {
        cause_code: boundedString(error?.code ?? "INVALID_AGENT_PROFILE"),
      });
    }
    if (
      agentProfile.provider !== "openai" ||
      agentProfile.runtime !== "codex-sdk"
    ) {
      throw invalidConfig("profile_runtime_mismatch", {
        field: "agent_profile",
      });
    }
    if (agentProfile.credential_profile_id === null) {
      throw invalidConfig("credential_profile_required", {
        field: "agent_profile.credential_profile_id",
      });
    }

    return Object.freeze({
      schema_version: 1,
      control_root: controlRoot,
      workspace_root: workspaceRoot,
      locale,
      runtime: Object.freeze({
        adapter: "codex-sdk",
        credential_source: input.runtime.credential_source,
      }),
      agent_profile: Object.freeze(agentProfile),
    });
  } catch (error) {
    if (error instanceof ChangeFleetError) {
      error.presentation_locale = locale;
    }
    throw error;
  }
}

// 请求文件保持应用层字段原样；这里只负责有界读取和 JSON 对象形状，不复制领域校验。
export async function loadStructuredRequest(
  source,
  { readFileImpl = readFile, stdin = process.stdin } = {},
) {
  if (typeof source !== "string" || source.length === 0) {
    throw invalidRequest("missing_request_source");
  }
  const input =
    source === "-"
      ? await readJsonStream(stdin, REQUEST_MAX_BYTES)
      : await readJsonFile(path.resolve(source), {
          maximumBytes: REQUEST_MAX_BYTES,
          code: "INVALID_CLI_REQUEST",
          reasonPrefix: "request",
          readFileImpl,
        });
  requirePlainObject(input, "request_not_object", invalidRequest);
  return input;
}

export function defaultLocalCodexHome(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, ".codex");
}

async function readJsonFile(
  filePath,
  { maximumBytes, code, reasonPrefix, readFileImpl },
) {
  let body;
  try {
    body = await readFileImpl(filePath);
  } catch {
    throw new ChangeFleetError(code, `${reasonPrefix} file could not be read`, {
      reason: `${reasonPrefix}_read_failed`,
    });
  }
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (buffer.length > maximumBytes) {
    throw new ChangeFleetError(code, `${reasonPrefix} file is too large`, {
      reason: `${reasonPrefix}_too_large`,
      maximum_bytes: maximumBytes,
    });
  }
  return parseJson(buffer.toString("utf8"), code, `${reasonPrefix}_json_invalid`);
}

async function readJsonStream(stream, maximumBytes) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maximumBytes) {
        throw invalidRequest("request_too_large", {
          maximum_bytes: maximumBytes,
        });
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof ChangeFleetError) throw error;
    throw invalidRequest("request_read_failed");
  }
  return parseJson(
    Buffer.concat(chunks).toString("utf8"),
    "INVALID_CLI_REQUEST",
    "request_json_invalid",
  );
}

function parseJson(body, code, reason) {
  try {
    return JSON.parse(body);
  } catch {
    throw new ChangeFleetError(code, "Structured JSON input is invalid", {
      reason,
    });
  }
}

function requirePlainObject(value, reason, errorFactory) {
  if (!isPlainObject(value)) throw errorFactory(reason);
}

function requireExactKeys(value, allowed, errorFactory, prefix = "") {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw errorFactory("unknown_field", {
        field: boundedString(prefix ? `${prefix}.${key}` : key),
      });
    }
  }
  for (const key of allowed) {
    if (key !== "locale" && !Object.hasOwn(value, key)) {
      throw errorFactory("missing_field", {
        field: boundedString(prefix ? `${prefix}.${key}` : key),
      });
    }
  }
}

function requirePath(value, field, configPath) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidConfig("invalid_path", { field });
  }
  return path.resolve(path.dirname(configPath), value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidConfig(reason, details = {}) {
  return new ChangeFleetError(
    "INVALID_CLI_CONFIG",
    "Local CLI configuration is invalid",
    { reason, ...details },
  );
}

function invalidRequest(reason, details = {}) {
  return new ChangeFleetError(
    "INVALID_CLI_REQUEST",
    "Local CLI request is invalid",
    { reason, ...details },
  );
}

function boundedString(value) {
  return String(value).slice(0, 128);
}
