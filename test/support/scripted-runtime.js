import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ChangeFleetError } from "../../src/domain/errors.js";

export const TEST_AGENT_PROFILE = Object.freeze({
  profile_id: "scripted-test-profile",
  revision: 1,
  provider: "test",
  runtime: "scripted",
  model: "fixture",
  reasoning: "deterministic",
  permissions: "operation_scoped",
  network_access: false,
  skills: [],
  credential_profile_id: null,
});

export class ScriptedRuntime {
  constructor({
    plan,
    planningOutcomes = null,
    planningFailures = null,
    contextMeasurement = {
      classification: "enforced",
      used_tokens: 600,
      capacity_tokens: 1_000,
    },
    interruptRepository = null,
    failRepository = null,
    failCode = "SCRIPTED_EXECUTION_FAILURE",
    executionOutcome = null,
    verificationOutcome = null,
    verificationOutcomes = null,
    supervisionOutcome = null,
    supervisionOutcomes = null,
    supervisionActionType = null,
    reviewOutcome = null,
    reviewOutcomes = null,
    feedbackExecutionOutcome = null,
    feedbackFileContent = null,
  }) {
    this.plan = plan;
    this.planningOutcomes = planningOutcomes;
    this.planningFailures = planningFailures;
    this.contextMeasurement = contextMeasurement;
    this.interruptRepository = interruptRepository;
    this.failRepository = failRepository;
    this.failCode = failCode;
    this.executionOutcome = executionOutcome;
    this.verificationOutcome = verificationOutcome;
    this.verificationOutcomes = verificationOutcomes;
    this.supervisionOutcome = supervisionOutcome;
    this.supervisionOutcomes = supervisionOutcomes;
    this.supervisionActionType = supervisionActionType;
    this.reviewOutcome = reviewOutcome;
    this.reviewOutcomes = reviewOutcomes;
    this.feedbackExecutionOutcome = feedbackExecutionOutcome;
    this.feedbackFileContent = feedbackFileContent;
    this.verificationInvocationCount = 0;
    this.planningInvocationCount = 0;
    this.supervisionInvocationCount = 0;
    this.reviewInvocationCount = 0;
    this.interrupted = false;
    this.invocations = [];
  }

  measureInitialContext() {
    return structuredClone(this.contextMeasurement);
  }

