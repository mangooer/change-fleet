import { CodexSdkRuntime } from "../adapters/runtime/codex-sdk-runtime.js";
import { ChangeFleetService } from "../application/change-fleet-service.js";
import { createOperatorApplication } from "../application/operator-application.js";
import { ChangeFleetError } from "../domain/errors.js";
import {
  loadLocalCliConfig,
  loadStructuredRequest,
} from "./local-input.js";

// 生命周期入口只装配已接受的真实 Provider；测试替身只能通过未暴露给进程参数的函数依赖注入。
export async function executeLifecycleCommand(
  command,
  {
    stdin = process.stdin,
    environment = process.env,
    runtimeFactory = createProductionRuntime,
    openService = (options) => ChangeFleetService.open(options),
  } = {},
) {
  const config = await loadLocalCliConfig(command.config_path);
  try {
    const request =
      command.request ??
      (await loadStructuredRequest(command.request_source, { stdin }));
    const runtime = await runtimeFactory(config, {
      environment,
    });
    const service = await openService({
      controlRoot: config.control_root,
      workspaceRoot: config.workspace_root,
      runtime,
      agentProfile: config.agent_profile,
    });
    return createOperatorApplication(service).execute(
      command.operation,
      request,
    );
  } catch (error) {
    if (error && typeof error === "object") {
      error.presentation_locale = config.locale;
    }
    throw error;
  }
}

export function createProductionRuntime(
  config,
  { environment = process.env } = {},
) {
  if (
    config.runtime.adapter !== "codex-sdk" ||
    !new Set(["local_codex_home", "openai_api_key"]).has(
      config.runtime.credential_source,
    )
  ) {
    throw new ChangeFleetError(
      "UNSUPPORTED_CLI_RUNTIME",
      "The local CLI Runtime selection is unsupported",
    );
  }
  if (config.runtime.credential_source === "openai_api_key") {
    const apiKey = environment.OPENAI_API_KEY;
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new ChangeFleetError(
        "CODEX_CREDENTIALS_UNAVAILABLE",
        "OPENAI_API_KEY is not available for the selected credential source",
      );
    }
    return new CodexSdkRuntime({
      apiKey,
      // API Key 只替代认证来源；Provider 的其余本机状态仍来自操作者显式选择的环境。
      codexHome: config.runtime.codex_home,
      credentialProfileId: config.agent_profile.credential_profile_id,
      environment,
    });
  }
  return new CodexSdkRuntime({
    codexHome: config.runtime.codex_home,
    credentialProfileId: config.agent_profile.credential_profile_id,
    environment,
  });
}
