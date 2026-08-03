import { ControlStore } from "../adapters/filesystem/control-store.js";
import { EvidenceStore } from "../adapters/filesystem/evidence-store.js";
import { RunStore } from "../adapters/filesystem/run-store.js";
import { RuntimeAuditQueryService } from "../application/runtime-audit-query-service.js";
import { ChangeFleetError } from "../domain/errors.js";

// 审计路由只组合只读能力；共享根命令不能让它顺带获得初始化、Runtime、Git 或工作区权限。
export async function executeReadOnlyAudit(command) {
  try {
    const queryService = createReadOnlyAuditQuery(
      command.control_root,
      command.locale,
    );
    return command.subject === "run"
      ? await queryService.getRunAudit(command.subject_id)
      : await queryService.getChangeSetAudit(command.subject_id, command.query);
  } catch (error) {
    if (error instanceof ChangeFleetError) throw error;
    throw new ChangeFleetError(
      "AUDIT_COMMAND_FAILED",
      "The local audit query could not be completed",
      undefined,
      { locale: command.locale },
    );
  }
}

function createReadOnlyAuditQuery(controlRoot, locale) {
  const controlStore = new ControlStore(controlRoot);
  const runStore = new RunStore(controlRoot);
  const evidenceStore = new EvidenceStore(controlRoot);
  return new RuntimeAuditQueryService({
    controlStore: Object.freeze({
      readChangeSet: controlStore.readChangeSet.bind(controlStore),
    }),
    runStore: Object.freeze({ read: runStore.read.bind(runStore) }),
    evidenceStore: Object.freeze({ read: evidenceStore.read.bind(evidenceStore) }),
    locale,
  });
}
