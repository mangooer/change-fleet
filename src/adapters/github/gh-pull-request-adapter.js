import { runCommand } from "../filesystem/command-runner.js";
import { sha256 } from "../../domain/canonical-json.js";
import { ChangeFleetError, invariant } from "../../domain/errors.js";
import {
  branchNameFromTargetRef,
  normalizeGithubDeliveryBindingRequest,
  normalizeGithubPullRequest,
} from "../../domain/github-delivery.js";

const PR_FIELDS = [
  "number",
  "url",
  "state",
  "isDraft",
  "headRefOid",
  "baseRefOid",
  "mergeCommit",
  "mergeStateStatus",
  "mergeable",
  "mergedAt",
  "mergedBy",
  "reviewDecision",
  "statusCheckRollup",
].join(",");

// gh 适配器只把官方 CLI JSON 规范化为有界 PR 观察，不保存凭据也不执行 merge。
export class GhPullRequestAdapter {
  constructor({
    executable = "gh",
    commandRunner = runCommand,
    timeoutMs = 30_000,
  } = {}) {
    this.executable = executable;
    this.commandRunner = commandRunner;
    this.timeoutMs = timeoutMs;
  }

  async findPullRequest({ githubRepository, headBranch, targetRef }) {
    const repository = normalizeRepository(githubRepository);
    const baseBranch = branchNameFromTargetRef(targetRef);
    const result = await this.run("github-pr-list", [
      "pr",
      "list",
      "--repo",
      repository,
      "--head",
      headBranch,
      "--base",
      baseBranch,
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      PR_FIELDS,
    ]);
    const rows = parseJson(result.stdout, "array");
    invariant(
      rows.length <= 1,
      "AMBIGUOUS_GITHUB_PULL_REQUEST",
      "More than one GitHub pull request matches the exact delivery branch",
      { observed_count: rows.length },
    );
    return rows.length === 0 ? null : normalizeRawPullRequest(rows[0]);
  }

  async createPullRequest({
    githubRepository,
    headBranch,
    targetRef,
    title,
    body,
  }) {
    const repository = normalizeRepository(githubRepository);
    const normalizedTitle = boundedRequiredString(title, "title", 256);
    const normalizedBody = boundedOptionalString(body, "body", 16 * 1024);
    try {
      await this.run("github-pr-create", [
        "pr",
        "create",
        "--repo",
        repository,
        "--head",
        headBranch,
        "--base",
        branchNameFromTargetRef(targetRef),
        "--title",
        normalizedTitle,
        "--body",
        normalizedBody,
      ]);
    } catch (error) {
      // 外部创建成功但本地未收到结果时，先按精确 head/base 恢复，避免盲目再建 PR。
      let recovered = null;
      try {
        recovered = await this.findPullRequest({
          githubRepository: repository,
          headBranch,
          targetRef,
        });
      } catch (recoveryError) {
        // 恢复查询失败不能覆盖首次创建错误，但必须随主错误返回给审计边界。
        error.secondary_failures ??= [];
        error.secondary_failures.push({
          stage: "github_pull_request_recovery",
          code: recoveryError?.code ?? "UNEXPECTED_ERROR",
          message: recoveryError?.message ?? String(recoveryError),
        });
      }
      if (recovered) return recovered;
      throw error;
    }
    const created = await this.findPullRequest({
      githubRepository: repository,
      headBranch,
      targetRef,
    });
    invariant(
      created,
      "GITHUB_PULL_REQUEST_NOT_FOUND",
      "GitHub did not return the newly created pull request",
    );
    return created;
  }

  async readPullRequest({ githubRepository, number }) {
    const repository = normalizeRepository(githubRepository);
    invariant(
      Number.isSafeInteger(number) && number >= 1,
      "INVALID_GITHUB_PULL_REQUEST",
      "GitHub pull request number is invalid",
    );
    const result = await this.run("github-pr-view", [
      "pr",
      "view",
      String(number),
      "--repo",
      repository,
      "--json",
      PR_FIELDS,
    ]);
    return normalizeRawPullRequest(parseJson(result.stdout, "object"));
  }

