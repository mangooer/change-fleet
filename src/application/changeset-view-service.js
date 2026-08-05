import { readdir } from "node:fs/promises";

import { createDeliveryProjection } from "../domain/github-delivery.js";
import { ChangeFleetError, invariant } from "../domain/errors.js";
import { normalizeId } from "../domain/model.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const AUDIT_DETAIL_ROWS = 10;

// 该读模型只为本地 review/delivery console 提供有界投影；它不暴露 transcript、diff、日志或原始证据正文。
export class ChangeSetViewService {
  constructor({ controlStore, auditQueryService }) {
    invariant(
      controlStore && typeof controlStore.readChangeSet === "function",
      "INVALID_OPERATOR_APPLICATION",
      "ChangeSet view service requires a readable ControlStore",
    );
    invariant(
      controlStore && typeof controlStore.readCatalog === "function",
      "INVALID_OPERATOR_APPLICATION",
      "ChangeSet view service requires catalog reads",
    );
    invariant(
      auditQueryService &&
        typeof auditQueryService.getChangeSetAudit === "function",
      "INVALID_OPERATOR_APPLICATION",
      "ChangeSet view service requires an audit query service",
    );
    this.controlStore = controlStore;
    this.auditQueryService = auditQueryService;
  }

  async listChangeSets(query = {}) {
    const { limit, cursor } = normalizeListQuery(query);
    const states = await this.readAllChangeSets();
    states.sort(compareChangeSetStatesDescending);
    const startIndex =
      cursor === null
        ? 0
        : states.findIndex((state) => compareCursor(state, cursor) < 0);
    const page = states.slice(startIndex === -1 ? states.length : startIndex);
    const items = page.slice(0, limit).map(projectListEntry);
    return {
      limit,
      items,
      next_cursor: page.length > limit ? encodeCursor(page[limit - 1]) : null,
    };
  }

  async readChangeSetView(changeSetId) {
    normalizeId("change_set_id", changeSetId);
    const [state, catalog] = await Promise.all([
      this.controlStore.readChangeSet(changeSetId),
      this.controlStore.readCatalog(),
    ]);
    return projectExactChangeSet(
      state,
      catalog.projects?.[state.project_id] ?? null,
    );
  }

  async readAuditView(changeSetId) {
    normalizeId("change_set_id", changeSetId);
    const audit = await this.auditQueryService.getChangeSetAudit(changeSetId, {
      detail_page: 1,
      page_size: AUDIT_DETAIL_ROWS,
    });
    return projectAuditView(audit);
  }

  async readAllChangeSets() {
    let entries;
    try {
      entries = await readdir(this.controlStore.changeSetsRoot, {
        withFileTypes: true,
      });
    } catch (error) {
      throw new ChangeFleetError(
        "CHANGE_SET_NOT_FOUND",
        "ChangeSet control root could not be listed",
        { cause_code: error?.code ?? "UNEXPECTED_ERROR" },
      );
    }
    const ids = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const reads = await Promise.all(
      ids.map(async (changeSetId) => {
        try {
          return await this.controlStore.readChangeSet(changeSetId);
        } catch (error) {
          if (error?.code === "CHANGE_SET_NOT_FOUND") return null;
          throw error;
        }
      }),
    );
    return reads.filter(Boolean);
  }
}

function projectListEntry(state) {
  const delivery = createDeliveryProjection(state);
  return {
    change_set_id: state.change_set_id,
    project_id: state.project_id,
    state: state.state,
    updated_at: state.updated_at,
    current_intent: currentIntentSummary(state),
    current_revisions: currentRevisionSummary(state),
    blockers: summarizeBlockers(state.blockers ?? []),
    bundle: currentBundleSummary(state),
    delivery: {
      state: delivery.state,
      delivery_count: delivery.delivery_count,
      counts: delivery.counts,
    },
  };
}

