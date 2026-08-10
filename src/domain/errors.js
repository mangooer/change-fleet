import { DEFAULT_LOCALE, diagnosticMessage, normalizeLocale } from "./diagnostics.js";

const MAX_SECONDARY_FAILURES = 8;
const MAX_SECONDARY_STAGE_BYTES = 128;
const MAX_SECONDARY_CODE_BYTES = 128;
const MAX_SECONDARY_MESSAGE_BYTES = 1_024;
const MAX_FAILURE_DIAGNOSTIC_BYTES = 128;

export class ChangeFleetError extends Error {
  // code 是持久且可供程序判断的契约；message 只是当前语言下给人的展示文本。
  constructor(code, fallbackMessage, details = undefined, { locale = DEFAULT_LOCALE } = {}) {
    const resolvedLocale = normalizeLocale(locale);
    super(diagnosticMessage(code, { locale: resolvedLocale, fallback: fallbackMessage }));
    this.name = "ChangeFleetError";
    this.code = code;
    this.details = details;
    this.locale = resolvedLocale;
  }
}

export function invariant(condition, code, message, details = undefined, options = undefined) {
  // 所有边界检查统一产生带稳定 code、结构化 details 和本地化 message 的错误。
  if (!condition) {
    throw new ChangeFleetError(code, message, details, options);
  }
}

export function wrapError(error, code, message, details = undefined) {
  // 保留原始 cause 供审计排障，同时不给上层泄漏不稳定的底层错误类型。
  if (error instanceof ChangeFleetError) {
    return error;
  }
  const wrapped = new ChangeFleetError(code, message, details);
  wrapped.cause = error;
  return wrapped;
}

export function attachSecondaryFailure(primaryError, stage, secondaryError) {
  // 次级错误最多保留固定条数和字节，不能借错误正文无限放大聚合或事件记录。
  const failures = boundedSecondaryFailures(primaryError.secondary_failures);
  if (failures.length < MAX_SECONDARY_FAILURES) {
    failures.push(normalizeSecondaryFailure({
      stage,
      code: secondaryError?.code ?? "UNEXPECTED_ERROR",
      message: secondaryError?.message ?? String(secondaryError),
    }));
  }
  primaryError.secondary_failures = failures;
  return primaryError;
}

export function boundedSecondaryFailures(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_SECONDARY_FAILURES)
    .map(normalizeSecondaryFailure);
}

// 主失败只允许少量稳定分类字段进入持久 Run；Provider 正文、堆栈和任意 details
// 仍不得借诊断路径进入聚合状态或默认审计视图。
export function boundedFailureDiagnostic(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const stage = boundedDiagnosticField(details.stage);
  const rule = boundedDiagnosticField(details.rule);
  if (stage === null && rule === null) return null;
  return {
    stage: stage ?? "unknown",
    rule: rule ?? "unknown",
  };
}

export async function preserveSecondaryFailure(primaryError, stage, operation) {
  // 审计或清理写入失败不会覆盖最初的业务错误，但会随主错误返回。
  try {
    await operation();
  } catch (secondaryError) {
    attachSecondaryFailure(primaryError, stage, secondaryError);
  }
}

function normalizeSecondaryFailure(input) {
  return {
    stage: truncateUtf8(input?.stage ?? "unknown", MAX_SECONDARY_STAGE_BYTES),
    code: truncateUtf8(
      input?.code ?? "UNEXPECTED_ERROR",
      MAX_SECONDARY_CODE_BYTES,
    ),
    message: truncateUtf8(
      input?.message ?? "Unexpected secondary failure",
      MAX_SECONDARY_MESSAGE_BYTES,
    ),
  };
}

function truncateUtf8(value, maximumBytes) {
  const text = String(value);
  if (Buffer.byteLength(text, "utf8") <= maximumBytes) return text;
  let result = "";
  let bytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function boundedDiagnosticField(value) {
  return typeof value === "string" && value.length > 0
    ? truncateUtf8(value, MAX_FAILURE_DIAGNOSTIC_BYTES)
    : null;
}
