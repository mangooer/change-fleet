import { randomUUID } from "node:crypto";
import path from "node:path";

import { sha256, stableId } from "../domain/canonical-json.js";
import {
  assertChangeSetMutable,
  commandFingerprint,
  createCandidateCheckpoint,
  createConfirmedPlan,
  normalizeHumanDecision,
  normalizeChangeSetCloseRequest,
  normalizeId,
  normalizeIntent,
  normalizePlanContent,
  normalizePlanningMessageText,
  normalizeRepositorySelectionRequest,
  normalizeRevisionFeedback,
  normalizeRevisionFeedbackAssessments,
} from "../domain/model.js";
import {
  assessInitialContext,
  createContextProjection,
  createControlContract,
} from "../domain/runtime-context.js";
import { normalizeAgentProfile } from "../domain/agent-profile.js";
import {
  assertValidationAttemptBudgetRequestsMatchPlan,
  normalizeOperatorAdmissionMode,
  normalizeValidationAttemptBudgetRequests,
  normalizeVerificationPolicy,
  selectValidationAttemptBudgetRequest,
} from "../domain/verification.js";
import {
  HARNESS_SELECTION_MODES,
  createExactBaseHarnessSelection,
  createOverlayHarnessSelection,
  normalizeRepositoryHarnessSelectionRequest,
  normalizeRepositoryWorkspacePolicy,
} from "../domain/repository-harness.js";
import {
  ChangeFleetError,
  attachSecondaryFailure,
  invariant,
  preserveSecondaryFailure,
} from "../domain/errors.js";
import { ControlStore, CONTROL_SCHEMA_VERSION } from "../adapters/filesystem/control-store.js";
import { EvidenceStore } from "../adapters/filesystem/evidence-store.js";
import { HarnessSnapshotStore } from "../adapters/filesystem/harness-snapshot-store.js";
import { RunStore } from "../adapters/filesystem/run-store.js";
import { DeliveryGitAdapter } from "../adapters/git/delivery-git-adapter.js";
import { RepositoryWorker } from "../adapters/git/repository-worker.js";
import { GhPullRequestAdapter } from "../adapters/github/gh-pull-request-adapter.js";
import { measureInitialContext } from "../adapters/runtime/runtime-port.js";
import { CombinedValidator } from "./combined-validator.js";
import { GithubDeliveryService } from "./github-delivery-service.js";
import { FeedbackService } from "./feedback-service.js";
import {
  RunCoordinator,
  runTerminalStatusForError,
} from "./run-coordinator.js";
import { ChangeSetRunService } from "./change-set-run-service.js";
import { SupervisionOrchestrator } from "./supervision-orchestrator.js";
import { VerificationOrchestrator } from "./verification-orchestrator.js";
import { BundleReviewOrchestrator } from "./bundle-review-orchestrator.js";
import { RunRecoveryService } from "./run-recovery-service.js";
import { RepositoryValidator } from "./repository-validator.js";
import { BundleAssembler } from "./bundle-assembler.js";
import {
  createAgentRunRecord,
  createRunReference,
  currentWorkUnits,
  isCurrentWorkUnit,
  setChangeSetPhase,
  setWorkUnitPhase,
  supersedeWorkUnit,
} from "../domain/lifecycle.js";
import {
  executionFailureIsRetryable,
  normalizeSupervisionPolicy,
} from "../domain/supervision.js";
import {
  bundleReviewAllowsHumanDecision,
  bundleReviewAssessmentMatches,
  normalizeBundleReviewPolicy,
} from "../domain/bundle-review.js";

const MAX_CONTEXT_HARNESS_RESOURCES = 32;
// 应用服务是确定性编排入口：语义工作交给 Runtime，权限、状态和证据在此裁决。
export class ChangeFleetService {
  constructor({
    controlRoot,
    workspaceRoot,
    runtime,
    agentProfile,
    verificationRuntime = runtime,
    verificationAgentProfile = agentProfile,
    supervisionRuntime = runtime,
    supervisionAgentProfile = null,
    reviewRuntime = runtime,
    reviewAgentProfile = null,
    clock = () => new Date(),
    idFactory = (prefix) => `${prefix}-${randomUUID()}`,
    deliveryGitAdapter = new DeliveryGitAdapter(),
    githubPullRequestAdapter = new GhPullRequestAdapter(),
  }) {
    this.controlRoot = path.resolve(controlRoot);
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.runtime = runtime;
    // 生产构造必须显式装配 Profile；测试 Runtime 也只能通过测试代码主动注入。
    this.agentProfile = normalizeAgentProfile(agentProfile);
    // 验证独立记录 Profile/Run；首个本地装配可复用 Provider，但调用者能够注入不同模型或 Runtime。
    this.verificationRuntime = verificationRuntime;
    this.verificationAgentProfile = normalizeAgentProfile(
      verificationAgentProfile,
    );
    this.supervisionRuntime = supervisionRuntime;
    this.supervisionAgentProfile = normalizeAgentProfile(
      supervisionAgentProfile ?? readOnlySupervisorProfile(agentProfile),
    );
    this.reviewRuntime = reviewRuntime;
    this.reviewAgentProfile = normalizeAgentProfile(
      reviewAgentProfile ?? readOnlyReviewProfile(agentProfile),
    );
    this.clock = clock;
    this.idFactory = idFactory;
    this.instanceId = idFactory("controller");
    this.controlStore = new ControlStore(this.controlRoot, { clock });
    this.runStore = new RunStore(this.controlRoot);
    this.evidenceStore = new EvidenceStore(this.controlRoot);
    this.harnessSnapshotStore = new HarnessSnapshotStore(this.controlRoot);
    this.repositoryWorker = new RepositoryWorker({
      workspaceRoot: this.workspaceRoot,
    });
    this.combinedValidator = new CombinedValidator({
      controlRoot: this.controlRoot,
      repositoryWorker: this.repositoryWorker,
      evidenceStore: this.evidenceStore,
      clock,
    });
    this.repositoryValidator = new RepositoryValidator({
      repositoryWorker: this.repositoryWorker,
      evidenceStore: this.evidenceStore,
      now: () => this.now(),
    });
    this.bundleAssembler = new BundleAssembler({
      controlStore: this.controlStore,
      now: () => this.now(),
    });
    this.githubDeliveryService = new GithubDeliveryService({
      controlStore: this.controlStore,
      evidenceStore: this.evidenceStore,
      repositoryWorker: this.repositoryWorker,
      deliveryGitAdapter,
      githubPullRequestAdapter,
      clock,
      controllerId: this.instanceId,
    });
    this.runService = new ChangeSetRunService({
      controlStore: this.controlStore,
      runStore: this.runStore,
      repositoryWorker: this.repositoryWorker,
      harnessSnapshotStore: this.harnessSnapshotStore,
      workspaceRoot: this.workspaceRoot,
      idFactory,
      now: () => this.now(),
    });
    this.runCoordinator = new RunCoordinator({
      appendEvent: (runId, event) =>
        this.runService.appendRuntimeEvent(runId, event),
      runStore: this.runStore,
      evidenceStore: this.evidenceStore,
      idFactory,
      now: () => this.now(),
    });
    this.feedbackService = new FeedbackService({ idFactory, clock });
    this.verificationOrchestrator = new VerificationOrchestrator({
      controlStore: this.controlStore,
      runStore: this.runStore,
      repositoryValidator: this.repositoryValidator,
      combinedValidator: this.combinedValidator,
      repositoryWorker: this.repositoryWorker,
      harnessSnapshotStore: this.harnessSnapshotStore,
      runCoordinator: this.runCoordinator,
      feedbackService: this.feedbackService,
      verificationRuntime,
      verificationAgentProfile: this.verificationAgentProfile,
      idFactory,
      now: () => this.now(),
      currentPlan,
      currentRepositorySelection,
      currentRepositoryHarnessSelection,
      unitsForCurrentPlan,
      requireProject,
      requireRepository,
      resolveValidationBlockers,
      stableErrorCode,
      verificationReviewAsRevisionFeedback,
      harnessSelectionForContext,
      harnessResourcesForContext,
      overlayHarnessResources,
      repositoryHarnessObservation,
    });
    this.bundleReviewOrchestrator = new BundleReviewOrchestrator({
      controlStore: this.controlStore,
      runStore: this.runStore,
      runCoordinator: this.runCoordinator,
      runService: this.runService,
      feedbackService: this.feedbackService,
      bundleAssembler: this.bundleAssembler,
      repositoryWorker: this.repositoryWorker,
      harnessSnapshotStore: this.harnessSnapshotStore,
      reviewRuntime,
      reviewAgentProfile: this.reviewAgentProfile,
      idFactory,
      now: () => this.now(),
      validateCombinedCandidates: (input) =>
        this.verificationOrchestrator.validateCombinedCandidates(input),
      currentPlan,
      currentRepositorySelection,
      currentRepositoryHarnessSelection,
      unitsForCurrentPlan,
      requireProject,
      requireRepository,
      resolveValidationBlockers,
      resolveFailedExecutionCommandBlockers,
      harnessSelectionForContext,
      overlayHarnessResources,
      repositoryHarnessObservation,
      cleanupBundleReviewResources,
      bundleReviewEvidenceReferenceIds,
      createBundleReviewProjection,
    });
    this.supervisionOrchestrator = new SupervisionOrchestrator({
      controlStore: this.controlStore,
      runStore: this.runStore,
      runCoordinator: this.runCoordinator,
      runService: this.runService,
      feedbackService: this.feedbackService,
      supervisionRuntime,
      supervisionAgentProfile: this.supervisionAgentProfile,
      workspaceRoot: this.workspaceRoot,
      schedulerOwnerId: this.instanceId,
      idFactory,
      now: () => this.now(),
      applyIdempotentCommand,
      requireProject,
      currentPlan,
      currentRepositorySelection,
      currentRepositoryHarnessSelection,
      unitsForCurrentPlan,
      resolveValidationBlockers,
      reconcileInterruptedRuns: (changeSetId, options) =>
        this.reconcileInterruptedRuns(changeSetId, options),
      executeWorkUnit: (changeSetId, workUnitId, options) =>
        this.executeWorkUnit(changeSetId, workUnitId, options),
      resumeWorkUnitValidation: (changeSetId, workUnitId) =>
        this.verificationOrchestrator.resumeWorkUnitValidation(
          changeSetId,
          workUnitId,
        ),
      prepareRetryableExecutions: (changeSetId, commandId, actor) =>
        this.prepareRetryableExecutions(changeSetId, commandId, actor),
      finalizeCurrentBundle: (changeSetId, options) =>
        this.bundleReviewOrchestrator.finalizeCurrentBundle(
          changeSetId,
          options,
        ),
      reviewCurrentBundle: (changeSetId) =>
        this.bundleReviewOrchestrator.reviewCurrentBundle(changeSetId),
    });
    this.runRecoveryService = new RunRecoveryService({
      controlStore: this.controlStore,
      runStore: this.runStore,
      harnessSnapshotStore: this.harnessSnapshotStore,
      repositoryWorker: this.repositoryWorker,
      cleanupPlanningWorkspaces: (input) =>
        this.runService.cleanupPlanningWorkspaces(input),
      recordRuntimeEvidence: (input) =>
        this.runCoordinator.recordRuntimeEvidence(input),
      idFactory,
      now: () => this.now(),
    });
  }

  static async open(options) {
    // 只返回完成存储初始化的实例，避免首个命令与目录创建发生竞争。
    const service = new ChangeFleetService(options);
    await Promise.all([
      service.controlStore.initialize(),
      service.runStore.initialize(),
      service.evidenceStore.initialize(),
      service.harnessSnapshotStore.initialize(),
    ]);
    return service;
  }

  async registerProject({ idempotency_key, project }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("project_id", project.project_id);
    invariant(
      // 项目可只有一个仓库；计划阶段才决定本次 ChangeSet 实际授权的非空子集。
      Array.isArray(project.repositories) && project.repositories.length >= 1,
      "INVALID_PROJECT_REPOSITORIES",
      "A Project requires at least one explicitly registered Repository",
    );
    const repositories = [];
    const repositoryIds = new Set();
    for (const input of project.repositories) {
      normalizeId("repository_id", input.repository_id);
      invariant(
        !repositoryIds.has(input.repository_id),
        "DUPLICATE_REPOSITORY",
        `Duplicate Repository ${input.repository_id}`,
      );
      repositoryIds.add(input.repository_id);
      const inspected = await this.repositoryWorker.inspectRegistration({
        repositoryId: input.repository_id,
        locator: input.locator.path,
        defaultTargetRef: input.default_target_ref ?? null,
      });
      repositories.push({
        ...inspected,
        description: optionalString(input.description),
        workspace_policy_revisions: [],
        current_workspace_policy_revision: null,
        delivery_binding_revisions: [],
        current_delivery_binding_revision: null,
      });
    }
    repositories.sort((left, right) =>
      left.repository_id.localeCompare(right.repository_id),
    );
    const bundleReviewPolicy = normalizeBundleReviewPolicy(
      project.bundle_review_policy,
    );
    invariant(
      bundleReviewPolicy.default_agent_profile_id === null ||
        (bundleReviewPolicy.default_agent_profile_id ===
          this.reviewAgentProfile.profile_id &&
          bundleReviewPolicy.default_agent_profile_revision ===
            this.reviewAgentProfile.revision),
      "REVIEW_AGENT_PROFILE_MISMATCH",
      "Project Bundle review policy must bind the configured Review AgentProfile",
    );
    const normalizedProject = {
      project_id: project.project_id,
      description: optionalString(project.description),
      verification_policy: normalizeVerificationPolicy(
        project.verification_policy,
      ),
      supervision_policy: normalizeSupervisionPolicy(
        project.supervision_policy,
      ),
      bundle_review_policy: bundleReviewPolicy,
      repositories,
      registered_at: this.now(),
    };
    const fingerprintInput = {
      project_id: normalizedProject.project_id,
      description: normalizedProject.description,
      repositories: normalizedProject.repositories.map((repository) => ({
        repository_id: repository.repository_id,
        locator: repository.locator,
        description: repository.description,
        default_target_ref: repository.default_target_ref,
      })),
    };
    if (project.verification_policy !== undefined) {
      fingerprintInput.verification_policy = normalizedProject.verification_policy;
    }
    if (project.supervision_policy !== undefined) {
      fingerprintInput.supervision_policy = normalizedProject.supervision_policy;
    }
    if (project.bundle_review_policy !== undefined) {
      fingerprintInput.bundle_review_policy =
        normalizedProject.bundle_review_policy;
    }

    return this.controlStore.transactCatalog((catalog) =>
      applyIdempotentCommand({
        record: catalog,
        idempotencyKey: idempotency_key,
        command: "registerProject",
        input: fingerprintInput,
        perform: () => {
          invariant(
            !catalog.projects[project.project_id],
            "PROJECT_ALREADY_EXISTS",
            `Project ${project.project_id} already exists`,
          );
          const registeredRoots = new Set(
            Object.values(catalog.projects).flatMap((existingProject) =>
              existingProject.repositories.map((repository) =>
                comparablePath(repository.resolved_git_root),
              ),
            ),
          );
          for (const repository of repositories) {
            invariant(
              !registeredRoots.has(comparablePath(repository.resolved_git_root)),
              "AMBIGUOUS_SHARED_REPOSITORY",
              `Repository ${repository.resolved_git_root} is already registered to another Project`,
            );
          }
          catalog.projects[project.project_id] = normalizedProject;
          return structuredClone(normalizedProject);
        },
      }),
    );
  }

