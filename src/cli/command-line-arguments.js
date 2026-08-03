import path from "node:path";

import { DEFAULT_LOCALE } from "../domain/diagnostics.js";
import { ChangeFleetError } from "../domain/errors.js";
import { normalizeId } from "../domain/model.js";

const SUPPORTED_LOCALES = new Set(["zh-CN", "en"]);
const LIFECYCLE_ROUTES = Object.freeze([
  route(
    ["project", "github-delivery", "configure"],
    "project.repository_delivery.github.configure",
  ),
  route(
    ["project", "repository-policy", "revise"],
    "project.repository_workspace_policy.revise",
  ),
  route(["project", "register"], "project.register"),
  route(
    ["changeset", "repository-selection", "revise"],
    "changeset.repository_selection.revise",
  ),
  route(
    ["changeset", "harness-selection", "revise"],
    "changeset.repository_harness_selection.revise",
  ),
  route(["changeset", "plan", "confirm"], "changeset.plan.confirm"),
  route(["changeset", "bundle", "decide"], "changeset.bundle.decide"),
  route(["changeset", "delivery", "publish"], "changeset.delivery.publish"),
  route(["changeset", "delivery", "refresh"], "changeset.delivery.refresh"),
  route(["changeset", "create"], "changeset.create"),
  route(["changeset", "plan"], "changeset.plan"),
  route(["changeset", "execute"], "changeset.execute"),
]);

// 解析器只决定显式路由和输入位置；应用请求的领域含义仍由既有应用服务校验。
export function parseCommandLine(arguments_) {
  if (!Array.isArray(arguments_)) throw invalidCli("arguments_not_array");
  if (
    arguments_[0] === "debug" &&
    arguments_[1] === "audit"
  ) {
    return parseAuditCommand(arguments_.slice(2));
  }
  if (
    arguments_[0] === "changeset" &&
    arguments_[1] === "delivery" &&
    arguments_[2] === "show"
  ) {
    return parseDeliveryRead(arguments_.slice(3));
  }
  if (
    arguments_[0] === "changeset" &&
    arguments_[1] === "show"
  ) {
    return parseChangeSetRead(arguments_.slice(2));
  }
  for (const candidate of LIFECYCLE_ROUTES) {
    if (startsWith(arguments_, candidate.tokens)) {
      return parseMutation(
        candidate,
        arguments_.slice(candidate.tokens.length),
      );
    }
  }
  throw invalidCli("unsupported_command");
}

function parseDeliveryRead(arguments_) {
  const [changeSetId, ...optionArguments] = arguments_;
  validateSubjectId("change_set_id", changeSetId, invalidCli);
  const options = parseOptions(
    optionArguments,
    new Set(["--config"]),
    invalidCli,
  );
  return {
    kind: "lifecycle",
    operation: "changeset.delivery.read",
    config_path: requireOption(options, "--config", invalidCli),
    request: { change_set_id: changeSetId },
  };
}

export function requestedCommandLocale(arguments_) {
  if (!Array.isArray(arguments_)) return DEFAULT_LOCALE;
  const index = arguments_.indexOf("--locale");
  const candidate = index === -1 ? null : arguments_[index + 1];
  return SUPPORTED_LOCALES.has(candidate) ? candidate : DEFAULT_LOCALE;
}

function parseMutation(candidate, optionArguments) {
  const options = parseOptions(
    optionArguments,
    new Set(["--config", "--request"]),
    invalidCli,
  );
  return {
    kind: "lifecycle",
    operation: candidate.operation,
    config_path: requireOption(options, "--config", invalidCli),
    request_source: requireOption(options, "--request", invalidCli),
  };
}

function parseChangeSetRead(arguments_) {
  const [changeSetId, ...optionArguments] = arguments_;
  validateSubjectId("change_set_id", changeSetId, invalidCli);
  const options = parseOptions(
    optionArguments,
    new Set(["--config"]),
    invalidCli,
  );
  return {
    kind: "lifecycle",
    operation: "changeset.read",
    config_path: requireOption(options, "--config", invalidCli),
    request: { change_set_id: changeSetId },
  };
}

function parseAuditCommand(arguments_) {
  const [subject, subjectId, ...optionArguments] = arguments_;
  if (!new Set(["run", "changeset"]).has(subject)) {
    throw invalidAudit("unsupported_subject");
  }
  validateSubjectId(
    subject === "run" ? "run_id" : "change_set_id",
    subjectId,
    invalidAudit,
  );
  const allowed = new Set(["--control-root", "--locale"]);
  if (subject === "changeset") {
    allowed.add("--detail-page");
    allowed.add("--page-size");
  }
  const options = parseOptions(optionArguments, allowed, invalidAudit);
  const locale = options.get("--locale") ?? DEFAULT_LOCALE;
  if (!SUPPORTED_LOCALES.has(locale)) {
    throw invalidAudit("unsupported_locale", { option: "--locale" });
  }
  const query = {};
  if (subject === "changeset") {
    if (options.has("--detail-page")) {
      query.detail_page = parsePositiveInteger(
        "--detail-page",
        options.get("--detail-page"),
      );
    }
    if (options.has("--page-size")) {
      query.page_size = parsePositiveInteger(
        "--page-size",
        options.get("--page-size"),
        100,
      );
    }
  }
  return {
    kind: "audit",
    subject,
    subject_id: subjectId,
    control_root: path.resolve(
      requireOption(options, "--control-root", invalidAudit),
    ),
    locale,
    query,
  };
}

function parseOptions(arguments_, allowed, errorFactory) {
  if (arguments_.length % 2 !== 0) {
    throw errorFactory("missing_option_value", {
      option: boundedString(arguments_.at(-1)),
    });
  }
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(option)) {
      throw errorFactory("unsupported_option", {
        option: boundedString(option),
      });
    }
    if (options.has(option)) {
      throw errorFactory("duplicate_option", { option });
    }
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw errorFactory("missing_option_value", { option });
    }
    options.set(option, value);
  }
  return options;
}

function requireOption(options, option, errorFactory) {
  const value = options.get(option);
  if (typeof value !== "string" || value.length === 0) {
    throw errorFactory("missing_required_option", { option });
  }
  return value;
}

function validateSubjectId(label, value, errorFactory) {
  if (typeof value !== "string" || value.startsWith("--")) {
    throw errorFactory("missing_subject_id");
  }
  try {
    normalizeId(label, value);
  } catch (error) {
    if (error?.code !== "INVALID_ID") throw error;
    throw errorFactory("invalid_subject_id");
  }
}

function parsePositiveInteger(option, value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw invalidAudit("invalid_positive_integer", { option });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw invalidAudit("integer_out_of_range", { option, maximum });
  }
  return parsed;
}

function route(tokens, operation) {
  return Object.freeze({ tokens: Object.freeze(tokens), operation });
}

function startsWith(values, prefix) {
  return prefix.every((value, index) => values[index] === value);
}

function invalidCli(reason, details = {}) {
  return invocationError("INVALID_CLI_INVOCATION", reason, details);
}

function invalidAudit(reason, details = {}) {
  return invocationError("INVALID_AUDIT_INVOCATION", reason, details);
}

function invocationError(code, reason, details) {
  return new ChangeFleetError(code, "Local command arguments are invalid", {
    reason,
    ...Object.fromEntries(
      Object.entries(details).map(([key, value]) => [
        key,
        typeof value === "string" ? boundedString(value) : value,
      ]),
    ),
  });
}

function boundedString(value) {
  return String(value ?? "").slice(0, 128);
}
