import { readdir } from "node:fs/promises";

import { normalizeAgentProfile } from "../domain/agent-profile.js";
import { createDeliveryProjection } from "../domain/github-delivery.js";
import { ChangeFleetError, invariant } from "../domain/errors.js";
import { normalizeId } from "../domain/model.js";
import { derivePresentationActivity } from "../domain/lifecycle.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const AUDIT_DETAIL_ROWS = 10;
const MAX_PLANNING_CONVERSATION_TURNS = 12;
const MAX_PLANNING_MESSAGE_BYTES = 8 * 1024;
const MAX_PLANNING_CONVERSATION_BYTES = 48 * 1024;

// 该读模型只为本地 review/delivery console 提供有界投影；它不暴露 transcript、diff、日志或原始证据正文。
export class ChangeSetViewService {
  constructor({ controlStore, runStore, auditQueryService, agentProfile }) {
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
      runStore &&
        typeof runStore.readJsonArtifact === "function" &&
        typeof runStore.readEvents === "function",
      "INVALID_OPERATOR_APPLICATION",
      "ChangeSet view service requires linked Run artifact reads",
    );
    invariant(
      auditQueryService &&
        typeof auditQueryService.getChangeSetAudit === "function",
      "INVALID_OPERATOR_APPLICATION",
      "ChangeSet view service requires an audit query service",
    );
    this.controlStore = controlStore;
    this.runStore = runStore;
    this.auditQueryService = auditQueryService;
    this.agentProfile = normalizeAgentProfile(agentProfile);
  }

  async readIntakeOptions() {
    const catalog = await this.controlStore.readCatalog();
    return {
      schema_version: 1,
      agent_profile: projectAgentProfile(this.agentProfile),
      projects: Object.values(catalog.projects ?? {})
        .sort((left, right) => left.project_id.localeCompare(right.project_id))
        .map(projectIntakeOption),
    };
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
    const messageReference = state.planning_message_references.find(
      (reference) =>
        reference.message_id === state.current_approvable_plan_message_id,
    );
    const [planningMessage, planningConversation] = await Promise.all([
      messageReference
        ? this.runStore.readJsonArtifact(messageReference.artifact_reference)
        : null,
      this.readPlanningConversation(state),
    ]);
    return projectExactChangeSet(
      state,
      catalog.projects?.[state.project_id] ?? null,
      planningMessage,
      planningConversation,
    );
  }

  async readPlanningConversation(state) {
    // 人类视图从已链接证据重建最近轮次；ChangeSet 聚合和 Agent 上下文都不复制完整正文。
    const references = state.planning_message_references ?? [];
    const recent = references.slice(-MAX_PLANNING_CONVERSATION_TURNS);
    const turns = [];
    let encodedBytes = 0;
    let truncated = recent.length < references.length;
    for (const reference of [...recent].reverse()) {
      const [assistant, inputEvents] = await Promise.all([
        this.runStore.readJsonArtifact(reference.artifact_reference),
        this.runStore.readEvents(reference.run_id, {
          type: "planning.input",
          limit: 1,
        }),
      ]);
      const turn = projectPlanningTurn({
        reference,
        assistant,
        inputEvent: inputEvents[0] ?? null,
        approvableMessageId: state.current_approvable_plan_message_id,
      });
      const turnBytes = Buffer.byteLength(JSON.stringify(turn), "utf8");
      if (
        turns.length > 0 &&
        encodedBytes + turnBytes > MAX_PLANNING_CONVERSATION_BYTES
      ) {
        truncated = true;
        break;
      }
      turns.unshift(turn);
      encodedBytes += turnBytes;
    }
    return {
      turns,
      shown_turns: turns.length,
      total_turns: references.length,
      truncated,
    };
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

function projectAgentProfile(profile) {
  // 凭据选择只属于服务端 Runtime 装配；浏览器只看本次任务真正生效的非敏感摘要。
  return {
    profile_id: profile.profile_id,
    revision: profile.revision,
    provider: profile.provider,
    runtime: profile.runtime,
    model: profile.model,
    reasoning: profile.reasoning,
    permissions: profile.permissions,
    network_access: profile.network_access,
    skills: [...profile.skills],
  };
}

function projectIntakeOption(project) {
  return {
    project_id: project.project_id,
    description: project.description,
    repositories: [...project.repositories]
      .sort((left, right) =>
        left.repository_id.localeCompare(right.repository_id),
      )
      .map((repository) => ({
        repository_id: repository.repository_id,
        description: repository.description,
        default_target_ref: repository.default_target_ref,
        delivery_configured:
          repository.current_delivery_binding_revision !== null,
      })),
    task_policy: {
      verification: {
        minimum_mode: project.verification_policy.minimum_mode,
        default_attempt_timeout_ms:
          project.verification_policy.default_attempt_timeout_ms,
        max_attempt_timeout_ms:
          project.verification_policy.max_attempt_timeout_ms,
      },
      supervision: structuredClone(project.supervision_policy),
      bundle_review: {
        default_mode: project.bundle_review_policy.default_mode,
        max_attempts: project.bundle_review_policy.max_attempts,
        reviewer:
          project.bundle_review_policy.default_agent_profile_id === null
            ? null
            : {
                profile_id:
                  project.bundle_review_policy.default_agent_profile_id,
                revision:
                  project.bundle_review_policy
                    .default_agent_profile_revision,
              },
      },
    },
  };
}

function projectPlanningTurn({
  reference,
  assistant,
  inputEvent,
  approvableMessageId,
}) {
  return {
    run_id: reference.run_id,
    user_message: projectPlanningInput(inputEvent),
    assistant_message: {
      message_id: assistant.message_id,
      ...boundedPlanningText(assistant.text),
      has_plan: reference.has_plan,
      is_approvable: reference.message_id === approvableMessageId,
      created_at: assistant.created_at,
    },
  };
}

function projectPlanningInput(event) {
  if (event === null) return null;
  const value = event.payload?.text;
  if (typeof value === "string") {
    return { ...boundedPlanningText(value), created_at: event.at };
  }
  if (value && typeof value.preview === "string") {
    return {
      ...boundedPlanningText(value.preview, true),
      created_at: event.at,
    };
  }
  return null;
}

function boundedPlanningText(value, alreadyTruncated = false) {
  const text = String(value ?? "");
  if (Buffer.byteLength(text, "utf8") <= MAX_PLANNING_MESSAGE_BYTES) {
    return { text, truncated: alreadyTruncated };
  }
  let projected = "";
  let bytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > MAX_PLANNING_MESSAGE_BYTES) break;
    projected += character;
    bytes += characterBytes;
  }
  return { text: projected, truncated: true };
}

