import path from "node:path";

import { RuntimeAuditQueryService } from "../application/runtime-audit-query-service.js";
import { ControlStore } from "../adapters/filesystem/control-store.js";
import { EvidenceStore } from "../adapters/filesystem/evidence-store.js";
import { RunStore } from "../adapters/filesystem/run-store.js";
import {
  DEFAULT_LOCALE,
  diagnosticMessage,
} from "../domain/diagnostics.js";
import { ChangeFleetError } from "../domain/errors.js";
import { normalizeId } from "../domain/model.js";

const SUPPORTED_LOCALES = new Set(["zh-CN", "en"]);
const SUBJECTS = new Set(["run", "changeset"]);
const COMMON_OPTIONS = new Set(["--control-root", "--locale"]);
const CHANGE_SET_OPTIONS = new Set([
  ...COMMON_OPTIONS,
  "--detail-page",
  "--page-size",
]);

// 参数解析只构造内存中的查询描述，不读取控制目录，确保无效调用先于任何 I/O 失败。
export function parseAuditArguments(arguments_) {
  if (!Array.isArray(arguments_)) {
    throw invalidInvocation("arguments_not_array");
  }

  const [subject, subjectId, ...optionArguments] = arguments_;
  if (!SUBJECTS.has(subject)) {
    throw invalidInvocation("unsupported_subject");
  }
  if (typeof subjectId !== "string" || subjectId.startsWith("--")) {
    throw invalidInvocation("missing_subject_id");
  }
  validateSubjectId(subject, subjectId);

  const allowedOptions = subject === "changeset" ? CHANGE_SET_OPTIONS : COMMON_OPTIONS;
  const options = new Map();
  for (let index = 0; index < optionArguments.length; index += 2) {
    const option = optionArguments[index];
    const value = optionArguments[index + 1];
    if (!allowedOptions.has(option)) {
      throw invalidInvocation("unsupported_option", { option });
    }
    if (options.has(option)) {
      throw invalidInvocation("duplicate_option", { option });
    }
    if (typeof value !== "string" || value.startsWith("--")) {
      throw invalidInvocation("missing_option_value", { option });
    }
    options.set(option, value);
  }

  const controlRoot = options.get("--control-root");
  if (typeof controlRoot !== "string" || controlRoot.trim().length === 0) {
    throw invalidInvocation("missing_control_root");
  }

  const locale = options.get("--locale") ?? DEFAULT_LOCALE;
  if (!SUPPORTED_LOCALES.has(locale)) {
    throw invalidInvocation("unsupported_locale", { option: "--locale" });
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
        { maximum: 100 },
      );
    }
  }

  return {
    subject,
    subject_id: subjectId,
    control_root: path.resolve(controlRoot),
    locale,
    query,
  };
}

// 进程边界捕获所有异常并返回明确状态，避免默认堆栈或进度文本污染 JSON 输出。
export async function runLocalAuditCommand(
  arguments_,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let locale = requestedLocale(arguments_);
  try {
    const command = parseAuditArguments(arguments_);
    locale = command.locale;
    const queryService = createReadOnlyAuditQuery(command.control_root, locale);
    const projection =
      command.subject === "run"
        ? await queryService.getRunAudit(command.subject_id)
        : await queryService.getChangeSetAudit(command.subject_id, command.query);
    stdout.write(`${JSON.stringify(projection)}\n`);
    return 0;
  } catch (error) {
    const invalid = error?.code === "INVALID_AUDIT_INVOCATION";
    stderr.write(`${JSON.stringify({ error: presentCommandError(error, locale) })}\n`);
    return invalid ? 2 : 1;
  }
}

function createReadOnlyAuditQuery(controlRoot, locale) {
  const controlStore = new ControlStore(controlRoot);
  const runStore = new RunStore(controlRoot);
  const evidenceStore = new EvidenceStore(controlRoot);

  // 查询服务仅拿到绑定后的 read 方法；Store 的初始化和写方法不会跨过此组合边界。
  return new RuntimeAuditQueryService({
    controlStore: Object.freeze({
      readChangeSet: controlStore.readChangeSet.bind(controlStore),
    }),
    runStore: Object.freeze({ read: runStore.read.bind(runStore) }),
    evidenceStore: Object.freeze({ read: evidenceStore.read.bind(evidenceStore) }),
    locale,
  });
}

function validateSubjectId(subject, subjectId) {
  try {
    normalizeId(subject === "run" ? "run_id" : "change_set_id", subjectId);
  } catch (error) {
    if (error?.code !== "INVALID_ID") throw error;
    throw invalidInvocation("invalid_subject_id");
  }
}

function parsePositiveInteger(option, value, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw invalidInvocation("invalid_positive_integer", { option });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw invalidInvocation("integer_out_of_range", { option, maximum });
  }
  return parsed;
}

function invalidInvocation(reason, details = {}) {
  return new ChangeFleetError(
    "INVALID_AUDIT_INVOCATION",
    "Local audit command arguments are invalid",
    {
      reason,
      ...Object.fromEntries(
        Object.entries(details).map(([key, value]) => [
          key,
          typeof value === "string" ? value.slice(0, 128) : value,
        ]),
      ),
    },
  );
}

function requestedLocale(arguments_) {
  if (!Array.isArray(arguments_)) return DEFAULT_LOCALE;
  const index = arguments_.indexOf("--locale");
  const candidate = index === -1 ? null : arguments_[index + 1];
  return SUPPORTED_LOCALES.has(candidate) ? candidate : DEFAULT_LOCALE;
}

function presentCommandError(error, locale) {
  const code =
    error instanceof ChangeFleetError
      ? error.code
      : "AUDIT_COMMAND_FAILED";
  const genericMessage = diagnosticMessage("AUDIT_COMMAND_FAILED", { locale });
  return {
    code,
    message: diagnosticMessage(code, { locale, fallback: genericMessage }),
    locale,
    details:
      error instanceof ChangeFleetError && error.details !== undefined
        ? error.details
        : null,
  };
}
