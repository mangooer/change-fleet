import { ChangeFleetService } from "../application/change-fleet-service.js";
import { ChangeSetViewService } from "../application/changeset-view-service.js";
import { RuntimeAuditQueryService } from "../application/runtime-audit-query-service.js";
import { AutonomousTaskController } from "../application/autonomous-task-controller.js";
import { createOperatorApplication } from "../application/operator-application.js";
import { TaskControlStore } from "../adapters/filesystem/task-control-store.js";
import { loadLocalCliConfig } from "./local-input.js";
import { createProductionRuntime } from "./lifecycle-command.js";
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
    environment = process.env,
    runtimeFactory = createProductionRuntime,
    openService = (options) => ChangeFleetService.open(options),
  } = {},
) {
  const config = await loadLocalCliConfig(command.config_path);
  // 本地控制台现在能够启动 Planner，因此必须与 CLI 生命周期命令装配同一个真实 Runtime。
  const runtime = await runtimeFactory(config, { environment });
  const service = await openService({
    controlRoot: config.control_root,
    workspaceRoot: config.workspace_root,
    runtime,
    agentProfile: config.agent_profile,
  });
  const auditQueryService = new RuntimeAuditQueryService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    evidenceStore: service.evidenceStore,
    locale: config.locale,
  });
  const taskControlStore = new TaskControlStore(config.control_root);
  await taskControlStore.initialize();
  const taskController = new AutonomousTaskController({
    service,
    taskControlStore,
  });
  await taskController.start();
  const queryService = new ChangeSetViewService({
    controlStore: service.controlStore,
    runStore: service.runStore,
    auditQueryService,
    agentProfile: config.agent_profile,
    taskControlStore,
  });
  const operatorApplication = createOperatorApplication(service, {
    operationHandlers: {
      "changeset.create": (request) => taskController.createChangeSet(request),
      "changeset.message": (request) => taskController.sendTaskMessage(request),
      "changeset.run.interrupt": (request) => taskController.interruptRun(request),
      "changeset.controller.run": (request) =>
        taskController.runTaskController(request),
      "changeset.close": (request) => taskController.cancelChangeSet(request),
      "changeset.bundle.decide": (request) =>
        taskController.recordBundleDecision(request),
      "changeset.delivery.publish": (request) =>
        taskController.publishDelivery(request),
      "changeset.delivery.refresh": (request) =>
        taskController.refreshDelivery(request),
    },
  });
  const server = await startLocalConsoleServer({
    host: "127.0.0.1",
    port: command.port ?? 0,
    locale: config.locale,
    queryService,
    operatorApplication,
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
        await taskController.stop();
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