function projectListEntry(state) {
  const delivery = createDeliveryProjection(state);
  return {
    change_set_id: state.change_set_id,
    project_id: state.project_id,
    phase: state.phase,
    activity:
      state.phase === "delivery" || state.phase === "terminal"
        ? delivery.activity
        : derivePresentationActivity(state),
    updated_at: state.updated_at,
    current_intent: currentIntentSummary(state),
    current_revisions: currentRevisionSummary(state),
    blockers: summarizeBlockers(state.blockers ?? []),
    work_units: projectCurrentWorkUnits(state),
    gates: projectOpenGates(state),
    supervision: projectSupervision(state),
    task_workspace: projectTaskWorkspace(state.task_workspace),
    bundle: currentBundleSummary(state),
    delivery: {
      phase: delivery.phase,
      activity: delivery.activity,
      delivery_count: delivery.delivery_count,
      counts: delivery.counts,
    },
  };
}

function projectExactChangeSet(
  state,
  project,
  planningMessage,
  planningConversation,
) {
  const delivery = createDeliveryProjection(state);
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
    phase: state.phase,
    activity:
      state.phase === "delivery" || state.phase === "terminal"
        ? delivery.activity
        : derivePresentationActivity(state),
    updated_at: state.updated_at,
    current_intent: currentIntentSummary(state),
    current_revisions: currentRevisionSummary(state),
    blockers: summarizeBlockers(state.blockers ?? []),
    work_units: projectCurrentWorkUnits(state),
    gates: projectOpenGates(state),
    supervision: projectSupervision(state),
    repositories: (currentSelection?.repositories ?? []).map((selection) =>
      projectRepository(selection, project),
    ),
    planning_message:
      planningMessage === null
        ? null
        : {
            message_id: planningMessage.message_id,
            content_digest: planningMessage.content_digest,
            text: planningMessage.text,
            plan: projectPlanContent(planningMessage.plan_content),
            workspace_control: projectWorkspaceControl(
              planningMessage.workspace_control_summary,
            ),
          },
    planning_conversation: planningConversation,
    plan:
      currentPlan === null
        ? null
        : {
            revision: currentPlan.revision,
            status: currentPlan.status,
            ...projectPlanContent(currentPlan.semantic_plan),
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
            quality_review: projectBundleReview(state, currentBundle),
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
                verification_admission:
                  candidate?.verification_admission_id === null ||
                  candidate?.verification_admission_id === undefined
                    ? null
                    : structuredClone(
                        (state.verification_admissions ?? []).find(
                          (admission) =>
                            admission.admission_id ===
                            candidate.verification_admission_id,
                        ) ?? null,
                      ),
                verification_review:
                  candidate?.verification_review_id === null ||
                  candidate?.verification_review_id === undefined
                    ? null
                    : structuredClone(
                        (state.verification_reviews ?? []).find(
                          (review) =>
                            review.review_id ===
                            candidate.verification_review_id,
                        ) ?? null,
                      ),
                repository_evidence: {
                  evidence_id: bundleCandidate.repository_evidence.evidence_id,
                  evidence_hash:
                    bundleCandidate.repository_evidence.evidence_hash,
                  kind: bundleCandidate.repository_evidence.kind,
                },
              };
            }),
          },
    delivery,
  };
}

