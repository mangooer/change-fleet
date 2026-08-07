import { DEFAULT_LOCALE, diagnosticMessage, normalizeLocale } from "./diagnostics.js";

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
  // 次级清理或审计失败不能覆盖主错误，但必须随主错误进入有界终态信封。
  primaryError.secondary_failures ??= [];
  primaryError.secondary_failures.push({
    stage,
    code: secondaryError?.code ?? "UNEXPECTED_ERROR",
    message: secondaryError?.message ?? String(secondaryError),
  });
  return primaryError;
}

export async function preserveSecondaryFailure(primaryError, stage, operation) {
  // 审计或清理写入失败不会覆盖最初的业务错误，但会随主错误返回。
  try {
    await operation();
  } catch (secondaryError) {
    attachSecondaryFailure(primaryError, stage, secondaryError);
  }
}