  async reviseRepositoryWorkspacePolicy({
    idempotency_key,
    project_id,
    repository_id,
    policy,
    actor = "human",
  }) {
    // 策略修订只改变后续 ChangeSet 的默认授权；既有 ChangeSet 快照不会被反向改写。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("project_id", project_id);
    normalizeId("repository_id", repository_id);
    const commandInput = {
      project_id,
      repository_id,
      policy: structuredClone(policy),
      actor,
    };
    return this.controlStore.transactCatalog((catalog) =>
      applyIdempotentCommand({
        record: catalog,
        idempotencyKey: idempotency_key,
        command: "reviseRepositoryWorkspacePolicy",
        input: commandInput,
        perform: () => {
          const project = requireProject(catalog, project_id);
          const repository = requireRepository(project, repository_id);
          const revision = repository.workspace_policy_revisions.length + 1;
          const normalized = normalizeRepositoryWorkspacePolicy(policy, {
            revision,
            confirmedAt: this.now(),
            actor,
          });
          const current = repository.workspace_policy_revisions.find(
            (candidate) =>
              candidate.revision ===
              repository.current_workspace_policy_revision,
          );
          if (current) {
            current.status = "superseded";
            current.superseded_at = this.now();
          }
          repository.workspace_policy_revisions.push(normalized);
          repository.current_workspace_policy_revision = revision;
          return {
            project_id,
            repository_id,
            workspace_policy_revision: revision,
            policy: structuredClone(normalized),
          };
        },
      }),
    );
  }

  async createChangeSet({
    idempotency_key,
    change_set_id,
    project_id,
    intent,
    planning_repository_ids,
    repository_selections,
    repository_harness_selections,
    actor = "human",
  }) {
    // 创建命令先固定调用者请求，再解析分支；已完成重试绝不能重新观察移动后的 ref。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("project_id", project_id);
    normalizeId("actor", actor);
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, project_id);
    const requestedSelection = normalizeRepositorySelectionRequest(project, {
      planningRepositoryIds: planning_repository_ids,
      repositorySelections: repository_selections,
    });
    const intentForFingerprint = normalizeIntent(intent, {
      revision: 1,
      confirmedAt: "",
    });
    const input = {
      change_set_id,
      project_id,
      intent: intentFingerprint(intentForFingerprint),
      repository_selection: requestedSelection,
      repository_harness_selection_request:
        harnessSelectionRequestFingerprint(
          repository_harness_selections,
        ),
      actor,
    };
    try {
      const existing = await this.controlStore.readChangeSet(change_set_id);
      return readIdempotentResult(
        existing,
        idempotency_key,
        "createChangeSet",
        input,
      );
    } catch (error) {
      if (error.code !== "CHANGE_SET_NOT_FOUND") throw error;
    }
    const requestedHarnessSelection =
      normalizeRepositoryHarnessSelectionRequest(project, {
        repositoryIds: requestedSelection.repository_ids,
        repositoryHarnessSelections: repository_harness_selections,
      });

