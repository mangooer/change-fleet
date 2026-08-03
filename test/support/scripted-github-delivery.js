import { DeliveryGitAdapter } from "../../src/adapters/git/delivery-git-adapter.js";
import { normalizeGithubPullRequest } from "../../src/domain/github-delivery.js";

// 测试替身只模拟 GitHub 控制面；真实 SHA 发布和目标可达性仍由本地 bare Git 远端验证。
export class FixtureBindingDeliveryGitAdapter extends DeliveryGitAdapter {
  async inspectBinding({ githubRepository }) {
    return {
      normalized_remote: githubRepository.toLowerCase(),
      remote_url: "fixture-local-bare-remote",
    };
  }
}

export class ScriptedGithubPullRequestAdapter {
  constructor({ resolveRefs }) {
    this.resolveRefs = resolveRefs;
    this.pullRequests = new Map();
    this.nextNumber = 1;
    this.createCount = 0;
  }

  async findPullRequest({ githubRepository, headBranch, targetRef }) {
    return clone(
      this.pullRequests.get(key(githubRepository, headBranch, targetRef)) ??
        null,
    );
  }

  async createPullRequest({ githubRepository, headBranch, targetRef }) {
    const refs = await this.resolveRefs({
      githubRepository,
      headBranch,
      targetRef,
    });
    const pullRequest = normalizeGithubPullRequest({
      number: this.nextNumber++,
      url: `https://github.com/${githubRepository}/pull/${this.nextNumber - 1}`,
      state: "OPEN",
      is_draft: false,
      head_sha: refs.head_sha,
      base_sha: refs.base_sha,
      merge_commit_sha: null,
      merged_at: null,
      merged_by: null,
      merge_state_status: "CLEAN",
      mergeable: "MERGEABLE",
      review_decision: null,
      checks: emptyChecks(),
    });
    this.pullRequests.set(
      key(githubRepository, headBranch, targetRef),
      pullRequest,
    );
    this.createCount += 1;
    return clone(pullRequest);
  }

  async readPullRequest({ githubRepository, number }) {
    const pullRequest = [...this.pullRequests.entries()].find(
      ([entryKey, value]) =>
        entryKey.startsWith(`${githubRepository}|`) && value.number === number,
    )?.[1];
    if (!pullRequest) throw new Error(`Missing fixture PR ${number}`);
    return clone(pullRequest);
  }

  merge({ githubRepository, headBranch, targetRef, mergeCommitSha }) {
    const entryKey = key(githubRepository, headBranch, targetRef);
    const current = this.pullRequests.get(entryKey);
    this.pullRequests.set(entryKey, {
      ...current,
      state: "merged",
      merge_commit_sha: mergeCommitSha,
      merged_at: "2026-08-03T12:00:00.000Z",
      merged_by: "fixture-reviewer",
      review_decision: "APPROVED",
    });
  }

  divergeHead({ githubRepository, headBranch, targetRef, headSha }) {
    const entryKey = key(githubRepository, headBranch, targetRef);
    const current = this.pullRequests.get(entryKey);
    this.pullRequests.set(entryKey, { ...current, head_sha: headSha });
  }

  close({ githubRepository, headBranch, targetRef }) {
    const entryKey = key(githubRepository, headBranch, targetRef);
    const current = this.pullRequests.get(entryKey);
    this.pullRequests.set(entryKey, { ...current, state: "closed" });
  }
}

function key(githubRepository, headBranch, targetRef) {
  return `${githubRepository}|${headBranch}|${targetRef}`;
}

function emptyChecks() {
  return { total: 0, successful: 0, failed: 0, pending: 0, neutral: 0 };
}

function clone(value) {
  return value === null ? null : structuredClone(value);
}
