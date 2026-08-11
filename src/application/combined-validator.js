import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalize, sha256 } from "../domain/canonical-json.js";
import { ChangeFleetError } from "../domain/errors.js";
import { candidateIdentity } from "../domain/model.js";
import { writeJsonFileAtomic } from "../adapters/filesystem/atomic-json-file.js";
import { runCommand } from "../adapters/filesystem/command-runner.js";

// 联合验证绑定精确 Candidate 集合；工作区路径只用于调用定位，不进入主体哈希。
export class CombinedValidator {
  constructor({
    controlRoot,
    repositoryWorker,
    evidenceStore,
    clock = () => new Date(),
  }) {
    this.validationsRoot = path.join(
      path.resolve(controlRoot),
      "validations",
    );
    this.repositoryWorker = repositoryWorker;
    this.evidenceStore = evidenceStore;
    this.clock = clock;
  }

  async validate({
    subject,
    candidates,
    repositories,
    command,
    checkIdentity,
    attemptBudget,
    environmentIdentity,
    selectionRationale,
  }) {
    // 组合验证始终生成精确 manifest；命令为空时它只承载结构证据和选择理由。
    const effectiveSelectionRationale =
      selectionRationale ?? command?.coverage_rationale ?? null;
    const validationDirectory = path.join(
      this.validationsRoot,
      subject.validation_subject_hash,
    );
    await mkdir(validationDirectory, { recursive: true });
    const manifest = {
      schema_version: 1,
      change_set_id: subject.change_set_id,
      plan_revision: subject.plan_revision,
      validation_subject_hash: subject.validation_subject_hash,
      candidates: candidates
        .map((candidate) => ({
          ...candidateIdentity(candidate),
          workspace_path: candidate.workspace_path,
        }))
        .sort((left, right) =>
          left.repository_id.localeCompare(right.repository_id),
        ),
    };
    const manifestPath = path.join(validationDirectory, "manifest.json");
    await writeJsonFileAtomic(manifestPath, manifest);
    const manifestBytes = await readFile(manifestPath);
    let preflightError = null;
    for (const candidate of candidates) {
      try {
        await this.repositoryWorker.preflightCandidate({
          repository: repositories[candidate.repository_id],
          candidate,
        });
      } catch (error) {
        preflightError ??= error;
      }
    }

    let commandResult = null;
    let commandError = null;
    // 无语义命令时不启动进程，但所有 Candidate 的结构预检仍是强制门禁。
    if (!preflightError && command !== null) {
      try {
        commandResult = await runCommand(command, {
          cwd: validationDirectory,
          environment: {
            CHANGEFLEET_VALIDATION_MANIFEST: manifestPath,
          },
        });
      } catch (error) {
        commandError = error;
        commandResult = error.details?.command_result ?? null;
      }
    }

    // 即使命令返回成功，也必须复检所有工作区，任何修改都会使整体验证失败。
    let postflightError = null;
    if (commandResult) {
      for (const candidate of candidates) {
        try {
          await this.repositoryWorker.preflightCandidate({
            repository: repositories[candidate.repository_id],
            candidate,
          });
        } catch (error) {
          postflightError ??= error;
        }
      }
    }

    const evidence = await this.evidenceStore.record({
      kind: "combined_validation",
      subject: {
        validation_subject_hash: subject.validation_subject_hash,
      },
      payload: {
        check_identity: checkIdentity,
        attempt_budget: attemptBudget,
        environment_identity: environmentIdentity,
        check_selection_rationale: effectiveSelectionRationale,
        manifest_hash: sha256(manifestBytes),
        manifest: canonicalize(manifest),
        preflight: errorProjection(preflightError),
        command:
          command === null
            ? { status: "not_applicable" }
            : commandResult ?? {
                status: "not_run",
                requested: canonicalize(command),
              },
        command_error: commandError
          ? errorProjection(commandError)
          : commandResult
            ? { status: "passed" }
            : { status: command === null ? "not_applicable" : "not_run" },
        postflight: postflightError
          ? {
              status: "failed",
              code: postflightError.code,
              message: postflightError.message,
            }
          : commandResult
            ? { status: "passed" }
            : { status: command === null ? "not_applicable" : "not_run" },
      },
      createdAt: this.clock().toISOString(),
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
        "COMBINED_VALIDATION_FAILED";
      throw new ChangeFleetError(
        code,
        "Combined validation did not pass for the exact Candidate set",
        {
          evidence,
          command_result: commandResult,
          preflight_error: preflightError?.code,
          command_error: commandError?.code,
          postflight_error: postflightError?.code,
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