  async invoke(invocation) {
    this.invocations.push(structuredClone(invocation));
    if (invocation.operation === "planning") {
      // 显式序列只服务持久的规划对话测试；未配置时仍沿用默认确定性 Plan。
      const invocationIndex = this.planningInvocationCount;
      const sequencedOutcome = Array.isArray(this.planningOutcomes)
        ? this.planningOutcomes[invocationIndex]
        : null;
      this.planningInvocationCount += 1;
      const sequencedFailure = Array.isArray(this.planningFailures)
        ? this.planningFailures[invocationIndex]
        : null;
      if (sequencedFailure) {
        throw new ChangeFleetError(
          sequencedFailure.code ?? "SCRIPTED_PLANNING_FAILURE",
          sequencedFailure.message ?? "Scripted planning failed",
        );
      }
      if (sequencedOutcome) {
        return {
          outcome: structuredClone(sequencedOutcome),
          provider_evidence: testProviderEvidence(),
        };
      }
      const plan = structuredClone(this.plan);
      // 确定性 Runtime 逐项采纳夹具反馈，用来验证 Core 的覆盖约束而不模拟语义判断质量。
      plan.revision_feedback_assessments ??=
        invocation.context_projection.feedback?.findings.map(
          (finding) => ({
            finding_id: finding.finding_id,
            disposition: "adopt",
            rationale: "The deterministic fixture adopts the reviewed finding",
          }),
        ) ?? [];
      return {
        outcome: {
          type: "conversation_message",
          message: {
            text: "The deterministic fixture produced an approvable plan.",
            plan,
          },
          request: null,
        },
        provider_evidence: testProviderEvidence(),
      };
    }
    if (invocation.operation === "verification") {
      const sequencedOutcome = Array.isArray(this.verificationOutcomes)
        ? this.verificationOutcomes[this.verificationInvocationCount]
        : null;
      this.verificationInvocationCount += 1;
      return {
        outcome: structuredClone(
          sequencedOutcome ?? this.verificationOutcome ?? {
            type: "verification_completed",
            review_depth: "triage",
            verdict: "pass",
            summary: "The deterministic fixture found no blocking issue.",
            findings: [],
            notes: [],
            human_decision: null,
            requested_checks: [],
          },
        ),
        provider_evidence: testProviderEvidence(),
      };
    }
    if (invocation.operation === "supervision") {
      const sequencedOutcome = Array.isArray(this.supervisionOutcomes)
        ? this.supervisionOutcomes[this.supervisionInvocationCount]
        : null;
      this.supervisionInvocationCount += 1;
      const offered = invocation.context_projection.offered_actions;
      const preferred =
        offered.find((action) => action.type === this.supervisionActionType) ??
        offered.find((action) => action.type === "submit_feedback") ??
        offered[0];
      return {
        outcome: structuredClone(
          sequencedOutcome ?? this.supervisionOutcome ?? {
            type: "supervisor_decision_proposal",
            action_id: preferred.action_id,
            projection_digest:
              invocation.context_projection.projection_digest,
            rationale: "The deterministic fixture selected the first bounded action.",
            expected_result: "The selected action advances or safely stops the route.",
            evidence_reference_ids: [],
          },
        ),
        provider_evidence: testProviderEvidence(),
      };
    }
    if (invocation.operation === "review") {
      const sequencedOutcome = Array.isArray(this.reviewOutcomes)
        ? this.reviewOutcomes[this.reviewInvocationCount]
        : null;
      this.reviewInvocationCount += 1;
      return {
        outcome: structuredClone(
          sequencedOutcome ?? this.reviewOutcome ?? {
            type: "bundle_review_completed",
            disposition: "pass",
            summary: "The deterministic fixture found no Bundle-level blocking issue.",
            findings: [],
            human_decision: null,
          },
        ),
        provider_evidence: testProviderEvidence(),
      };
    }
    const repositoryId =
      invocation.context_projection.work_unit.repository_id;
    if (
      repositoryId === this.interruptRepository &&
      this.interrupted === false
    ) {
      this.interrupted = true;
      throw new ChangeFleetError(
        "CONTROLLER_INTERRUPTED",
        `Simulated controller loss while executing ${repositoryId}`,
      );
    }
    if (repositoryId === this.failRepository) {
      throw new ChangeFleetError(
        this.failCode,
        `Scripted execution failed for ${repositoryId}`,
      );
    }
    if (
      invocation.operation === "execution" &&
      invocation.control_contract.operation === "execution" &&
      invocation.context_projection.feedback !== null &&
      this.feedbackFileContent !== null
    ) {
      // 只有显式配置的测试才制造修正差异；缺省值保留“评估后无需改动”的路径。
      await writeFixtureFeature(
        invocation,
        `${this.feedbackFileContent}`,
      );
    }
    if (
      invocation.operation === "execution" &&
      invocation.context_projection.feedback !== null &&
      this.feedbackExecutionOutcome
    ) {
      const outcome = structuredClone(this.feedbackExecutionOutcome);
      outcome.revision_feedback_assessments ??=
        feedbackAssessments(invocation);
      return {
        outcome,
        provider_evidence: testProviderEvidence(),
      };
    }
    if (this.executionOutcome && invocation.operation === "execution") {
      // 测试可显式模拟阻塞或空实现；生产 Runtime 仍由严格 schema 约束。
      const outcome = structuredClone(this.executionOutcome);
      outcome.revision_feedback_assessments ??=
        feedbackAssessments(invocation);
      return {
        outcome,
        provider_evidence: testProviderEvidence(),
      };
    }
    await writeFixtureFeature(
      invocation,
      `${repositoryId} implementation\n`,
    );
    return {
      outcome: {
        type: "implementation_completed",
        summary: `implemented ${repositoryId}`,
        changed_paths: ["feature.txt"],
        blocker: null,
        revision_feedback_assessments: feedbackAssessments(invocation),
      },
      provider_evidence: testProviderEvidence(),
    };
  }
}

async function writeFixtureFeature(invocation, content) {
  const workspace = invocation.workspace.workspace_path;
  const target = path.resolve(workspace, "feature.txt");
  const relative = path.relative(path.resolve(workspace), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("scripted write escaped workspace");
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function feedbackAssessments(invocation) {
  return (
    invocation.context_projection.feedback?.findings?.map(
      (finding) => ({
        finding_id: finding.finding_id,
        disposition: "adopt",
        rationale: "The deterministic fixture adopts the reviewed finding",
      }),
    ) ?? []
  );
}

function testProviderEvidence() {
  // 测试 Runtime 只声明 fixture 身份，不伪造 Provider token 或成本。
  return {
    evidence_classification: "test_fixture",
    provider: {
      name: "test",
      runtime: "scripted",
      sdk_version: null,
      cli_version: null,
      thread_id: null,
    },
    observed: { effective_model: null },
    usage_observations: [],
    raw_artifact_references: [],
  };
}

export function createTwoRepositoryPlan(combinedCheckScript) {
  // 保留参数以维持调用方的场景可读性；语义 Plan 不再携带可执行命令。
  void combinedCheckScript;
  return {
    summary: "Implement the coordinated API and web behavior.",
    steps: [
      "Implement the API behavior.",
      "Update the web behavior against the resulting API contract.",
    ],
    validation: [
      "Run the smallest repository-native checks for both changed repositories.",
      "Verify the combined API and web contract.",
    ],
    risks: ["The repositories must remain coherent"],
    assumptions: ["Both selected repositories participate in this task."],
    revision_feedback_assessments: [],
  };
}

export function createOneRepositoryPlan(combinedCheckScript) {
  // 测试计划只表达语义；Core 从 TaskWorkspace 编译 Repository 级执行身份。
  void combinedCheckScript;
  return {
    summary: "Implement the API behavior.",
    steps: ["Update the API implementation for the requested behavior."],
    validation: ["Run the smallest repository-native API checks."],
    risks: [],
    assumptions: [],
    revision_feedback_assessments: [],
  };
}
