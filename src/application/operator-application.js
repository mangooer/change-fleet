import { invariant } from "../domain/errors.js";

// 该清单是所有外部操作面的共同权限边界；类上的内部方法不会因为可调用就自动成为产品命令。
const OPERATION_METHODS = Object.freeze({
  "project.register": "registerProject",
  "project.repository_workspace_policy.revise":
    "reviseRepositoryWorkspacePolicy",
  "project.repository_delivery.github.configure":
    "configureGithubDelivery",
  "changeset.create": "createChangeSet",
  "changeset.close": "closeChangeSet",
  "changeset.feedback.submit": "submitFeedback",
  "changeset.run.interrupt": "interruptRun",
  "changeset.gate.resolve": "resolveGate",
  "changeset.repository_selection.revise": "reviseRepositorySelection",
  "changeset.repository_harness_selection.revise":
    "reviseRepositoryHarnessSelection",
  "changeset.plan": "planChangeSet",
  "changeset.plan.confirm": "confirmPlanMessage",
  "changeset.candidate.recover_legacy": "recoverLegacyCandidate",
  "changeset.execute": "executeChangeSet",
  "changeset.supervision.start": "startSupervision",
  "changeset.supervision.pause": "pauseSupervision",
  "changeset.supervision.resume": "resumeSupervision",
  "changeset.supervision.progress": "readSupervisionProgress",
  "changeset.bundle.decide": "recordBundleDecision",
  "changeset.delivery.publish": "publishDelivery",
  "changeset.delivery.read": "readDelivery",
  "changeset.delivery.refresh": "refreshDelivery",
  "changeset.read": "readChangeSet",
});

export const OPERATOR_OPERATIONS = Object.freeze(
  Object.keys(OPERATION_METHODS),
);

export function createOperatorApplication(service) {
  invariant(
    service && typeof service === "object",
    "INVALID_OPERATOR_APPLICATION",
    "Operator application requires one lifecycle service",
  );

  const handlers = {};
  for (const [operation, method] of Object.entries(OPERATION_METHODS)) {
    invariant(
      typeof service[method] === "function",
      "INVALID_OPERATOR_APPLICATION",
      `Lifecycle service does not implement ${method}`,
    );
    handlers[operation] =
      operation === "changeset.read"
        ? (request) => service[method](request.change_set_id)
        : (request) => service[method](request);
  }

  return Object.freeze({
    operations: OPERATOR_OPERATIONS,

    async execute(operation, request) {
      invariant(
        typeof handlers[operation] === "function",
        "UNSUPPORTED_OPERATOR_OPERATION",
        `Operator operation is not allowed: ${String(operation)}`,
      );
      invariant(
        isPlainObject(request),
        "INVALID_OPERATOR_REQUEST",
        "Operator request must be one JSON object",
      );
      return handlers[operation](request);
    },
  });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
