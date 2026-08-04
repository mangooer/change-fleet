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
  }) {
    this.plan = plan;
    this.contextMeasurement = contextMeasurement;
    this.interruptRepository = interruptRepository;
    this.failRepository = failRepository;
    this.executionOutcome = executionOutcome;
    this.interrupted = false;
    this.invocations = [];
  }

  measureInitialContext() {
    return structuredClone(this.contextMeasurement);
  }

  async invoke(invocation) {
    this.invocations.push(structuredClone(invocation));
    if (invocation.operation === "planning") {
      return {
        outcome: {
          type: "plan_proposed",
          plan: structuredClone(this.plan),
        },
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
    if (this.executionOutcome) {
      // 测试可显式模拟阻塞或空实现；生产 Runtime 仍由严格 schema 约束。
      return {
        outcome: structuredClone(this.executionOutcome),
        provider_evidence: testProviderEvidence(),
      };
    }
    const workspace = invocation.workspace.workspace_path;
    const target = path.resolve(workspace, "feature.txt");
    const relative = path.relative(path.resolve(workspace), target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("scripted write escaped workspace");
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${repositoryId} implementation\n`, "utf8");
    return {
      outcome: {
        type: "implementation_completed",
        summary: `implemented ${repositoryId}`,
        changed_paths: ["feature.txt"],
        blocker: null,
      },
      provider_evidence: testProviderEvidence(),
    };
  }
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
      timeout_ms: 10_000,
    },
    risks: ["The repositories must remain coherent"],
    unverified_boundaries: [],
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
          timeout_ms: 10_000,
        },
      },
    ],
    combined_check: { command_id: "combined-check", executable: process.execPath, argv: [combinedCheckScript], timeout_ms: 10_000 },
    risks: [],
    unverified_boundaries: [],
  };
}