function projectPlanContent(plan) {
  if (plan === null) return null;
  return {
    summary: plan.summary,
    steps: [...plan.steps],
    validation: [...plan.validation],
    risks: [...plan.risks],
    assumptions: [...plan.assumptions],
    revision_feedback_assessments: structuredClone(
      plan.revision_feedback_assessments,
    ),
  };
}

function projectWorkspaceControl(summary) {
  if (!summary) return null;
  return {
    control_digest: summary.control_digest,
    task_workspace_id: summary.task_workspace_id,
    repository_selection_revision: summary.repository_selection_revision,
    repository_harness_selection_revision:
      summary.repository_harness_selection_revision,
    repositories: structuredClone(summary.repositories),
    agent_profile: structuredClone(summary.agent_profile),
    verification_expectation: structuredClone(
      summary.verification_expectation,
    ),
    supervision: structuredClone(summary.supervision),
    bundle_review: structuredClone(summary.bundle_review),
  };
}

function projectTaskWorkspace(workspace) {
  if (!workspace) return null;
  return {
    task_workspace_id: workspace.task_workspace_id,
    resources_released_at: workspace.resources_released_at,
    repositories: workspace.repositories.map((repository) => ({
      repository_id: repository.repository_id,
      base_sha: repository.base_sha,
      target_ref: repository.target_ref,
      branch_ref: repository.branch_ref,
      repository_workspace_id: repository.workspace.workspace_id,
    })),
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
      bundle_reviews: audit.payload.bundle_reviews,
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
    quality_review: projectBundleReviewSummary(state, bundle),
  };
}

function currentBundleReviewAssessment(state, bundle) {
  if (bundle === null) return null;
  return (
    (state.bundle_review_assessments ?? []).find(
      (assessment) =>
        assessment.assessment_id ===
          state.current_bundle_review_assessment_id &&
        assessment.bundle_id === bundle.bundle_id &&
        assessment.bundle_revision === bundle.revision &&
        assessment.bundle_hash === bundle.bundle_hash,
    ) ?? null
  );
}

// 列表只显示结论与 finding 数量；完整有界 finding 留在精确 ChangeSet 读模型。
function projectBundleReviewSummary(state, bundle) {
  const assessment = currentBundleReviewAssessment(state, bundle);
  if (assessment === null) return null;
  return {
    assessment_id: assessment.assessment_id,
    disposition: assessment.disposition,
    blocking_findings: assessment.findings.filter(
      (finding) => finding.severity === "blocking",
    ).length,
    advisory_findings: assessment.findings.filter(
      (finding) => finding.severity === "advisory",
    ).length,
  };
}

function projectBundleReview(state, bundle) {
  const assessment = currentBundleReviewAssessment(state, bundle);
  if (assessment === null) return null;
  return {
    assessment_id: assessment.assessment_id,
    run_id: assessment.run_id,
    plan_revision: assessment.plan_revision,
    bundle_id: assessment.bundle_id,
    bundle_revision: assessment.bundle_revision,
    bundle_hash: assessment.bundle_hash,
    subject_digest: assessment.subject_digest,
    disposition: assessment.disposition,
    summary: assessment.summary,
    findings: structuredClone(assessment.findings),
    human_decision: structuredClone(assessment.human_decision),
    agent_profile: {
      profile_id: assessment.agent_profile.profile_id,
      revision: assessment.agent_profile.revision,
      provider: assessment.agent_profile.provider,
      model: assessment.agent_profile.model,
    },
    created_at: assessment.created_at,
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

function projectCurrentWorkUnits(state) {
  return (state.work_units ?? [])
    .filter(
      (unit) =>
        unit.plan_revision === state.current_plan_revision &&
        unit.disposition === "current",
    )
    .map((unit) => ({
      active_run_id:
        unit.run_references
          .filter((reference) => ["queued", "running"].includes(reference.status))
          .at(-1)?.run_id ?? null,
      work_unit_id: unit.work_unit_id,
      repository_id: unit.repository_id,
      phase: unit.phase,
      activity: derivePresentationActivity(state, unit),
      pending_feedback_id: unit.pending_feedback_id ?? null,
      candidate_id: unit.candidate?.candidate_id ?? null,
    }));
}

function projectOpenGates(state) {
  return (state.gates ?? [])
    .filter((gate) => gate.status === "open")
    .map((gate) => ({
      gate_id: gate.gate_id,
      kind: gate.kind,
      work_unit_id: gate.work_unit_id ?? null,
      question: gate.request?.question ?? null,
      options: [...(gate.request?.options ?? [])],
      created_at: gate.created_at,
    }));
}

function projectSupervision(state) {
  const plan =
    state.plans.find(
      (candidate) => candidate.revision === state.current_plan_revision,
    ) ?? null;
  return {
    mode: plan?.supervision?.mode ?? "manual",
    plan_revision: plan?.revision ?? null,
    held: Boolean(state.supervision_control?.hold),
    hold: structuredClone(state.supervision_control?.hold ?? null),
    last_stop_reason: state.supervision_control?.last_stop_reason ?? null,
  };
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