function projectExactChangeSet(state, project) {
  const currentSelection =
    state.repository_selection_revisions.find(
      (revision) =>
        revision.revision === state.current_repository_selection_revision,
    ) ?? null;
  const currentPlan =
    state.plans.find((plan) => plan.revision === state.current_plan_revision) ??
    null;
  const currentBundle = state.bundles.at(-1) ?? null;
  const bundleDecision =
    currentBundle === null
      ? null
      : (state.decisions ?? []).find(
          (decision) =>
            decision.type === "bundle_review" &&
            decision.bundle_revision === currentBundle.revision &&
            decision.bundle_hash === currentBundle.bundle_hash,
        ) ?? null;
  return {
    change_set_id: state.change_set_id,
    project_id: state.project_id,
    state: state.state,
    updated_at: state.updated_at,
    current_intent: currentIntentSummary(state),
    current_revisions: currentRevisionSummary(state),
    blockers: summarizeBlockers(state.blockers ?? []),
    repositories: (currentSelection?.repositories ?? []).map((selection) =>
      projectRepository(selection, project),
    ),
    plan:
      currentPlan === null
        ? null
        : {
            revision: currentPlan.revision,
            status: currentPlan.status,
            rationale: currentPlan.rationale,
            risks: [...currentPlan.risks],
            unverified_boundaries: [...currentPlan.unverified_boundaries],
            work_units: currentPlan.work_units.map((unit) => ({
              work_unit_id: unit.work_unit_id,
              repository_id: unit.repository_id,
              task: unit.task,
              dependencies: [...unit.dependencies],
              target_ref: unit.target_ref,
              base_sha: unit.base_sha,
              repository_check: {
                command_id: unit.repository_check.command_id,
                timeout_ms: unit.repository_check.timeout_ms,
              },
            })),
            combined_check: {
              command_id: currentPlan.combined_check.command_id,
              timeout_ms: currentPlan.combined_check.timeout_ms,
            },
          },
    bundle:
      currentBundle === null
        ? null
        : {
            bundle_id: currentBundle.bundle_id,
            revision: currentBundle.revision,
            bundle_hash: currentBundle.bundle_hash,
            plan_revision: currentBundle.plan_revision,
            combined_validation_evidence:
              currentBundle.combined_validation_evidence === null
                ? null
                : {
                    evidence_id:
                      currentBundle.combined_validation_evidence.evidence_id,
                    evidence_hash:
                      currentBundle.combined_validation_evidence.evidence_hash,
                    kind: currentBundle.combined_validation_evidence.kind,
                  },
            human_decision:
              bundleDecision === null
                ? null
                : {
                    decision: bundleDecision.decision,
                    actor: bundleDecision.actor,
                    decided_at: bundleDecision.decided_at,
                  },
            candidates: currentBundle.candidates.map((bundleCandidate) => {
              const candidate = (state.candidates ?? []).find(
                (item) => item.candidate_id === bundleCandidate.candidate_id,
              );
              return {
                candidate_id: bundleCandidate.candidate_id,
                repository_id: bundleCandidate.repository_id,
                target_ref: bundleCandidate.target_ref,
                base_sha: bundleCandidate.base_sha,
                candidate_sha: bundleCandidate.candidate_sha,
                changed_paths: [...(candidate?.changed_paths ?? [])],
                repository_evidence: {
                  evidence_id: bundleCandidate.repository_evidence.evidence_id,
                  evidence_hash:
                    bundleCandidate.repository_evidence.evidence_hash,
                  kind: bundleCandidate.repository_evidence.kind,
                },
              };
            }),
          },
    delivery: createDeliveryProjection(state),
  };
}

function projectRepository(selection, project) {
  const repository = project?.repositories?.find(
    (candidate) => candidate.repository_id === selection.repository_id,
  );
  const binding =
    repository?.delivery_binding_revisions?.find(
      (candidate) =>
        candidate.revision === repository.current_delivery_binding_revision,
    ) ?? null;
  return {
    repository_id: selection.repository_id,
    branch_ref: selection.branch_ref,
    target_ref: selection.target_ref,
    resolved_base_sha: selection.resolved_base_sha,
    delivery_binding:
      binding === null
        ? { status: "missing" }
        : {
            status: "configured",
            revision: binding.revision,
            github_repository: binding.github_repository,
            push_remote: binding.push_remote,
          },
  };
}