    const now = this.now();
    const normalizedIntent = normalizeIntent(intent, {
      revision: 1,
      confirmedAt: now,
    });
    const repositorySelection = await this.resolveRepositorySelectionRevision({
      project,
      request: requestedSelection,
      revision: 1,
      confirmedAt: now,
    });
    const repositoryHarnessSelection =
      await this.resolveRepositoryHarnessSelectionRevision({
        project,
        repositorySelection,
        request: requestedHarnessSelection,
        revision: 1,
        confirmedAt: now,
        confirmedBy: actor,
      });
    const result = {
      change_set_id,
      repository_selection_revision: 1,
      repository_harness_selection_revision: 1,
      repositories: structuredClone(repositorySelection.repositories),
      repository_harness: structuredClone(
        repositoryHarnessSelection.repositories,
      ),
    };
    const fingerprint = commandFingerprint("createChangeSet", input);
    const state = {
      schema_version: CONTROL_SCHEMA_VERSION,
      change_set_id,
      project_id,
      verification_policy: structuredClone(project.verification_policy),
      supervision_policy: structuredClone(project.supervision_policy),
      bundle_review_policy: structuredClone(project.bundle_review_policy),
      phase: "planning",
      terminal_outcome: null,
      intents: [normalizedIntent],
      current_intent_revision: 1,
      repository_selection_revisions: [repositorySelection],
      current_repository_selection_revision: 1,
      repository_selection_change_requests: [],
      repository_harness_selection_revisions: [
        repositoryHarnessSelection,
      ],
      current_repository_harness_selection_revision: 1,
      plans: [],
      current_plan_revision: null,
      planning_message_references: [],
      current_approvable_plan_message_id: null,
      work_units: [],
      run_references: [],
      candidate_checkpoints: [],
      verification_admissions: [],
      verification_reviews: [],
      bundle_review_assessments: [],
      current_bundle_review_assessment_id: null,
      bundle_review_last_error: null,
      validation_attempts: [],
      candidates: [],
      bundles: [],
      delivery_requests: [],
      decisions: [],
      feedback_records: [],
      current_feedback_id: null,
      gates: [],
      blockers: [],
      supervision_control: {
        plan_revision: null,
        authorized_at: null,
        hold: null,
        last_stop_reason: null,
        updated_at: now,
      },
      commands: {
        [idempotency_key]: {
          command: "createChangeSet",
          fingerprint,
          status: "completed",
          result,
          completed_at: now,
        },
      },
      created_at: now,
      updated_at: now,
    };
    try {
      await this.controlStore.createChangeSet(state);
      return structuredClone(result);
    } catch (error) {
      if (error.code !== "CHANGE_SET_ALREADY_EXISTS") throw error;
      const existing = await this.controlStore.readChangeSet(change_set_id);
      return readIdempotentResult(
        existing,
        idempotency_key,
        "createChangeSet",
        input,
      );
    }
  }

  async closeChangeSet(request) {
    // 关闭只写控制事实：不解析基线、不触碰工作区，也不调用 Runtime、验证或交付端口。
    const {
      idempotency_key,
      change_set_id,
      actor,
      reason,
    } = normalizeChangeSetCloseRequest(request);
    const commandInput = { change_set_id, actor, reason };
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "closeChangeSet",
        input: commandInput,
        perform: () => {
          invariant(
            state.phase !== "terminal",
            "CHANGE_SET_ALREADY_TERMINAL",
            "ChangeSet is already terminal",
          );
          invariant(
            !state.run_references.some(
              (reference) => reference.status === "running",
            ) &&
              !Object.values(state.commands ?? {}).some(
                (command) => command.status === "in_progress",
              ),
            "CHANGE_SET_NOT_QUIESCENT",
            "ChangeSet has active lifecycle work",
          );
          invariant(
            (state.delivery_requests ?? []).length === 0,
            "CHANGE_SET_DELIVERY_STARTED",
            "ChangeSet delivery has already begun",
          );
          const closedAt = this.now();
          const decision = {
            decision_id: this.idFactory("decision"),
            type: "changeset_closure",
            disposition: "abandoned",
            actor,
            reason: structuredClone(reason),
            decided_at: closedAt,
          };
          state.decisions.push(decision);
          setChangeSetPhase(state, "terminal", "abandoned");
          state.updated_at = closedAt;
          return {
            change_set_id,
            status: "abandoned",
            decision_id: decision.decision_id,
            closed_at: closedAt,
          };
        },
      }),
    );
  }

  async submitFeedback({
    idempotency_key,
    change_set_id,
    phase,
    work_unit_id = null,
    run_id = null,
    feedback,
    actor = "human",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("actor", actor);
    if (work_unit_id !== null) normalizeId("work_unit_id", work_unit_id);
    if (run_id !== null) normalizeId("run_id", run_id);
    const content = normalizeRevisionFeedback(feedback);
    const commandInput = {
      change_set_id,
      phase,
      work_unit_id,
      run_id,
      feedback: content,
      actor,
    };
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "submitFeedback",
        input: commandInput,
        perform: () => {
          assertChangeSetMutable(state);
          invariant(
            state.phase === phase,
            "STALE_FEEDBACK_SUBJECT",
            `Feedback phase ${String(phase)} is no longer current`,
          );
          const runReference =
            run_id === null
              ? null
              : state.run_references.find(
                  (reference) => reference.run_id === run_id,
                );
          invariant(
            run_id === null || runReference,
            "STALE_FEEDBACK_SUBJECT",
            `Feedback Run ${String(run_id)} is not part of this ChangeSet`,
          );
          const workUnitId = work_unit_id ?? runReference?.work_unit_id ?? null;
          const workUnit =
            workUnitId === null
              ? null
              : unitsForCurrentPlan(state).find(
                  (unit) => unit.work_unit_id === workUnitId,
                );
          invariant(
            workUnitId === null || workUnit,
            "STALE_FEEDBACK_SUBJECT",
            `Feedback WorkUnit ${String(workUnitId)} is not current`,
          );
          const createdAt = this.now();
          const record = this.feedbackService.record(state, {
            source: "human",
            target: {
              change_set_id,
              phase,
              work_unit_id: workUnitId,
              run_id,
            },
            content,
            createdAt,
          });
          if (workUnit && workUnit.phase !== "complete") {
            workUnit.pending_feedback_id = record.feedback_id;
          }
          state.updated_at = createdAt;
          return {
            change_set_id,
            feedback_id: record.feedback_id,
            phase,
            work_unit_id: workUnitId,
            run_id,
            delivery:
              runReference?.status === "running"
                ? "next_run"
                : "recorded",
          };
        },
      }),
    );
  }

  async interruptRun({
    idempotency_key,
    change_set_id,
    run_id,
    actor = "human",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("run_id", run_id);
    normalizeId("actor", actor);
    const initialState = await this.controlStore.readChangeSet(change_set_id);
    const prior = existingCommand(
      initialState,
      idempotency_key,
      "interruptRun",
      { change_set_id, run_id, actor },
    );
    if (prior?.status === "completed") {
      return structuredClone(prior.result);
    }
    invariant(
      this.runCoordinator.isLocallyActive(run_id),
      "RUN_NOT_LOCALLY_ACTIVE",
      `Run ${run_id} has no active invocation owned by this controller`,
    );
    const result = await this.controlStore.transactChangeSet(
      change_set_id,
      (state) =>
        applyIdempotentCommand({
          record: state,
          idempotencyKey: idempotency_key,
          command: "interruptRun",
          input: { change_set_id, run_id, actor },
          perform: () => {
            const reference = state.run_references.find(
              (item) => item.run_id === run_id,
            );
            invariant(
              reference?.status === "running",
              "RUN_NOT_ACTIVE",
              `Run ${run_id} is not running`,
            );
            const requestedAt = this.now();
            state.decisions.push({
              decision_id: this.idFactory("decision"),
              type: "run_interruption_request",
              run_id,
              actor,
              decided_at: requestedAt,
            });
            state.updated_at = requestedAt;
            return {
              change_set_id,
              run_id,
              status: "interrupt_requested",
              requested_at: requestedAt,
            };
          },
        }),
    );
    this.runCoordinator.requestInterrupt(
      run_id,
      new ChangeFleetError(
        "RUNTIME_INTERRUPTED",
        `Run ${run_id} was interrupted by ${actor}`,
      ),
    );
    return result;
  }

  async resolveGate({
    idempotency_key,
    change_set_id,
    gate_id,
    option,
    actor = "human",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("gate_id", gate_id);
    normalizeId("actor", actor);
    invariant(
      typeof option === "string" && option.trim().length > 0,
      "INVALID_GATE_DECISION",
      "Gate resolution requires one exact option",
    );
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "resolveGate",
        input: { change_set_id, gate_id, option, actor },
        perform: () => {
          assertChangeSetMutable(state);
          const gate = state.gates.find((item) => item.gate_id === gate_id);
          invariant(
            gate?.status === "open" && gate.request.options.includes(option),
            "INVALID_GATE_DECISION",
            "Gate is not open or the selected option is not exact",
          );
          if (gate.kind === "supervision_decision") {
            const resolvedAt = this.now();
            gate.status = "resolved";
            gate.selected_option = option;
            gate.resolved_by = actor;
            gate.resolved_at = resolvedAt;
            if (option === "resume") {
              state.supervision_control.hold = null;
              state.supervision_control.last_stop_reason = null;
            }
            state.supervision_control.updated_at = resolvedAt;
            state.decisions.push({
              decision_id: this.idFactory("decision"),
              type: "supervision_gate_resolution",
              gate_id,
              option,
              actor,
              decided_at: resolvedAt,
            });
            state.updated_at = resolvedAt;
            return {
              change_set_id,
              gate_id,
              feedback_id: null,
              status: "resolved",
              selected_option: option,
            };
          }
          if (
            ["bundle_review_decision", "bundle_review_failure"].includes(
              gate.kind,
            )
          ) {
            // Bundle Gate 只记录人类答案；它不伪造 passage recommendation 或隐式改变 Plan。
            const resolvedAt = this.now();
            gate.status = "resolved";
            gate.selected_option = option;
            gate.resolved_by = actor;
            gate.resolved_at = resolvedAt;
            state.decisions.push({
              decision_id: this.idFactory("decision"),
              type: "bundle_review_gate_resolution",
              gate_id,
              bundle_id: gate.bundle_id,
              bundle_review_assessment_id:
                gate.bundle_review_assessment_id ?? null,
              option,
              actor,
              decided_at: resolvedAt,
            });
            state.updated_at = resolvedAt;
            return {
              change_set_id,
              gate_id,
              feedback_id: null,
              status: "resolved",
              selected_option: option,
            };
          }
          const workUnit = unitsForCurrentPlan(state).find(
            (unit) => unit.work_unit_id === gate.work_unit_id,
          );
          invariant(
            workUnit?.phase === "verification" && !workUnit.candidate,
            "STALE_GATE_SUBJECT",
            "Gate no longer binds the current verification subject",
          );
          const resolvedAt = this.now();
          const feedback = this.feedbackService.record(state, {
            source: "human",
            target: {
              change_set_id,
              phase: state.phase,
              work_unit_id: workUnit.work_unit_id,
              gate_id,
              verification_review_id: gate.verification_review_id,
            },
            content: {
              summary: gate.request.question,
              findings: [
                {
                  finding_id: "gate-choice",
                  text: `Human selected: ${option}`,
                },
              ],
            },
            createdAt: resolvedAt,
          });
          gate.status = "resolved";
          gate.selected_option = option;
          gate.resolved_by = actor;
          gate.resolved_at = resolvedAt;
          gate.feedback_id = feedback.feedback_id;
          workUnit.pending_feedback_id = feedback.feedback_id;
          state.updated_at = resolvedAt;
          return {
            change_set_id,
            gate_id,
            feedback_id: feedback.feedback_id,
            status: "resolved",
            selected_option: option,
          };
        },
      }),
    );
  }

  async reviseRepositorySelection({
    idempotency_key,
    change_set_id,
    current_repository_selection_revision,
    planning_repository_ids,
    repository_selections,
    repository_harness_selections,
    actor = "human",
  }) {
    // 修订先校验旧 revision，再解析新分支，避免旧页面覆盖刚刚确认的新选择。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("actor", actor);
    const catalog = await this.controlStore.readCatalog();
    let initialState = await this.controlStore.readChangeSet(change_set_id);
    const project = requireProject(catalog, initialState.project_id);
    const requestedSelection = normalizeRepositorySelectionRequest(project, {
      planningRepositoryIds: planning_repository_ids,
      repositorySelections: repository_selections,
    });
    const commandInput = {
      change_set_id,
      current_repository_selection_revision,
      repository_selection: requestedSelection,
      repository_harness_selection_request:
        harnessSelectionRequestFingerprint(
          repository_harness_selections,
        ),
      actor,
    };
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "reviseRepositorySelection",
      commandInput,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    assertChangeSetMutable(initialState);
    const requestedHarnessSelection =
      normalizeRepositoryHarnessSelectionRequest(project, {
        repositoryIds: requestedSelection.repository_ids,
        repositoryHarnessSelections: repository_harness_selections,
      });
    await this.reconcileInterruptedRuns(change_set_id, { project });
    initialState = await this.controlStore.readChangeSet(change_set_id);
    assertChangeSetMutable(initialState);
    assertRepositorySelectionRevisionAllowed(
      initialState,
      current_repository_selection_revision,
    );
    const nextRevision = initialState.repository_selection_revisions.length + 1;
    const nextSelection = await this.resolveRepositorySelectionRevision({
      project,
      request: requestedSelection,
      revision: nextRevision,
      confirmedAt: this.now(),
    });
    const nextHarnessRevision =
      initialState.repository_harness_selection_revisions.length + 1;
    const nextHarnessSelection =
      await this.resolveRepositoryHarnessSelectionRevision({
        project,
        repositorySelection: nextSelection,
        request: requestedHarnessSelection,
        revision: nextHarnessRevision,
        confirmedAt: this.now(),
        confirmedBy: actor,
      });

    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "reviseRepositorySelection",
        input: commandInput,
        perform: () => {
          assertChangeSetMutable(state);
          assertRepositorySelectionRevisionAllowed(
            state,
            current_repository_selection_revision,
          );
          const priorSelection = currentRepositorySelection(state);
          priorSelection.status = "superseded";
          priorSelection.superseded_at = this.now();
          const priorHarnessSelection =
            currentRepositoryHarnessSelection(state);
          priorHarnessSelection.status = "superseded";
          priorHarnessSelection.superseded_at = this.now();

          const priorPlan = currentPlan(state);
          if (priorPlan) priorPlan.status = "superseded";
          for (const workUnit of unitsForCurrentPlan(state)) {
            supersedeWorkUnit(workUnit);
          }

          state.repository_selection_revisions.push(nextSelection);
          state.current_repository_selection_revision = nextRevision;
          state.repository_harness_selection_revisions.push(
            nextHarnessSelection,
          );
          state.current_repository_harness_selection_revision =
            nextHarnessRevision;
          state.current_plan_revision = null;
          state.current_bundle_review_assessment_id = null;
          state.current_approvable_plan_message_id = null;
          this.feedbackService.clear(state);
          for (const request of state.repository_selection_change_requests) {
            if (request.status === "pending") {
              request.status = "resolved_by_revision";
              request.resolved_by_revision = nextRevision;
              request.resolved_at = this.now();
            }
          }
          state.decisions.push({
            decision_id: this.idFactory("decision"),
            type: "repository_selection_revision",
            from_revision: priorSelection.revision,
            to_revision: nextRevision,
            repository_harness_selection_revision: nextHarnessRevision,
            actor,
            decided_at: this.now(),
          });
          setChangeSetPhase(state, "planning");
          state.updated_at = this.now();
          return {
            change_set_id,
            repository_selection_revision: nextRevision,
            repository_harness_selection_revision: nextHarnessRevision,
            repositories: structuredClone(nextSelection.repositories),
            repository_harness: structuredClone(
              nextHarnessSelection.repositories,
            ),
          };
        },
      }),
    );
  }

  async reviseRepositoryHarnessSelection({
    idempotency_key,
    change_set_id,
    current_repository_harness_selection_revision,
    repository_harness_selections,
    actor = "human",
  }) {
    // Harness 修订沿用同一 ChangeSet，但必须废弃当前计划并生成新的上下文身份。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("actor", actor);
    const catalog = await this.controlStore.readCatalog();
    let initialState = await this.controlStore.readChangeSet(change_set_id);
    const project = requireProject(catalog, initialState.project_id);
    const repositorySelection = currentRepositorySelection(initialState);
    const commandInput = {
      change_set_id,
      current_repository_harness_selection_revision,
      repository_harness_selection_request:
        harnessSelectionRequestFingerprint(
          repository_harness_selections,
        ),
      actor,
    };
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "reviseRepositoryHarnessSelection",
      commandInput,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    assertChangeSetMutable(initialState);
    const request = normalizeRepositoryHarnessSelectionRequest(project, {
      repositoryIds: repositorySelection.repositories.map(
        (repository) => repository.repository_id,
      ),
      repositoryHarnessSelections: repository_harness_selections,
    });
    await this.reconcileInterruptedRuns(change_set_id, { project });
    initialState = await this.controlStore.readChangeSet(change_set_id);
    assertChangeSetMutable(initialState);
    assertRepositoryHarnessSelectionRevisionAllowed(
      initialState,
      current_repository_harness_selection_revision,
    );
    const revision =
      initialState.repository_harness_selection_revisions.length + 1;
    const nextSelection =
      await this.resolveRepositoryHarnessSelectionRevision({
        project,
        repositorySelection: currentRepositorySelection(initialState),
        request,
        revision,
        confirmedAt: this.now(),
        confirmedBy: actor,
      });

    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "reviseRepositoryHarnessSelection",
        input: commandInput,
        perform: () => {
          assertChangeSetMutable(state);
          assertRepositoryHarnessSelectionRevisionAllowed(
            state,
            current_repository_harness_selection_revision,
          );
          const prior = currentRepositoryHarnessSelection(state);
          prior.status = "superseded";
          prior.superseded_at = this.now();
          const priorPlan = currentPlan(state);
          if (priorPlan) priorPlan.status = "superseded";
          for (const workUnit of unitsForCurrentPlan(state)) {
            supersedeWorkUnit(workUnit);
          }
          state.repository_harness_selection_revisions.push(nextSelection);
          state.current_repository_harness_selection_revision = revision;
          state.current_plan_revision = null;
          state.current_bundle_review_assessment_id = null;
          state.current_approvable_plan_message_id = null;
          this.feedbackService.clear(state);
          state.decisions.push({
            decision_id: this.idFactory("decision"),
            type: "repository_harness_selection_revision",
            from_revision: prior.revision,
            to_revision: revision,
            actor,
            decided_at: this.now(),
          });
          setChangeSetPhase(state, "planning");
          state.updated_at = this.now();
          return {
            change_set_id,
            repository_harness_selection_revision: revision,
            repositories: structuredClone(nextSelection.repositories),
          };
        },
      }),
    );
  }

  async resolveRepositorySelectionRevision({
    project,
    request,
    revision,
    confirmedAt,
  }) {
    // 严格按规范化后的仓库顺序解析，使持久化和幂等结果具有稳定次序。
    const repositoriesById = new Map(
      project.repositories.map((repository) => [
        repository.repository_id,
        repository,
      ]),
    );
    const repositories = [];
    for (const requested of request.repositories) {
      const resolved = await this.repositoryWorker.resolveRepositorySelection(
        repositoriesById.get(requested.repository_id),
        {
          branchRef: requested.branch_ref,
          targetRef: requested.target_ref,
        },
      );
      repositories.push({
        ...resolved,
        resolved_at: this.now(),
      });
    }
    return {
      revision,
      status: "current",
      confirmed_at: confirmedAt,
      repositories,
    };
  }

  async resolveRepositoryHarnessSelectionRevision({
    project,
    repositorySelection,
    request,
    revision,
    confirmedAt,
    confirmedBy,
  }) {
    // 先持久化内容寻址快照，再把其不可变引用与 Git base 一起写入 ChangeSet。
    const repositoriesById = new Map(
      project.repositories.map((repository) => [
        repository.repository_id,
        repository,
      ]),
    );
    const basesById = new Map(
      repositorySelection.repositories.map((selection) => [
        selection.repository_id,
        selection,
      ]),
    );
    const repositories = [];
    for (const requested of request.repositories) {
      const repository = repositoriesById.get(requested.repository_id);
      const base = basesById.get(requested.repository_id);
      invariant(
        repository && base,
        "REPOSITORY_HARNESS_SELECTION_MISMATCH",
        `Harness selection has no matching Repository base: ${requested.repository_id}`,
      );
      if (requested.mode === HARNESS_SELECTION_MODES.EXACT_BASE_ONLY) {
        repositories.push(
          createExactBaseHarnessSelection({
            repositoryId: requested.repository_id,
            baseSha: base.resolved_base_sha,
          }),
        );
        continue;
      }
      const policy = repository.workspace_policy_revisions.find(
        (candidate) =>
          candidate.revision === requested.workspace_policy_revision,
      );
      invariant(
        policy,
        "REPOSITORY_HARNESS_POLICY_NOT_FOUND",
        `Repository ${requested.repository_id} has no Harness policy revision ${requested.workspace_policy_revision}`,
      );
      const overlay = await this.repositoryWorker.resolveHarnessOverlay({
        repository,
        baseSha: base.resolved_base_sha,
        policy,
      });
      const snapshotReference = await this.harnessSnapshotStore.record({
        repositoryId: repository.repository_id,
        baseSha: base.resolved_base_sha,
        providerFamily: requested.provider_family,
        policyRevision: policy.revision,
        selectorDigest: overlay.selector_digest,
        files: overlay.files,
        createdAt: this.now(),
      });
      repositories.push(
        createOverlayHarnessSelection({
          repositoryId: repository.repository_id,
          baseSha: base.resolved_base_sha,
          policy,
          snapshotReference,
          selectorDigest: overlay.selector_digest,
          files: overlay.files,
          skippedResources: overlay.skipped_resources,
        }),
      );
    }
    return {
      revision,
      status: "current",
      confirmed_by: confirmedBy,
      confirmed_at: confirmedAt,
      repositories,
    };
  }

  async planChangeSet({
    idempotency_key,
    change_set_id,
    agent_profile = null,
    message = null,
  }) {
    normalizeId("idempotency_key", idempotency_key);
    const userMessage =
      message === null
        ? null
        : normalizePlanningMessageText(message, "planning.message");
    const agentProfile = normalizeAgentProfile(
      agent_profile ?? this.agentProfile,
    );
    const catalog = await this.controlStore.readCatalog();
    let initialState = await this.controlStore.readChangeSet(change_set_id);
    const project = requireProject(catalog, initialState.project_id);
    const commandInput = {
      change_set_id,
      agent_profile: agentProfile,
      message: userMessage,
    };
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "planChangeSet",
      commandInput,
    );
    if (existing?.status === "completed") return structuredClone(existing.result);
    assertChangeSetMutable(initialState);
    await this.reconcileInterruptedRuns(change_set_id, { project });
    initialState = await this.controlStore.readChangeSet(change_set_id);
    assertChangeSetMutable(initialState);

    const repositorySelection = currentRepositorySelection(initialState);
    const repositoryHarnessSelection =
      currentRepositoryHarnessSelection(initialState);
    const projectRepositories = new Map(
      project.repositories.map((repository) => [
        repository.repository_id,
        repository,
      ]),
    );
    const selectedRepositories = repositorySelection.repositories.map(
      (selection) => projectRepositories.get(selection.repository_id),
    );
    const planningProject = {
      ...project,
      repositories: selectedRepositories,
    };
    const planningAttempt =
      initialState.run_references.filter(
        (reference) => reference.operation === "planning",
      ).length + 1;
    const runId = this.idFactory("run");
    const bases = {};
    const repositoriesForContext = [];
    const harnessObservations = [];
    const planningWorkspaces = [];
    // 规划只消费创建时已冻结的选择，不能再次读取分支 tip 或登记默认值。
    try {
      for (const selection of repositorySelection.repositories) {
        const repository = projectRepositories.get(selection.repository_id);
        const harnessSelection =
          repositoryHarnessSelection.repositories.find(
            (candidate) =>
              candidate.repository_id === selection.repository_id,
          );
        invariant(
          harnessSelection?.resolved_base_sha ===
            selection.resolved_base_sha,
          "REPOSITORY_HARNESS_SELECTION_MISMATCH",
          `Harness selection does not match Repository ${selection.repository_id}`,
        );
        const base = {
          repository_id: selection.repository_id,
          target_ref: selection.target_ref,
          base_sha: selection.resolved_base_sha,
        };
        let workspace =
          await this.repositoryWorker.preparePlanningWorkspace({
            repository,
            baseSha: base.base_sha,
            workspaceId: `planning-${runId}`,
          });
        planningWorkspaces.push(workspace);
        let overlaySnapshot = null;
        if (
          harnessSelection.mode ===
          HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
        ) {
          overlaySnapshot = await this.harnessSnapshotStore.read(
            harnessSelection.artifact_reference,
          );
          workspace = {
            ...workspace,
            harness_overlay: {
              ...harnessSelection.artifact_reference,
              paths: [...harnessSelection.resolved_relative_paths],
            },
          };
          planningWorkspaces[planningWorkspaces.length - 1] = workspace;
          workspace =
            await this.repositoryWorker.materializeHarnessOverlay({
              repository,
              workspace,
              snapshot: overlaySnapshot,
            });
          planningWorkspaces[planningWorkspaces.length - 1] = workspace;
        }
        bases[selection.repository_id] = base;
        const exactBaseHarness =
          await this.repositoryWorker.discoverHarness(
            repository,
            base.base_sha,
          );
        const frozenOverlayHarness =
          overlayHarnessResources(overlaySnapshot);
        const availableHarness = [
          ...exactBaseHarness,
          ...frozenOverlayHarness,
        ];
        harnessObservations.push(
          repositoryHarnessObservation({
            repositoryId: repository.repository_id,
            exactBaseResources: exactBaseHarness,
            overlayResources: frozenOverlayHarness,
          }),
        );
        repositoriesForContext.push({
          repository_id: repository.repository_id,
          description: repository.description,
          branch_ref: selection.branch_ref,
          target_ref: base.target_ref,
          base_sha: base.base_sha,
          root_path: workspace.workspace_path,
          harness_selection: harnessSelectionForContext(harnessSelection),
          ...harnessResourcesForContext(availableHarness),
        });
      }
    } catch (error) {
      // 部分创建失败时，只清理已经验证归属的规划 worktree。
      await preserveSecondaryFailure(
        error,
        "planning_workspace_cleanup",
        () =>
          this.runService.cleanupPlanningWorkspaces({
            planningWorkspaces,
            projectRepositories,
          }),
      );
      throw error;
    }

    const controlContract = createControlContract({
      operation: "planning",
      changeSetId: change_set_id,
      planRevision: initialState.current_plan_revision,
      repositorySelectionRevision: repositorySelection.revision,
      repositoryHarnessSelectionRevision:
        repositoryHarnessSelection.revision,
      authorizedRepositories: repositorySelection.repositories.map(
        (selection) => selection.repository_id,
      ),
      allowedOutcomes: [
        "conversation_message",
        "repository_selection_change_request",
      ],
      humanGates: ["multi_repository_plan_confirmation"],
    });
    const currentMessageReference =
      initialState.planning_message_references.find(
        (reference) =>
          reference.message_id ===
          initialState.current_approvable_plan_message_id,
      ) ?? null;
    const currentApprovableMessage = currentMessageReference
      ? await this.runStore.readJsonArtifact(
          currentMessageReference.artifact_reference,
        )
      : null;
    const contextProjection = createContextProjection({
      operation: "planning",
      changeSet: initialState,
      plan: currentPlan(initialState),
      repositorySelection,
      repositoryHarnessSelection,
      repositories: repositoriesForContext,
      capability: {
        mode: "read_only",
        paths: planningWorkspaces.map(
          (workspace) => workspace.workspace_path,
        ),
      },
      requiredEvidence: ["change_plan", "risks", "unverified_boundaries"],
      historyReferences: initialState.plans.slice(-16).map((plan) => ({
        kind: "plan_revision",
        revision: plan.revision,
        status: plan.status,
      })),
      planningConversation: {
        user_message: userMessage,
        current_approvable_message: currentApprovableMessage,
      },
      feedback:
        initialState.current_feedback_id === null
          ? null
          : initialState.feedback_records.find(
              (item) =>
                item.feedback_id === initialState.current_feedback_id,
            ) ?? null,
      verificationPolicy: initialState.verification_policy,
      supervisionPolicy: initialState.supervision_policy,
      bundleReviewPolicy: initialState.bundle_review_policy,
    });
    const invocation = {
      operation: "planning",
      agent_profile: agentProfile,
      control_contract: controlContract,
      context_projection: contextProjection,
      capabilities: contextProjection.capability,
      workspace: null,
      signal: null,
    };
    const contextEvidence = assessInitialContext({
      controlContract,
      contextProjection,
      agentProfile,
      runtimeMeasurement: await measureInitialContext(this.runtime, invocation),
    });
    try {
      await this.runStore.create(
        createAgentRunRecord({
          runId,
          changeSetId: change_set_id,
          workUnitId: null,
          operation: "planning",
          trigger:
            userMessage !== null || initialState.current_feedback_id !== null
              ? "feedback"
              : "initial",
          attempt: planningAttempt,
          agentProfile,
          continuationOfRunId:
            initialState.run_references
              .filter((reference) => reference.operation === "planning")
              .at(-1)?.run_id ?? null,
          repositoryHarnessSelection: {
            revision: repositoryHarnessSelection.revision,
            repositories: repositoryHarnessSelection.repositories.map(
              harnessSelectionForContext,
            ),
          },
          repositoryHarnessObservation: {
            repositories: harnessObservations,
          },
          contextEvidence,
          contextProjectionIdentity: {
            schema_version: contextProjection.schema_version,
            digest: sha256(contextProjection),
          },
          createdAt: this.now(),
          extra: {
            planning_workspaces: planningWorkspaces,
          },
        }),
      );
      if (userMessage !== null) {
        await this.runStore.appendEvent(runId, {
          event_id: this.idFactory("event"),
          type: "planning.input",
          at: this.now(),
          payload: { role: "user", text: userMessage },
        });
      }
      await this.controlStore.transactChangeSet(change_set_id, (state) => {
        assertChangeSetMutable(state);
        invariant(
          state.current_repository_selection_revision ===
            repositorySelection.revision,
          "STALE_REPOSITORY_SELECTION_REVISION",
          "Repository selection changed before planning dispatch",
        );
        invariant(
          state.current_repository_harness_selection_revision ===
            repositoryHarnessSelection.revision,
          "STALE_REPOSITORY_HARNESS_SELECTION_REVISION",
          "Repository Harness selection changed before planning dispatch",
        );
        state.run_references.push(
          createRunReference({
            runId,
            operation: "planning",
            trigger:
              userMessage !== null || initialState.current_feedback_id !== null
                ? "feedback"
                : "initial",
            plan_revision: state.current_plan_revision,
            repository_harness_selection_revision:
              repositoryHarnessSelection.revision,
            attempt: planningAttempt,
          }),
        );
        state.updated_at = this.now();
      });
    } catch (error) {
      // 关闭若先赢得状态事务，规划不得调用 Runtime；只回收本次尚未授权的隔离工作区。
      await preserveSecondaryFailure(
        error,
        "planning_workspace_cleanup",
        () =>
          this.runService.cleanupPlanningWorkspaces({
            planningWorkspaces,
            projectRepositories,
          }),
      );
      throw error;
    }

    let outcome;
    let providerEvidence = null;
    let repositorySelectionChangeRequest = null;
    let planningMessage = null;
    let planningMessageArtifact = null;
    let runtimeError = null;
    try {
      const result = await this.runCoordinator.invoke(
        this.runtime,
        runId,
        invocation,
      );
      outcome = result.outcome;
      providerEvidence = result.provider_evidence;
      invariant(
        ["conversation_message", "repository_selection_change_request"].includes(
          outcome.type,
        ),
        "UNEXPECTED_RUNTIME_OUTCOME",
        `Planning returned unsupported outcome ${outcome.type}`,
      );
      if (outcome.type === "repository_selection_change_request") {
        repositorySelectionChangeRequest =
          normalizeRepositorySelectionChangeRequest(outcome, project);
      } else {
        // 规划输出先成为对话消息；只有其中的结构化内容在精确批准后才成为 Plan revision。
        const text = normalizePlanningMessageText(
          outcome.message.text,
          "planning.outcome.message.text",
        );
        const planContent =
          outcome.message.plan === null
            ? null
            : normalizePlanContent(outcome.message.plan, {
                project: planningProject,
                bases,
                intentRevision: initialState.current_intent_revision,
                repositorySelectionRevision: repositorySelection.revision,
                repositoryHarnessSelectionRevision:
                  repositoryHarnessSelection.revision,
                revisionFeedback: this.feedbackService.currentContent(initialState),
              });
        const contentDigest = sha256({ text, plan_content: planContent });
        planningMessage = {
          schema_version: 1,
          message_id: this.idFactory("planning-message"),
          role: "assistant",
          text,
          plan_content: planContent,
          content_digest: contentDigest,
          planning_run_id: runId,
          created_at: this.now(),
        };
        planningMessageArtifact = await this.runStore.writeJsonArtifact(
          runId,
          "planning-message",
          planningMessage,
        );
      }
    } catch (error) {
      runtimeError = error;
      // Provider 已完成而领域规范化失败时，保留已观测证据；仅在错误携带更新证据时覆盖。
      providerEvidence = error.runtime_evidence ?? providerEvidence;
    }
    // 该错误模拟进程已直接消失；保留 running Run 和 worktree 供下一控制器执行确定性恢复。
    if (runtimeError?.code === "CONTROLLER_INTERRUPTED") {
      throw runtimeError;
    }
    try {
      await this.runService.cleanupPlanningWorkspaces({
        planningWorkspaces,
        projectRepositories,
      });
    } catch (error) {
      runtimeError ??= error;
    }
    if (runtimeError) {
      await this.runCoordinator.failAttempt({
        runId,
        invocation,
        providerEvidence,
        error: runtimeError,
      });
      await this.runService.markRunReference(
        change_set_id,
        runId,
        runTerminalStatusForError(runtimeError),
      );
      throw runtimeError;
    }
    await this.runCoordinator.completeAttempt({
      runId,
      invocation,
      providerEvidence,
      eventPayload: outcome,
      runOutcome: {
        type: outcome.type,
        planning_message_id: planningMessage?.message_id ?? null,
      },
    });

    return this.controlStore.transactChangeSet(change_set_id, (state) => {
      const result = applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "planChangeSet",
        input: commandInput,
        perform: () => {
          assertChangeSetMutable(state);
          invariant(
            state.phase === "planning",
            "INVALID_CHANGE_SET_PHASE",
            `Cannot plan ChangeSet in phase ${state.phase}`,
          );
          invariant(
            state.current_repository_selection_revision ===
              repositorySelection.revision,
            "STALE_REPOSITORY_SELECTION_REVISION",
            "Repository selection changed while planning was running",
          );
          invariant(
            state.current_repository_harness_selection_revision ===
              repositoryHarnessSelection.revision,
            "STALE_REPOSITORY_HARNESS_SELECTION_REVISION",
            "Repository Harness selection changed while planning was running",
          );
          if (repositorySelectionChangeRequest) {
            const request = {
              request_id: this.idFactory("selection-request"),
              run_id: runId,
              status: "pending",
              ...repositorySelectionChangeRequest,
              requested_at: this.now(),
            };
            state.repository_selection_change_requests.push(request);
            const runReference = state.run_references.find(
              (reference) => reference.run_id === runId,
            );
            invariant(
              runReference?.status === "running",
              "RUN_REFERENCE_STATE_MISMATCH",
              `Planning Run ${runId} has no running reference`,
            );
            runReference.status = "completed";
            state.updated_at = this.now();
            return {
              change_set_id,
              status: "repository_selection_change_requested",
              request: structuredClone(request),
            };
          }
          const runReference = state.run_references.find(
            (reference) => reference.run_id === runId,
          );
          invariant(
            runReference?.status === "running",
            "RUN_REFERENCE_STATE_MISMATCH",
            `Planning Run ${runId} has no running reference`,
          );
          runReference.status = "completed";
          const reference = {
            message_id: planningMessage.message_id,
            run_id: runId,
            role: planningMessage.role,
            content_digest: planningMessage.content_digest,
            has_plan: planningMessage.plan_content !== null,
            artifact_reference: structuredClone(planningMessageArtifact),
            created_at: planningMessage.created_at,
          };
          state.planning_message_references.push(reference);
          // 任一新回复都会使旧批准主体失效；只有新回复携带计划时才出现批准按钮。
          state.current_approvable_plan_message_id =
            reference.has_plan ? reference.message_id : null;
          setChangeSetPhase(state, "planning");
          state.updated_at = this.now();
          return {
            change_set_id,
            status: reference.has_plan ? "plan_ready" : "planning",
            message: structuredClone(planningMessage),
            artifact_reference: structuredClone(planningMessageArtifact),
          };
        },
      });
      return result;
    });
  }

  async confirmPlanMessage({
    idempotency_key,
    change_set_id,
    message_id,
    content_digest,
    actor = "human",
  }) {
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    normalizeId("message_id", message_id);
    invariant(
      typeof content_digest === "string" && /^[0-9a-f]{64}$/u.test(content_digest),
      "INVALID_PLAN_MESSAGE_DIGEST",
      "Plan confirmation requires one SHA-256 content digest",
    );
    const input = { change_set_id, message_id, content_digest, actor };
    const initialState = await this.controlStore.readChangeSet(change_set_id);
    assertChangeSetMutable(initialState);
    const existing = existingCommand(
      initialState,
      idempotency_key,
      "confirmPlanMessage",
      input,
    );
    if (existing?.status === "completed") {
      return this.maybeAutoStartAfterConfirmation(
        structuredClone(existing.result),
      );
    }
    const reference = initialState.planning_message_references.find(
      (item) => item.message_id === message_id,
    );
    invariant(
      initialState.current_approvable_plan_message_id === message_id &&
        reference?.content_digest === content_digest &&
        reference.has_plan,
      "STALE_PLAN_MESSAGE_CONFIRMATION",
      "Plan confirmation does not bind the current exact planning message",
    );
    const [planningMessage, planningRun] = await Promise.all([
      this.runStore.readJsonArtifact(reference.artifact_reference),
      this.runStore.read(reference.run_id),
    ]);
    invariant(
      planningMessage.message_id === message_id &&
        planningMessage.content_digest === content_digest &&
        planningMessage.plan_content !== null &&
        sha256({
          text: planningMessage.text,
          plan_content: planningMessage.plan_content,
        }) === content_digest,
      "PLAN_MESSAGE_SUBJECT_MISMATCH",
      "Planning message artifact does not match the approval subject",
    );

    // 确认在一个聚合事务中分配 revision、创建 WorkUnit 并开放执行。
    const confirmation = await this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "confirmPlanMessage",
        input,
        perform: () => {
          assertChangeSetMutable(state);
          invariant(
            state.phase === "planning",
            "INVALID_CHANGE_SET_STATE",
            `ChangeSet is not awaiting plan confirmation`,
          );
          const currentReference = state.planning_message_references.find(
            (item) => item.message_id === message_id,
          );
          invariant(
            state.current_approvable_plan_message_id === message_id &&
              currentReference?.content_digest === content_digest,
            "STALE_PLAN_MESSAGE_CONFIRMATION",
            "Plan confirmation subject changed before the transaction committed",
          );
          normalizeRevisionFeedbackAssessments(
            planningMessage.plan_content.revision_feedback_assessments,
            this.feedbackService.currentContent(state),
          );
          const planRevision =
            state.plans.reduce(
              (maximum, plan) => Math.max(maximum, plan.revision),
              0,
            ) + 1;
          const priorPlan = currentPlan(state);
          if (priorPlan) priorPlan.status = "superseded";
          const plan = createConfirmedPlan(planningMessage.plan_content, {
            revision: planRevision,
            confirmedAt: this.now(),
            agentProfile: planningRun.agent_profile,
            planningRunId: planningRun.run_id,
            sourceMessageId: message_id,
            sourceContentDigest: content_digest,
          });
          state.plans.push(plan);
          state.current_plan_revision = planRevision;
          state.current_bundle_review_assessment_id = null;
          state.bundle_review_last_error = null;
          state.work_units.push(
            ...plan.work_units.map((workUnit) => ({
              ...workUnit,
              plan_revision: planRevision,
              phase: "execution",
              disposition: "current",
              workspace: null,
              run_references: [],
              pending_feedback_id: null,
              candidate_checkpoint_id: null,
              verification_admission_id: null,
              verification_review_id: null,
              validation_attempt_ids: [],
              candidate: null,
              last_error: null,
            })),
          );
          state.current_approvable_plan_message_id = null;
          this.feedbackService.clear(state);
          state.decisions.push({
            decision_id: this.idFactory("decision"),
            type: "plan_confirmation",
            plan_revision: planRevision,
            source_message_id: message_id,
            source_content_digest: content_digest,
            actor,
            decided_at: this.now(),
          });
          state.supervision_control = {
            plan_revision: planRevision,
            authorized_at: this.now(),
            hold: null,
            last_stop_reason: null,
            updated_at: this.now(),
          };
          setChangeSetPhase(state, "working");
          state.updated_at = this.now();
          return {
            change_set_id,
            plan_revision: planRevision,
            status: "confirmed",
            plan: structuredClone(plan),
          };
        },
      }),
    );
    return this.maybeAutoStartAfterConfirmation(confirmation);
  }

  async maybeAutoStartAfterConfirmation(confirmation) {
    if (confirmation.plan.supervision.mode !== "autonomous_until_review") {
      return confirmation;
    }
    const supervision = await this.runAutonomousSupervision(
      confirmation.change_set_id,
    );
    return { ...confirmation, supervision };
  }

  async startSupervision(input) {
    return this.supervisionOrchestrator.startSupervision(input);
  }

  async pauseSupervision(input) {
    return this.supervisionOrchestrator.pauseSupervision(input);
  }

  async resumeSupervision(input) {
    return this.supervisionOrchestrator.resumeSupervision(input);
  }

  async readSupervisionProgress(input) {
    return this.supervisionOrchestrator.readSupervisionProgress(input);
  }

  async runAutonomousSupervision(changeSetId) {
    return this.supervisionOrchestrator.runAutonomousSupervision(changeSetId);
  }


  async executeChangeSet({
    idempotency_key,
    change_set_id,
    verification_admission_mode = null,
    validation_attempt_budgets = [],
  }) {
    // 单一 scheduler 所有者负责恢复和派发，防止多控制器重复执行 WorkUnit。
    normalizeId("idempotency_key", idempotency_key);
    normalizeId("change_set_id", change_set_id);
    const operatorAdmissionMode = normalizeOperatorAdmissionMode(
      verification_admission_mode,
    );
    const attemptBudgetRequests =
      normalizeValidationAttemptBudgetRequests(validation_attempt_budgets);
    // 缺省请求保持旧命令指纹，升级后重放既有幂等键不会因新增可选字段而冲突。
    const commandInput = { change_set_id };
    if (operatorAdmissionMode !== null) {
      commandInput.verification_admission_mode = operatorAdmissionMode;
    }
    if (attemptBudgetRequests.length > 0) {
      commandInput.validation_attempt_budgets = attemptBudgetRequests;
    }
    const initialState = await this.controlStore.readChangeSet(change_set_id);
    const initialCommand = existingCommand(
      initialState,
      idempotency_key,
      "executeChangeSet",
      commandInput,
    );
    if (initialCommand?.status === "completed") {
      return structuredClone(initialCommand.result);
    }
    assertChangeSetMutable(initialState);
    const schedulerLock = await this.controlStore.acquireSchedulerLock(
      this.instanceId,
    );
    try {
      await this.reconcileInterruptedRuns(change_set_id);
      const commandState = await this.controlStore.transactChangeSet(
        change_set_id,
        (state) => {
          const existing = existingCommand(
            state,
            idempotency_key,
            "executeChangeSet",
            commandInput,
          );
          if (existing?.status === "completed") {
            return { completed: true, result: structuredClone(existing.result) };
          }
          assertChangeSetMutable(state);
          if (existing?.status === "failed") {
            throw new ChangeFleetError(
              "COMMAND_PREVIOUSLY_FAILED",
              `Execution command ${idempotency_key} previously failed`,
              existing.error,
            );
          }
          const resumableBundle = state.bundles.at(-1) ?? null;
          const resumablePlan = currentPlan(state);
          const currentAssessment = (state.bundle_review_assessments ?? []).find(
            (assessment) =>
              assessment.assessment_id ===
              state.current_bundle_review_assessment_id,
          );
          if (
            state.phase === "review" &&
            resumablePlan?.bundle_review?.mode === "independent" &&
            resumableBundle &&
            !bundleReviewAssessmentMatches(
              currentAssessment,
              resumableBundle,
              resumablePlan,
            ) &&
            !(state.gates ?? []).some((gate) => gate.status === "open")
          ) {
            if (!existing) {
              state.commands[idempotency_key] = {
                command: "executeChangeSet",
                fingerprint: commandFingerprint(
                  "executeChangeSet",
                  commandInput,
                ),
                status: "in_progress",
                started_at: this.now(),
              };
            }
            return {
              completed: false,
              resume_bundle_review: true,
              bundle: structuredClone(resumableBundle),
            };
          }
          invariant(
            state.phase === "working",
            "PLAN_CONFIRMATION_REQUIRED",
            `ChangeSet cannot execute from phase ${state.phase}`,
          );
          if (!existing) {
            state.commands[idempotency_key] = {
              command: "executeChangeSet",
              fingerprint: commandFingerprint(
                "executeChangeSet",
                commandInput,
              ),
              status: "in_progress",
              started_at: this.now(),
            };
          }
          return { completed: false, resume_bundle_review: false };
        },
      );
      if (commandState.completed) return commandState.result;
      if (commandState.resume_bundle_review) {
        const reviewBoundary =
          await this.bundleReviewOrchestrator.reviewCurrentBundleUntilBoundary(
            change_set_id,
          );
        return this.controlStore.transactChangeSet(change_set_id, (state) => {
          const result = createBundleExecutionResult({
            changeSetId: change_set_id,
            bundle: commandState.bundle,
            reviewBoundary,
          });
          completeCommand(state, idempotency_key, result, this.now());
          return structuredClone(result);
        });
      }

      await this.prepareRetryableExecutions(
        change_set_id,
        idempotency_key,
      );

      while (true) {
        const state = await this.controlStore.readChangeSet(change_set_id);
        const plan = currentPlan(state);
        invariant(
          plan?.status === "confirmed",
          "PLAN_CONFIRMATION_REQUIRED",
          "Current plan is not confirmed",
        );
        assertValidationAttemptBudgetRequestsMatchPlan(
          attemptBudgetRequests,
          plan,
        );
        const currentUnits = unitsForCurrentPlan(state);
        const incomplete = currentUnits.filter(
          (unit) => unit.phase !== "complete",
        );
        if (incomplete.length === 0) break;
        const dispatchable = incomplete.filter(
          (unit) =>
            ["execution", "verification"].includes(unit.phase) &&
            !unit.run_references.some(
              (reference) => reference.status === "running",
            ) &&
            unit.dependencies.every(
              (dependency) =>
                currentUnits.find(
                  (candidate) => candidate.work_unit_id === dependency,
                )?.phase === "complete",
            ),
        );
        // 在依赖允许时先启动尚未执行的仓库，再消费已有检查点。
        // 这样多个仓库可以自然处于不同阶段，而无需并发状态或额外生命周期。
        const ready =
          dispatchable.find((unit) => unit.phase === "execution") ??
          dispatchable.find((unit) => unit.phase === "verification");
        invariant(
          ready,
          "WORK_UNIT_DEPENDENCY_BLOCKED",
          "No WorkUnit is ready and the current plan is incomplete",
          {
            units: incomplete.map((unit) => ({
              work_unit_id: unit.work_unit_id,
              phase: unit.phase,
            })),
          },
        );
        let executionResult = null;
        if (ready.phase === "execution") {
          executionResult = await this.executeWorkUnit(
            change_set_id,
            ready.work_unit_id,
            {
              operatorAdmissionMode,
              attemptBudgetRequests,
              feedbackSourceId: ready.pending_feedback_id ?? null,
            },
          );
        } else {
          executionResult =
            await this.verificationOrchestrator.resumeWorkUnitValidation(
            change_set_id,
            ready.work_unit_id,
            { operatorAdmissionMode, attemptBudgetRequests },
          );
        }
        if (executionResult?.status === "plan_invalidation_required") {
          return this.controlStore.transactChangeSet(change_set_id, (state) => {
            const result = {
              change_set_id,
              status: "replanning",
              plan_revision: executionResult.plan_revision,
              run_id: executionResult.run_id,
            };
            completeCommand(state, idempotency_key, result, this.now());
            return structuredClone(result);
          });
        }
        if (
          ["feedback_required", "human_input_required"].includes(
            executionResult?.status,
          )
        ) {
          return this.controlStore.transactChangeSet(change_set_id, (state) => {
            const result = {
              change_set_id,
              status: executionResult.status,
              work_unit_id: ready.work_unit_id,
              feedback_id: executionResult.feedback_id ?? null,
              gate_id: executionResult.gate_id ?? null,
              verification_review_id:
                executionResult.verification_review_id ?? null,
            };
            completeCommand(state, idempotency_key, result, this.now());
            return structuredClone(result);
          });
        }
      }

      const plan = currentPlan(
        await this.controlStore.readChangeSet(change_set_id),
      );
      const bundle =
        await this.bundleReviewOrchestrator.finalizeCurrentBundle(
          change_set_id,
          {
            budgetRequest:
              plan.combined_check === null
                ? null
                : selectValidationAttemptBudgetRequest(
                    attemptBudgetRequests,
                    {
                      kind: "combined_validation",
                      commandId: plan.combined_check.command_id,
                    },
                  ),
          },
        );
      let reviewBoundary = { assessment: null, gate: null };
      if (plan.bundle_review.mode === "independent") {
        reviewBoundary =
          await this.bundleReviewOrchestrator.reviewCurrentBundleUntilBoundary(
            change_set_id,
          );
      }
      return this.controlStore.transactChangeSet(change_set_id, (state) => {
        const result = createBundleExecutionResult({
          changeSetId: change_set_id,
          bundle,
          reviewBoundary,
        });
        completeCommand(state, idempotency_key, result, this.now());
        return structuredClone(result);
      });
    } catch (error) {
      if (error.code !== "CONTROLLER_INTERRUPTED") {
        await preserveSecondaryFailure(
          error,
          "command_failure_persistence",
          () =>
            this.runService.markCommandFailed(
              change_set_id,
              idempotency_key,
              error,
            ),
        );
      }
      throw error;
    } finally {
      await schedulerLock.release();
    }
  }

  async recordBundleDecision({
    idempotency_key,
    change_set_id,
    bundle_revision,
    bundle_hash,
    decision,
    feedback = null,
    actor = "human",
  }) {
    // 人工决策同时绑定 revision 与 hash，Candidate 或证据变化后旧批准立即失效。
    const normalizedDecision = normalizeHumanDecision(decision);
    const normalizedFeedback =
      normalizedDecision === "request_revision"
        ? normalizeRevisionFeedback(feedback)
        : null;
    invariant(
      normalizedDecision === "request_revision" || feedback === null,
      "INVALID_REVISION_FEEDBACK",
      "Only request_revision may carry revision feedback",
    );
    return this.controlStore.transactChangeSet(change_set_id, (state) =>
      applyIdempotentCommand({
        record: state,
        idempotencyKey: idempotency_key,
        command: "recordBundleDecision",
        input: {
          change_set_id,
          bundle_revision,
          bundle_hash,
          decision: normalizedDecision,
          feedback: normalizedFeedback,
          actor,
        },
        perform: () => {
          assertChangeSetMutable(state);
          invariant(
            state.phase === "review",
            "INVALID_CHANGE_SET_STATE",
            "ChangeSet is not awaiting CandidateBundle review",
          );
          const bundle = state.bundles.at(-1);
          invariant(
            bundle?.revision === bundle_revision &&
              bundle.bundle_hash === bundle_hash,
            "STALE_BUNDLE_DECISION",
            "Human decision does not bind to the current exact Bundle",
          );
          const plan = currentPlan(state);
          const assessment = (state.bundle_review_assessments ?? []).find(
            (item) =>
              item.assessment_id ===
              state.current_bundle_review_assessment_id,
          );
          if (
            normalizedDecision === "accept" &&
            plan.bundle_review?.mode === "independent"
          ) {
            invariant(
              bundleReviewAllowsHumanDecision(assessment, bundle, plan),
              "BUNDLE_REVIEW_REQUIRED",
              "Human acceptance requires a current Bundle review recommendation",
            );
          }
          const record = {
            decision_id: this.idFactory("decision"),
            type: "bundle_review",
            bundle_id: bundle.bundle_id,
            bundle_revision,
            bundle_hash,
            bundle_review_assessment_id: assessment?.assessment_id ?? null,
            decision: normalizedDecision,
            feedback: normalizedFeedback,
            actor,
            decided_at: this.now(),
          };
          state.decisions.push(record);
          const feedbackRecord =
            normalizedDecision === "request_revision"
              ? this.feedbackService.record(state, {
                  source: "review",
                  target: {
                    change_set_id,
                    plan_revision: state.current_plan_revision,
                    bundle_revision,
                    bundle_hash,
                  },
                  content: normalizedFeedback,
                  createdAt: record.decided_at,
                })
              : null;
          if (feedbackRecord === null) this.feedbackService.clear(state);
          if (normalizedDecision === "request_revision") {
            // Bundle 反馈从当前精确 checkpoint 继续；只撤销 Candidate 的当前审查资格。
            for (const workUnit of unitsForCurrentPlan(state)) {
              setWorkUnitPhase(workUnit, "execution");
              workUnit.pending_feedback_id = feedbackRecord.feedback_id;
              workUnit.candidate = null;
              workUnit.last_error = null;
            }
            state.current_bundle_review_assessment_id = null;
            state.bundle_review_last_error = null;
            setChangeSetPhase(state, "working");
          } else {
            setChangeSetPhase(
              state,
              normalizedDecision === "accept" ? "delivery" : "terminal",
              normalizedDecision === "accept" ? null : "abandoned",
            );
          }
          state.updated_at = this.now();
          return structuredClone(record);
        },
      }),
    );
  }

  configureGithubDelivery(request) {
    // GitHub 绑定由独立交付应用服务确认；生命周期服务只保留统一操作入口。
    return this.githubDeliveryService.configureGithubDelivery(request);
  }

  publishDelivery(request) {
    // 发布与 Bundle 接受分离，避免 Agent 或审核动作隐式获得外部写权限。
    return this.githubDeliveryService.publishDelivery(request);
  }

  readDelivery(request) {
    return this.githubDeliveryService.readDelivery(request);
  }

  refreshDelivery(request) {
    return this.githubDeliveryService.refreshDelivery(request);
  }

  readChangeSet(changeSetId) {
    return this.controlStore.readChangeSet(changeSetId);
  }

  async reconcileInterruptedRuns(changeSetId, { project = null } = {}) {
    return this.runRecoveryService.reconcile(changeSetId, { project });
  }

  async prepareRetryableExecutions(changeSetId, commandId, actor = "human") {
    // 人工继续或已授权 Supervisor 都只能重试无真实 Candidate 的干净 base 工作区。
    const state = await this.controlStore.readChangeSet(changeSetId);
    const retryable = retryableExecutionUnits(state);
    if (retryable.length === 0) return;
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, state.project_id);
    const planRevision = state.current_plan_revision;
    const plan = currentPlan(state);
    const repositorySelection = currentRepositorySelection(state);
    const repositoryHarnessSelection =
      currentRepositoryHarnessSelection(state);
    invariant(
      plan?.status === "confirmed" && plan.revision === planRevision,
      "STALE_PLAN_REVISION",
      "Provider retry requires the current confirmed plan",
    );

    for (const snapshotUnit of retryable) {
      const repository = requireRepository(
        project,
        snapshotUnit.repository_id,
      );
      const selectedRepository = repositorySelection.repositories.find(
        (candidate) =>
          candidate.repository_id === snapshotUnit.repository_id,
      );
      const selectedHarness =
        repositoryHarnessSelection.repositories.find(
          (candidate) =>
            candidate.repository_id === snapshotUnit.repository_id,
        );
      invariant(
        snapshotUnit.plan_revision === planRevision &&
          snapshotUnit.repository_selection_revision ===
            repositorySelection.revision &&
          snapshotUnit.repository_harness_selection_revision ===
            repositoryHarnessSelection.revision &&
          selectedRepository?.resolved_base_sha === snapshotUnit.base_sha &&
          selectedRepository?.target_ref === snapshotUnit.target_ref &&
          selectedHarness?.resolved_base_sha === snapshotUnit.base_sha,
        "EXECUTION_RETRY_SUBJECT_MISMATCH",
        "Execution retry no longer matches current plan, Repository, and Harness authority",
      );
      await this.repositoryWorker.preflightExecutionRetry({
        repository,
        workspace: snapshotUnit.workspace,
        baseSha: snapshotUnit.base_sha,
        targetRef: snapshotUnit.target_ref,
      });
      if (
        selectedHarness.mode ===
        HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
      ) {
        const overlaySnapshot = await this.harnessSnapshotStore.read(
          selectedHarness.artifact_reference,
        );
        await this.repositoryWorker.verifyHarnessOverlay({
          repository,
          workspace: snapshotUnit.workspace,
          snapshot: overlaySnapshot,
        });
      }
    }

    // 所有主体都先完成只读预检，再用一次控制事务共同恢复 execution，避免多 WorkUnit 半重试。
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      invariant(
        current.current_plan_revision === planRevision &&
          current.current_repository_selection_revision ===
            repositorySelection.revision &&
          current.current_repository_harness_selection_revision ===
            repositoryHarnessSelection.revision,
        "EXECUTION_RETRY_SUBJECT_MISMATCH",
        "Current retry authority changed before dispatch",
      );
      for (const snapshotUnit of retryable) {
        const unit = unitsForCurrentPlan(current).find(
          (candidate) =>
            candidate.work_unit_id === snapshotUnit.work_unit_id,
        );
        const reason = retryableExecutionReason(current, unit);
        invariant(
          reason &&
            unit.plan_revision === snapshotUnit.plan_revision &&
            unit.base_sha === snapshotUnit.base_sha &&
            unit.target_ref === snapshotUnit.target_ref &&
            unit.repository_selection_revision ===
              snapshotUnit.repository_selection_revision &&
            unit.repository_harness_selection_revision ===
              snapshotUnit.repository_harness_selection_revision &&
            unit.workspace?.workspace_id === snapshotUnit.workspace?.workspace_id &&
            unit.workspace?.workspace_path === snapshotUnit.workspace?.workspace_path,
          "EXECUTION_RETRY_SUBJECT_MISMATCH",
          "WorkUnit retry subject changed before dispatch",
        );
        const decision = {
          decision_id: this.idFactory("decision"),
          type: "provider_retry",
          work_unit_id: unit.work_unit_id,
          source_run_id: reason.source_run_id,
          reason_code: reason.reason_code,
          command_id: commandId,
          actor,
          decided_at: this.now(),
        };
        current.decisions.push(decision);
        for (const blocker of current.blockers) {
          if (blocker.resolved_at !== undefined) continue;
          const failedCommand = blocker.command_id
            ? current.commands[blocker.command_id]
            : null;
          if (
            blocker.work_unit_id === unit.work_unit_id ||
            failedCommand?.command === "executeChangeSet"
          ) {
            blocker.resolved_at = decision.decided_at;
            blocker.resolved_by_decision_id = decision.decision_id;
          }
        }
        setWorkUnitPhase(unit, "execution");
        unit.pending_feedback_id = null;
        unit.candidate_checkpoint_id = null;
        unit.last_error = {
          code: "PROVIDER_RETRY_SCHEDULED",
          previous_code: reason.reason_code,
          source_run_id: reason.source_run_id,
          decision_id: decision.decision_id,
        };
      }
      setChangeSetPhase(current, "working");
      current.updated_at = this.now();
    });
  }

  async executeWorkUnit(
    changeSetId,
    workUnitId,
    {
      operatorAdmissionMode = null,
      attemptBudgetRequests = [],
      feedbackSourceId = null,
    } = {},
  ) {
    // 先创建 Run 再标记 running，崩溃最多留下孤立记录，不留下无来源派发。
    const state = await this.controlStore.readChangeSet(changeSetId);
    const catalog = await this.controlStore.readCatalog();
    const project = requireProject(catalog, state.project_id);
    const plan = currentPlan(state);
    const repositorySelection = currentRepositorySelection(state);
    const repositoryHarnessSelection =
      currentRepositoryHarnessSelection(state);
    const workUnit = unitsForCurrentPlan(state).find(
      (candidate) => candidate.work_unit_id === workUnitId,
    );
    const feedbackRecord =
      feedbackSourceId === null
        ? null
        : state.feedback_records.find(
            (feedback) => feedback.feedback_id === feedbackSourceId,
          );
    const isFeedbackExecution = feedbackRecord !== null;
    let queuedFeedbackId = null;
    const sourceCheckpoint = isFeedbackExecution
      ? state.candidate_checkpoints.find(
          (checkpoint) =>
            checkpoint.checkpoint_id === workUnit?.candidate_checkpoint_id,
        )
      : null;
    // 执行阶段只检查统一 phase 和精确反馈引用；反馈来源不会创造另一套运行状态机。
    invariant(
      workUnit &&
        isCurrentWorkUnit(workUnit) &&
        workUnit.phase === "execution" &&
        workUnit.candidate === null &&
        !workUnit.run_references.some(
          (reference) => reference.status === "running",
        ) &&
        (feedbackSourceId === null ||
          (feedbackRecord &&
            workUnit.pending_feedback_id === feedbackRecord.feedback_id)),
      "WORK_UNIT_NOT_READY",
      `WorkUnit ${workUnitId} is not ready for execution`,
    );
    const repository = project.repositories.find(
      (candidate) => candidate.repository_id === workUnit.repository_id,
    );
    const selectedRepository = repositorySelection.repositories.find(
      (candidate) => candidate.repository_id === workUnit.repository_id,
    );
    const selectedHarness =
      repositoryHarnessSelection.repositories.find(
        (candidate) =>
          candidate.repository_id === workUnit.repository_id,
      );
    invariant(
      selectedHarness?.resolved_base_sha === workUnit.base_sha &&
        workUnit.repository_harness_selection_revision ===
          repositoryHarnessSelection.revision,
      "REPOSITORY_HARNESS_SELECTION_MISMATCH",
      `WorkUnit ${workUnitId} does not match the current Harness selection`,
    );
    const executionReferences = workUnit.run_references.filter(
      (reference) => reference.operation === "execution",
    );
    const attempt = executionReferences.length + 1;
    const reuseWorkspace = Boolean(
      isFeedbackExecution && sourceCheckpoint && workUnit.workspace,
    );
    const workspaceId = reuseWorkspace
      ? workUnit.workspace.workspace_id
      : `${changeSetId}.${plan.revision}.${workUnitId}.${attempt}`;
    let workspace;
    if (reuseWorkspace) {
      // 反馈执行只在精确 checkpoint 仍匹配时复用工作区；否则创建新的受控工作区。
      await this.repositoryWorker.preflightCandidate({
        repository,
        candidate: {
          ...sourceCheckpoint,
          workspace_id: workUnit.workspace.workspace_id,
          workspace_path: workUnit.workspace.workspace_path,
        },
      });
      workspace = structuredClone(workUnit.workspace);
    } else {
      workspace = await this.repositoryWorker.prepareWorkspace({
        repository,
        targetRef: workUnit.target_ref,
        baseSha: workUnit.base_sha,
        workspaceId,
      });
    }
    let overlaySnapshot = null;
    if (
      selectedHarness.mode ===
      HARNESS_SELECTION_MODES.EXACT_BASE_PLUS_OVERLAY
    ) {
      overlaySnapshot = await this.harnessSnapshotStore.read(
        selectedHarness.artifact_reference,
      );
      workspace = await this.repositoryWorker.materializeHarnessOverlay({
        repository,
        workspace,
        snapshot: overlaySnapshot,
      });
    }
    const harnessCommit = reuseWorkspace
      ? sourceCheckpoint.candidate_sha
      : workUnit.base_sha;
    const exactBaseHarness = await this.repositoryWorker.discoverHarness(
      repository,
      harnessCommit,
    );
    const frozenOverlayHarness = overlayHarnessResources(overlaySnapshot);
    const availableHarness = [
      ...exactBaseHarness,
      ...frozenOverlayHarness,
    ];
    const harnessObservation = repositoryHarnessObservation({
      repositoryId: repository.repository_id,
      exactBaseResources: exactBaseHarness,
      overlayResources: frozenOverlayHarness,
    });
    const runId = this.idFactory("run");
    const run = createAgentRunRecord({
      runId,
      changeSetId,
      workUnitId,
      operation: "execution",
      trigger: isFeedbackExecution ? "feedback" : "initial",
      attempt,
      agentProfile: plan.agent_profile,
      continuationOfRunId: executionReferences.at(-1)?.run_id ?? null,
      repositoryHarnessSelection: {
        revision: repositoryHarnessSelection.revision,
        repositories: [
          harnessSelectionForContext(selectedHarness),
        ],
      },
      repositoryHarnessObservation: {
        repositories: [harnessObservation],
      },
      contextEvidence: null,
      contextProjectionIdentity: null,
      createdAt: this.now(),
      extra: {
        feedback_source_id: feedbackRecord?.feedback_id ?? null,
      },
    });
    await this.runStore.create(run);
    await this.controlStore.transactChangeSet(changeSetId, (current) => {
      const currentUnit = unitsForCurrentPlan(current).find(
        (candidate) => candidate.work_unit_id === workUnitId,
      );
      invariant(
        currentUnit.phase === "execution" &&
          currentUnit.disposition === "current" &&
          currentUnit.pending_feedback_id ===
            (feedbackRecord?.feedback_id ?? null) &&
          !currentUnit.run_references.some(
            (reference) => reference.status === "running",
          ),
        "DUPLICATE_DISPATCH",
        `WorkUnit ${workUnitId} already left its dispatchable state`,
      );
      currentUnit.workspace = workspace;
      currentUnit.run_references.push(
        createRunReference({
          runId,
          operation: "execution",
          trigger: isFeedbackExecution ? "feedback" : "initial",
          feedback_source_id: feedbackRecord?.feedback_id ?? null,
          attempt,
        }),
      );
      current.run_references.push(
        createRunReference({
          runId,
          operation: "execution",
          trigger: isFeedbackExecution ? "feedback" : "initial",
          plan_revision: plan.revision,
          work_unit_id: workUnitId,
          feedback_source_id: feedbackRecord?.feedback_id ?? null,
        }),
      );
      if (isFeedbackExecution) {
        resolveValidationBlockers(current, {
          workUnitId,
          resolvedAt: this.now(),
        });
      }
      setChangeSetPhase(current, "working");
      current.updated_at = this.now();
    });

    const currentState = await this.controlStore.readChangeSet(changeSetId);
    const currentUnit = unitsForCurrentPlan(currentState).find(
      (candidate) => candidate.work_unit_id === workUnitId,
    );
    const controlContract = createControlContract({
      operation: "execution",
      changeSetId,
      planRevision: plan.revision,
      repositorySelectionRevision: repositorySelection.revision,
      repositoryHarnessSelectionRevision:
        repositoryHarnessSelection.revision,
      workUnitId,
      authorizedRepositories: [workUnit.repository_id],
      allowedOutcomes: [
        "implementation_completed",
        "implementation_blocked",
        "plan_invalidation_required",
      ],
      humanGates: [],
    });
    const contextProjection = createContextProjection({
      operation: "execution",
      changeSet: currentState,
      plan,
      repositorySelection,
      repositoryHarnessSelection,
      workUnit: currentUnit,
      repositories: [
        {
          repository_id: repository.repository_id,
          branch_ref: selectedRepository.branch_ref,
          target_ref: workUnit.target_ref,
          base_sha: workUnit.base_sha,
          ...(reuseWorkspace
            ? { candidate_sha: sourceCheckpoint.candidate_sha }
            : {}),
          root_path: workspace.workspace_path,
          harness_selection: harnessSelectionForContext(selectedHarness),
          ...harnessResourcesForContext(availableHarness),
        },
      ],
      capability: {
        mode: "read_write",
        paths: [workspace.workspace_path],
      },
      requiredEvidence: isFeedbackExecution
        ? [
            "structured_outcome",
            "finding_assessments",
            "candidate",
            "applicable_project_check_results",
          ]
        : ["structured_outcome", "candidate", "applicable_project_check_results"],
      feedback: feedbackRecord,
      historyReferences: isFeedbackExecution
        ? []
        : workUnit.run_references.slice(-16).map((reference) => ({
            kind: "run",
            run_id: reference.run_id,
            status: reference.status,
          })),
    });
    const invocation = {
      operation: "execution",
      agent_profile: plan.agent_profile,
      control_contract: controlContract,
      context_projection: contextProjection,
      capabilities: contextProjection.capability,
      workspace,
      signal: null,
    };
    const contextEvidence = assessInitialContext({
      controlContract,
      contextProjection,
      agentProfile: plan.agent_profile,
      runtimeMeasurement: await measureInitialContext(this.runtime, invocation),
    });
    await this.runStore.update(runId, (current) => {
      current.context_evidence = contextEvidence;
      current.context_projection_identity = {
        schema_version: contextProjection.schema_version,
        digest: sha256(contextProjection),
      };
    });

    let outcome;
    let providerEvidence = null;
    try {
      const result = await this.runCoordinator.invoke(
        this.runtime,
        runId,
        invocation,
      );
      outcome = result.outcome;
      providerEvidence = result.provider_evidence;
      invariant(
        [
          "implementation_completed",
          "implementation_blocked",
          "plan_invalidation_required",
        ].includes(outcome.type),
        "UNEXPECTED_RUNTIME_OUTCOME",
        `Execution returned unsupported outcome ${outcome.type}`,
      );
      outcome = {
        ...outcome,
        revision_feedback_assessments:
          // Core 只验证逐项覆盖和结构，不替 Agent 判断 finding 是否正确。
          normalizeRevisionFeedbackAssessments(
            outcome.revision_feedback_assessments,
            feedbackRecord?.content ?? null,
          ),
      };
      await this.runCoordinator.completeAttempt({
        runId,
        invocation,
        providerEvidence,
        eventPayload: outcome,
        runOutcome: {
          type: outcome.type,
          // 只保留有界路径声明用于和最终 Git 主体做确定性比对，不保存 Agent 推理。
          reported_changed_paths: [...outcome.changed_paths].sort(),
          revision_feedback_assessments: structuredClone(
            outcome.revision_feedback_assessments,
          ),
        },
      });
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (candidate) => candidate.work_unit_id === workUnitId,
        );
        const unitReference = unit.run_references.find(
          (reference) => reference.run_id === runId,
        );
        unitReference.status = "completed";
        unitReference.outcome_type = outcome.type;
        const reference = current.run_references.find(
          (candidate) => candidate.run_id === runId,
        );
        reference.status = "completed";
        current.updated_at = this.now();
      });
    } catch (error) {
      if (error.code === "CONTROLLER_INTERRUPTED") throw error;
      await this.runCoordinator.failAttempt({
        runId,
        invocation,
        providerEvidence: error.runtime_evidence ?? providerEvidence,
        error,
      });
      await this.runService.failWorkUnit(changeSetId, workUnitId, error, runId);
      throw error;
    }

    if (outcome.type === "implementation_blocked") {
      const error = new ChangeFleetError(
        "RUNTIME_IMPLEMENTATION_BLOCKED",
        outcome.summary || outcome.blocker.message,
        { blocker_code: outcome.blocker.code },
      );
      await this.runService.blockWorkUnit(changeSetId, workUnitId, error, runId);
      throw error;
    }

    if (outcome.type === "plan_invalidation_required") {
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const currentPlanRecord = currentPlan(current);
        invariant(
          currentPlanRecord?.revision === plan.revision,
          "STALE_PLAN_INVALIDATION",
          "Execution invalidation no longer refers to the current Plan",
        );
        currentPlanRecord.status = "invalidated";
        for (const unit of unitsForCurrentPlan(current)) {
          supersedeWorkUnit(unit);
        }
        current.current_approvable_plan_message_id = null;
        setChangeSetPhase(current, "planning");
        current.decisions.push({
          decision_id: this.idFactory("decision"),
          type: "plan_invalidation",
          plan_revision: plan.revision,
          run_id: runId,
          code: outcome.blocker.code,
          message: outcome.blocker.message,
          revision_feedback_assessments: structuredClone(
            outcome.revision_feedback_assessments,
          ),
          decided_at: this.now(),
        });
        current.updated_at = this.now();
      });
      return {
        status: "plan_invalidation_required",
        plan_revision: plan.revision,
        run_id: runId,
      };
    }

    let checkpointPersisted = false;
    try {
      const requestedPrivateHarnessChanges =
        overlaySnapshot === null
          ? []
          : outcome.changed_paths
              .map((item) => item.replaceAll("\\", "/"))
              .filter((item) =>
                overlaySnapshot.files.some(
                  (file) =>
                    item === file.relative_path,
                ),
              );
      invariant(
        requestedPrivateHarnessChanges.length === 0,
        "NON_GIT_HARNESS_CHANGE_UNSUPPORTED",
        "A durable change to private non-Git Harness is unsupported",
        { paths: requestedPrivateHarnessChanges.sort() },
      );
      if (overlaySnapshot) {
        await this.repositoryWorker.verifyAndRemoveHarnessOverlay({
          repository,
          workspace,
          snapshot: overlaySnapshot,
        });
      }
      const published = await this.repositoryWorker.publishCandidate({
        repository,
        workspace,
        expectedHead: reuseWorkspace
          ? sourceCheckpoint.candidate_sha
          : workUnit.base_sha,
        baseSha: workUnit.base_sha,
        message: isFeedbackExecution
          ? `ChangeFleet ${changeSetId} ${workUnitId} feedback`
          : `ChangeFleet ${changeSetId} ${workUnitId}`,
      });
      invariant(
        !reuseWorkspace ||
          !published.no_change ||
          outcome.changed_paths.length === 0,
        "FEEDBACK_EXECUTION_CHANGED_PATHS_MISMATCH",
        "A no-change feedback execution cannot report changed paths",
        { source_run_id: runId, reported_changed_paths: outcome.changed_paths },
      );
      invariant(
        reuseWorkspace ||
          (!published.no_change && published.changed_paths.length > 0),
        "EMPTY_IMPLEMENTATION_RESULT",
        "Runtime implementation produced no Git change for the WorkUnit",
        { source_run_id: runId },
      );
      const checkpoint = published.no_change
        ? sourceCheckpoint
        : createCandidateCheckpoint({
            changeSetId,
            intentRevision: plan.intent_revision,
            planRevision: plan.revision,
            repositorySelectionRevision: repositorySelection.revision,
            repositoryHarnessSelectionRevision:
              repositoryHarnessSelection.revision,
            workUnitId,
            repositoryId: published.repository_id,
            targetRef: published.target_ref,
            baseSha: published.base_sha,
            candidateSha: published.candidate_sha,
            workspaceId: published.workspace_id,
            workspacePath: published.workspace_path,
            changedPaths: published.changed_paths,
            sourceRunId: runId,
            createdAt: this.now(),
          });
      if (isFeedbackExecution) {
        // Provider 声明与真实 old-to-new Git delta 分开保存，后续验证消费后者。
        await this.runStore.update(runId, (current) => {
          current.outcome.actual_changed_paths = [
            ...published.round_changed_paths,
          ];
          current.outcome.published_candidate_sha =
            published.candidate_sha;
          current.outcome.no_change = published.no_change;
        });
      }
      await this.controlStore.transactChangeSet(changeSetId, (current) => {
        const unit = unitsForCurrentPlan(current).find(
          (item) => item.work_unit_id === workUnitId,
        );
        const dispatchedFeedbackId = feedbackRecord?.feedback_id ?? null;
        queuedFeedbackId =
          unit.pending_feedback_id !== dispatchedFeedbackId
            ? unit.pending_feedback_id
            : null;
        invariant(
          unit.phase === "execution" &&
            unit.disposition === "current" &&
            (unit.pending_feedback_id === dispatchedFeedbackId ||
              queuedFeedbackId !== null) &&
            unit.candidate === null,
          "CANDIDATE_CHECKPOINT_STATE_MISMATCH",
          `WorkUnit ${workUnitId} cannot persist its CandidateCheckpoint`,
        );
        if (!published.no_change) {
          current.candidate_checkpoints.push(checkpoint);
        }
        unit.candidate_checkpoint_id = checkpoint.checkpoint_id;
        if (isFeedbackExecution) {
          unit.verification_review_id = null;
          if (!published.no_change) {
            unit.verification_admission_id = null;
            unit.validation_attempt_ids = [];
          }
          resolveValidationBlockers(current, {
            workUnitId,
            resolvedAt: this.now(),
          });
        }
        if (queuedFeedbackId === null) {
          unit.pending_feedback_id = null;
          setWorkUnitPhase(unit, "verification");
        }
        unit.last_error = null;
        setChangeSetPhase(current, "working");
        current.updated_at = this.now();
      });
      checkpointPersisted = true;
      if (queuedFeedbackId !== null) {
        return {
          status: "feedback_queued",
          feedback_id: queuedFeedbackId,
          work_unit_id: workUnitId,
        };
      }
      // 验证由统一调度循环的下一次选择推进，执行函数只负责形成精确检查点。
      return {
        status: "checkpoint_ready",
        work_unit_id: workUnitId,
      };
    } catch (error) {
      if (!checkpointPersisted) {
        await this.runService.failWorkUnit(
          changeSetId,
          workUnitId,
          error,
          runId,
        );
      }
      throw error;
    }
  }

  now() {
    return this.clock().toISOString();
  }
}

