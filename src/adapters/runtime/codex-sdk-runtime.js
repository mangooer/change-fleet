import { Codex } from "@openai/codex-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  canonicalStringify,
  sha256,
} from "../../domain/canonical-json.js";
import { normalizeAgentProfile } from "../../domain/agent-profile.js";
import {
  ChangeFleetError,
  invariant,
} from "../../domain/errors.js";
import { createCodexAggregateUsageObservation } from "../../domain/runtime-evidence.js";
import {
  assertStructuredOutcome,
  schemaForOperation,
} from "./runtime-schemas.js";

export const CODEX_SDK_VERSION = "0.146.0";
export const CODEX_CLI_VERSION = "0.146.0";

const PASSTHROUGH_ENVIRONMENT_KEYS = new Set([
  "APPDATA",
  "COMSPEC",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMDATA",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);
const CODEX_REASONING_EFFORTS = new Set([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export class CodexSdkRuntime {
  constructor({
    apiKey = null,
    baseUrl = null,
    codexHome = null,
    credentialProfileId = null,
    environment = process.env,
    clock = () => new Date(),
    codexFactory = (options) => new Codex(options),
    platform = process.platform,
  } = {}) {
    // Provider 环境由操作者准备；适配器只持有显式 locator，不读取或维护其中内容。
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.codexHome = codexHome ? path.resolve(codexHome) : null;
    this.credentialProfileId = credentialProfileId;
    this.environment = environment;
    this.clock = clock;
    this.codexFactory = codexFactory;
    this.platform = platform;
  }

  async invoke(invocation, { onEvent = async () => {} } = {}) {
    const profile = normalizeAgentProfile(invocation.agent_profile);
    assertInvocationCapability(
      invocation,
      profile,
      this.credentialProfileId,
    );
    const startedAt = this.clock().toISOString();
    const providerEvidence = {
      invocation_id: `runtime-invocation-${randomUUID()}`,
      evidence_classification: "provider_observed",
      provider: {
        name: "openai",
        runtime: "codex-sdk",
        sdk_version: CODEX_SDK_VERSION,
        cli_version: CODEX_CLI_VERSION,
        thread_id: null,
      },
      observed: {
        // 稳定 SDK 事件没有返回有效模型，因此不能把请求值冒充观测值。
        effective_model: null,
      },
      started_at: startedAt,
      completed_at: null,
      duration_ms: null,
      usage_observations: [],
      raw_artifact_references: [],
    };
    let observedUsage = null;

    try {
      const codex = this.codexFactory({
        apiKey: this.apiKey ?? undefined,
        baseUrl: this.baseUrl ?? undefined,
        env: controlledEnvironment(this.environment, this.codexHome),
        config: {
          // Provider 会话只服务本次 Run；本地历史和原生多 Agent 在首个切片中关闭。
          history: { persistence: "none" },
          features: { multi_agent: false },
          // Windows Sandbox 的具体实现属于显式选择的 Provider 环境；这里不覆盖配置或触发安装路径。
        },
      });
      const paths = invocation.capabilities.paths.map((item) =>
        path.resolve(item),
      );
      const thread = codex.startThread({
        model: profile.model,
        modelReasoningEffort: profile.reasoning,
        sandboxMode:
          invocation.operation === "planning"
            ? "read-only"
            : "workspace-write",
        workingDirectory: paths[0],
        additionalDirectories: paths.slice(1),
        skipGitRepoCheck: false,
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        approvalPolicy: "never",
      });
      const streamed = await thread.runStreamed(buildPrompt(invocation), {
        outputSchema: schemaForOperation(invocation.operation),
        signal: invocation.signal ?? undefined,
      });

      let finalResponse = null;
      for await (const event of streamed.events) {
        if (event.type === "thread.started") {
          providerEvidence.provider.thread_id = event.thread_id;
        }
        if (event.type === "turn.completed") {
          observedUsage = event.usage;
        }
        if (
          event.type === "item.completed" &&
          event.item.type === "agent_message"
        ) {
          finalResponse = event.item.text;
        }
        await onEvent(normalizeProviderEvent(event));
        if (event.type === "turn.failed") {
          throw new ChangeFleetError(
            "CODEX_PROVIDER_FAILED",
            `Codex turn failed: ${event.error.message}`,
          );
        }
        if (event.type === "error") {
          throw new ChangeFleetError(
            "CODEX_PROVIDER_FAILED",
            `Codex event stream failed: ${event.message}`,
          );
        }
      }

      invariant(
        typeof finalResponse === "string" && finalResponse.length > 0,
        "CODEX_RUNTIME_OUTPUT_INVALID",
        "Codex completed without a structured terminal response",
      );
      let outcome;
      try {
        outcome = assertStructuredOutcome(
          invocation.operation,
          JSON.parse(finalResponse),
        );
      } catch (error) {
        throw new ChangeFleetError(
          "CODEX_RUNTIME_OUTPUT_INVALID",
          "Codex returned invalid structured JSON",
          { cause_message: error.message },
        );
      }
      completeProviderEvidence(
        providerEvidence,
        observedUsage,
        this.clock(),
      );
      return {
        outcome,
        provider_evidence: providerEvidence,
      };
    } catch (error) {
      completeProviderEvidence(
        providerEvidence,
        observedUsage,
        this.clock(),
      );
      const wrapped = normalizeProviderError(error, invocation.signal);
      wrapped.runtime_evidence = providerEvidence;
      throw wrapped;
    }
  }

}

function assertInvocationCapability(
  invocation,
  profile,
  credentialProfileId,
) {
  invariant(
    invocation &&
      ["planning", "execution"].includes(invocation.operation) &&
      invocation.capabilities &&
      Array.isArray(invocation.capabilities.paths) &&
      invocation.capabilities.paths.length > 0,
    "INVALID_RUNTIME_INVOCATION",
    "Codex Runtime requires an operation-scoped non-empty path capability",
  );
  invariant(
    invocation.operation === "planning"
      ? invocation.capabilities.mode === "read_only"
      : invocation.capabilities.mode === "read_write",
    "INVALID_RUNTIME_INVOCATION",
    "Runtime capability mode does not match the operation",
  );
  invariant(
    profile.network_access === false,
    "INVALID_RUNTIME_INVOCATION",
    "Codex Runtime network access must remain disabled",
  );
  invariant(
    profile.provider === "openai" &&
      profile.runtime === "codex-sdk" &&
      CODEX_REASONING_EFFORTS.has(profile.reasoning),
    "UNSUPPORTED_AGENT_PROFILE",
    "Codex Runtime requires an OpenAI Codex SDK profile with a supported reasoning effort",
  );
  invariant(
    typeof credentialProfileId === "string" &&
      credentialProfileId.length > 0 &&
      profile.credential_profile_id === credentialProfileId,
    "INVALID_RUNTIME_INVOCATION",
    "Codex AgentProfile does not match the selected Provider environment",
  );
}

function controlledEnvironment(source, codexHome) {
  // SDK 提供 env 后不会继承父进程，因此只透传启动 CLI 所需的非敏感宿主变量。
  invariant(
    typeof codexHome === "string" && codexHome.length > 0,
    "INVALID_RUNTIME_INVOCATION",
    "Codex Runtime requires an explicitly selected Provider environment",
  );
  const result = { CODEX_HOME: codexHome };
  for (const [key, value] of Object.entries(source ?? {})) {
    if (
      value !== undefined &&
      PASSTHROUGH_ENVIRONMENT_KEYS.has(key.toUpperCase())
    ) {
      result[key] = String(value);
    }
  }
  return result;
}

function buildPrompt(invocation) {
  // Prompt 只包含当前控制契约和投影；用量、历史 trace 与成本数据不进入 Agent 上下文。
  const operationInstruction =
    invocation.operation === "planning"
      ? [
          "Inspect only the supplied exact-base repositories and their repository-native instructions.",
          "Return either plan_proposed with plan populated and request null, or repository_selection_change_request with request populated and plan null.",
          // 领域内核允许授权仓库的非空子集，但同一仓库只能形成一个 WorkUnit；仓库内任务必须在规划阶段合并。
          "A plan may use a non-empty subset of authorized repositories, but it must return at most one WorkUnit for each repository_id; combine all tasks for the same Repository into that single WorkUnit.",
          "Commands in checks must be non-interactive argv-style commands that can run in the supplied repository or combined validation environment.",
        ].join(" ")
      : [
          `CURRENT WORKUNIT TASK: ${invocation.context_projection.work_unit.task}`,
          "Implement this exact task in the supplied writable workspace; do not stop after inspection or merely describe the change.",
          "You must inspect the current working directory and use your filesystem tools to make the requested repository changes before returning a terminal result.",
          "Use apply_patch or an equivalent available editing tool; a JSON response alone does not implement the WorkUnit.",
          "Verify the requested files exist in the writable workspace and run the WorkUnit repository check before completion.",
          "Do not commit, change Git refs, or modify ChangeFleet control state.",
          "Return implementation_completed with blocker null after the repository files are ready for controller-owned publication.",
          "If unavailable tools, permissions, missing information, or another blocker prevents inspection, editing, or verification, return implementation_blocked with a bounded blocker code and message; never label an unchanged workspace implementation_completed.",
        ].join(" ");
  return [
    "You are an Agent Runtime operating under a ChangeFleet control contract.",
    "Repository authorization, base SHAs, plan confirmation, review, and lifecycle state are controller-owned and cannot be changed by your output.",
    operationInstruction,
    "CONTROL_CONTRACT:",
    canonicalStringify(invocation.control_contract),
    "CONTEXT_PROJECTION:",
    canonicalStringify(invocation.context_projection),
  ].join("\n\n");
}

function normalizeProviderEvent(event) {
  // Run 事件不复制推理、命令或输出正文；只保留状态、大小和指纹，避免审计存储吸收潜在 secret。
  if (event.type === "thread.started") {
    return {
      type: "provider.thread.started",
      payload: { thread_id: event.thread_id },
    };
  }
  if (event.type === "turn.started") {
    return { type: "provider.turn.started", payload: {} };
  }
  if (event.type === "turn.completed") {
    return {
      type: "provider.turn.completed",
      payload: { usage_available: true },
    };
  }
  if (event.type === "turn.failed") {
    return {
      type: "provider.turn.failed",
      payload: { message: event.error.message },
    };
  }
  if (event.type === "error") {
    return {
      type: "provider.stream.failed",
      payload: { message: event.message },
    };
  }
  const itemMetadata = {
    item_id: event.item.id,
    item_type: event.item.type,
    item_status: event.item.status ?? null,
  };
  if (event.item.type === "command_execution") {
    itemMetadata.exit_code = event.item.exit_code ?? null;
    itemMetadata.command_bytes = Buffer.byteLength(event.item.command);
    itemMetadata.command_sha256 = sha256(event.item.command);
    itemMetadata.output_bytes = Buffer.byteLength(
      event.item.aggregated_output,
    );
    itemMetadata.output_sha256 = sha256(
      event.item.aggregated_output,
    );
  }
  if (event.item.type === "file_change") {
    itemMetadata.change_count = event.item.changes.length;
  }
  return {
    type: `provider.${event.type}`,
    payload: itemMetadata,
  };
}

function completeProviderEvidence(providerEvidence, usage, completedAt) {
  if (providerEvidence.completed_at !== null) return;
  providerEvidence.completed_at = completedAt.toISOString();
  providerEvidence.duration_ms = Math.max(
    0,
    Date.parse(providerEvidence.completed_at) -
      Date.parse(providerEvidence.started_at),
  );
  providerEvidence.usage_observations =
    createCodexAggregateUsageObservation(usage);
}

function normalizeProviderError(error, signal) {
  if (error instanceof ChangeFleetError) return error;
  if (signal?.aborted || error?.name === "AbortError") {
    return new ChangeFleetError(
      "RUNTIME_CANCELLED",
      "Codex Runtime invocation was cancelled",
    );
  }
  const wrapped = new ChangeFleetError(
    "CODEX_PROVIDER_FAILED",
    "Codex Runtime process failed",
    { cause_message: error?.message ?? String(error) },
  );
  wrapped.cause = error;
  return wrapped;
}
