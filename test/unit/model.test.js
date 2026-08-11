import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  commandFingerprint,
  createConfirmedPlan,
  createCandidate,
  createCandidateCheckpoint,
  createCandidateBundle,
  createValidationAttempt,
  createValidationSubject,
  normalizeChangeSetCloseRequest,
  normalizePlanContent,
  normalizeRepositorySelectionRequest,
  normalizeRevisionFeedback,
} from "../../src/domain/model.js";
import { createCheckIdentity } from "../../src/domain/verification.js";

const command = {
  command_id: "check",
  executable: "node",
  argv: ["-e", "process.exit(0)"],
  coverage_rationale: "Covers the planned behavior",
  timeout_ms: 1_000,
};

function planInput(overrides = {}) {
  return {
    revision_feedback_assessments: [],
    work_units: [
      {
        work_unit_id: "api",
        repository_id: "api",
        task: "Change API",
        dependencies: [],
        repository_check: { ...command, command_id: "api-check" },
        repository_check_rationale: "The API change has a focused check",
      },
      {
        work_unit_id: "web",
        repository_id: "web",
        task: "Change web",
        dependencies: ["api"],
        repository_check: { ...command, command_id: "web-check" },
        repository_check_rationale: "The web change has a focused check",
      },
    ],
    combined_check: { ...command, command_id: "combined" },
    combined_check_rationale: "The repositories share one contract",
    verification_expectation: {
      mode: "deterministic",
      rationale: "The behavioral checks cover this plan.",
      escalation_triggers: ["scope_divergence"],
    },
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
  test("keeps normalized planning content revision-free until exact confirmation", () => {
    const content = normalizePlanContent(planInput(), {
      project,
      bases,
      intentRevision: 1,
      repositorySelectionRevision: 1,
      repositoryHarnessSelectionRevision: 1,
    });
    assert.equal("revision" in content, false);
    assert.equal("status" in content, false);
    const plan = createConfirmedPlan(content, {
      revision: 1,
      confirmedAt: "2026-08-05T00:00:00.000Z",
      agentProfile: { profile_id: "profile" },
      planningRunId: "run-1",
      sourceMessageId: "message-1",
      sourceContentDigest: "a".repeat(64),
    });
    assert.equal(plan.revision, 1);
    assert.equal(plan.status, "confirmed");
    assert.equal(plan.source_message_id, "message-1");
  });

  test("normalizes the exact authorized two-node plan", () => {
    const plan = createConfirmedPlan(
      normalizePlanContent(planInput(), {
        project,
        bases,
        intentRevision: 1,
        repositorySelectionRevision: 1,
        repositoryHarnessSelectionRevision: 1,
      }),
      {
        revision: 1,
        confirmedAt: "2026-07-30T00:00:00.000Z",
        agentProfile: { profile_id: "profile" },
        planningRunId: "run-1",
        sourceMessageId: "message-1",
        sourceContentDigest: "a".repeat(64),
      },
    );

    assert.equal(plan.status, "confirmed");
    assert.deepEqual(plan.work_units[1].dependencies, ["api"]);
    assert.equal(plan.work_units[0].base_sha, "a".repeat(40));
  });

  test("accepts explicit commandless validation selections and binds their rationale", () => {
    const input = planInput({
      combined_check: null,
      combined_check_rationale: "One Repository has no cross-Repository invariant",
    });
    input.work_units = input.work_units.map((unit) => ({
      ...unit,
      repository_check: null,
      repository_check_rationale: "No project semantic command applies to this change",
    }));
    const plan = normalizePlanContent(input, {
      project,
      bases,
      intentRevision: 1,
      repositorySelectionRevision: 1,
      repositoryHarnessSelectionRevision: 1,
    });

    assert.equal(plan.work_units[0].repository_check, null);
    assert.equal(plan.combined_check, null);
    plan.revision = 1;
    const changedRationale = structuredClone(plan);
    changedRationale.combined_check_rationale = "A different explicit selection reason";
    const changeSet = { change_set_id: "change", candidates: [] };
    const candidates = [
      {
        repository_id: "api",
        target_ref: "refs/heads/main",
        base_sha: "a".repeat(40),
        candidate_sha: "c".repeat(40),
      },
      {
        repository_id: "web",
        target_ref: "refs/heads/main",
        base_sha: "b".repeat(40),
        candidate_sha: "d".repeat(40),
      },
    ];
    assert.notEqual(
      createValidationSubject(changeSet, plan, candidates)
        .validation_subject_hash,
      createValidationSubject(changeSet, changedRationale, candidates)
        .validation_subject_hash,
    );

    delete input.work_units[0].repository_check_rationale;
    assert.throws(
      () =>
        normalizePlanContent(input, {
          project,
          bases,
          intentRevision: 1,
          repositorySelectionRevision: 1,
          repositoryHarnessSelectionRevision: 1,
        }),
      { code: "INVALID_STRING" },
    );
  });

  test("rejects repository expansion and dependency cycles", () => {
    const expanded = planInput();
    expanded.work_units[1].repository_id = "billing";
    assert.throws(
      () =>
        normalizePlanContent(expanded, {
          project,
          bases,
          intentRevision: 1,
          repositorySelectionRevision: 1,
          repositoryHarnessSelectionRevision: 1,
        }),
      { code: "SCOPE_EXPANSION_REQUIRED" },
    );

    const cyclic = planInput();
    cyclic.work_units[0].dependencies = ["web"];
    assert.throws(
      () =>
        normalizePlanContent(cyclic, {
          project,
          bases,
          intentRevision: 1,
          repositorySelectionRevision: 1,
          repositoryHarnessSelectionRevision: 1,
        }),
      { code: "WORK_UNIT_DEPENDENCY_CYCLE" },
    );
  });

  test("accepts a plan that changes one explicitly registered Repository", () => {
    const oneRepository = planInput({ work_units: [planInput().work_units[0]] });
    const plan = normalizePlanContent(oneRepository, {
      project,
      bases,
      intentRevision: 1,
      repositorySelectionRevision: 1,
      repositoryHarnessSelectionRevision: 1,
    });
    assert.deepEqual(plan.work_units.map((unit) => unit.repository_id), ["api"]);
  });

  test("requires one bounded Agent assessment for every current feedback finding", () => {
    const revisionFeedback = {
      summary: "Review the conflicting claims",
      findings: [
        { finding_id: "landed-state", text: "The prior slice is landed" },
        { finding_id: "task-state", text: "Complete project tracking" },
      ],
    };
    const revised = planInput({
      revision_feedback_assessments: [
        {
          finding_id: "task-state",
          disposition: "adopt",
          rationale: "The exact task evidence supports completing the tracking state",
        },
        {
          finding_id: "landed-state",
          disposition: "adapt",
          rationale: "Git proves the code landed, but the repository projection is stale",
        },
      ],
    });
    const options = {
      project,
      bases,
      intentRevision: 1,
      repositorySelectionRevision: 1,
      repositoryHarnessSelectionRevision: 1,
      revisionFeedback,
    };

    const plan = normalizePlanContent(revised, options);
    assert.deepEqual(
      plan.revision_feedback_assessments.map((item) => [
        item.finding_id,
        item.disposition,
      ]),
      [
        ["landed-state", "adapt"],
        ["task-state", "adopt"],
      ],
    );
    assert.throws(
      () =>
        normalizePlanContent(
          planInput({ revision_feedback_assessments: [] }),
          options,
        ),
      { code: "INVALID_PLAN" },
    );
    assert.throws(
      () =>
        normalizePlanContent(
          planInput({
            revision_feedback_assessments: [
              revised.revision_feedback_assessments[0],
              revised.revision_feedback_assessments[0],
            ],
          }),
          options,
        ),
      { code: "INVALID_PLAN" },
    );
  });

  test("binds validation and Bundle hashes to exact Candidates and evidence", () => {
    const changeSet = {
      change_set_id: "change-1",
      bundles: [],
      verification_admissions: [
        { admission_id: "admission-api", mode: "deterministic" },
        { admission_id: "admission-web", mode: "deterministic" },
      ],
      verification_reviews: [],
    };
    const plan = createConfirmedPlan(
      normalizePlanContent(planInput(), {
        project,
        bases,
        intentRevision: 1,
        repositorySelectionRevision: 1,
        repositoryHarnessSelectionRevision: 1,
      }),
      {
        revision: 1,
        confirmedAt: "2026-07-30T00:00:00.000Z",
        agentProfile: { profile_id: "profile" },
        planningRunId: "run-1",
        sourceMessageId: "message-1",
        sourceContentDigest: "a".repeat(64),
      },
    );
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
        verificationAdmissionId: "admission-web",
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
        verificationAdmissionId: "admission-api",
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

  test("normalizes only bounded exact ChangeSet closure requests", () => {
    const request = {
      idempotency_key: "close-1",
      change_set_id: "change-1",
      actor: "human",
      reason: {
        code: "restart_on_new_base",
        summary: "Restart from the newly selected branch tip",
      },
    };
    assert.deepEqual(normalizeChangeSetCloseRequest(request), request);

    assert.throws(
      () => normalizeChangeSetCloseRequest({ ...request, successor_id: "next" }),
      { code: "INVALID_CHANGE_SET_CLOSURE" },
    );
    assert.throws(
      () =>
        normalizeChangeSetCloseRequest({
          ...request,
          reason: { ...request.reason, code: "retry" },
        }),
      { code: "INVALID_CHANGE_SET_CLOSURE" },
    );
    assert.throws(
      () =>
        normalizeChangeSetCloseRequest({
          ...request,
          reason: { ...request.reason, summary: "界".repeat(683) },
        }),
      { code: "INVALID_CHANGE_SET_CLOSURE" },
    );
  });

  test("binds CandidateCheckpoint, validation attempts, and bounded feedback", () => {
    const checkpoint = createCandidateCheckpoint({
      changeSetId: "change-1",
      intentRevision: 1,
      planRevision: 2,
      repositorySelectionRevision: 3,
      repositoryHarnessSelectionRevision: 4,
      workUnitId: "api-unit",
      repositoryId: "api",
      targetRef: "refs/heads/main",
      baseSha: "a".repeat(40),
      candidateSha: "b".repeat(40),
      workspaceId: "workspace-api",
      workspacePath: "C:/private/workspace",
      changedPaths: ["z.txt", "a.txt"],
      sourceRunId: "run-1",
      createdAt: "2026-08-04T00:00:00.000Z",
    });
    assert.deepEqual(checkpoint.changed_paths, ["a.txt", "z.txt"]);
    assert.equal(checkpoint.provenance, "automatic");

    const attempt = createValidationAttempt({
      kind: "repository_validation",
      subjectId: checkpoint.checkpoint_id,
      attempt: 1,
      status: "failed",
      evidence: {
        evidence_id: "evidence-1",
        evidence_hash: "c".repeat(64),
      },
      errorCode: "COMMAND_SPAWN_FAILED",
      checkIdentity: createCheckIdentity(command),
      requestedBudget: { timeout_ms: null },
      effectiveBudget: { timeout_ms: 1_000 },
      budgetSource: "plan_default",
      budgetLimit: { max_timeout_ms: 10_000 },
      environmentIdentity: {
        platform: "test",
        architecture: "test",
        controller_node_version: "test",
      },
      startedAt: "2026-08-04T00:00:00.000Z",
      completedAt: "2026-08-04T00:00:01.000Z",
    });
    assert.equal(attempt.subject_id, checkpoint.checkpoint_id);
    assert.equal(attempt.status, "failed");

    const structuralAttempt = createValidationAttempt({
      kind: "repository_validation",
      subjectId: checkpoint.checkpoint_id,
      attempt: 2,
      status: "passed",
      evidence: {
        evidence_id: "evidence-structural",
        evidence_hash: "d".repeat(64),
      },
      checkIdentity: null,
      requestedBudget: null,
      effectiveBudget: null,
      budgetSource: null,
      budgetLimit: null,
      environmentIdentity: {
        platform: "test",
        architecture: "test",
        controller_node_version: "test",
      },
      startedAt: "2026-08-04T00:00:01.000Z",
      completedAt: "2026-08-04T00:00:02.000Z",
    });
    assert.equal(structuralAttempt.check_identity, null);
    assert.equal(structuralAttempt.effective_budget, null);
    assert.equal(structuralAttempt.budget_source, null);
    assert.throws(
      () =>
        createValidationAttempt({
          kind: "repository_validation",
          subjectId: checkpoint.checkpoint_id,
          attempt: 3,
          status: "passed",
          evidence: {
            evidence_id: "evidence-invalid-structural",
            evidence_hash: "e".repeat(64),
          },
          checkIdentity: null,
          requestedBudget: { timeout_ms: null },
          effectiveBudget: null,
          budgetSource: null,
          budgetLimit: null,
          environmentIdentity: structuralAttempt.environment_identity,
          startedAt: "2026-08-04T00:00:02.000Z",
          completedAt: "2026-08-04T00:00:03.000Z",
        }),
      { code: "INVALID_VALIDATION_ATTEMPT" },
    );

    assert.deepEqual(
      normalizeRevisionFeedback({
        summary: "Fix the exact review blockers",
        findings: [
          { finding_id: "finding-1", text: "Escape bootstrap data" },
        ],
      }),
      {
        summary: "Fix the exact review blockers",
        findings: [
          { finding_id: "finding-1", text: "Escape bootstrap data" },
        ],
      },
    );
    assert.throws(
      () => normalizeRevisionFeedback({ summary: "Missing findings", findings: [] }),
      { code: "INVALID_REVISION_FEEDBACK" },
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