function readOnlySupervisorProfile(agentProfile) {
  return readOnlyDerivedProfile(agentProfile, "supervisor");
}

function readOnlyReviewProfile(agentProfile) {
  return readOnlyDerivedProfile(agentProfile, "reviewer");
}

function readOnlyDerivedProfile(agentProfile, role) {
  // 派生身份绑定基础 Profile 的稳定版本和角色，避免截断长 ID 后发生权限身份碰撞。
  const readableId = `${agentProfile.profile_id}-${role}`;
  return {
    ...structuredClone(agentProfile),
    profile_id:
      readableId.length <= 128
        ? readableId
        : stableId(`profile-${role}`, {
            base_profile_id: agentProfile.profile_id,
            base_profile_revision: agentProfile.revision,
            role,
          }),
    permissions: "operation_scoped",
    network_access: false,
    skills: [],
  };
}

function createBundleExecutionResult({ changeSetId, bundle, reviewBoundary }) {
  return {
    change_set_id: changeSetId,
    bundle_revision: bundle.revision,
    bundle_hash: bundle.bundle_hash,
    bundle_id: bundle.bundle_id,
    status:
      reviewBoundary.gate !== null
        ? "human_input_required"
        : reviewBoundary.assessment?.disposition === "feedback"
          ? "feedback_required"
          : "review_ready",
    bundle_review_assessment_id:
      reviewBoundary.assessment?.assessment_id ?? null,
    gate_id: reviewBoundary.gate?.gate_id ?? null,
  };
}

