import { runCommand } from "../adapters/filesystem/command-runner.js";
import { ChangeFleetError } from "../domain/errors.js";

// RepositoryValidator 只运行并记录一个精确 Candidate 的命令，不拥有阶段转换。
export class RepositoryValidator {
  constructor({ repositoryWorker, evidenceStore, now }) {
    this.repositoryWorker = repositoryWorker;
    this.evidenceStore = evidenceStore;
    this.now = now;
  }

  async validate({
    repository,
    candidate,
    command,
    checkIdentity,
    attemptBudget,
    environmentIdentity,
    selectionRationale,
    evidenceKind = "repository_validation",
  }) {
    // 计划命令使用选择理由；验证 Agent 追加的命令没有独立选择字段时复用覆盖理由。
    const effectiveSelectionRationale =
      selectionRationale ?? command?.coverage_rationale ?? null;
    let preflightError = null;
    try {
      await this.repositoryWorker.preflightCandidate({ repository, candidate });
    } catch (error) {
      preflightError = error;
    }
    let commandResult = null;
    let commandError = null;
    // null 是显式的“无适用项目命令”，结构预检仍必须执行，且不会启动空进程。
    if (!preflightError && command !== null) {
      try {
        commandResult = await runCommand(command, {
          cwd: candidate.workspace_path,
        });
      } catch (error) {
        commandError = error;
        commandResult = error.details?.command_result ?? null;
      }
    }
    let postflightError = null;
    if (commandResult) {
      try {
        await this.repositoryWorker.preflightCandidate({ repository, candidate });
      } catch (error) {
        postflightError = error;
      }
    }
    const evidence = await this.evidenceStore.record({
      kind: evidenceKind,
      subject: {
        repository_id: candidate.repository_id,
        target_ref: candidate.target_ref,
        base_sha: candidate.base_sha,
        candidate_sha: candidate.candidate_sha,
      },
      payload: {
        check_identity: checkIdentity,
        attempt_budget: attemptBudget,
        environment_identity: environmentIdentity,
        check_selection_rationale: effectiveSelectionRationale,
        preflight: errorProjection(preflightError),
        command:
          command === null
            ? { status: "not_applicable" }
            : commandResult ?? {
                status: "not_run",
                requested: structuredClone(command),
              },
        command_error: commandError
          ? errorProjection(commandError)
          : commandResult
            ? { status: "passed" }
            : { status: command === null ? "not_applicable" : "not_run" },
        postflight: postflightError
          ? errorProjection(postflightError)
          : commandResult
            ? { status: "passed" }
            : { status: command === null ? "not_applicable" : "not_run" },
      },
      createdAt: this.now(),
    });
    if (
      preflightError ||
      commandError ||
      (commandResult !== null &&
        (commandResult.exit_code !== 0 ||
          commandResult.timed_out ||
          commandResult.cancelled ||
          commandResult.output_overflow)) ||
      postflightError
    ) {
      const code =
        stableErrorCode(preflightError) ??
        stableErrorCode(commandError) ??
        "REPOSITORY_VALIDATION_FAILED";
      throw new ChangeFleetError(
        code,
        `Repository check failed for ${candidate.repository_id}`,
        {
          evidence,
          command_result: commandResult,
          preflight_error: stableErrorCode(preflightError),
          command_error: stableErrorCode(commandError),
          postflight_error: stableErrorCode(postflightError),
        },
      );
    }
    return evidence;
  }
}

function errorProjection(error) {
  return error
    ? {
        status: "failed",
        code: stableErrorCode(error) ?? "UNEXPECTED_ERROR",
        message: String(error.message ?? "Validation failed").slice(0, 2_048),
      }
    : { status: "passed" };
}

function stableErrorCode(error) {
  return typeof error?.code === "string" && error.code.length > 0
    ? error.code
    : null;
}
