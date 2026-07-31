import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  commandFingerprint,
  createCandidate,
  createCandidateBundle,
  createValidationSubject,
  normalizePlan,
  normalizeRepositorySelectionRequest,
} from "../../src/domain/model.js";

const command = {
  command_id: "check",
  executable: "node",
  argv: ["-e", "process.exit(0)"],
  timeout_ms: 1_000,
};

function planInput(overrides = {}) {
  return {
    work_units: [
      {
        work_unit_id: "api",
        repository_id: "api",
        task: "Change API",
        dependencies: [],
        repository_check: { ...command, command_id: "api-check" },
      },
      {
        work_unit_id: "web",
        repository_id: "web",
        task: "Change web",
        dependencies: ["api"],
        repository_check: { ...command, command_id: "web-check" },
      },
    ],
    combined_check: { ...command, command_id: "combined" },
    ...overrides,
  };
}

const project = {
  repositories: [
    { repository_id: "api" },
    { repository_id: "web" },
  ],
};

const bases = {
  api: { target_ref: "refs/heads/main", base_sha: "a".repeat(40) },
  web: { target_ref: "refs/heads/main", base_sha: "b".repeat(40) },
};

describe("domain model", () => {
  test("normalizes the exact authorized two-node plan", () => {
    const plan = normalizePlan(planInput(), {
      project,
      bases,
      intentRevision: 1,
      repositorySelectionRevision: 1,
      revision: 1,
      createdAt: "2026-07-30T00:00:00.000Z",
    });

    assert.equal(plan.status, "proposed");
    assert.deepEqual(plan.work_units[1].dependencies, ["api"]);
    assert.equal(plan.work_units[0].base_sha, "a".repeat(40));
  });

  test("rejects repository expansion and dependency cycles", () => {
    const expanded = planInput();
    expanded.work_units[1].repository_id = "billing";
    assert.throws(
      () =>
        normalizePlan(expanded, {
          project,
          bases,
          intentRevision: 1,
          repositorySelectionRevision: 1,
          revision: 1,
          createdAt: "2026-07-30T00:00:00.000Z",
        }),
      { code: "SCOPE_EXPANSION_REQUIRED" },
    );

    const cyclic = planInput();
    cyclic.work_units[0].dependencies = ["web"];
    assert.throws(
      () =>
        normalizePlan(cyclic, {
          project,
          bases,
          intentRevision: 1,
          repositorySelectionRevision: 1,
          revision: 1,
          createdAt: "2026-07-30T00:00:00.000Z",
        }),
      { code: "WORK_UNIT_DEPENDENCY_CYCLE" },
    );
  });

  test("accepts a plan that changes one explicitly registered Repository", () => {
    const oneRepository = planInput({ work_units: [planInput().work_units[0]] });
    const plan = normalizePlan(oneRepository, {
      project,
      bases,
      intentRevision: 1,
      repositorySelectionRevision: 1,
      revision: 1,
      createdAt: "2026-07-30T00:00:00.000Z",
    });
    assert.deepEqual(plan.work_units.map((unit) => unit.repository_id), ["api"]);
  });

  test("binds validation and Bundle hashes to exact Candidates and evidence", () => {
    const changeSet = {
      change_set_id: "change-1",
      bundles: [],
    };
    const plan = normalizePlan(planInput(), {
      project,
      bases,
      intentRevision: 1,
      repositorySelectionRevision: 1,
      revision: 1,
      createdAt: "2026-07-30T00:00:00.000Z",
    });
    const candidates = [
      createCandidate({
        repositoryId: "web",
        targetRef: "refs/heads/main",
        baseSha: "b".repeat(40),
        candidateSha: "d".repeat(40),
        workspaceId: "workspace-web",
        workspacePath: "D:/work/web",
        changedPaths: ["web.txt"],
        repositoryEvidence: {
          evidence_id: "evidence-web",
          evidence_hash: "1".repeat(64),
        },
      }),
      createCandidate({
        repositoryId: "api",
        targetRef: "refs/heads/main",
        baseSha: "a".repeat(40),
        candidateSha: "c".repeat(40),
        workspaceId: "workspace-api",
        workspacePath: "D:/work/api",
        changedPaths: ["api.txt"],
        repositoryEvidence: {
          evidence_id: "evidence-api",
          evidence_hash: "2".repeat(64),
        },
      }),
    ];

    const subject = createValidationSubject(changeSet, plan, candidates);
    const movedWorkspace = structuredClone(candidates);
    movedWorkspace[0].workspace_path = "D:/other/web";
    assert.equal(
      subject.validation_subject_hash,
      createValidationSubject(changeSet, plan, movedWorkspace)
        .validation_subject_hash,
    );

    const bundle = createCandidateBundle({
      changeSet,
      plan,
      candidates,
      combinedEvidence: {
        evidence_id: "combined",
        evidence_hash: "3".repeat(64),
      },
      createdAt: "2026-07-30T00:00:01.000Z",
    });
    const changedEvidenceBundle = createCandidateBundle({
      changeSet,
      plan,
      candidates,
      combinedEvidence: {
        evidence_id: "combined",
        evidence_hash: "4".repeat(64),
      },
      createdAt: "2026-07-30T00:00:01.000Z",
    });
    const laterCreationBundle = createCandidateBundle({
      changeSet,
      plan,
      candidates,
      combinedEvidence: {
        evidence_id: "combined",
        evidence_hash: "3".repeat(64),
      },
      createdAt: "2026-07-30T00:00:09.000Z",
    });

    assert.deepEqual(
      bundle.candidates.map((candidate) => candidate.repository_id),
      ["api", "web"],
    );
    assert.notEqual(bundle.bundle_hash, changedEvidenceBundle.bundle_hash);
    assert.equal(bundle.bundle_hash, laterCreationBundle.bundle_hash);
    assert.throws(
      () =>
        createCandidateBundle({
          changeSet,
          plan,
          candidates: candidates.map((candidate) => ({
            ...candidate,
            repository_evidence: null,
          })),
          combinedEvidence: {
            evidence_id: "combined",
            evidence_hash: "3".repeat(64),
          },
          createdAt: "2026-07-30T00:00:01.000Z",
        }),
      { code: "MISSING_REQUIRED_EVIDENCE" },
    );
  });

  test("creates stable caller command fingerprints", () => {
    assert.equal(
      commandFingerprint("confirm", { revision: 1, actor: "human" }),
      commandFingerprint("confirm", { actor: "human", revision: 1 }),
    );
    assert.notEqual(
      commandFingerprint("confirm", { revision: 1 }),
      commandFingerprint("confirm", { revision: 2 }),
    );
  });

  test("normalizes a non-empty planning subset and per-Repository refs", () => {
    assert.deepEqual(
      normalizeRepositorySelectionRequest(project, {
        planningRepositoryIds: ["web"],
        repositorySelections: [
          {
            repository_id: "web",
            branch_ref: "feature",
            target_ref: "main",
          },
        ],
      }),
      {
        repository_ids: ["web"],
        repositories: [
          {
            repository_id: "web",
            branch_ref: "feature",
            target_ref: "main",
          },
        ],
      },
    );

    assert.deepEqual(
      normalizeRepositorySelectionRequest(project, {}),
      {
        repository_ids: ["api", "web"],
        repositories: [
          { repository_id: "api", branch_ref: null, target_ref: null },
          { repository_id: "web", branch_ref: null, target_ref: null },
        ],
      },
    );
  });

  test("rejects empty, unknown, and non-visible Repository selections", () => {
    assert.throws(
      () =>
        normalizeRepositorySelectionRequest(project, {
          planningRepositoryIds: [],
        }),
      { code: "INVALID_REPOSITORY_SELECTION" },
    );
    assert.throws(
      () =>
        normalizeRepositorySelectionRequest(project, {
          planningRepositoryIds: ["billing"],
        }),
      { code: "REPOSITORY_NOT_REGISTERED" },
    );
    assert.throws(
      () =>
        normalizeRepositorySelectionRequest(project, {
          planningRepositoryIds: ["api"],
          repositorySelections: [{ repository_id: "web" }],
        }),
      { code: "REPOSITORY_NOT_PLANNING_VISIBLE" },
    );
  });
});
