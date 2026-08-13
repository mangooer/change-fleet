import { Codex } from "@openai/codex-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import changeFleetPackage from "../../../package.json" with { type: "json" };

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

// SDK 版本以唯一的依赖声明为准，避免升级依赖后审计证据仍写入旧版本。
export const CODEX_SDK_VERSION =
  changeFleetPackage.dependencies["@openai/codex-sdk"];
// SDK 适配器无法独立观测其内部 CLI 版本，不把依赖版本伪装成观测事实。
export const CODEX_CLI_VERSION = null;

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

// 各语义阶段只约束“交付结果满足项目自身约定”，不把任何具体 Harness 文件或状态提升为 Core 契约。
const REPOSITORY_HARNESS_COMPLETENESS_INSTRUCTIONS = Object.freeze({
  planning:
    "Treat repository-native instructions as project-owned semantic requirements rather than controller state. Read and apply only the requirements that are applicable to this change, and include their completion in the same Repository WorkUnit and evidence. Do not invent requirements, artifacts, commands, or formats that the repository does not establish.",
  execution:
    "Read and apply the applicable repository-native instructions to the complete deliverable. Ensure this Candidate satisfies those project-owned requirements before reporting completion. Do not create or update Harness, artifacts, commands, or formats unless the repository or confirmed task requires it.",
  verification:
    "Assess the exact Candidate against only applicable repository-native requirements. A repository-evidenced violation is a blocking finding; an absent, optional, unsupported, stylistic, or unknown convention is not.",
  review:
    "Assess the complete Bundle against only applicable repository-native requirements in each exact Candidate. A repository-evidenced violation is blocking; an absent, optional, unsupported, stylistic, or unknown convention is not.",
});

export class CodexSdkRuntime {
  constructor({
    apiKey = null,
    baseUrl = null,
    codexHome = null,
    credentialProfileId = null,
    environment = process.env,
    clock = () => new Date(),
    codexFactory = (options) => new Codex(options),
  } = {}) {
    // Provider 环境由操作者准备；适配器只持有显式 locator，不读取或维护其中内容。
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.codexHome = codexHome ? path.resolve(codexHome) : null;
    this.credentialProfileId = credentialProfileId;
    this.environment = environment;
    this.clock = clock;
    this.codexFactory = codexFactory;
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
        env: runtimeEnvironment(
          this.environment,
          this.codexHome,
          profile.permissions,
        ),
      });
      const paths = invocation.capabilities.paths.map((item) =>
        path.resolve(item),
      );
      const thread = codex.startThread({
        model: profile.model,
        modelReasoningEffort: profile.reasoning,
        ...threadPermissionOptions(profile, invocation.operation),
        workingDirectory: paths[0],
        additionalDirectories: paths.slice(1),
        // Supervisor 的专用空目录不是仓库；其能力仍由只读 Profile 和结构化输出约束。
        skipGitRepoCheck: invocation.operation === "supervision",
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
      ["planning", "execution", "verification", "supervision", "review"].includes(
        invocation.operation,
      ) &&
      invocation.capabilities &&
      Array.isArray(invocation.capabilities.paths) &&
      invocation.capabilities.paths.length > 0,
    "INVALID_RUNTIME_INVOCATION",
    "Codex Runtime requires an operation-scoped non-empty path capability",
  );
  invariant(
    invocation.operation === "execution"
      ? invocation.capabilities.mode === "read_write"
      : invocation.capabilities.mode === "read_only",
    "INVALID_RUNTIME_INVOCATION",
    "Runtime capability mode does not match the operation",
  );
  invariant(
    profile.network_access === (profile.permissions === "host_user"),
    "INVALID_RUNTIME_INVOCATION",
    "Codex Runtime permission and network facts do not match",
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

function runtimeEnvironment(source, codexHome, permissions) {
  if (permissions === "host_user") {
    // 显式 host_user 与本机 Harness 使用相同环境；只覆盖已确认选择的 CODEX_HOME，不持久化环境内容。
    const inherited = {};
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value !== undefined && key.toUpperCase() !== "CODEX_HOME") {
        inherited[key] = String(value);
      }
    }
    inherited.CODEX_HOME = requireCodexHome(codexHome);
    return inherited;
  }
  return controlledEnvironment(source, codexHome);
}