function createBundleReviewProjection({
  state,
  plan,
  bundle,
  repositorySelection,
  harnessSelection,
  resources,
  evidenceReferenceIds,
}) {
  // Bundle reviewer 只接收当前精确主体和质量判断所需证据；成本、旧对话和完整日志不进入上下文。
  return {
    schema_version: 1,
    operation: "review",
    change_set_id: state.change_set_id,
    confirmed_intent: structuredClone(
      state.intents.find(
        (intent) => intent.revision === state.current_intent_revision,
      ),
    ),
    plan: {
      revision: plan.revision,
      rationale: plan.rationale,
      bundle_review: structuredClone(plan.bundle_review),
      risks: [...plan.risks],
      unverified_boundaries: [...plan.unverified_boundaries],
      work_units: plan.work_units.map((unit) => ({
        work_unit_id: unit.work_unit_id,
        repository_id: unit.repository_id,
        task: unit.task,
        dependencies: [...unit.dependencies],
        repository_check:
          unit.repository_check === null
            ? null
            : {
                command_id: unit.repository_check.command_id,
                coverage_rationale: unit.repository_check.coverage_rationale,
              },
        repository_check_rationale: unit.repository_check_rationale,
      })),
      combined_check:
        plan.combined_check === null
          ? null
          : {
              command_id: plan.combined_check.command_id,
              coverage_rationale: plan.combined_check.coverage_rationale,
            },
      combined_check_rationale: plan.combined_check_rationale,
    },
    bundle: {
      bundle_id: bundle.bundle_id,
      revision: bundle.revision,
      bundle_hash: bundle.bundle_hash,
      plan_revision: bundle.plan_revision,
      candidates: structuredClone(bundle.candidates),
      combined_validation_evidence: structuredClone(
        bundle.combined_validation_evidence,
      ),
      missing_work_units: structuredClone(bundle.missing_work_units ?? []),
      blocked_work_units: structuredClone(bundle.blocked_work_units ?? []),
      superseded_work_units: structuredClone(
        bundle.superseded_work_units ?? [],
      ),
      excluded_work_units: structuredClone(bundle.excluded_work_units ?? []),
      unverified_risks: structuredClone(bundle.unverified_risks ?? []),
    },
    repositories: resources.map((resource) => {
      const candidate = resource.candidate;
      const storedCandidate = (state.candidates ?? []).find(
        (item) => item.candidate_id === candidate.candidate_id,
      );
      const verificationReview = (state.verification_reviews ?? []).find(
        (review) =>
          review.review_id === storedCandidate?.verification_review_id,
      );
      return {
        repository_id: candidate.repository_id,
        branch_ref: resource.selected_repository.branch_ref,
        target_ref: candidate.target_ref,
        base_sha: candidate.base_sha,
        candidate_sha: candidate.candidate_sha,
        changed_paths: [...(storedCandidate?.changed_paths ?? [])],
        root_path: resource.workspace.workspace_path,
        repository_evidence: structuredClone(candidate.repository_evidence),
        verification_review:
          verificationReview === undefined
            ? null
            : {
                review_id: verificationReview.review_id,
                verdict: verificationReview.verdict,
                summary: verificationReview.summary,
                notes: structuredClone(verificationReview.notes),
                validation_attempt_ids: [
                  ...(verificationReview.validation_attempt_ids ?? []),
                ],
              },
        harness_selection: harnessSelectionForContext(
          resource.selected_harness,
        ),
        ...harnessResourcesForContext(resource.available_harness),
      };
    }),
    repository_selection_revision: repositorySelection.revision,
    repository_harness_selection_revision: harnessSelection.revision,
    feedback_history: (state.feedback_records ?? [])
      .filter(
        (feedback) =>
          feedback.target?.bundle_id === bundle.bundle_id ||
          plan.work_units.some(
            (unit) => unit.work_unit_id === feedback.target?.work_unit_id,
          ),
      )
      .slice(-8)
      .map((feedback) => ({
        feedback_id: feedback.feedback_id,
        source: feedback.source,
        target: structuredClone(feedback.target),
        summary: feedback.content.summary,
        findings: structuredClone(feedback.content.findings),
      })),
    resolved_bundle_gates: (state.gates ?? [])
      .filter(
        (gate) =>
          gate.status === "resolved" && gate.bundle_id === bundle.bundle_id,
      )
      .slice(-8)
      .map((gate) => ({
        gate_id: gate.gate_id,
        kind: gate.kind,
        question: gate.request.question,
        selected_option: gate.selected_option,
        resolved_by: gate.resolved_by,
      })),
    required_evidence: [
      "exact_bundle_manifest",
      "exact_candidate_diffs",
      "repository_validation_evidence",
      "combined_validation_evidence",
      "structured_bundle_review_outcome",
    ],
    allowed_evidence_reference_ids: [...evidenceReferenceIds],
    capability: {
      mode: "read_only",
      paths: resources.map((resource) => resource.workspace.workspace_path),
    },
  };
}