function projectAuditView(audit) {
  return {
    audit_projection_schema_version: audit.audit_projection_schema_version,
    generated_at: audit.generated_at,
    payload_digest: audit.payload_digest,
    source_identity: audit.source_identity,
    payload: {
      identity: audit.payload.identity,
      timing: audit.payload.timing,
      usage: audit.payload.usage,
      outcomes: audit.payload.outcomes,
      validation: audit.payload.validation,
      bundles: audit.payload.bundles,
      human_review: audit.payload.human_review,
      diagnostics: audit.payload.diagnostics,
      runs: audit.payload.runs,
    },
  };
}

function currentIntentSummary(state) {
  const current =
    state.intents.find(
      (intent) => intent.revision === state.current_intent_revision,
    ) ?? null;
  return current === null
    ? null
    : {
        revision: current.revision,
        objective: current.objective,
        confirmed_at: current.confirmed_at,
      };
}

function currentRevisionSummary(state) {
  return {
    intent_revision: state.current_intent_revision,
    repository_selection_revision: state.current_repository_selection_revision,
    repository_harness_selection_revision:
      state.current_repository_harness_selection_revision,
    plan_revision: state.current_plan_revision,
  };
}

function currentBundleSummary(state) {
  const bundle = state.bundles.at(-1) ?? null;
  if (bundle === null) return null;
  const decision =
    (state.decisions ?? []).find(
      (item) =>
        item.type === "bundle_review" &&
        item.bundle_revision === bundle.revision &&
        item.bundle_hash === bundle.bundle_hash,
    ) ?? null;
  return {
    bundle_id: bundle.bundle_id,
    revision: bundle.revision,
    bundle_hash: bundle.bundle_hash,
    candidate_count: bundle.candidates.length,
    human_decision: decision?.decision ?? null,
  };
}

function summarizeBlockers(blockers) {
  return blockers.slice(0, 10).map((blocker) => ({
    code: blocker.code ?? "UNKNOWN",
    work_unit_id: blocker.work_unit_id ?? null,
    command_id: blocker.command_id ?? null,
    blocker_code: blocker.blocker_code ?? null,
    validation_subject_hash: blocker.validation_subject_hash ?? null,
    resolved_at: blocker.resolved_at ?? null,
  }));
}

function normalizeListQuery(query) {
  invariant(
    query && typeof query === "object" && !Array.isArray(query),
    "INVALID_OPERATOR_REQUEST",
    "ChangeSet list query must be one object",
  );
  const allowed = new Set(["limit", "cursor"]);
  invariant(
    Object.keys(query).every((key) => allowed.has(key)),
    "INVALID_OPERATOR_REQUEST",
    "ChangeSet list query contains an unsupported field",
  );
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  invariant(
    Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_PAGE_SIZE,
    "INVALID_OPERATOR_REQUEST",
    `ChangeSet list limit must be between 1 and ${MAX_PAGE_SIZE}`,
  );
  return {
    limit,
    cursor: query.cursor === undefined ? null : decodeCursor(query.cursor),
  };
}

function encodeCursor(state) {
  return Buffer.from(
    JSON.stringify({
      updated_at: state.updated_at,
      change_set_id: state.change_set_id,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value) {
  invariant(
    typeof value === "string" && value.length > 0 && value.length <= 256,
    "INVALID_OPERATOR_REQUEST",
    "ChangeSet list cursor is invalid",
  );
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new ChangeFleetError(
      "INVALID_OPERATOR_REQUEST",
      "ChangeSet list cursor is invalid",
    );
  }
  invariant(
    parsed &&
      typeof parsed.updated_at === "string" &&
      typeof parsed.change_set_id === "string",
    "INVALID_OPERATOR_REQUEST",
    "ChangeSet list cursor is invalid",
  );
  normalizeId("change_set_id", parsed.change_set_id);
  return parsed;
}

function compareChangeSetStatesDescending(left, right) {
  return (
    right.updated_at.localeCompare(left.updated_at) ||
    right.change_set_id.localeCompare(left.change_set_id)
  );
}

function compareCursor(state, cursor) {
  return (
    state.updated_at.localeCompare(cursor.updated_at) ||
    state.change_set_id.localeCompare(cursor.change_set_id)
  );
}
