import { ChangeFleetService } from "../application/change-fleet-service.js";
import { ChangeSetViewService } from "../application/changeset-view-service.js";
import { RuntimeAuditQueryService } from "../application/runtime-audit-query-service.js";
import { createOperatorApplication } from "../application/operator-application.js";
import { loadLocalCliConfig } from "./local-input.js";
import { startLocalConsoleServer } from "./local-console-server.js";

// `serve` 只把已配置的 control root 以前台 loopback 进程投影为本地 console；它不经 CLI 子进程，也不暴露通用 API。
export async function executeServeCommand(
  command,
  {
    stdout = process.stdout,
    signalHandlers = {
      on: process.on.bind(process),
      off: process.off.bind(process),
    },
    openService = (options) => ChangeFleetService.open(options),
  } = {},
) {
  const config = await loadLocalCliConfig(command.config_path);
  const service = await openService({
    controlRoot: config.control_root,
    workspaceRoot: config.workspace_root,
    runtime: null,
    agentProfile: config.agent_profile,
  });
  const auditQueryService = new RuntimeAuditQueryService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    evidenceStore: service.evidenceStore,
    locale: config.locale,
  });
  const queryService = new ChangeSetViewService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    auditQueryService,
  });
  const server = await startLocalConsoleServer({
    host: "127.0.0.1",
    port: command.port ?? 0,
    locale: config.locale,
    queryService,
    operatorApplication: createOperatorApplication(service),
  });
  stdout.write(
    `ChangeFleet local console listening on http://${server.host}:${server.port}/\n`,
  );

  await new Promise((resolve, reject) => {
    let finished = false;
    const onSignal = () => void shutdown();
    const cleanup = () => {
      signalHandlers.off("SIGINT", onSignal);
      signalHandlers.off("SIGTERM", onSignal);
    };
    const shutdown = async () => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        await server.close();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    signalHandlers.on("SIGINT", onSignal);
    signalHandlers.on("SIGTERM", onSignal);
  });
}