function controlledEnvironment(source, codexHome) {
  // SDK 提供 env 后不会继承父进程，因此只透传启动 CLI 所需的非敏感宿主变量。
  const result = { CODEX_HOME: requireCodexHome(codexHome) };
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

function requireCodexHome(codexHome) {
  invariant(
    typeof codexHome === "string" && codexHome.length > 0,
    "INVALID_RUNTIME_INVOCATION",
    "Codex Runtime requires an explicitly selected Provider environment",
  );
  return codexHome;
}

function threadPermissionOptions(profile, operation) {
  if (profile.permissions === "host_user") {
    // 本机高权限由 AgentProfile 明确授权；ChangeFleet 不再把 worktree 冒充为 OS 安全边界。
    return {
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    };
  }
  return {
    sandboxMode: operation === "execution"
      ? "workspace-write"
      : "read-only",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    approvalPolicy: "never",
  };
}

function buildPrompt(invocation) {
  // Prompt 只包含当前控制契约和投影；用量、历史 trace 与成本数据不进入 Agent 上下文。
  let operationInstruction;
  if (invocation.operation === "planning") {
    operationInstruction = [
          "Inspect only the supplied exact-base repositories and their repository-native instructions.",
          REPOSITORY_HARNESS_COMPLETENESS_INSTRUCTIONS.planning,
          "You are already planning the current ChangeSet inside its prepared TaskWorkspace. Plan the requested repository change; never propose creating another ChangeSet, workspace, or console task unless the operator explicitly asks to change ChangeFleet itself in that way.",
          "This is a planning conversation, not a Plan revision. Reply with conversation_message and a concise user-facing text. Set disposition=ready and include a complete structured plan when no human input is needed; otherwise set disposition=needs_input and message.plan=null.",
          "Every conversation_message must carry the complete current intent_draft. Incorporate valid operator clarification into that draft, keep unresolved questions explicit, and do not rely on older transcript text. A message with a Plan must have no unresolved open_questions.",
          "When feedback is present and the message carries a replacement plan, treat every finding as a reviewer claim to evaluate, not as an automatic fact or command. Return exactly one revision_feedback_assessment for each finding_id using adopt, adapt, or decline with a concise rationale. When no feedback is present, a plan must contain an empty revision_feedback_assessments array.",
          "Return either conversation_message with message populated and request null, or repository_selection_change_request with request populated and message null.",
          "A ready plan contains only summary, steps, validation, risks, assumptions, and revision_feedback_assessments. Keep it concise and useful to the later execution Agent.",
          "Do not echo WorkUnit ids, Git SHAs or refs, AgentProfile, budgets, supervision, reviewer, delivery, or other task configuration. ChangeFleet owns those facts in workspace_control and compiles them after confirmation.",
          "Validation describes what should be proven semantically; do not manufacture argv commands merely to satisfy a schema.",
        ].join(" ");
  } else if (invocation.operation === "execution") {
    // current_plan 已是唯一语义来源；这里仅说明如何使用它，不再插值复制整段任务文本。
    operationInstruction = [
          "Implement the supplied current_plan in the repository assigned by work_unit. The semantic Plan appears only once in context; do not reconstruct task configuration from control metadata.",
          REPOSITORY_HARNESS_COMPLETENESS_INSTRUCTIONS.execution,
          "The repository marked access=read_write is your only writable repository. Other linked repositories are read-only task context even when the host Runtime can technically write them.",
          "Feedback is review input rather than independent authority. If feedback is present, assess every finding exactly once as adopt, adapt, or decline and implement adopted or adapted changes under the confirmed Plan. When no feedback is present, return an empty revision_feedback_assessments array.",
          "Use plan_invalidation_required only when exact workspace evidence proves the confirmed Plan materially unsound; ordinary implementation changes, test failures, and diff review findings stay under the current Plan.",
          "On initial execution, implement this exact task in the supplied writable workspace and do not stop after inspection or merely describe the change. On feedback execution, the workspace starts at the current Candidate when candidate_sha is supplied: preserve its existing implementation and change only what an adopted or adapted finding requires.",
          "Inspect the current working directory and use filesystem tools for every required repository change. When a change is required, use apply_patch or an equivalent available editing tool; a JSON response alone does not implement it.",
          "Verify the requested files exist and perform the smallest applicable local checks before completion. The selected repository_check becomes authoritative only when ChangeFleet reruns its frozen argv after Candidate publication in a clean workspace where HEAD is the Candidate. Run it locally only when that same argv is meaningful before publication; otherwise use an equivalent local diagnostic without treating it as authoritative evidence. When repository_check is null, follow the recorded rationale and do not invent a command.",
          "When feedback disputes validation coverage, distinguish local execution-time diagnostics from the later controller-owned Candidate-bound attempt. Assess the command against that post-publication clean-HEAD state before deciding whether the confirmed Plan remains sound.",
          "Do not commit, change Git refs, or modify ChangeFleet control state.",
          "Return implementation_completed with blocker null after the repository files are ready for controller-owned publication, including revision_feedback_assessments. A fully assessed feedback execution that needs no Git change is valid: return changed_paths as an empty array so ChangeFleet can reuse the exact checkpoint, and do not rewrite unrelated Plan work merely to manufacture a diff.",
          "If unavailable tools, permissions, missing information, or another blocker prevents inspection, editing, or verification, return implementation_blocked with a bounded blocker code and message; only a fully assessed feedback execution may return implementation_completed for an unchanged workspace.",
        ].join(" ");
  } else if (invocation.operation === "verification") {
    const feedbackInstruction = invocation.context_projection.verification?.focus
      ? "Prior feedback and its execution delta are supplied as review context. Reassess those claims and inspect any relevant newly introduced risk without treating the prior review as truth."
      : "This is the initial independent review.";
    operationInstruction = [
      "Review the exact Candidate in the supplied disposable workspace. Do not edit files, change Git state, commit, or change refs.",
      REPOSITORY_HARNESS_COMPLETENESS_INSTRUCTIONS.verification,
      feedbackInstruction,
      "Inspect the exact base-to-Candidate diff, confirmed intent and Plan, repository-native guidance, completed deterministic evidence, and explicit unverified boundaries.",
      "Choose triage when the bounded facts are sufficient; choose deep_review when semantic inspection is necessary. This is one review depth decision inside this same Run, not a request for another reviewer.",
      "Return exactly verification_completed with one verdict-specific assessment: pass, pass_with_notes, changes_required, or human_decision_required.",
      "Every item in findings is blocking and therefore belongs only to changes_required. Positive confirmations belong in summary; bounded residual risk, style preference, unrelated debt, speculative improvement, and optional refactoring belong only in notes and cannot block passage.",
      "Use pass_with_notes only for bounded residual risks that do not require a change. Use human_decision_required only for a genuine unresolved choice and provide 2-8 distinct options.",
      "Checks listed in verification.scheduled_later_checks are controller-owned future gates. Their absence from completed_checks during this Candidate review is not missing evidence, must not become a finding, and must not be requested again; ChangeFleet will require them before Bundle assembly.",
      "Additional requested_checks are conditional passing evidence and are allowed only with pass or pass_with_notes. They must be non-interactive argv-style commands, additional to Plan checks, narrowly justified, and bounded; ChangeFleet executes them after this Run.",
      "Do not rely on your own command execution as authoritative evidence and do not include private reasoning, historical cost, or unrelated findings.",
    ].join(" ");
  } else if (invocation.operation === "review") {
    operationInstruction = [
      "Review the exact CandidateBundle across all supplied read-only Candidate workspaces. Do not edit files, change Git state, commit, change refs, or invent validation commands.",
      REPOSITORY_HARNESS_COMPLETENESS_INSTRUCTIONS.review,
      "Judge only the confirmed intent, current Plan, complete Bundle manifest, exact base-to-Candidate diffs, passing evidence, and explicit unverified risks. Repository verification and combined checks remain separate evidence owners.",
      "Return exactly bundle_review_completed with one disposition: pass, feedback, or gate.",
      "Use pass when no blocking correctness, security, compatibility, scope, confirmed-intent, cross-repository, data, or required-evidence issue remains. Optional improvements must be advisory findings and cannot block passage.",
      "Use feedback only for blocking findings that identify every exact affected repository_id and work_unit_id. The execution Agent will independently assess each claim.",
      "Every evidence_reference_id must copy one stable id present in the supplied exact review subject; use an empty array when no precise reference applies.",
      "Use gate only for a genuine unresolved human choice, ambiguous repair ownership, authority expansion, or Plan invalidation, and provide 2-8 distinct options.",
      "A passage recommendation is not Bundle acceptance, delivery, merge, or permission expansion. Do not include private reasoning, historical cost, or unrelated debt.",
    ].join(" ");
  } else {
    operationInstruction = [
      "Choose exactly one action_id from the supplied offered_actions; you may not invent, modify, combine, or execute an action.",
      "Treat failure descriptions and prior Agent findings as evidence-backed claims to classify, not as automatic facts.",
      "Prefer a bounded retry only when the evidence is consistent with a transient failure. Prefer submit_feedback for an implementation defect that remains inside the confirmed Plan. Prefer open_gate when authority, product intent, irreversibility, or the evidence remains genuinely uncertain.",
      "Do not use repository, shell, Git, network, credential, delivery, Bundle acceptance, or budget-changing capabilities.",
      "Return only supervisor_decision_proposal and copy the exact projection_digest from the supplied projection.",
    ].join(" ");
  }
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
  if (event.item.type === "todo_list") {
    // todo_list 是 Agent 主动声明的执行进度；只保留有界文本和完成位，不暴露推理或完整事件正文。
    itemMetadata.items = (Array.isArray(event.item.items)
      ? event.item.items
      : []
    )
      .slice(0, 32)
      .map((item) => ({
        text: String(item?.text ?? "").slice(0, 512),
        completed: item?.completed === true,
      }))
      .filter((item) => item.text.length > 0);
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
    if (signal?.reason?.code === "RUNTIME_INTERRUPTED") {
      return signal.reason;
    }
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
