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
    contextMeasurement = {
      classification: "enforced",
      used_tokens: 600,
      capacity_tokens: 1_000,
    },
    interruptRepository = null,
    failRepository = null,
    executionOutcome = null,
    verificationOutcome = null,
    verificationOutcomes = null,
    feedbackExecutionOutcome = null,
    feedbackFileContent = null,
  }) {
    this.plan = plan;
    this.contextMeasurement = contextMeasurement;
    this.interruptRepository = interruptRepository;
    this.failRepository = failRepository;
    this.executionOutcome = executionOutcome;
    this.verificationOutcome = verificationOutcome;
    this.verificationOutcomes = verificationOutcomes;
    this.feedbackExecutionOutcome = feedbackExecutionOutcome;
    this.feedbackFileContent = feedbackFileContent;
    this.verificationInvocationCount = 0;
    this.interrupted = false;
    this.invocations = [];
  }

  measureInitialContext() {
    return structuredClone(this.contextMeasurement);
  }

  async invoke(invocation) {
    this.invocations.push(structuredClone(invocation));
    if (invocation.operation === "planning") {
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
        "SCRIPTED_EXECUTION_FAILURE",
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
  const repositoryCheck = (repositoryId) => ({
    command_id: `${repositoryId}-check`,
    executable: process.execPath,
    argv: [
      "-e",
      `const fs=require('node:fs');const value=fs.readFileSync('feature.txt','utf8');if(!value.includes('${repositoryId}'))process.exit(2)`,
    ],
    coverage_rationale: `Checks the delivered ${repositoryId} behavior`,
    timeout_ms: 10_000,
  });
  return {
    rationale: "The API change precedes the web change",
    work_units: [
      {
        work_unit_id: "api-unit",
        repository_id: "api",
        task: "Implement API behavior",
        dependencies: [],
        repository_check: repositoryCheck("api"),
      },
      {
        work_unit_id: "web-unit",
        repository_id: "web",
        task: "Implement web behavior",
        dependencies: ["api-unit"],
        repository_check: repositoryCheck("web"),
      },
    ],
    combined_check: {
      command_id: "combined-check",
      executable: process.execPath,
      argv: [combinedCheckScript],
      coverage_rationale: "Checks the combined repository contract",
      timeout_ms: 10_000,
    },
    risks: ["The repositories must remain coherent"],
    unverified_boundaries: [],
    verification_expectation: {
      mode: "deterministic",
      rationale: "The selected behavioral checks cover the planned change.",
      escalation_triggers: ["scope_divergence"],
    },
  };
}

export function createOneRepositoryPlan(combinedCheckScript) {
  return {
    rationale: "Only the API needs to change",
    work_units: [
      {
        work_unit_id: "api-unit",
        repository_id: "api",
        task: "Implement API behavior",
        dependencies: [],
        repository_check: {
          command_id: "api-check",
          executable: process.execPath,
          argv: ["-e", "const fs=require('node:fs');if(!fs.readFileSync('feature.txt','utf8').includes('api'))process.exit(2)"],
          coverage_rationale: "Checks the delivered API behavior",
          timeout_ms: 10_000,
        },
      },
    ],
    combined_check: { command_id: "combined-check", executable: process.execPath, argv: [combinedCheckScript], coverage_rationale: "Checks the combined repository contract", timeout_ms: 10_000 },
    risks: [],
    unverified_boundaries: [],
    verification_expectation: {
      mode: "deterministic",
      rationale: "The selected behavioral checks cover the planned change.",
      escalation_triggers: ["scope_divergence"],
    },
  };
}
