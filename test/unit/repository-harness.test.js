import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  normalizeRepositoryHarnessSelectionRequest,
  normalizeRepositoryWorkspacePolicy,
} from "../../src/domain/repository-harness.js";

describe("Repository Harness policy model", () => {
  test("normalizes an explicit immutable Harness policy", () => {
    assert.deepEqual(
      normalizeRepositoryWorkspacePolicy(
        {
          purpose: "repository_harness",
          selector: "explicit_patterns",
          patterns: [".agents/skills/**", "!**/.env"],
        },
        {
          revision: 1,
          confirmedAt: "2026-07-31T00:00:00.000Z",
          actor: "human",
        },
      ),
      {
        revision: 1,
        status: "current",
        purpose: "repository_harness",
        selector: "explicit_patterns",
        patterns: [".agents/skills/**", "!**/.env"],
        manifest_path: null,
        confirmed_by: "human",
        confirmed_at: "2026-07-31T00:00:00.000Z",
      },
    );
  });

  test("uses a confirmed Repository default and allows exact-base override", () => {
    const project = {
      repositories: [
        {
          repository_id: "api",
          current_workspace_policy_revision: 1,
          workspace_policy_revisions: [
            {
              revision: 1,
              purpose: "repository_harness",
              selector: "explicit_patterns",
            },
          ],
        },
      ],
    };
    assert.equal(
      normalizeRepositoryHarnessSelectionRequest(project, {
        repositoryIds: ["api"],
      }).repositories[0].mode,
      "exact_base_plus_overlay",
    );
    assert.deepEqual(
      normalizeRepositoryHarnessSelectionRequest(project, {
        repositoryIds: ["api"],
        repositoryHarnessSelections: [
          { repository_id: "api", mode: "exact_base_only" },
        ],
      }).repositories[0],
      {
        repository_id: "api",
        mode: "exact_base_only",
        provider_family: "codex",
        workspace_policy_revision: null,
      },
    );
  });

  test("rejects an overlay without confirmed policy authority", () => {
    const project = {
      repositories: [
        {
          repository_id: "api",
          current_workspace_policy_revision: null,
          workspace_policy_revisions: [],
        },
      ],
    };
    assert.throws(
      () =>
        normalizeRepositoryHarnessSelectionRequest(project, {
          repositoryIds: ["api"],
          repositoryHarnessSelections: [
            {
              repository_id: "api",
              mode: "exact_base_plus_overlay",
            },
          ],
        }),
      { code: "REPOSITORY_HARNESS_POLICY_REQUIRED" },
    );
  });
});