function bundleReviewEvidenceReferenceIds(state, bundle) {
  const workUnitIds = new Set(
    unitsForCurrentPlan(state).map((unit) => unit.work_unit_id),
  );
  const verificationReviews = (state.verification_reviews ?? []).filter(
    (review) =>
      bundle.candidates.some(
        (candidate) => candidate.verification_review_id === review.review_id,
      ),
  );
  const references = [
    bundle.bundle_id,
    bundle.combined_validation_evidence?.evidence_id,
    ...bundle.candidates.flatMap((candidate) => [
      candidate.candidate_id,
      candidate.repository_evidence?.evidence_id,
      candidate.verification_admission_id,
      candidate.verification_review_id,
    ]),
    ...verificationReviews.flatMap((review) => [
      review.review_id,
      ...(review.validation_attempt_ids ?? []),
    ]),
    ...(state.feedback_records ?? [])
      .filter((feedback) =>
        feedback.target?.bundle_id === bundle.bundle_id ||
        workUnitIds.has(feedback.target?.work_unit_id),
      )
      .slice(-8)
      .map((feedback) => feedback.feedback_id),
    ...(state.gates ?? [])
      .filter((gate) => gate.bundle_id === bundle.bundle_id)
      .slice(-8)
      .map((gate) => gate.gate_id),
  ].filter(Boolean);
  return [...new Set(references)].sort();
}

