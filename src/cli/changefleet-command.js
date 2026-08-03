import {
  DEFAULT_LOCALE,
  diagnosticMessage,
  normalizeLocale,
} from "../domain/diagnostics.js";
import { ChangeFleetError } from "../domain/errors.js";
import {
  parseCommandLine,
  requestedCommandLocale,
} from "./command-line-arguments.js";

const INVOCATION_ERROR_CODES = new Set([
  "INVALID_CLI_INVOCATION",
  "INVALID_AUDIT_INVOCATION",
  "INVALID_CLI_CONFIG",
  "INVALID_CLI_REQUEST",
  "INVALID_OPERATOR_REQUEST",
  "UNSUPPORTED_OPERATOR_OPERATION",
  "UNSUPPORTED_CLI_RUNTIME",
]);

// 根进程统一 stdout、stderr 和退出码；按路由动态加载处理器，避免只读审计装配生命周期能力。
export async function runChangeFleetCommand(
  arguments_,
  {
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    auditExecutor = defaultAuditExecutor,
    lifecycleExecutor = defaultLifecycleExecutor,
    lifecycleDependencies = {},
  } = {},
) {
  let command = null;
  try {
    command = parseCommandLine(arguments_);
    const result =
      command.kind === "audit"
        ? await auditExecutor(command)
        : await lifecycleExecutor(command, {
            stdin,
            ...lifecycleDependencies,
          });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const locale = normalizeLocale(
      error?.presentation_locale ??
        command?.locale ??
        requestedCommandLocale(arguments_) ??
        DEFAULT_LOCALE,
    );
    stderr.write(
      `${JSON.stringify({ error: presentCommandError(error, locale) })}\n`,
    );
    return INVOCATION_ERROR_CODES.has(error?.code) ? 2 : 1;
  }
}

async function defaultAuditExecutor(command) {
  const { executeReadOnlyAudit } = await import("./read-only-audit.js");
  return executeReadOnlyAudit(command);
}

async function defaultLifecycleExecutor(command, dependencies) {
  const { executeLifecycleCommand } = await import("./lifecycle-command.js");
  return executeLifecycleCommand(command, dependencies);
}

function presentCommandError(error, locale) {
  const code =
    error instanceof ChangeFleetError ? error.code : "CLI_COMMAND_FAILED";
  return {
    code,
    message: diagnosticMessage(code, {
      locale,
      fallback: diagnosticMessage("CLI_COMMAND_FAILED", { locale }),
    }),
    locale,
    details:
      error instanceof ChangeFleetError && error.details !== undefined
        ? error.details
        : null,
  };
}