  async run(commandId, argv) {
    const result = await this.commandRunner({
      command_id: commandId,
      executable: this.executable,
      argv,
      timeout_ms: this.timeoutMs,
    });
    if (
      result.exit_code !== 0 ||
      result.signal !== null ||
      result.timed_out ||
      result.cancelled ||
      result.output_overflow
    ) {
      throw new ChangeFleetError(
        "GITHUB_COMMAND_FAILED",
        `GitHub command ${commandId} failed`,
        {
          command_id: commandId,
          exit_code: result.exit_code,
          signal: result.signal,
          timed_out: result.timed_out,
          cancelled: result.cancelled,
          output_overflow: result.output_overflow,
          // gh 错误可能包含宿主细节；稳定摘要足够审计，正文不进入状态或 CLI 输出。
          stderr_sha256: sha256(String(result.stderr ?? "")),
          stderr_bytes: Buffer.byteLength(String(result.stderr ?? "")),
        },
      );
    }
    return result;
  }
}

function normalizeRepository(value) {
  return normalizeGithubDeliveryBindingRequest({
    github_repository: value,
    push_remote: "validated",
  }).github_repository;
}

function normalizeRawPullRequest(value) {
  const checks = summarizeChecks(value.statusCheckRollup ?? []);
  return normalizeGithubPullRequest({
    number: value.number,
    url: value.url,
    state: value.state,
    is_draft: value.isDraft,
    head_sha: value.headRefOid,
    base_sha: value.baseRefOid,
    merge_commit_sha: value.mergeCommit?.oid ?? null,
    merged_at: value.mergedAt ?? null,
    merged_by: value.mergedBy?.login ?? null,
    merge_state_status: value.mergeStateStatus ?? null,
    mergeable: value.mergeable ?? null,
    review_decision: value.reviewDecision ?? null,
    checks,
  });
}

function summarizeChecks(rows) {
  invariant(
    Array.isArray(rows),
    "INVALID_GITHUB_RESPONSE",
    "GitHub status check rollup must be an array",
  );
  const result = {
    total: rows.length,
    successful: 0,
    failed: 0,
    pending: 0,
    neutral: 0,
  };
  for (const row of rows) {
    const state = String(
      row?.conclusion ?? row?.state ?? row?.status ?? "",
    ).toUpperCase();
    if (new Set(["SUCCESS", "EXPECTED"]).has(state)) result.successful += 1;
    else if (
      new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"]).has(
        state,
      )
    ) {
      result.failed += 1;
    } else if (
      new Set(["NEUTRAL", "SKIPPED", "STALE"]).has(state)
    ) {
      result.neutral += 1;
    } else result.pending += 1;
  }
  return result;
}

function parseJson(value, expected) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ChangeFleetError(
      "INVALID_GITHUB_RESPONSE",
      "GitHub command returned invalid JSON",
    );
  }
  invariant(
    expected === "array"
      ? Array.isArray(parsed)
      : parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "INVALID_GITHUB_RESPONSE",
    `GitHub command did not return one ${expected}`,
  );
  return parsed;
}

function boundedRequiredString(value, field, maximum) {
  invariant(
    typeof value === "string" &&
      value.trim().length >= 1 &&
      value.length <= maximum,
    "INVALID_GITHUB_PULL_REQUEST_TEXT",
    `GitHub pull request ${field} is invalid`,
  );
  return value.trim();
}

function boundedOptionalString(value, field, maximum) {
  if (value === null || value === undefined) return "";
  invariant(
    typeof value === "string" && value.length <= maximum,
    "INVALID_GITHUB_PULL_REQUEST_TEXT",
    `GitHub pull request ${field} is invalid`,
  );
  return value;
}