async function cleanupBundleReviewResources(repositoryWorker, resources) {
  let firstError = null;
  for (const resource of [...resources].reverse()) {
    try {
      await repositoryWorker.cleanupVerificationWorkspace({
        repository: resource.repository,
        workspace: resource.workspace,
        harnessSnapshot: resource.overlay_snapshot,
      });
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}

function retryableExecutionUnits(state) {
  return unitsForCurrentPlan(state).filter(
    (unit) => retryableExecutionReason(state, unit) !== null,
  );
}

function retryableExecutionReason(state, unit) {
  if (!unit || unit.candidate) return null;
  if (
    unit.phase === "execution" &&
    unit.candidate_checkpoint_id === null &&
    executionFailureIsRetryable(unit.last_error?.code)
  ) {
    return {
      reason_code: unit.last_error.code,
      source_run_id: unit.run_references.at(-1)?.run_id ?? null,
    };
  }
  return null;
}

function verificationReviewAsRevisionFeedback(review) {
  return {
    summary: review.summary,
    findings: review.findings.map((finding) => ({
      finding_id: finding.finding_id,
      text: finding.message,
    })),
  };
}

function resolveValidationBlockers(
  state,
  {
    workUnitId = null,
    validationSubjectHash = null,
    resolvedAt,
    resolvedByDecisionId = null,
  },
) {
  // 历史 blocker 不删除；标记已解决后不再进入当前 Runtime 投影。
  for (const blocker of state.blockers) {
    if (blocker.resolved_at !== undefined) continue;
    if (
      (workUnitId && blocker.work_unit_id === workUnitId) ||
      (validationSubjectHash &&
        blocker.validation_subject_hash === validationSubjectHash)
    ) {
      blocker.resolved_at = resolvedAt;
      if (resolvedByDecisionId) {
        blocker.resolved_by_decision_id = resolvedByDecisionId;
      }
    }
  }
}

function resolveFailedExecutionCommandBlockers(
  state,
  resolvedAt,
  resolvedByDecisionId = null,
) {
  for (const blocker of state.blockers) {
    if (blocker.resolved_at !== undefined || !blocker.command_id) continue;
    const command = state.commands[blocker.command_id];
    if (command?.command !== "executeChangeSet") continue;
    blocker.resolved_at = resolvedAt;
    if (resolvedByDecisionId) {
      blocker.resolved_by_decision_id = resolvedByDecisionId;
    }
  }
}

function stableErrorCode(error) {
  return typeof error?.code === "string" && error.code.length > 0
    ? error.code
    : null;
}

function applyIdempotentCommand({
  record,
  idempotencyKey,
  command,
  input,
  perform,
}) {
  // 同 key 同输入返回首次结果；同 key 不同输入必须拒绝，不能覆盖历史。
  const commands =
    record.commands ??
    record.idempotency ??
    (record.idempotency = {});
  const existing = existingCommand(
    { commands },
    idempotencyKey,
    command,
    input,
  );
  if (existing) {
    invariant(
      existing.status === "completed",
      "COMMAND_IN_PROGRESS",
      `Command ${idempotencyKey} is not complete`,
    );
    return structuredClone(existing.result);
  }
  const result = perform();
  commands[idempotencyKey] = {
    command,
    fingerprint: commandFingerprint(command, input),
    status: "completed",
    result: structuredClone(result),
  };
  return result;
}

function existingCommand(record, idempotencyKey, command, input) {
  const existing = record.commands?.[idempotencyKey];
  if (!existing) return null;
  const fingerprint = commandFingerprint(command, input);
  invariant(
    existing.command === command && existing.fingerprint === fingerprint,
    "IDEMPOTENCY_KEY_REUSED",
    `Idempotency key ${idempotencyKey} was used for different input`,
  );
  return existing;
}

function readIdempotentResult(
  record,
  idempotencyKey,
  command,
  input,
) {
  const existing = existingCommand(
    record,
    idempotencyKey,
    command,
    input,
  );
  invariant(
    existing?.status === "completed",
    "CHANGE_SET_ALREADY_EXISTS",
    `ChangeSet already exists without matching idempotency evidence`,
  );
  return structuredClone(existing.result);
}

function completeCommand(state, idempotencyKey, result, completedAt) {
  const command = state.commands[idempotencyKey];
  invariant(
    command?.status === "in_progress",
    "COMMAND_STATE_MISMATCH",
    `Command ${idempotencyKey} is not in progress`,
  );
  command.status = "completed";
  command.result = structuredClone(result);
  command.completed_at = completedAt;
}

function requireProject(catalog, projectId) {
  const project = catalog.projects[projectId];
  invariant(
    project,
    "PROJECT_NOT_FOUND",
    `Project ${projectId} does not exist`,
  );
  return project;
}

function requireRepository(project, repositoryId) {
  const repository = project.repositories.find(
    (candidate) => candidate.repository_id === repositoryId,
  );
  invariant(
    repository,
    "REPOSITORY_NOT_REGISTERED",
    `Repository ${repositoryId} is not registered in Project ${project.project_id}`,
    { repository_id: repositoryId, project_id: project.project_id },
  );
  return repository;
}

function normalizeRepositorySelectionChangeRequest(outcome, project) {
  // Agent 只能提出完整的新选择请求；这里验证结构，但不会解析 ref 或改变任何权限。
  invariant(
    outcome.request && typeof outcome.request === "object",
    "INVALID_REPOSITORY_SELECTION_CHANGE_REQUEST",
    "Repository selection change outcome requires a request object",
  );
  try {
    const selection = normalizeRepositorySelectionRequest(project, {
      planningRepositoryIds: outcome.request.planning_repository_ids,
      repositorySelections: outcome.request.repository_selections,
    });
    return {
      requested_repository_selection: selection,
      rationale: optionalString(outcome.request.rationale),
    };
  } catch (error) {
    if (error instanceof ChangeFleetError) {
      throw new ChangeFleetError(
        "INVALID_REPOSITORY_SELECTION_CHANGE_REQUEST",
        "Runtime requested an invalid Repository selection change",
        { cause_code: error.code },
      );
    }
    throw error;
  }
}

function currentPlan(state) {
  return (
    state.plans.find(
      (plan) => plan.revision === state.current_plan_revision,
    ) ?? null
  );
}

function currentRepositorySelection(state) {
  // 当前指针是唯一可执行权威；历史 revision 只保留用于审计和恢复判断。
  const selection =
    state.repository_selection_revisions.find(
      (candidate) =>
        candidate.revision ===
        state.current_repository_selection_revision,
    ) ?? null;
  invariant(
    selection?.status === "current",
    "INVALID_REPOSITORY_SELECTION_REVISION",
    "ChangeSet has no current Repository selection revision",
  );
  return selection;
}

function currentRepositoryHarnessSelection(state) {
  const selection = state.repository_harness_selection_revisions.find(
    (candidate) =>
      candidate.revision ===
      state.current_repository_harness_selection_revision,
  );
  invariant(
    selection?.status === "current",
    "INVALID_REPOSITORY_HARNESS_SELECTION_REVISION",
    "ChangeSet has no current Repository Harness selection revision",
  );
  return selection;
}

function assertRepositorySelectionRevisionAllowed(state, expectedRevision) {
  invariant(
    Number.isSafeInteger(expectedRevision) && expectedRevision > 0,
    "INVALID_REPOSITORY_SELECTION_REVISION",
    "Current Repository selection revision must be a positive integer",
  );
  invariant(
    state.phase === "planning",
    "INVALID_CHANGE_SET_STATE",
    `Cannot revise Repository selection in phase ${state.phase}`,
  );
  invariant(
    state.current_repository_selection_revision === expectedRevision,
    "STALE_REPOSITORY_SELECTION_REVISION",
    `Repository selection revision ${expectedRevision} is not current`,
  );
}

function assertRepositoryHarnessSelectionRevisionAllowed(
  state,
  expectedRevision,
) {
  invariant(
    Number.isSafeInteger(expectedRevision) && expectedRevision > 0,
    "INVALID_REPOSITORY_HARNESS_SELECTION_REVISION",
    "Current Repository Harness selection revision must be positive",
  );
  invariant(
    state.phase === "planning",
    "INVALID_CHANGE_SET_STATE",
    `Cannot revise Repository Harness selection in phase ${state.phase}`,
  );
  invariant(
    state.current_repository_harness_selection_revision === expectedRevision,
    "STALE_REPOSITORY_HARNESS_SELECTION_REVISION",
    `Repository Harness selection revision ${expectedRevision} is not current`,
  );
}

function unitsForCurrentPlan(state) {
  return state.work_units.filter(
    (workUnit) =>
      workUnit.plan_revision === state.current_plan_revision &&
      isCurrentWorkUnit(workUnit),
  );
}

function optionalString(value) {
  if (value === undefined || value === null || value === "") return null;
  invariant(
    typeof value === "string",
    "INVALID_STRING",
    "Expected a string",
  );
  return value.trim();
}

function comparablePath(value) {
  return path.resolve(value).toLowerCase();
}

function harnessSelectionForContext(selection) {
  return {
    repository_id: selection.repository_id,
    resolved_base_sha: selection.resolved_base_sha,
    mode: selection.mode,
    provider_family: selection.provider_family,
    workspace_policy_revision: selection.workspace_policy_revision,
    selector_digest: selection.selector_digest,
    resolved_relative_paths: [...selection.resolved_relative_paths],
    skipped_resources: structuredClone(selection.skipped_resources ?? []),
    content_digest: selection.content_digest,
    artifact_reference: selection.artifact_reference
      ? {
          snapshot_id: selection.artifact_reference.snapshot_id,
          snapshot_hash: selection.artifact_reference.snapshot_hash,
        }
      : null,
  };
}

function overlayHarnessResources(snapshot) {
  if (!snapshot) return [];
  return snapshot.files.map((file) => ({
    path: file.relative_path,
    source: "frozen_overlay",
    content_sha256: file.sha256,
    bytes: file.bytes,
    executable: file.executable,
    snapshot_id: snapshot.snapshot_id,
  }));
}

function repositoryHarnessObservation({
  repositoryId,
  exactBaseResources,
  overlayResources,
}) {
  // Run 证据保留完整的资源身份，并诚实声明当前 Codex 接口无法报告实际加载事件。
  return {
    repository_id: repositoryId,
    exact_base_resources: structuredClone(exactBaseResources),
    frozen_overlay_resources: structuredClone(overlayResources),
    provider_discovery: {
      coverage: "unavailable",
      discovered_resources: [],
      loaded_resources: [],
    },
  };
}

function harnessResourcesForContext(resources) {
  // Agent 投影只广告有界样本；完整无正文清单留在 Run 证据中按引用审计。
  const advertised = resources.slice(0, MAX_CONTEXT_HARNESS_RESOURCES);
  return {
    harness_resources: structuredClone(advertised),
    harness_resource_summary: {
      total_count: resources.length,
      advertised_count: advertised.length,
      omitted_count: resources.length - advertised.length,
      identity_digest: sha256(resources),
    },
  };
}

function harnessSelectionRequestFingerprint(value) {
  if (value === undefined) return null;
  invariant(
    Array.isArray(value),
    "INVALID_REPOSITORY_HARNESS_SELECTION",
    "repository_harness_selections must be an array",
  );
  return value
    .map((selection) => ({
      repository_id: normalizeId(
        "repository_harness_selection.repository_id",
        selection.repository_id,
      ),
      mode: selection.mode ?? null,
      provider_family: selection.provider_family ?? null,
      workspace_policy_revision:
        selection.workspace_policy_revision ?? null,
    }))
    .sort((left, right) =>
      left.repository_id.localeCompare(right.repository_id),
    );
}

function intentFingerprint(intent) {
  return {
    objective: intent.objective,
    rationale: intent.rationale,
    constraints: intent.constraints,
    non_goals: intent.non_goals,
    acceptance_criteria: intent.acceptance_criteria,
    resolved_decisions: intent.resolved_decisions,
    open_questions: intent.open_questions,
    source: intent.source,
  };
}
